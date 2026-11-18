// The site-health issue's summary of a failing `node --test` run (scripts/health-issue.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summary } from '../scripts/health-issue.mjs';

test('health: the failing tests and why, once each, without timings', () => {
  const log = [
    '✔ timeline: every post once (12.3ms)',
    '✖ videos: a page per video, newest first (2.58ms)',
    'ℹ fail 1',
    '✖ failing tests:',
    '✖ videos: a page per video, newest first (2.58ms)',
    '  AssertionError [ERR_ASSERTION]: every video, newest first',
  ].join('\n');
  assert.equal(summary(log), '✖ videos: a page per video, newest first\n\nAssertionError [ERR_ASSERTION]: every video, newest first');
  assert.equal(summary(''), '');
});
