// src/lib/checks.ts: Gholam's numbers the English source never says (for /admin/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numbersIn, unmatchedNumbers } from '../src/lib/checks.ts';

const EN = 'GPT-6.2 Astra is the new leader in AA-Robotics v0.1, scoring 79, up 10 points on GPT-6 Astra and ahead of GPT-6.2 Sol (78), Claude Fable 5.2 (75). It raised $1.5K and 41% of 2,000 testers liked it, in 2026.';

test('checks: Persian digits, decimals and thousands read as the source writes them; years and small counts skipped', () => {
  assert.deepEqual([...numbersIn('امتیاز ۷۹ و ۱٫۵ و ۲٬۰۰۰ نفر در سال ۲۰۲۶ و ۳ بار')].sort(), ['1.5', '2000', '79']);
});

test('checks: a slipped digit is listed, the same figure in another unit is not', () => {
  assert.deepEqual(unmatchedNumbers('امتیاز ۷۹ گرفت و از Sol با ۷۸ جلو زد؛ ۴۱ درصد از ۲۰۰۰ نفر', EN), []);
  assert.deepEqual(unmatchedNumbers('۱۵۰۰ دلار جمع کرد', EN), [], '1500 = $1.5K');
  assert.deepEqual(unmatchedNumbers('امتیاز ۹۷ گرفت و ۱۴ درصد پسندیدند', EN), ['97', '14']);
  assert.deepEqual(unmatchedNumbers('امتیاز ۹۷', 'too short to judge'), [], 'no verdict on a bare link');
});

test('checks: only a likely slip is suspect — swapped digits, one wrong digit, a moved decimal point', async () => {
  const { suspectNumbers, nearMiss } = await import('../src/lib/checks.ts');
  assert.ok(nearMiss('14', '41') && nearMiss('1.5', '15') && nearMiss('1794', '1749') && nearMiss('350', '360'));
  assert.ok(!nearMiss('79', '78'), 'two real scores side by side');
  assert.deepEqual(suspectNumbers('۱۴ درصد پسندیدند و امتیاز ۷۹ گرفت', EN), [['14', '41']]);
  assert.deepEqual(suspectNumbers('۵۵۰ نفر آمدند', EN), [], 'a number the stored source lacks is not a slip');
});
