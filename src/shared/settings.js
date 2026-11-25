/* 设置页和新标签页共用的网址校验及存储逻辑。 */
(function (root) {
  'use strict';

  const DEFAULT_HOMEPAGE = 'https://kagi.com/';

  // 旧版使用 homepage 缓存。新键只在本机设置确认后写入，避免升级后首次跳到旧地址。
  const HOMEPAGE_MIRROR_KEY = 'localHomepage';

  function saveHomepageMirror(homepage) {
    try {
      localStorage.setItem(HOMEPAGE_MIRROR_KEY, homepage);
      return true;
    } catch {
      return false;
    }
  }

  function readHomepageMirror() {
    try {
      const cached = localStorage.getItem(HOMEPAGE_MIRROR_KEY);
      if (typeof cached !== 'string') return null;
      const url = new URL(cached);
      return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.href : null;
    } catch {
      return null;
    }
  }

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

  function localSettings(rawHomepage) {
    const homepage = normalizeHomepage(rawHomepage);
    const needsRepair = rawHomepage !== undefined && !homepage;
    return { homepage: homepage || DEFAULT_HOMEPAGE, needsRepair, warning: needsRepair ? 'warnInvalidSaved' : '' };
  }

  async function persistHomepage(homepage, needsRepair = false) {
    // 先清空缓存，避免写入本机成功、刷新缓存失败时仍跳到旧地址。
    try {
      localStorage.removeItem(HOMEPAGE_MIRROR_KEY);
    } catch { /* 无法使用缓存时，仍保存本机设置。 */ }
    // 与主页一次写入，保证迁移完成标志和迁移后的地址同时生效。
    const update = needsRepair ? { syncEnabled: false } : { homepage, syncEnabled: false };
    await storageCall('local', 'set', update);
    saveHomepageMirror(homepage);
  }

  async function loadSettings(onLocalHomepage) {
    // 扩展页面共享同一把锁，防止多个标签页重复迁移或让迁移覆盖用户刚保存的地址。
    return navigator.locks.request('homepage-settings', async () => {
      const local = await storageCall('local', 'get', ['homepage', 'syncEnabled']);
      const settings = localSettings(local.homepage);
      if (local.syncEnabled !== true) {
        saveHomepageMirror(settings.homepage);
        return settings;
      }

      onLocalHomepage?.(settings.homepage);
      let synced;
      try {
        synced = await storageCall('sync', 'get', ['homepage']);
      } catch {
        // 保留迁移标志，且暂用地址不进入快速跳转缓存。
        return settings;
      }
      const syncedHomepage = normalizeHomepage(synced.homepage);
      const migrated = syncedHomepage ? localSettings(syncedHomepage) : settings;
      try {
        // 缺少有效地址时保留原值，让已有的本机地址修复提示继续工作。
        await persistHomepage(migrated.homepage, migrated.needsRepair);
      } catch { /* 当前页仍可使用已取得的有效主页，下次重新迁移。 */ }
      return migrated;
    });
  }

  async function saveSettings({ homepage }) {
    const normalized = normalizeHomepage(homepage);
    if (!normalized) throw new Error('Invalid HTTP or HTTPS URL');
    await navigator.locks.request('homepage-settings', () => persistHomepage(normalized));
    return localSettings(normalized);
  }

  const api = { DEFAULT_HOMEPAGE, normalizeHomepage, loadSettings, saveSettings, saveHomepageMirror, readHomepageMirror };
  root.HomepageSettings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
