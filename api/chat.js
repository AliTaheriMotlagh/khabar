// GET  /api/chat → { messages: [{ id, name, text, at, c }] } newest first (the same response for everyone, CDN-cached)
// POST /api/chat { guest, name, text, website } → { message }
// One site-wide room for guests. `c` is a colour seed derived from the guest, so names keep their colour.
import { randomUUID } from 'node:crypto';
import { POINTS, award, cleanText, configured, fail, guestId, hash, json, limited, nameCmd, preflight, readBody, redis } from './_lib.js';

const KEY = 'chat';
const KEEP = 100;
const publicView = ({ id, name, text, at, c }) => ({ id, name, text, at, c });

export const OPTIONS = preflight;

export async function GET(request) {
  if (!configured()) return fail(request, 503, 'not configured');
  const [rows] = await redis(['LRANGE', KEY, '0', '49']);
  return json(request, { messages: rows.map((r) => publicView(JSON.parse(r))) }, { cache: 4 });
}

export async function POST(request) {
  if (!configured()) return fail(request, 503, 'not configured');
  const body = await readBody(request);
  const guest = guestId(body?.guest);
  if (!body || !guest) return fail(request, 400, 'bad request');
  if (body.website) return json(request, { message: null });

  const text = cleanText(body.text, 400).replace(/\n+/g, ' ');
  const name = cleanText(body.name, 32).replace(/\n/g, ' ') || 'مهمان';
  if (text.length < 1) return fail(request, 400, 'empty');
  if ((text.match(/https?:\/\//g) || []).length > 1) return fail(request, 400, 'too many links');
  const gh = hash(guest);
  if (await limited(request, ['chat-min', 8, 60, gh], ['chat-day', 300, 86400, gh], ['chat-ip', 60, 60])) {
    return fail(request, 429, 'slow down');
  }

  const message = { id: randomUUID().slice(0, 12), name, text, at: new Date().toISOString(), c: parseInt(gh.slice(0, 4), 16) % 360, o: gh };
  await redis(['LPUSH', KEY, JSON.stringify(message)], ['LTRIM', KEY, '0', String(KEEP - 1)], ...award(gh, POINTS.chat), ...nameCmd(gh, name));
  return json(request, { message: publicView(message) }, { status: 201 });
}
