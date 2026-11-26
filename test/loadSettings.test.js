const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('../src/shared/settings.js'), 'utf8');
const coreSource = fs.readFileSync(require.resolve('../src/shared/homepage.js'), 'utf8');
const keys = ['homepage', 'syncEnabled', 'homepageSchedule', 'temporaryHomepage', 'advancedEnabled'];
const mirrorKey = 'localHomepageConfigV1';

function mirrorValue(homepage) {
  return JSON.stringify({ version: 2, homepage, rules: [], temporaryHomepage: null, advancedEnabled: false });
}

function state(homepage, extra = {}) {
  return {
    homepage, rules: [], temporaryHomepage: null, advancedEnabled: false, revision: 0,
    needsRepair: false, warning: '', scheduleNeedsRepair: false, temporaryNeedsRepair: false,
    ...extra,
  };
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

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
  vm.runInContext(coreSource, context);
  vm.runInContext(source, context);
  return { settings: context.HomepageSettings, calls, local, sync, mirror, localStorage };
}

test('全新安装：只读本机，缓存默认地址', async () => {
  const { settings, calls } = setup();
  assert.deepEqual(copy(await settings.loadSettings()), state(settings.DEFAULT_HOMEPAGE));
  assert.deepEqual(calls, [['local.get', keys]]);
  assert.equal(settings.readHomepageMirror()?.homepage, settings.DEFAULT_HOMEPAGE);
});

test('旧版同步关闭或非严格 true：使用本机地址，只访问本机存储', async () => {
  for (const syncEnabled of [false, 1]) {
    const { settings, calls } = setup({ local: { homepage: 'local.example', syncEnabled } });
    assert.equal((await settings.loadSettings()).homepage, 'https://local.example/');
    assert.deepEqual(calls, [['local.get', keys]]);
    assert.equal(settings.readHomepageMirror()?.homepage, 'https://local.example/');
  }
});

test('本机读取只在镜像缺失或不一致时回写，之后跳过相同地址', async () => {
  const homepage = 'https://local.example/';
  for (const cached of [undefined, homepage, 'https://old.example/', 'https://local.example']) {
    const mirror = new Map(cached === undefined ? [] : [[mirrorKey, mirrorValue(cached)]]);
    const { settings, localStorage } = setup({ local: { homepage }, mirror });
    const { setItem } = localStorage;
    const writes = [];
    localStorage.setItem = (key, value) => {
      writes.push([key, value]);
      setItem(key, value);
    };

    await settings.loadSettings();
    await settings.loadSettings();
    assert.deepEqual(writes, cached === homepage ? [] : [[mirrorKey, mirrorValue(homepage)]]);
    assert.equal(settings.readHomepageMirror()?.homepage, homepage);
  }
});

test('旧版同步开启：一次迁移生效地址，后续读取和保存都只访问本机', async () => {
  const { settings, calls, local, sync } = setup({
    local: { homepage: 'local.example', syncEnabled: true },
    sync: { homepage: 'synced.example' },
  });
  assert.equal((await settings.loadSettings()).homepage, 'https://synced.example/');
  assert.equal(settings.readHomepageMirror()?.homepage, 'https://synced.example/');
  assert.deepEqual(local, { homepage: 'https://synced.example/', syncEnabled: false });
  assert.deepEqual(calls.map(([operation]) => operation), ['local.get', 'sync.get', 'local.set']);
  sync.homepage = 'new-sync.example';
  assert.equal((await settings.loadSettings()).homepage, 'https://synced.example/');
  await settings.saveSettings({ homepage: 'new-local.example' });
  assert.deepEqual(calls.slice(3).map(([operation]) => operation), ['local.get', 'local.get', 'local.set']);
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
  assert.equal(mirror.has(mirrorKey), false);
  assert.deepEqual(calls.map(([operation]) => operation), ['local.get', 'sync.get']);
  assert.equal((await settings.loadSettings()).homepage, 'https://synced.example/');
  assert.equal(local.syncEnabled, false);
  assert.equal(settings.readHomepageMirror()?.homepage, 'https://synced.example/');
});

test('同步地址缺失或无效：保留本机主页，完成迁移', async () => {
  for (const homepage of [undefined, 'file:///tmp/invalid']) {
    const { settings, local } = setup({
      local: { homepage: 'local.example', syncEnabled: true },
      sync: { homepage },
    });
    assert.equal((await settings.loadSettings()).homepage, 'https://local.example/');
    assert.equal(local.syncEnabled, false);
    assert.equal(settings.readHomepageMirror()?.homepage, 'https://local.example/');
  }
});

