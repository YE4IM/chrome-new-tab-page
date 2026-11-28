const test = require('node:test');
const assert = require('node:assert/strict');

const {
  pad2,
  pad4,
  parseDateTimeValue,
  formatDateTimeValue,
  parseTimeValue,
  formatTimeValue,
  getFirstDayOfWeek,
  stepMonth,
  buildCalendarCells,
  clampTimePart,
} = require('../src/options/datetime-picker.js');

test('parseDateTimeValue 与 formatDateTimeValue 往返并拒绝非法输入', () => {
  const parsed = parseDateTimeValue('2026-11-28T21:47');
  assert.deepEqual(parsed, { year: 2026, month: 10, day: 28, hour: 21, minute: 47 });
  assert.equal(formatDateTimeValue(parsed), '2026-11-28T21:47');
  assert.equal(formatDateTimeValue({ year: 2026, month: 0, day: 5, hour: 3, minute: 9 }), '2026-01-05T03:09');

  for (const invalid of [
    '',
    '2026-02-30T10:00',
    '2025-02-29T10:00',
    '2026-13-01T10:00',
    '2026-11-28T24:00',
    '2026-11-28T12:60',
    'not-a-date',
    null,
  ]) {
    assert.equal(parseDateTimeValue(invalid), null);
  }
  assert.deepEqual(parseDateTimeValue('2024-02-29T00:00'), { year: 2024, month: 1, day: 29, hour: 0, minute: 0 });
});

test('parseTimeValue 与 formatTimeValue 校验时分范围', () => {
  assert.deepEqual(parseTimeValue('09:05'), { hour: 9, minute: 5 });
  assert.equal(formatTimeValue({ hour: 9, minute: 5 }), '09:05');
  assert.deepEqual(parseTimeValue('23:59'), { hour: 23, minute: 59 });
  assert.equal(parseTimeValue('24:00'), null);
  assert.equal(parseTimeValue('12:60'), null);
  assert.equal(parseTimeValue('9:05'), null);
  assert.equal(parseTimeValue(''), null);
});

test('buildCalendarCells 始终生成 42 格并正确处理闰年、跨年与周起始日', () => {
  // 2026-11-01 is Sunday.
  const zhCells = buildCalendarCells(2026, 10, 1);
  assert.equal(zhCells.length, 42);
  // Monday-first grid starts on Oct 26, 2026
  assert.deepEqual(zhCells[0], { year: 2026, month: 9, day: 26, outside: true });
  assert.deepEqual(zhCells[6], { year: 2026, month: 10, day: 1, outside: false });
  assert.deepEqual(zhCells[35], { year: 2026, month: 10, day: 30, outside: false });
  assert.deepEqual(zhCells[36], { year: 2026, month: 11, day: 1, outside: true });

  // Sunday-first grid starts directly on Nov 1, 2026
  const enCells = buildCalendarCells(2026, 10, 0);
  assert.equal(enCells.length, 42);
  assert.deepEqual(enCells[0], { year: 2026, month: 10, day: 1, outside: false });
  assert.deepEqual(enCells[30], { year: 2026, month: 11, day: 1, outside: true });

  // Leap year Feb 2024 vs non-leap Feb 2026
  const leapFeb = buildCalendarCells(2024, 1, 1);
  assert.equal(leapFeb.filter((c) => !c.outside).length, 29);
  const nonLeapFeb = buildCalendarCells(2026, 1, 1);
  assert.equal(nonLeapFeb.filter((c) => !c.outside).length, 28);

  // January wraps backwards into previous December
  const janCells = buildCalendarCells(2026, 0, 1); // Jan 1, 2026 is Thursday
  assert.deepEqual(janCells[0], { year: 2025, month: 11, day: 29, outside: true });
  assert.deepEqual(janCells[3], { year: 2026, month: 0, day: 1, outside: false });
});

test('stepMonth 正确跨越年份边界并限制安全区间', () => {
  assert.deepEqual(stepMonth(2026, 11, 1), { year: 2027, month: 0 });
  assert.deepEqual(stepMonth(2026, 0, -1), { year: 2025, month: 11 });
  assert.deepEqual(stepMonth(1000, 0, -1), { year: 1000, month: 0 });
  assert.deepEqual(stepMonth(9999, 11, 1), { year: 9999, month: 11 });
});

test('getFirstDayOfWeek 与 clampTimePart 返回合理结果', () => {
  assert.equal(getFirstDayOfWeek('zh-CN'), 1);
  assert.equal(getFirstDayOfWeek('en-US'), 0);
  assert.equal(clampTimePart(24, 23), 0);
  assert.equal(clampTimePart(-1, 23), 23);
  assert.equal(clampTimePart(60, 59), 0);
  assert.equal(clampTimePart(-1, 59), 59);
  assert.equal(pad2(5), '05');
  assert.equal(pad4(99), '0099');
});
