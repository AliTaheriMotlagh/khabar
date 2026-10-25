// Dates, relative times and the story sets (src/lib/time.ts): node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysAgo, decodeStories, dropCompanions, encodeStories, isToday, lastDays, nextUnseen, pickStories, relTime, tehranDay } from '../src/lib/time.ts';

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

const h = (n) => at('2026-10-25T08:00:00Z') - n * 36e5; // n hours before 11:30 Tehran
const story = (id, hours, kind = 'story') => ({ id, at: h(hours), kind });

test('dropCompanions: the forwarded original a story comments on, stamped the same second, is the same news', () => {
  const list = [story(6100, 1, 'brief'), story(6099, 1), story(6098, 2, 'brief'), story(5829, 3), story(5828, 3)];
  assert.deepEqual(dropCompanions(list).map((i) => i.id), [6099, 6098, 5829, 5828]);
});

test('pickStories: only the unseen, today or all, newest or oldest first', () => {
  // 11:30 Tehran on the 25th: 0–11 hours back is today, 12 hours back is yesterday.
  const now = h(0);
  const items = [story(5, 0), story(4, 3), story(3, 11), story(2, 12), story(1, 30)];
  const ids = (list) => list.map((i) => i.id);
  const unread = (id) => id !== 4 && id !== 2;
  assert.deepEqual(ids(pickStories(items, 'unseen', 'new', unread, now)), [5, 3, 1]);
  assert.deepEqual(ids(pickStories(items, 'unseen', 'old', unread, now)), [1, 3, 5]);
  assert.deepEqual(ids(pickStories(items, 'today', 'new', unread, now)), [5, 4, 3]);
  assert.deepEqual(ids(pickStories(items, 'all', 'old', unread, now)), [1, 2, 3, 4, 5]);
  assert.deepEqual(ids(items), [5, 4, 3, 2, 1], 'the list given is left alone');
});

test('nextUnseen: the next story not seen yet, then the newer ones skipped at the start, then the end', () => {
  const items = [1, 2, 3, 4, 5].map((id) => ({ id, at: h(id) })); // newest first, the order they play in
  const seen = new Set();
  const unread = (id) => !seen.has(id);
  assert.equal(nextUnseen(items, 0, unread), 1);
  // Opened at the third (a rail circle further along): on to the fourth and fifth, then back for the first two.
  seen.add(3);
  assert.equal(nextUnseen(items, 2, unread), 3);
  seen.add(4).add(5);
  assert.equal(nextUnseen(items, 4, unread), 0);
  seen.add(1);
  assert.equal(nextUnseen(items, 0, unread), 1);
  // Gone back to a story already seen: forward skips what was seen.
  assert.equal(nextUnseen(items, 2, unread), 1);
  seen.add(2);
  assert.equal(nextUnseen(items, 1, unread), -1);
  assert.equal(nextUnseen([], 0, unread), -1);
});

test('lastDays: three whole Tehran days up to the newest story, oldest days dropped past the cap', () => {
  const ids = (list) => list.map((i) => i.id);
  // Newest at 10:00 Tehran on the 25th; 72 hours back would cut the 22nd in half — calendar days keep it whole.
  const list = [
    { id: 9, at: at('2026-10-25T06:30:00Z') }, // 25th 10:00
    { id: 8, at: at('2026-10-24T20:31:00Z') }, // 25th 00:01
    { id: 7, at: at('2026-10-24T20:29:00Z') }, // 24th 23:59
    { id: 6, at: at('2026-10-23T05:00:00Z') }, // 23rd
    { id: 5, at: at('2026-10-22T21:00:00Z') }, // 23rd 00:30
    { id: 4, at: at('2026-10-22T19:00:00Z') }, // 22nd 22:30
  ];
  assert.deepEqual(ids(lastDays(list)), [9, 8, 7, 6, 5]);
  assert.deepEqual(ids(lastDays(list, 2)), [9, 8, 7]);
  // Over the cap: the 23rd goes as a whole day, never half of it.
  assert.deepEqual(ids(lastDays(list, 3, 4)), [9, 8, 7]);
  // A single day busier than the cap keeps its newest.
  assert.deepEqual(ids(lastDays(list, 1, 1)), [9]);
  assert.deepEqual(lastDays([]), []);
});

test('the rail encoding', () => {
  const list = [{ id: 6099, at: at('2026-10-24T19:11:37Z') }, { id: 6098, at: at('2026-10-24T18:45:45Z') }];
  assert.equal(encodeStories(list), '6099:1792869097,6098:1792867545');
  assert.deepEqual(decodeStories(encodeStories(list)), list);
  assert.deepEqual(decodeStories(''), []);
  assert.deepEqual(decodeStories('6099:x,abc,6098:1792867545'), [list[1]]);
});