test('缺少本机与同步地址时写入默认主页', async () => {
  const { settings, local } = setup({ local: { syncEnabled: true } });
  assert.equal((await settings.loadSettings()).homepage, settings.DEFAULT_HOMEPAGE);
  assert.deepEqual(local, { syncEnabled: false, homepage: settings.DEFAULT_HOMEPAGE });
});

test('两处地址均无效：使用默认主页，仍提示修复本机的坏值', async () => {
  const { settings, local } = setup({
    local: { homepage: 'file:///bad-local', syncEnabled: true },
    sync: { homepage: 'file:///bad-sync' },
  });
  assert.deepEqual(copy(await settings.loadSettings()), state(settings.DEFAULT_HOMEPAGE, {
    needsRepair: true, warning: 'warnInvalidSaved',
  }));
  assert.deepEqual(local, { homepage: 'file:///bad-local', syncEnabled: false });
  assert.equal(settings.readHomepageMirror()?.homepage, settings.DEFAULT_HOMEPAGE);
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
  const provisional = await settings.loadSettings();
  assert.equal(provisional.homepage, 'https://synced.example/');
  assert.equal(provisional.persistedHomepage, 'https://local.example/');
  assert.equal(local.syncEnabled, true);
  assert.equal(mirror.has(mirrorKey), false);
  await settings.loadSettings();
  assert.equal(local.syncEnabled, false);
  assert.equal(settings.readHomepageMirror()?.homepage, 'https://synced.example/');
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
  assert.equal(settings.readHomepageMirror()?.homepage, local.homepage);
});

test('迁移未完成时手动保存：本机保存优先，之后跳过同步读取', async () => {
  const { settings, calls } = setup({ local: { syncEnabled: true }, sync: { homepage: 'synced.example' } });
  const result = await settings.saveSettings({ homepage: 'new-local.example' });
  assert.deepEqual(copy(result), state('https://new-local.example/'));
  assert.equal((await settings.loadSettings()).homepage, result.homepage);
  assert.deepEqual(calls.map(([operation]) => operation), ['local.get', 'local.set', 'local.get']);
});

test('地址无效或本机保存失败：报错且不写同步存储', async () => {
  const { settings, calls, local } = setup({ failOnce: { 'local.set': '本机配额超限' } });
  await assert.rejects(settings.saveSettings({ homepage: 'javascript:alert(1)' }), /Invalid HTTP or HTTPS URL/);
  assert.deepEqual(calls, []);
  await assert.rejects(settings.saveSettings({ homepage: 'local.example' }), /本机配额超限/);
  assert.deepEqual(calls.map(([operation]) => operation), ['local.get', 'local.set']);
  assert.deepEqual(local, {});
});

test('本机保存成功后缓存写入失败：清除旧缓存，新地址仍已保存', async () => {
  const { settings, local, localStorage, mirror } = setup({
    mirror: new Map([[mirrorKey, mirrorValue('https://old.example/')]]),
  });
  localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal((await settings.saveSettings({ homepage: 'new.example' })).homepage, 'https://new.example/');
  assert.equal(local.homepage, 'https://new.example/');
  assert.equal(mirror.has(mirrorKey), false);
});

const workRule = {
  id: 'work', name: 'Work', days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00',
  homepage: 'https://work.example/', enabled: true,
};

test('2.3.0 升级仅为已保存的规则或当前有效的临时主页自动启用高级功能', async () => {
  const now = Date.now();
  const temporaryHomepage = { homepage: 'https://meeting.example/', startsAt: now - 5000, expiresAt: now + 60000 };
  const homepageSchedule = { version: 1, revision: 3, rules: [{ ...workRule, enabled: false }] };
  for (const [raw, expected] of [
    [{}, false],
    [{ homepageSchedule }, true],
    [{ temporaryHomepage }, true],
    [{ temporaryHomepage: { ...temporaryHomepage, expiresAt: now - 1000 } }, false],
    [{ temporaryHomepage, homepageSchedule, advancedEnabled: false }, false],
    [{ advancedEnabled: true }, true],
  ]) {
    const { settings, local } = setup({ local: { homepage: 'base.example/path?q=1#hash', ...raw } });
    assert.equal((await settings.loadSettings()).advancedEnabled, expected);
    assert.equal(settings.readHomepageMirror().advancedEnabled, expected);
    assert.equal(settings.readHomepageMirror().homepage, 'https://base.example/path?q=1#hash');
    if (expected) assert.equal(local.advancedEnabled, true);
  }
});

