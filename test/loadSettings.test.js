const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('../src/shared/settings.js'), 'utf8');
const keys = ['homepage', 'syncEnabled'];

function setup({ local = {}, sync = {}, mirror = new Map(), failOnce = {} } = {}) {
  const calls = [];
  const chrome = { runtime: {}, storage: {} };
  for (const [area, data] of Object.entries({ local, sync })) {
    function complete(method, cb, readOrWrite) {
      const operation = area + '.' + method;
      const error = failOnce[operation];
      delete failOnce[operation];
      queueMicrotask(() => {
        chrome.runtime.lastError = error ? { message: error } : undefined;
        cb(error ? undefined : readOrWrite());
        delete chrome.runtime.lastError;
      });
    }
    chrome.storage[area] = {
      get(names, cb) {
        calls.push([area + '.get', [...names]]);
        complete('get', cb, () => Object.fromEntries(names.map((key) => [key, data[key]])));
      },
      set(value, cb) {
        calls.push([area + '.set', { ...value }]);
        complete('set', cb, () => { Object.assign(data, value); });
      },
    };
  }
  let lock = Promise.resolve();
  const navigator = { locks: {
    request(_name, callback) {
      const result = lock.then(callback);
      lock = result.catch(() => {});
      return result;
    },
  } };
  const localStorage = {
    getItem: (key) => mirror.get(key) ?? null,
    setItem: (key, value) => mirror.set(key, value),
    removeItem: (key) => mirror.delete(key),
  };
  const context = vm.createContext({ chrome, navigator, localStorage, URL });
  vm.runInContext(source, context);
  return { settings: context.HomepageSettings, calls, local, sync, mirror, localStorage };
}

test('全新安装：只读本机，缓存默认地址', async () => {
  const { settings, calls, mirror } = setup();
  assert.deepEqual({ ...await settings.loadSettings() }, {
    homepage: settings.DEFAULT_HOMEPAGE, needsRepair: false, warning: '',
  });
  assert.deepEqual(calls, [['local.get', keys]]);
  assert.equal(mirror.get('localHomepage'), settings.DEFAULT_HOMEPAGE);
});

test('旧版同步关闭或非严格 true：使用本机地址，只访问本机存储', async () => {
  for (const syncEnabled of [false, 1]) {
    const { settings, calls, mirror } = setup({ local: { homepage: 'local.example', syncEnabled } });
    assert.equal((await settings.loadSettings()).homepage, 'https://local.example/');
    assert.deepEqual(calls, [['local.get', keys]]);
    assert.equal(mirror.get('localHomepage'), 'https://local.example/');
  }
});

test('旧版同步开启：一次迁移生效地址，后续读取和保存都只访问本机', async () => {
  const { settings, calls, local, sync, mirror } = setup({
    local: { homepage: 'local.example', syncEnabled: true },
    sync: { homepage: 'synced.example' },
  });
  assert.equal((await settings.loadSettings()).homepage, 'https://synced.example/');
  assert.equal(mirror.get('localHomepage'), 'https://synced.example/');
  assert.deepEqual(local, { homepage: 'https://synced.example/', syncEnabled: false });
  assert.deepEqual(calls.map(([operation]) => operation), ['local.get', 'sync.get', 'local.set']);
  sync.homepage = 'new-sync.example';
  assert.equal((await settings.loadSettings()).homepage, 'https://synced.example/');
  await settings.saveSettings({ homepage: 'new-local.example' });
  assert.deepEqual(calls.slice(3).map(([operation]) => operation), ['local.get', 'local.set']);
  assert.equal(sync.homepage, 'new-sync.example');
});

test('同步读取失败：暂用本机地址，不更新快速缓存，下一次重试迁移', async () => {
  const { settings, calls, local, mirror } = setup({
    local: { homepage: 'local.example', syncEnabled: true },
    sync: { homepage: 'synced.example' },
    failOnce: { 'sync.get': '暂时不可读' },
  });
  assert.equal((await settings.loadSettings()).homepage, 'https://local.example/');
  assert.equal(local.syncEnabled, true);
  assert.equal(mirror.has('localHomepage'), false);
  assert.deepEqual(calls.map(([operation]) => operation), ['local.get', 'sync.get']);
  assert.equal((await settings.loadSettings()).homepage, 'https://synced.example/');
  assert.equal(local.syncEnabled, false);
  assert.equal(mirror.get('localHomepage'), 'https://synced.example/');
});

