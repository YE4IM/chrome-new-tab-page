/* 设置页和新标签页共用的本机设置及缓存。 */
(function (root) {
  'use strict';

  const rulesApi = typeof module !== 'undefined' && module.exports ? require('./homepage.js') : root.HomepageRules;
  if (!rulesApi) return;
  const { DEFAULT_HOMEPAGE, normalizeHomepage, normalizeTemporaryHomepage, sanitizeSchedule, validateSchedule } = rulesApi;
  const SCHEDULE_VERSION = 1;
  const MIRROR_VERSION = 1;
  const HOMEPAGE_MIRROR_KEY = 'localHomepageConfigV1';
  const STORAGE_KEYS = ['homepage', 'syncEnabled', 'homepageSchedule', 'temporaryHomepage'];

  function refreshHomepageMirror({ homepage, rules, temporaryHomepage }) {
    const value = JSON.stringify({ version: MIRROR_VERSION, homepage, rules, temporaryHomepage });
    try {
      if (localStorage.getItem(HOMEPAGE_MIRROR_KEY) !== value) localStorage.setItem(HOMEPAGE_MIRROR_KEY, value);
    } catch { /* 权威设置仍可从扩展存储读取。 */ }
  }

  function readHomepageMirror() {
    try {
      const cached = JSON.parse(localStorage.getItem(HOMEPAGE_MIRROR_KEY));
      if (cached?.version !== MIRROR_VERSION || typeof cached.homepage !== 'string' ||
          normalizeHomepage(cached.homepage) !== cached.homepage || !Array.isArray(cached.rules)) return null;
      const { rules, needsRepair } = sanitizeSchedule(cached.rules);
      const temporaryHomepage = normalizeTemporaryHomepage(cached.temporaryHomepage);
      if (needsRepair || (cached.temporaryHomepage !== null && !temporaryHomepage)) return null;
      return { homepage: cached.homepage, rules, temporaryHomepage };
    } catch {
      return null;
    }
  }

  function invalidateHomepageMirror() {
    // 新标签页可在锁外读缓存。写权威设置前同步作废，避免新标签使用旧配置跳转。
    try {
      localStorage.removeItem(HOMEPAGE_MIRROR_KEY);
      return;
    } catch { /* 仍可尝试覆盖缓存。 */ }
    try {
      localStorage.setItem(HOMEPAGE_MIRROR_KEY, '');
    } catch (error) {
      if (readHomepageMirror()) throw error;
    }
  }

  // 包装回调 API，以便在回调作用域内读取 runtime.lastError。
  function storageCall(area, method, value) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage[area][method](value, (result) => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message || 'Storage operation failed'));
          else resolve(result);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function localSettings(raw) {
    const homepage = normalizeHomepage(raw.homepage);
    const needsRepair = raw.homepage !== undefined && !homepage;
    const schedule = raw.homepageSchedule;
    const knownSchedule = schedule?.version === SCHEDULE_VERSION;
    const hasRevision = knownSchedule && Number.isSafeInteger(schedule.revision) && schedule.revision > 0;
    const { rules, needsRepair: rulesNeedRepair } = sanitizeSchedule(knownSchedule ? schedule.rules : []);
    const temporaryHomepage = normalizeTemporaryHomepage(raw.temporaryHomepage);
    return {
      homepage: homepage || DEFAULT_HOMEPAGE,
      rules,
      temporaryHomepage,
      revision: hasRevision ? schedule.revision : 0,
      needsRepair,
      warning: needsRepair ? 'warnInvalidSaved' : '',
      scheduleNeedsRepair: schedule !== undefined && (!hasRevision || rulesNeedRepair),
      temporaryNeedsRepair: raw.temporaryHomepage != null && !temporaryHomepage,
    };
  }

  async function writeLocal(update) {
    invalidateHomepageMirror();
    await storageCall('local', 'set', update);
  }

  async function loadSettings(onLocalSettings) {
    // 扩展页面共享同一把锁，防止迁移覆盖刚保存的设置，也防止旧读取重新填充缓存。
    return navigator.locks.request('homepage-settings', async () => {
      const local = await storageCall('local', 'get', STORAGE_KEYS);
      const settings = localSettings(local);
      if (local.syncEnabled !== true) {
        refreshHomepageMirror(settings);
        return settings;
      }

      onLocalSettings?.(settings);
      let synced;
      try {
        invalidateHomepageMirror();
        synced = await storageCall('sync', 'get', ['homepage']);
      } catch {
        // 保留迁移标志，且暂用设置不进入快速跳转缓存。
        return settings;
      }
      const syncedHomepage = normalizeHomepage(synced.homepage);
      const migrated = syncedHomepage ? localSettings({ ...local, homepage: syncedHomepage }) : settings;
      // 缺少有效地址时保留本机的坏值，让设置页仍能提示修复。
      const update = migrated.needsRepair ? { syncEnabled: false } : { homepage: migrated.homepage, syncEnabled: false };
      try {
        // 与主页一次写入，保证迁移完成标志和迁移后的地址同时生效。
        await storageCall('local', 'set', update);
        refreshHomepageMirror(migrated);
      } catch {
        // 当前页可以使用同步地址，保存草稿时仍与实际存储的地址比较。
        return migrated.homepage === settings.homepage ? migrated : { ...migrated, persistedHomepage: settings.homepage };
      }
      return migrated;
    });
  }

  function settingsConflict(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  async function saveSettings({ homepage, rules, expectedRevision, expectedHomepage }) {
    const normalized = normalizeHomepage(homepage);
    if (!normalized) throw new Error('Invalid HTTP or HTTPS URL');
    const validation = rules === undefined ? null : validateSchedule(rules);
    if (validation?.errors.length) throw new Error('Invalid homepage schedule');
    return navigator.locks.request('homepage-settings', async () => {
      const local = await storageCall('local', 'get', STORAGE_KEYS);
      const settings = localSettings(local);
      if ((expectedRevision !== undefined && expectedRevision !== settings.revision) ||
          (expectedHomepage !== undefined && expectedHomepage !== settings.homepage)) {
        throw settingsConflict('SCHEDULE_CONFLICT');
      }
      const update = { homepage: normalized, syncEnabled: false };
      if (validation || !settings.scheduleNeedsRepair) {
        update.homepageSchedule = {
          version: SCHEDULE_VERSION,
          revision: settings.revision === Number.MAX_SAFE_INTEGER ? 1 : settings.revision + 1,
          rules: validation?.rules ?? settings.rules,
        };
      }
      await writeLocal(update);
      const saved = localSettings({ ...local, ...update });
      refreshHomepageMirror(saved);
      return saved;
    });
  }

  async function saveTemporaryHomepage({ homepage, durationMs, expiresAt }) {
    const startsAt = Date.now();
    const temporaryHomepage = normalizeTemporaryHomepage({
      homepage,
      startsAt,
      expiresAt: durationMs === undefined ? expiresAt : startsAt + durationMs,
    });
    if (!temporaryHomepage) throw settingsConflict('INVALID_TEMPORARY_EXPIRY');
    return updateTemporaryHomepage(temporaryHomepage);
  }

  async function clearTemporaryHomepage(expectedTemporaryHomepage) {
    return updateTemporaryHomepage(null, expectedTemporaryHomepage);
  }

  function updateTemporaryHomepage(temporaryHomepage, expected) {
    return navigator.locks.request('homepage-settings', async () => {
      const local = await storageCall('local', 'get', STORAGE_KEYS);
      const current = normalizeTemporaryHomepage(local.temporaryHomepage);
      if (expected && (!current || current.homepage !== expected.homepage ||
          current.startsAt !== expected.startsAt || current.expiresAt !== expected.expiresAt)) {
        throw settingsConflict('TEMPORARY_CONFLICT');
      }
      if (temporaryHomepage && temporaryHomepage.expiresAt <= Date.now()) {
        throw settingsConflict('INVALID_TEMPORARY_EXPIRY');
      }
      await writeLocal({ temporaryHomepage });
      const saved = localSettings({ ...local, temporaryHomepage });
      if (local.syncEnabled !== true) refreshHomepageMirror(saved);
      return saved;
    });
  }

  const api = {
    DEFAULT_HOMEPAGE,
    normalizeHomepage,
    loadSettings,
    saveSettings,
    saveTemporaryHomepage,
    clearTemporaryHomepage,
    readHomepageMirror,
  };
  root.HomepageSettings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
