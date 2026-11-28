const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findNextEnabledIndex,
  findEdgeEnabledIndex,
  findTypeaheadIndex,
  computePopoverPosition,
} = require('../src/options/custom-select.js');

test('findNextEnabledIndex 与 findEdgeEnabledIndex 跳过禁用项并正确收敛边界', () => {
  const options = [
    { label: 'Disabled first', disabled: true },
    { label: '30 分钟', disabled: false },
    { label: 'Disabled middle', disabled: true },
    { label: '1 小时', disabled: false },
    { label: '指定结束时间', disabled: false },
    { label: 'Disabled last', disabled: true },
  ];

  assert.equal(findEdgeEnabledIndex(options, false), 1);
  assert.equal(findEdgeEnabledIndex(options, true), 4);
  assert.equal(findNextEnabledIndex(options, 1, 1), 3);
  assert.equal(findNextEnabledIndex(options, 3, -1), 1);
  assert.equal(findNextEnabledIndex(options, 4, 1), 4);
  assert.equal(findNextEnabledIndex(options, 1, -1), 1);
  assert.equal(findNextEnabledIndex(options, -1, 1), 1);

  const allDisabled = [{ disabled: true }, { disabled: true }];
  assert.equal(findEdgeEnabledIndex(allDisabled, false), -1);
  assert.equal(findEdgeEnabledIndex(allDisabled, true), -1);
  assert.equal(findNextEnabledIndex(allDisabled, 0, 1), -1);
  assert.equal(findNextEnabledIndex([], 0, 1), -1);
});

test('findTypeaheadIndex 忽略大小写与前后空白并从当前位置循环匹配', () => {
  const options = [
    { label: '  Alpha  ', disabled: false },
    { label: 'Beta', disabled: true },
    { label: 'Bravo', disabled: false },
    { label: 'Charlie', disabled: false },
    { label: 'Another', disabled: false },
  ];

  assert.equal(findTypeaheadIndex(options, 'b', -1), 2);
  assert.equal(findTypeaheadIndex(options, 'a', 0), 4);
  assert.equal(findTypeaheadIndex(options, 'a', 4), 0);
  assert.equal(findTypeaheadIndex(options, 'ch', 0), 3);
  assert.equal(findTypeaheadIndex(options, 'z', 0), -1);
  assert.equal(findTypeaheadIndex(options, '   ', 0), -1);
});

test('computePopoverPosition 优先向下展开，底部空间不足时向上翻转并钳制水平边距', () => {
  const viewport = { width: 400, height: 600 };

  const below = computePopoverPosition(
    { left: 40, top: 100, bottom: 140, width: 320 },
    { width: 320, height: 120 },
    viewport,
  );
  assert.deepEqual(below, { left: 40, top: 146, width: 320, placement: 'bottom' });

  const above = computePopoverPosition(
    { left: 40, top: 520, bottom: 560, width: 320 },
    { width: 320, height: 120 },
    viewport,
  );
  assert.deepEqual(above, { left: 40, top: 394, width: 320, placement: 'top' });

  const clamped = computePopoverPosition(
    { left: 260, top: 100, bottom: 140, width: 220 },
    { width: 220, height: 100 },
    viewport,
  );
  assert.deepEqual(clamped, { left: 168, top: 146, width: 220, placement: 'bottom' });

  const narrowViewport = computePopoverPosition(
    { left: 20, top: 100, bottom: 140, width: 500 },
    { width: 376, height: 100 },
    viewport,
  );
  assert.deepEqual(narrowViewport, { left: 12, top: 146, width: 376, placement: 'bottom' });
});