test('关闭后基础保存独立进行，重新开启保留原规则及临时主页时间', async () => {
  const { settings, local } = setup({ local: {
    homepage: 'https://base.example/',
    homepageSchedule: { version: 1, revision: 4, rules: [workRule] },
  } });
  await settings.loadSettings();
  const { temporaryHomepage } = await settings.saveTemporaryHomepage({ homepage: 'meeting.example', durationMs: 60000 });
  await settings.saveAdvancedEnabled(false);
  await assert.rejects(settings.saveSettings({ homepage: 'stale.example', rules: [] }), { code: 'ADVANCED_DISABLED' });
  await assert.rejects(settings.clearTemporaryHomepage(temporaryHomepage), { code: 'ADVANCED_DISABLED' });
  await settings.saveSettings({ homepage: 'new.example', expectedHomepage: 'https://base.example/' });
  assert.equal(settings.readHomepageMirror().advancedEnabled, false);
  assert.equal(local.homepageSchedule.revision, 4);
  assert.deepEqual(local.homepageSchedule.rules, [workRule]);
  assert.deepEqual(copy(local.temporaryHomepage), copy(temporaryHomepage));
  const reopened = await settings.saveAdvancedEnabled(true);
  assert.deepEqual(copy(reopened.temporaryHomepage), copy(temporaryHomepage));
  assert.equal(reopened.homepage, 'https://new.example/');
  assert.equal(settings.readHomepageMirror().advancedEnabled, true);
});

test('升级后忽略旧缓存，并按原样保留本机主页的路径、查询参数及锚点', async () => {
  const homepage = 'https://local.example/folder/tab?q=keep%20spaces#section';
  const { settings } = setup({
    local: { homepage, syncEnabled: false },
    mirror: new Map([['localHomepage', 'https://pre-upgrade.example/']]),
  });
  assert.equal(settings.readHomepageMirror(), null);
  assert.equal((await settings.loadSettings()).homepage, homepage);
  assert.equal(settings.readHomepageMirror().homepage, homepage);
});

test('跳过单条损坏规则和临时主页，并将其余规则放入缓存', async () => {
  const { settings } = setup({
    local: {
      homepage: 'local.example',
      homepageSchedule: { version: 1, revision: 2, rules: [workRule, { ...workRule, homepage: 'file:///unsafe' }] },
      temporaryHomepage: { homepage: 'temporary.example', startsAt: 2, expiresAt: 1 },
    },
  });
  const expected = state('https://local.example/', {
    revision: 2, rules: [workRule], advancedEnabled: true, scheduleNeedsRepair: true, temporaryNeedsRepair: true,
  });
  assert.deepEqual(copy(await settings.loadSettings()), expected);
  assert.deepEqual(copy(settings.readHomepageMirror()), {
    homepage: expected.homepage, rules: [workRule], temporaryHomepage: null, advancedEnabled: true,
  });
  const repaired = await settings.saveSettings({ homepage: expected.homepage, rules: [workRule], expectedRevision: 2 });
  assert.equal(repaired.scheduleNeedsRepair, false);
  assert.equal(repaired.temporaryNeedsRepair, true);
  assert.equal((await settings.clearTemporaryHomepage()).temporaryNeedsRepair, false);
});

test('并行保存排程和结束临时主页时，两项操作都保留', async () => {
  for (const scheduleFirst of [true, false]) {
    const { settings, local } = setup({ local: { advancedEnabled: true } });
    const { temporaryHomepage } = await settings.saveTemporaryHomepage({ homepage: 'meeting.example', durationMs: 60000 });
    const operations = [
      () => settings.saveSettings({ homepage: 'base.example', rules: [workRule], expectedRevision: 0 }),
      () => settings.clearTemporaryHomepage(temporaryHomepage),
    ];
    if (!scheduleFirst) operations.reverse();
    await Promise.all(operations.map((operation) => operation()));
    assert.equal(local.temporaryHomepage, null);
    assert.deepEqual(copy(settings.readHomepageMirror()), {
      homepage: 'https://base.example/', rules: [workRule], temporaryHomepage: null, advancedEnabled: true,
    });
  }
});

