// Comments' keys and moderation, shared by comments.js (readers) and admin.js (the site's owner).
//   c:<post>            list of comments (JSON), newest first
//   cl:<post>           hash: comment id → likes          cl:<post>:<id>  set: who liked it (guest hashes)
//   cr:<post>:<id>      set: who reported it               reports         zset: "<post>:<id>" → number of reports
//   ch:<post>           set: comment ids hidden (REPORT_HIDE reports, or by the owner) — left out of the list
//   c:recent            list: the newest comments site-wide (for the admin page), RECENT kept
import { MAX_COMMENTS, redis } from './_lib.js';

export const REPORT_HIDE = 3;
export const RECENT = 200;
export const commentKey = (post) => `c:${post}`;
export const commentId = (v) => (typeof v === 'string' && /^[0-9a-f-]{8,40}$/.test(v) ? v : null);
/** What a reader sees of a comment (never its author's hash). */
export const publicView = ({ id, name, text, at, q, re }) => ({ id, name, text, at, ...(q && { quote: q }), ...(re && { re }) });
/** The entry in c:recent: built the same way every time, so deleting finds it (LREM matches the exact string). */
export const recentEntry = (post, c) => JSON.stringify({ post: Number(post), ...publicView(c) });

/** The comment's stored JSON and parsed value, or null. */
export async function findComment(post, id) {
  const [rows] = await redis(['LRANGE', commentKey(post), '0', String(MAX_COMMENTS - 1)]);
  const raw = rows.find((r) => JSON.parse(r).id === id);
  return raw ? { raw, comment: JSON.parse(raw) } : null;
}

/** Hides a comment from readers (it stays stored, for the owner to look at). True when it was visible. */
export async function hideComment(post, id) {
  const [added] = await redis(['SADD', `ch:${post}`, id]);
  if (added) await redis(['HINCRBY', 'h:comments', String(post), '-1']);
  return Boolean(added);
}

/** Shows a hidden comment again and forgets its reports. */
export async function unhideComment(post, id) {
  const [removed] = await redis(['SREM', `ch:${post}`, id], ['DEL', `cr:${post}:${id}`], ['ZREM', 'reports', `${post}:${id}`]);
  if (removed) await redis(['HINCRBY', 'h:comments', String(post), '1']);
  return Boolean(removed);
}

/** Deletes a comment for good, with its likes, reports and place in the recent list. */
export async function deleteComment(post, found) {
  const { raw, comment } = found;
  const [removed, , , , , hidden] = await redis(
    ['LREM', commentKey(post), '1', raw],
    ['HDEL', `cl:${post}`, comment.id],
    ['DEL', `cl:${post}:${comment.id}`],
    ['DEL', `cr:${post}:${comment.id}`],
    ['ZREM', 'reports', `${post}:${comment.id}`],
    ['SREM', `ch:${post}`, comment.id],
    ['LREM', 'c:recent', '1', recentEntry(post, comment)],
  );
  // A hidden comment was already taken off the count.
  if (removed && !hidden) await redis(['HINCRBY', 'h:comments', String(post), '-1']);
  return Boolean(removed);
}
