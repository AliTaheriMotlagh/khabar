// POST /api/react { post, guest, reaction, on } → { count }
// Each guest counts once per reaction per post: a set of guest hashes guards a counter hash.
import { POINTS, REACTIONS, award, configured, fail, guestId, hash, json, limited, postId, preflight, readBody, redis } from './_lib.js';

export const OPTIONS = preflight;

export async function POST(request) {
  if (!configured()) return fail(request, 503, 'not configured');
  const body = await readBody(request);
  const post = postId(body?.post);
  const guest = guestId(body?.guest);
  const reaction = REACTIONS.includes(body?.reaction) ? body.reaction : null;
  if (!post || !guest || !reaction) return fail(request, 400, 'bad request');
  if (await limited(request, 'r-min', 40, 60)) return fail(request, 429, 'slow down');

  const gh = hash(guest);
  const [changed] = await redis([body.on ? 'SADD' : 'SREM', `rx:${post}:${reaction}`, gh]);
  const count = changed
    ? (await redis(['HINCRBY', `h:react:${reaction}`, post, body.on ? '1' : '-1'], ...(body.on ? award(gh, POINTS.react) : [])))[0]
    : (await redis(['HMGET', `h:react:${reaction}`, post]))[0][0];
  return json(request, { count: Math.max(0, Number(count) || 0) });
}
