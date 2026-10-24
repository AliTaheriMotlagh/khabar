// GET    /api/comments?post=ID          → { comments: [{ id, name, text, at }] } newest first
// POST   /api/comments  { post, guest, name, text, website }   (website is a honeypot: bots fill it)
// DELETE /api/comments?post=ID&id=CID  { guest }  — the guest who wrote it, or `Authorization: Bearer ADMIN_TOKEN`
import { randomUUID } from 'node:crypto';
import { MAX_COMMENTS, POINTS, award, cleanText, configured, fail, guestId, hash, json, limited, nameCmd, postId, preflight, readBody, redis } from './_lib.js';

const key = (post) => `c:${post}`;
const publicView = ({ id, name, text, at }) => ({ id, name, text, at });

export const OPTIONS = preflight;

export async function GET(request) {
  if (!configured()) return fail(request, 503, 'not configured');
  const post = postId(new URL(request.url).searchParams.get('post'));
  if (!post) return fail(request, 400, 'bad post');
  const [rows] = await redis(['LRANGE', key(post), '0', String(MAX_COMMENTS - 1)]);
  return json(request, { comments: rows.map((r) => publicView(JSON.parse(r))) }, { cache: 10 });
}

export async function POST(request) {
  if (!configured()) return fail(request, 503, 'not configured');
  const body = await readBody(request);
  const post = postId(body?.post);
  const guest = guestId(body?.guest);
  if (!body || !post || !guest) return fail(request, 400, 'bad request');
  if (body.website) return json(request, { comment: null }); // honeypot: pretend it worked

  const text = cleanText(body.text, 1000);
  const name = cleanText(body.name, 32).replace(/\n/g, ' ') || 'مهمان';
  if (text.length < 2) return fail(request, 400, 'too short');
  if ((text.match(/https?:\/\//g) || []).length > 2) return fail(request, 400, 'too many links');
  if ((await limited(request, 'c-min', 3, 60)) || (await limited(request, 'c-day', 40, 86400))) {
    return fail(request, 429, 'slow down');
  }

  const comment = { id: randomUUID().slice(0, 12), name, text, at: new Date().toISOString(), o: hash(guest) };
  await redis(
    ['LPUSH', key(post), JSON.stringify(comment)],
    ['LTRIM', key(post), '0', String(MAX_COMMENTS - 1)],
    ['HINCRBY', 'h:comments', post, '1'],
    ...award(comment.o, POINTS.comment),
    ...nameCmd(comment.o, name),
  );
  return json(request, { comment: publicView(comment) }, { status: 201 });
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
  const [rows] = await redis(['LRANGE', key(post), '0', String(MAX_COMMENTS - 1)]);
  const raw = rows.find((r) => JSON.parse(r).id === id);
  if (!raw) return fail(request, 404, 'not found');
  if (!admin && JSON.parse(raw).o !== owner) return fail(request, 403, 'not yours');

  const [removed] = await redis(['LREM', key(post), '1', raw]);
  if (removed) await redis(['HINCRBY', 'h:comments', post, '-1']);
  return json(request, { ok: true });
}
