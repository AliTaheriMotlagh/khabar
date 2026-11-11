// scripts/vercel-prune.mjs: which old Vercel deployments are deleted.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { toDelete } = await import('../scripts/vercel-prune.mjs');
const now = Date.UTC(2026, 10, 11, 12);
const h = 3600_000;
const d = (uid, hoursAgo, state = 'READY', target = 'production') => ({ uid, created: now - hoursAgo * h, state, target });

test('prune: keeps the live one, the newest ready production ones, and anything building or new', () => {
  const all = [
    d('new', 0.5), // younger than an hour
    d('p1', 2),
    d('building', 3, 'BUILDING'),
    d('p2', 4),
    d('err', 5, 'ERROR'),
    d('p3', 6),
    d('p4', 8),
    d('rolled-back-to', 30), // the domain points here after a rollback
    d('preview', 40, 'READY', null),
    d('p5', 50),
  ];
  const ids = (xs) => xs.map((x) => x.uid).sort();
  assert.deepEqual(ids(toDelete(all, { live: 'rolled-back-to', keep: 3, now })), ['err', 'p3', 'p4', 'p5', 'preview']);
  // 'new' is within the hour, and counts among the newest ready ones
  assert.deepEqual(ids(toDelete(all, { live: 'p1', keep: 2, now })), ['err', 'p2', 'p3', 'p4', 'p5', 'preview', 'rolled-back-to']);
});

test('prune: nothing is deleted without knowing the live deployment', () => {
  assert.deepEqual(toDelete([d('a', 10), d('b', 20)], { live: null, now }), []);
  assert.deepEqual(toDelete([d('a', 10), d('b', 20)], { live: undefined, now }), []);
});
