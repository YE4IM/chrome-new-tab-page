/* 新标签跳转和设置预览共用的时间规则。 */
(function (root) {
  'use strict';

  const DEFAULT_HOMEPAGE = 'https://kagi.com/';
  const MINUTES_PER_DAY = 24 * 60;

  function normalizeHomepage(raw) {
    if (typeof raw !== 'string') return null;
    const value = raw.trim();
    if (!value || /[\u0000-\u001f\u007f]/.test(value)) return null;
    const scheme = value.match(/^([a-z][a-z\d+.-]*):/i);
    const hostWithPort = /^[^\s/?#:]+:\d+(?:[/?#]|$)/.test(value);
    if (scheme && !/^https?$/i.test(scheme[1])) {
      if (!hostWithPort || /^(javascript|data|file|ftp|blob|about|chrome|chrome-extension)$/i.test(scheme[1])) return null;
    }
    try {
      const hasWebScheme = scheme && /^https?$/i.test(scheme[1]);
      const url = new URL(hasWebScheme ? value : `https://${value}`);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function timeToMinutes(value) {
    if (typeof value !== 'string' || !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)) return null;
    return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  }

  function normalizeRule(raw, index, errors) {
    const invalid = (field, code = 'invalidRule') => errors.push({ code, index, field });
    if (!raw || typeof raw !== 'object') {
      invalid('id');
      return null;
    }

    const errorCount = errors.length;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const start = timeToMinutes(raw.start);
    const end = timeToMinutes(raw.end);
    const homepage = normalizeHomepage(raw.homepage);

    if (!id) invalid('id');
    if (!name) invalid('name');
    if (!Array.isArray(raw.days) || !raw.days.length ||
        !Array.from(raw.days).every((day) => Number.isInteger(day) && day >= 0 && day <= 6)) invalid('days');
    if (start === null) invalid('start');
    if (end === null) invalid('end');
    if (start !== null && start === end) invalid('end', 'equalTimes');
    if (!homepage) invalid('homepage');
    if (typeof raw.enabled !== 'boolean') invalid('enabled');
    if (errors.length !== errorCount) return null;

    return {
      id, name, days: [...new Set(raw.days)].sort((a, b) => a - b),
      start: raw.start, end: raw.end, homepage, enabled: raw.enabled,
    };
  }

  function ruleSegments(rule) {
    const start = timeToMinutes(rule.start);
    const end = timeToMinutes(rule.end);
    return rule.days.flatMap((day) => {
      if (start < end) return [{ day, start, end }];
      const segments = [{ day, start, end: MINUTES_PER_DAY }];
      if (end > 0) segments.push({ day: (day + 1) % 7, start: 0, end });
      return segments;
    });
  }

  function checkSchedule(rawRules, repair) {
    const rules = [];
    const errors = [];
    if (!Array.isArray(rawRules)) {
      errors.push({ code: 'invalidRule', index: -1, field: 'id' });
      return { rules, errors };
    }

    const ids = new Set();
    const segmentsByDay = Array.from({ length: 7 }, () => []);
    for (const [index, raw] of rawRules.entries()) {
      const rule = normalizeRule(raw, index, errors);
      if (!rule) continue;
      if (ids.has(rule.id)) {
        errors.push({ code: 'invalidRule', index, field: 'id' });
        continue;
      }

      const segments = rule.enabled ? ruleSegments(rule) : [];
      const errorCount = errors.length;
      for (const segment of segments) {
        for (const other of segmentsByDay[segment.day]) {
          const start = Math.max(segment.start, other.start);
          const end = Math.min(segment.end, other.end);
          if (start < end) {
            errors.push({ code: 'overlap', index, otherIndex: other.index, day: segment.day, start, end });
          }
        }
      }
      if (repair && errors.length !== errorCount) continue;

      ids.add(rule.id);
      rules.push(rule);
      for (const segment of segments) segmentsByDay[segment.day].push({ ...segment, index });
    }
    return { rules, errors };
  }

  function validateSchedule(rules) {
    return checkSchedule(rules, false);
  }

  function sanitizeSchedule(rawRules) {
    const { rules, errors } = checkSchedule(rawRules, true);
    return { rules, needsRepair: errors.length > 0 };
  }

  function normalizeTemporaryHomepage(record) {
    if (!record || typeof record !== 'object') return null;
    const { startsAt, expiresAt } = record;
    const homepage = normalizeHomepage(record.homepage);
    if (!homepage || !Number.isInteger(startsAt) || !Number.isInteger(expiresAt) ||
        Math.abs(startsAt) > 8.64e15 || Math.abs(expiresAt) > 8.64e15 || startsAt >= expiresAt) return null;
    return { homepage, startsAt, expiresAt };
  }

  // 输入是存储层或表单校验后的配置。每次根据 instant 的本地时间重新匹配。
  function resolveHomepage({ homepage, advancedEnabled, rules = [], temporaryHomepage }, instant) {
    const base = { homepage: homepage || DEFAULT_HOMEPAGE, source: 'base', ruleId: null };
    if (advancedEnabled !== true) return base;
    const date = new Date(instant);
    const timestamp = date.getTime();
    if (temporaryHomepage && temporaryHomepage.startsAt <= timestamp && timestamp < temporaryHomepage.expiresAt) {
      return { homepage: temporaryHomepage.homepage, source: 'temporary', ruleId: null };
    }

    const day = date.getDay();
    const previousDay = (day + 6) % 7;
    const minutes = date.getHours() * 60 + date.getMinutes();
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const start = timeToMinutes(rule.start);
      const end = timeToMinutes(rule.end);
      const matches = start < end
        ? rule.days.includes(day) && start <= minutes && minutes < end
        : (rule.days.includes(day) && start <= minutes) || (rule.days.includes(previousDay) && minutes < end);
      if (matches) return { homepage: rule.homepage, source: 'schedule', ruleId: rule.id };
    }
    return base;
  }

  const api = {
    DEFAULT_HOMEPAGE, normalizeHomepage, normalizeTemporaryHomepage, validateSchedule, sanitizeSchedule, resolveHomepage,
  };
  root.HomepageRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
