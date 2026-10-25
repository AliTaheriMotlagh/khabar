// Dates, relative times and the story sets (src/lib/time.ts): node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseStories, daysAgo, decodeStories, encodeStories, isToday, relTime, storySet, tehranDay } from '../src/lib/time.ts';

// Tehran is UTC+3:30 all year (no daylight saving since 2022).
const at = (iso) => Date.parse(iso);

test('tehranDay: the calendar day in Tehran, not UTC', () => {
  assert.equal(tehranDay('2026-10-24T20:29:00Z'), '2026-10-24'); // 23:59 Tehran
  assert.equal(tehranDay('2026-10-24T20:30:00Z'), '2026-10-25'); // 00:00 Tehran
  assert.equal(tehranDay('2026-10-25T04:06:09+00:00'), '2026-10-25');
  // Summer too: no daylight-saving shift.
  assert.equal(tehranDay('2026-06-30T20:29:00Z'), '2026-06-30');
  assert.equal(tehranDay('2026-06-30T20:30:00Z'), '2026-07-01');
});

test('daysAgo / isToday: calendar days, not 24-hour blocks', () => {
  const now = at('2026-10-25T09:00:00Z'); // 12:30 Tehran
  assert.equal(daysAgo('2026-10-25T00:00:00Z', now), 0);
  assert.equal(daysAgo('2026-10-24T20:31:00Z', now), 0); // 00:01 Tehran today
  assert.equal(daysAgo('2026-10-24T20:29:00Z', now), 1); // 23:59 Tehran yesterday, only 12.5 hours ago
  assert.equal(daysAgo('2026-10-23T21:00:00Z', now), 1); // 00:30 Tehran yesterday, 36 hours ago
  assert.equal(daysAgo('2026-10-22T20:29:00Z', now), 3);
  assert.ok(isToday('2026-10-24T21:00:00Z', now));
  assert.ok(!isToday('2026-10-24T19:11:37Z', now));
  // Across a month and a year end.
  assert.equal(daysAgo('2026-12-31T12:00:00Z', at('2027-01-01T12:00:00Z')), 1);
});

test('relTime: minutes, hours, then calendar days, then the date', () => {
  const now = at('2026-10-25T09:00:00Z');
  const ago = (ms) => relTime(now - ms, now);
  assert.equal(ago(20e3), 'همین حالا');
  assert.equal(ago(5 * 6e4), '۵ دقیقه پیش');
  assert.equal(ago(3 * 36e5), '۳ ساعت پیش');
  assert.equal(ago(23 * 36e5), '۲۳ ساعت پیش');
  // 25 h ago is yesterday (Oct 24, 11:30 Tehran); 46 h ago is 23 Oct, 14:30 Tehran: two calendar days back.
  assert.equal(ago(25 * 36e5), 'دیروز');
  assert.equal(ago(46 * 36e5), 'پریروز');
  // 47 h apart but still yesterday on the calendar (24 Oct 00:30 → 25 Oct 23:30 Tehran): rounding 24-hour blocks said
  // "two days ago" while the timeline listed it under yesterday.
  assert.equal(relTime(at('2026-10-23T21:00:00Z'), at('2026-10-25T20:00:00Z')), 'دیروز');
  assert.equal(ago(4 * 864e5), '۴ روز پیش');
  // A week or more: the Persian calendar date.
  assert.match(ago(10 * 864e5), /^[۰-۹]+ مهر$/);
  // A clock a little behind the post never shows a negative time.
  assert.equal(relTime(now + 60e3, now), 'همین حالا');
});

const items = [
  { id: 6105, at: at('2026-10-25T08:00:00Z') }, // 11:30 Tehran, today
  { id: 6104, at: at('2026-10-24T21:00:00Z') }, // 00:30 Tehran, today
  { id: 6099, at: at('2026-10-24T19:11:37Z') }, // 22:41 Tehran, yesterday
  { id: 6091, at: at('2026-10-24T15:56:35Z') },
  { id: 6088, at: at('2026-10-24T03:43:20Z') },
];

test('chooseStories: today follows the clock, not the newest story', () => {
  const ids = (list) => list.map((i) => i.id);
  assert.deepEqual(ids(chooseStories('today', items, { now: at('2026-10-25T09:00:00Z') })), [6105, 6104]);
  // Early morning, nothing yet today: an empty set (the rail hides it), never yesterday's stories under «امروز».
  assert.deepEqual(ids(chooseStories('today', items.slice(2), { now: at('2026-10-25T03:00:00Z') })), []);
  // The next day the same page has no "today" stories left.
  assert.deepEqual(ids(chooseStories('today', items, { now: at('2026-10-26T06:00:00Z') })), []);
  assert.deepEqual(ids(chooseStories('all', items, { now: at('2026-10-26T06:00:00Z') })), ids(items));
});

test('chooseStories: new and unseen follow the reader, newest first, capped', () => {
  const read = new Set([6105, 6091]);
  const opts = { now: at('2026-10-25T09:00:00Z'), unread: (id) => !read.has(id), pending: new Set([6105, 6104, 6088]) };
  assert.deepEqual(chooseStories('unseen', items, opts).map((i) => i.id), [6104, 6099, 6088]);
  assert.deepEqual(chooseStories('new', items, opts).map((i) => i.id), [6104, 6088]);
  assert.deepEqual(chooseStories('new', items, { ...opts, pending: new Set() }), []);
  const many = Array.from({ length: 50 }, (_, i) => ({ id: 1000 - i, at: at('2026-10-25T08:00:00Z') - i * 6e4 }));
  assert.equal(chooseStories('unseen', many).length, 20);
  assert.equal(chooseStories('unseen', many)[0].id, 1000);
  assert.equal(chooseStories('all', many).length, 50);
});

test('storySet and the rail encoding', () => {
  assert.equal(storySet('new'), 'new');
  assert.equal(storySet('bogus'), 'today');
  assert.equal(storySet(null), 'today');
  const list = [{ id: 6099, at: at('2026-10-24T19:11:37Z') }, { id: 6098, at: at('2026-10-24T18:45:45Z') }];
  assert.equal(encodeStories(list), '6099:1792869097,6098:1792867545');
  assert.deepEqual(decodeStories(encodeStories(list)), list);
  assert.deepEqual(decodeStories(''), []);
  assert.deepEqual(decodeStories('6099:x,abc,6098:1792867545'), [list[1]]);
});
