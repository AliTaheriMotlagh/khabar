// GET    /api/comments?post=ID → { comments: [{ id, name, text, at, quote?, re?, likes? }] } newest first; hidden ones left out
// POST   /api/comments  { post, guest, name, text, quote?, re?, website }   a new comment (website is a honeypot: bots fill it)
//        quote: the words of the story it is about, highlighted by the reader (one line, up to 300 characters)
//        re: the comment it answers — replies are one level deep, so an answer to a reply goes under the same comment
// POST   /api/comments  { action: 'like', post, id, guest, on } → { likes }      once per guest, can be taken back
// POST   /api/comments  { action: 'report', post, id, guest } → { hidden }     REPORT_HIDE reports hide it until the
//        owner looks (admin.js)
// DELETE /api/comments?post=ID&id=CID  { guest }  — the guest who wrote it, or `Authorization: Bearer ADMIN_TOKEN`
// Keys: see _moderation.js.
import { randomUUID } from 'node:crypto';
import { MAX_COMMENTS, POINTS, award, cleanText, configured, fail, guestId, hash, json, limited, nameCmd, postId, preflight, readBody, redis } from './_lib.js';
import { RECENT, REPORT_HIDE, commentId, commentKey, deleteComment, findComment, hideComment, publicView, recentEntry } from './_moderation.js';

export const OPTIONS = preflight;

export async function GET(request) {
  if (!configured()) return fail(request, 503, 'not configured');
  const post = postId(new URL(request.url).searchParams.get('post'));
  if (!post) return fail(request, 400, 'bad post');
  const [rows, likes, hidden] = await redis(['LRANGE', commentKey(post), '0', String(MAX_COMMENTS - 1)], ['HGETALL', `cl:${post}`], ['SMEMBERS', `ch:${post}`]);
  const liked = new Map();
  for (let i = 0; i + 1 < (likes?.length ?? 0); i += 2) liked.set(likes[i], Number(likes[i + 1]) || 0);
  const off = new Set(hidden ?? []);
  const comments = rows
    .map((r) => JSON.parse(r))
    .filter((c) => !off.has(c.id))
    .map((c) => {
      const v = publicView(c);
      const n = liked.get(c.id);
      return n > 0 ? { ...v, likes: n } : v;
    });
  return json(request, { comments }, { cache: 10 });
}

export async function POST(request) {
  if (!configured()) return fail(request, 503, 'not configured');
  const body = await readBody(request);
  const post = postId(body?.post);
  const guest = guestId(body?.guest);
  if (!body || !post || !guest) return fail(request, 400, 'bad request');
  if (body.action === 'like') return like(request, post, guest, body);
  if (body.action === 'report') return report(request, post, guest, body);
  if (body.action) return fail(request, 400, 'bad action');
  if (body.website) return json(request, { comment: null }); // honeypot: pretend it worked

  const text = cleanText(body.text, 1000);
  const name = cleanText(body.name, 32).replace(/\n/g, ' ') || 'مهمان';
  const quote = cleanText(body.quote, 300).replace(/\s+/g, ' ').trim();
  if (text.length < 2) return fail(request, 400, 'too short');
  if ((text.match(/https?:\/\//g) || []).length > 2) return fail(request, 400, 'too many links');
  const gh = hash(guest);
  if (await limited(request, ['c-min', 3, 60, gh], ['c-day', 40, 86400, gh], ['c-ip', 20, 60], ['c-ip-day', 400, 86400])) {
    return fail(request, 429, 'slow down');
  }
  // A reply goes under a comment that exists; an answer to a reply goes under the same comment.
  let re;
  if (body.re != null) {
    const id = commentId(body.re);
    const parent = id && (await findComment(post, id));
    if (!parent) return fail(request, 400, 'no such comment');
    re = parent.comment.re ?? parent.comment.id;
  }

  const comment = { id: randomUUID().slice(0, 12), name, text, at: new Date().toISOString(), o: gh, ...(quote.length >= 2 && { q: quote }), ...(re && { re }) };
  await redis(
    ['LPUSH', commentKey(post), JSON.stringify(comment)],
    ['LTRIM', commentKey(post), '0', String(MAX_COMMENTS - 1)],
    ['HINCRBY', 'h:comments', post, '1'],
    ['LPUSH', 'c:recent', recentEntry(post, comment)],
    ['LTRIM', 'c:recent', '0', String(RECENT - 1)],
    ...award(comment.o, POINTS.comment),
    ...nameCmd(comment.o, name),
  );
  return json(request, { comment: publicView(comment) }, { status: 201 });
}

async function like(request, post, guest, body) {
  const id = commentId(body.id);
  if (!id) return fail(request, 400, 'bad comment');
  const gh = hash(guest);
  if (await limited(request, ['cl-min', 30, 60, gh])) return fail(request, 429, 'slow down');
  const on = body.on !== false;
  const [changed] = await redis([on ? 'SADD' : 'SREM', `cl:${post}:${id}`, gh]);
  const [likes] = changed ? await redis(['HINCRBY', `cl:${post}`, id, on ? '1' : '-1']) : await redis(['HGET', `cl:${post}`, id]);
  return json(request, { likes: Math.max(0, Number(likes) || 0) });
}

async function report(request, post, guest, body) {
  const id = commentId(body.id);
  if (!id) return fail(request, 400, 'bad comment');
  const gh = hash(guest);
  if (await limited(request, ['cr-day', 20, 86400, gh])) return fail(request, 429, 'slow down');
  const [added] = await redis(['SADD', `cr:${post}:${id}`, gh]);
  if (!added) return json(request, { hidden: false });
  const [score] = await redis(['ZINCRBY', 'reports', '1', `${post}:${id}`]);
  const hidden = Number(score) >= REPORT_HIDE && (await hideComment(post, id));
  return json(request, { hidden: Boolean(hidden) });
}

export async function DELETE(request) {
  if (!configured()) return fail(request, 503, 'not configured');
  const params = new URL(request.url).searchParams;
  const post = postId(params.get('post'));
  const id = params.get('id');
  const body = (await readBody(request)) || {};
  if (!post || !id) return fail(request, 400, 'bad request');

  const admin = process.env.ADMIN_TOKEN && request.headers.get('authorization') === `Bearer ${process.env.ADMIN_TOKEN}`;
  const owner = guestId(body.guest) && hash(body.guest);
  const found = await findComment(post, id);
  if (!found) return fail(request, 404, 'not found');
  if (!admin && found.comment.o !== owner) return fail(request, 403, 'not yours');
  await deleteComment(post, found);
  return json(request, { ok: true });
}