test('同步地址缺失或无效：保留本机主页，完成迁移', async () => {
  for (const homepage of [undefined, 'file:///tmp/invalid']) {
    const { settings, local, mirror } = setup({
      local: { homepage: 'local.example', syncEnabled: true },
      sync: { homepage },
    });
    assert.equal((await settings.loadSettings()).homepage, 'https://local.example/');
    assert.equal(local.syncEnabled, false);
    assert.equal(mirror.get('localHomepage'), 'https://local.example/');
  }
});

test('缺少本机与同步地址时写入默认主页', async () => {
  const { settings, local } = setup({ local: { syncEnabled: true } });
  assert.equal((await settings.loadSettings()).homepage, settings.DEFAULT_HOMEPAGE);
  assert.deepEqual(local, { syncEnabled: false, homepage: settings.DEFAULT_HOMEPAGE });
});

test('两处地址均无效：使用默认主页，仍提示修复本机的坏值', async () => {
  const { settings, local, mirror } = setup({
    local: { homepage: 'file:///bad-local', syncEnabled: true },
    sync: { homepage: 'file:///bad-sync' },
  });
  assert.deepEqual({ ...await settings.loadSettings() }, {
    homepage: settings.DEFAULT_HOMEPAGE, needsRepair: true, warning: 'warnInvalidSaved',
  });
  assert.deepEqual(local, { homepage: 'file:///bad-local', syncEnabled: false });
  assert.equal(mirror.get('localHomepage'), settings.DEFAULT_HOMEPAGE);
  for (const locale of ['en', 'zh_CN']) {
    assert.ok(require(`../_locales/${locale}/messages.json`).warnInvalidSaved.message);
  }
});

test('迁移写入失败：仍打开已取得的同步地址，下次重试', async () => {
  const { settings, local, mirror } = setup({
    local: { homepage: 'local.example', syncEnabled: true },
    sync: { homepage: 'synced.example' },
    failOnce: { 'local.set': '暂时不可写' },
  });
  assert.equal((await settings.loadSettings()).homepage, 'https://synced.example/');
  assert.equal(local.syncEnabled, true);
  assert.equal(mirror.has('localHomepage'), false);
  await settings.loadSettings();
  assert.equal(local.syncEnabled, false);
  assert.equal(mirror.get('localHomepage'), 'https://synced.example/');
});

test('并行读取与保存：只迁移一次，用户保存的地址最终生效', async () => {
  const { settings, calls, local, mirror } = setup({
    local: { homepage: 'local.example', syncEnabled: true },
    sync: { homepage: 'synced.example' },
  });
  const [first, second] = await Promise.all([
    settings.loadSettings(),
    settings.loadSettings(),
    settings.saveSettings({ homepage: 'manual.example' }),
  ]);
  assert.equal(first.homepage, 'https://synced.example/');
  assert.equal(second.homepage, first.homepage);
  assert.equal(calls.filter(([op]) => op === 'sync.get').length, 1);
  assert.equal(local.homepage, 'https://manual.example/');
  assert.equal(mirror.get('localHomepage'), local.homepage);
});

test('迁移未完成时手动保存：本机保存优先，之后跳过同步读取', async () => {
  const { settings, calls } = setup({ local: { syncEnabled: true }, sync: { homepage: 'synced.example' } });
  const result = await settings.saveSettings({ homepage: 'new-local.example' });
  assert.deepEqual({ ...result }, { homepage: 'https://new-local.example/', needsRepair: false, warning: '' });
  assert.equal((await settings.loadSettings()).homepage, result.homepage);
  assert.deepEqual(calls.map(([operation]) => operation), ['local.set', 'local.get']);
});

test('地址无效或本机保存失败：报错且不写同步存储', async () => {
  const { settings, calls, local } = setup({ failOnce: { 'local.set': '本机配额超限' } });
  await assert.rejects(settings.saveSettings({ homepage: 'javascript:alert(1)' }), /Invalid HTTP or HTTPS URL/);
  assert.deepEqual(calls, []);
  await assert.rejects(settings.saveSettings({ homepage: 'local.example' }), /本机配额超限/);
  assert.deepEqual(calls.map(([operation]) => operation), ['local.set']);
  assert.deepEqual(local, {});
});

test('本机保存成功后缓存写入失败：清除旧缓存，新地址仍已保存', async () => {
  const { settings, local, localStorage, mirror } = setup({
    mirror: new Map([['localHomepage', 'https://old.example/']]),
  });
  localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal((await settings.saveSettings({ homepage: 'new.example' })).homepage, 'https://new.example/');
  assert.equal(local.homepage, 'https://new.example/');
  assert.equal(mirror.has('localHomepage'), false);
});