test('页面持有旧版本时拒绝覆盖排程，也拒绝提前结束替换后的临时主页', async () => {
  const { settings, local } = setup({ local: { advancedEnabled: true } });
  const { revision } = await settings.loadSettings();
  await settings.saveSettings({ homepage: 'base.example', rules: [], expectedRevision: revision });
  await assert.rejects(
    settings.saveSettings({ homepage: 'stale.example', rules: [workRule], expectedRevision: revision }),
    { code: 'SCHEDULE_CONFLICT' },
  );
  const { temporaryHomepage } = await settings.saveTemporaryHomepage({ homepage: 'meeting.example', durationMs: 60000 });
  const expiresAt = Date.now() + 120000;
  await settings.saveTemporaryHomepage({ homepage: 'replacement.example', expiresAt });
  await assert.rejects(settings.clearTemporaryHomepage(temporaryHomepage), { code: 'TEMPORARY_CONFLICT' });
  assert.equal(local.homepage, 'https://base.example/');
  assert.equal(local.temporaryHomepage.homepage, 'https://replacement.example/');
  assert.equal(local.temporaryHomepage.expiresAt, expiresAt);
});

test('旧版同步迁移更改基础主页后，同一排程版本的旧草稿也需要重新核对', async () => {
  const { settings } = setup({
    local: { homepage: 'local.example', syncEnabled: true, advancedEnabled: true },
    sync: { homepage: 'synced.example' },
    failOnce: { 'sync.get': 'Sync read failed' },
  });
  const draft = await settings.loadSettings();
  const migrated = await settings.loadSettings();
  assert.equal(migrated.revision, draft.revision);
  assert.notEqual(migrated.homepage, draft.homepage);
  await assert.rejects(settings.saveSettings({
    homepage: 'draft.example', rules: [], expectedRevision: draft.revision, expectedHomepage: draft.homepage,
  }), { code: 'SCHEDULE_CONFLICT' });
  assert.equal((await settings.loadSettings()).homepage, migrated.homepage);
});

test('迁移写入暂时失败后，设置页仍可显式保存基础主页和排程', async () => {
  const { settings, local } = setup({
    local: { homepage: 'local.example', syncEnabled: true, advancedEnabled: true },
    sync: { homepage: 'synced.example' },
    failOnce: { 'local.set': 'Storage operation failed' },
  });
  const draft = await settings.loadSettings();
  const saved = await settings.saveSettings({
    homepage: 'manual.example', rules: [workRule], expectedRevision: draft.revision, expectedHomepage: draft.persistedHomepage,
  });
  assert.equal(saved.homepage, 'https://manual.example/');
  assert.equal(local.syncEnabled, false);
});

test('临时主页独立保存，不会将失败的旧版同步迁移标记为完成', async () => {
  const { settings, local, calls } = setup({
    local: { homepage: 'local.example', syncEnabled: true, advancedEnabled: true }, sync: { homepage: 'synced.example' },
  });
  const { temporaryHomepage } = await settings.saveTemporaryHomepage({ homepage: 'meeting.example', durationMs: 60000 });
  assert.equal(temporaryHomepage.expiresAt - temporaryHomepage.startsAt, 60000);
  assert.equal(local.syncEnabled, true);
  assert.deepEqual(calls.map(([operation]) => operation), ['local.get', 'local.set']);
  assert.equal(settings.readHomepageMirror(), null);
  let provisional;
  const result = await settings.loadSettings((value) => { provisional = value; });
  assert.equal(provisional.homepage, 'https://local.example/');
  assert.equal(result.homepage, 'https://synced.example/');
  assert.equal(result.temporaryHomepage.homepage, temporaryHomepage.homepage);
});

test('缓存无法删除或覆盖时阻止改写，避免下一页跳到旧地址', async () => {
  const { settings, localStorage, local } = setup({ local: { homepage: 'base.example', advancedEnabled: true } });
  await settings.loadSettings();
  const fail = () => { throw new Error('缓存不可写'); };
  localStorage.removeItem = fail;
  localStorage.setItem = fail;
  await assert.rejects(
    settings.saveTemporaryHomepage({ homepage: 'meeting.example', durationMs: 60000 }),
    /缓存不可写/,
  );
  assert.equal(local.temporaryHomepage, undefined);
  assert.equal(settings.readHomepageMirror().homepage, 'https://base.example/');
});

test('本机存储拒绝写入时，下一次读取仍可重建权威配置的缓存', async () => {
  const failOnce = {};
  const { settings, local } = setup({ local: { homepage: 'base.example', advancedEnabled: true }, failOnce });
  await settings.loadSettings();
  failOnce['local.set'] = 'Storage operation failed';
  await assert.rejects(
    settings.saveSettings({ homepage: 'new.example', rules: [workRule], expectedRevision: 0 }),
    /Storage operation failed/,
  );
  assert.equal(settings.readHomepageMirror(), null);
  assert.equal(local.homepage, 'base.example');
  assert.equal((await settings.loadSettings()).homepage, 'https://base.example/');
  assert.equal(settings.readHomepageMirror().homepage, 'https://base.example/');
});
