'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveHomepage, validateSchedule, sanitizeSchedule, normalizeTemporaryHomepage,
} = require('../src/shared/homepage.js');

const base = 'https://kagi.com/';
const board = 'https://example.com/board';
const meeting = 'https://example.com/meeting';

function rule(overrides = {}) {
  return {
    id: 'work', name: 'Work', days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00',
    homepage: board, enabled: true, ...overrides,
  };
}

function localDate(day, hour, minute) {
  return new Date(2026, 10, day, hour, minute);
}

test('a temporary homepage overrides the weekly schedule from its start through just before expiration', () => {
  const temporaryHomepage = {
    homepage: meeting, startsAt: +localDate(27, 17, 30), expiresAt: +localDate(27, 18, 30),
  };
  const config = { homepage: base, advancedEnabled: true, rules: [rule()], temporaryHomepage };

  const cases = [
    [localDate(27, 17, 29), board, 'schedule', 'work'],
    [localDate(27, 17, 30), meeting, 'temporary', null],
    [localDate(27, 18, 0), meeting, 'temporary', null],
    [new Date(temporaryHomepage.expiresAt - 1), meeting, 'temporary', null],
    [localDate(27, 18, 30), base, 'base', null],
    [localDate(30, 9, 0), board, 'schedule', 'work'],
  ];
  for (const [instant, homepage, source, ruleId] of cases) {
    assert.deepEqual(resolveHomepage(config, instant), { homepage, source, ruleId });
  }

  assert.equal(resolveHomepage({ ...config, temporaryHomepage: null }, localDate(27, 17, 45)).homepage, board);
  const earlier = { ...temporaryHomepage, expiresAt: +localDate(27, 17, 45) };
  assert.equal(resolveHomepage({ ...config, temporaryHomepage: earlier }, earlier.expiresAt).homepage, board);
});

test('overnight schedules belong to their starting day, including across the week boundary', () => {
  const config = { homepage: base, advancedEnabled: true, rules: [rule({ days: [0, 5, 6], start: '22:00', end: '02:00' })] };
  for (const day of [27, 28, 29]) {
    assert.equal(resolveHomepage(config, localDate(day, 21, 59)).homepage, base);
    assert.equal(resolveHomepage(config, localDate(day, 22, 0)).homepage, board);
    assert.equal(resolveHomepage(config, localDate(day + 1, 1, 59)).homepage, board);
    assert.equal(resolveHomepage(config, localDate(day + 1, 2, 0)).homepage, base);
  }
});

test('validation reports actual intersections, permits adjacent rules and excludes disabled rules', () => {
  const overnight = rule({ days: [0], start: '22:00', end: '02:00' });
  const next = rule({ id: 'next', name: 'Next', days: [1], start: '01:00', end: '03:00' });
  assert.deepEqual(validateSchedule([overnight, next]).errors, [
    { code: 'overlap', index: 1, otherIndex: 0, day: 1, start: 60, end: 120 },
  ]);
  assert.deepEqual(validateSchedule([overnight, { ...next, start: '02:00' }]).errors, []);
  assert.deepEqual(validateSchedule([overnight, { ...next, enabled: false }]).errors, []);
  assert.deepEqual(validateSchedule([rule({ start: '18:00' })]).errors, [
    { code: 'equalTimes', index: 0, field: 'end' },
  ]);
});

test('repair skips only unusable or conflicting rules and validates temporary data independently', () => {
  const first = rule();
  const malformed = rule({ id: 'malformed', homepage: 'javascript:alert(1)' });
  const overlapping = rule({ id: 'overlapping', start: '10:00', end: '12:00' });
  const independent = rule({ id: 'weekend', days: [6, 0, 6], homepage: 'example.org' });
  assert.deepEqual(sanitizeSchedule([first, malformed, overlapping, independent]), {
    rules: [first, { ...independent, days: [0, 6], homepage: 'https://example.org/' }],
    needsRepair: true,
  });
  assert.deepEqual(sanitizeSchedule({}), { rules: [], needsRepair: true });
  assert.equal(normalizeTemporaryHomepage({ homepage: meeting, startsAt: 5, expiresAt: 5 }), null);
  assert.equal(normalizeTemporaryHomepage({ homepage: meeting, startsAt: 5, expiresAt: Infinity }), null);
  assert.deepEqual(normalizeTemporaryHomepage({ homepage: 'example.org', startsAt: 5, expiresAt: 10 }), {
    homepage: 'https://example.org/', startsAt: 5, expiresAt: 10,
  });
});

test('local weekly times follow timezone and DST while temporary expiration uses an absolute timestamp', () => {
  const originalTimezone = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    const early = { homepage: base, advancedEnabled: true, rules: [rule({ days: [0], start: '01:00', end: '02:00' })] };
    // The repeated local hour matches for both occurrences.
    assert.equal(resolveHomepage(early, new Date('2026-11-01T05:30:00Z')).homepage, board);
    assert.equal(resolveHomepage(early, new Date('2026-11-01T06:30:00Z')).homepage, board);
    assert.equal(resolveHomepage(early, new Date('2026-11-01T07:00:00Z')).homepage, base);

    const gap = { homepage: base, advancedEnabled: true, rules: [rule({ days: [0], start: '02:00', end: '03:00' })] };
    assert.equal(resolveHomepage(gap, new Date('2026-03-08T06:59:59Z')).homepage, base);
    assert.equal(resolveHomepage(gap, new Date('2026-03-08T07:00:00Z')).homepage, base);

    const beforeSwitch = Date.parse('2026-11-01T05:30:00Z');
    const temporaryHomepage = { homepage: meeting, startsAt: beforeSwitch, expiresAt: beforeSwitch + 3600000 };
    assert.equal(resolveHomepage({ ...early, temporaryHomepage }, beforeSwitch).homepage, meeting);
    process.env.TZ = 'UTC';
    assert.equal(resolveHomepage(early, beforeSwitch).homepage, base);
    assert.equal(resolveHomepage({ ...early, temporaryHomepage }, temporaryHomepage.expiresAt - 1).homepage, meeting);
    assert.equal(resolveHomepage({ ...early, temporaryHomepage }, temporaryHomepage.expiresAt).homepage, base);
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});
