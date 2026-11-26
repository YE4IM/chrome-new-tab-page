const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const homepageRules = require('../src/shared/homepage.js');

const script = fs.readFileSync(require.resolve('../src/newtab/newtab.js'), 'utf8');
const sharedScripts = ['homepage.js', 'settings.js'].map((file) =>
  fs.readFileSync(require.resolve(`../src/shared/${file}`), 'utf8'));
const { DEFAULT_HOMEPAGE: defaultHomepage } = homepageRules;
const savedHomepage = 'https://example.org/path?x=1&y=2';
const fallbackHomepage = 'https://local.example/';
const scheduleHomepage = 'https://board.example/dashboard';
const temporaryHomepage = 'https://meeting.example/doc#notes';
const friday = (hours, minutes) => new Date(2026, 10, 27, hours, minutes).getTime();
const workweek = {
  homepage: savedHomepage,
  advancedEnabled: true,
  rules: [{ id: 'work', name: 'Work', days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', enabled: true, homepage: scheduleHomepage }],
};

function runRedirect({ loadSettings, replace, mirror, now = () => Date.now(), realStorage } = {}) {
  const elements = new Map();
  const navigations = [];
  let timer;
  const context = {
    HomepageRules: homepageRules,
    HomepageSettings: {
      loadSettings: loadSettings || (async () => ({ homepage: savedHomepage })),
      readHomepageMirror: () => typeof mirror === 'function' ? mirror() : mirror,
    },
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now()])); }
      static now() { return now(); }
    },
    chrome: { i18n: { getMessage: (key) => key, getUILanguage: () => 'en' }, runtime: { getURL: (path) => path } },
    document: {
      documentElement: {},
      getElementById: (id) => elements.get(id),
      createElement: () => ({}),
      body: {
        appendChild(main) {
          elements.set(main.id, main);
          for (const [, id] of main.innerHTML.matchAll(/ id="([^"]+)"/g)) {
            elements.set(id, { addEventListener() {} });
          }
        },
      },
    },
    location: { replace(url) { navigations.push(url); replace?.(url); } },
    setTimeout(callback) { timer = callback; return 1; },
    clearTimeout() { timer = undefined; },
  };
  vm.createContext(context);
  if (realStorage) {
    Object.assign(context, { localStorage: realStorage.localStorage, navigator: realStorage.navigator, URL });
    context.chrome.storage = realStorage.chromeStorage;
    for (const sharedScript of sharedScripts) vm.runInContext(sharedScript, context);
  }
  const finished = vm.runInContext(script, context);
  return { finished, elements, navigations, timeOut: () => timer() };
}

test('读取完成后跳转超时：手动链接使用已读取的主页和完整查询参数', async () => {
  const tab = runRedirect();
  await tab.finished;
  assert.deepEqual(tab.navigations, [savedHomepage]);
  tab.timeOut();
  assert.equal(tab.elements.get('target').href, savedHomepage);
});

test('导航抛出异常：立即显示恢复页并保留已读取的主页', async () => {
  const tab = runRedirect({ replace() { throw new Error('Navigation failed'); } });
  await tab.finished;
  assert.equal(tab.elements.get('target').href, savedHomepage);
  assert.equal(tab.elements.get('message').textContent, 'recoveryRedirectFail');
});

test('迁移尚未完成时先显示已读取的本机主页，随后更新为迁移地址', async () => {
  let finishLoad;
  const tab = runRedirect({ loadSettings(onLocalSettings) {
    onLocalSettings({ homepage: fallbackHomepage });
    return new Promise((resolve) => { finishLoad = resolve; });
  } });
  tab.timeOut();
  assert.equal(tab.elements.get('target').href, fallbackHomepage);
  finishLoad({ homepage: savedHomepage });
  await tab.finished;
  assert.equal(tab.elements.get('target').href, savedHomepage);
});

test('本机读取失败时，有效缓存优先，否则恢复链接使用默认主页', async () => {
  for (const homepage of [fallbackHomepage, undefined]) {
    let availableConfig;
    const tab = runRedirect({
      mirror: () => availableConfig,
      async loadSettings() {
        if (homepage) availableConfig = { homepage };
        throw new Error('Read failed');
      },
    });
    await tab.finished;
    assert.equal(tab.elements.get('target').href, homepage || defaultHomepage);
    assert.equal(tab.elements.get('message').textContent, 'recoveryLoadFail');
  }
});

test('已有固定主页缓存时同步跳转一次，超时仍使用同一个地址', async () => {
  let storageReads = 0;
  const tab = runRedirect({
    mirror: { homepage: savedHomepage },
    async loadSettings() { storageReads += 1; return { homepage: fallbackHomepage }; },
  });
  assert.deepEqual(tab.navigations, [savedHomepage]);
  await tab.finished;
  assert.equal(storageReads, 0);
  assert.deepEqual(tab.navigations, [savedHomepage]);
  tab.timeOut();
  assert.equal(tab.elements.get('target').href, savedHomepage);
});

test('同一份动态缓存可连续跨过工作时段和临时主页的边界', async () => {
  const mirror = {
    ...workweek,
    temporaryHomepage: { homepage: temporaryHomepage, startsAt: friday(17, 30), expiresAt: friday(18, 30) },
  };
  for (const [instant, expected] of [
    [friday(17, 29), scheduleHomepage],
    [friday(17, 30), temporaryHomepage],
    [friday(18, 0), temporaryHomepage],
    [friday(18, 30), savedHomepage],
    [new Date(2026, 10, 30, 9, 0).getTime(), scheduleHomepage],
  ]) {
    const tab = runRedirect({ mirror, now: () => instant });
    assert.deepEqual(tab.navigations, [expected]);
    await tab.finished;
    tab.timeOut();
    assert.equal(tab.elements.get('target').href, expected);
    assert.deepEqual(tab.navigations, [expected]);
  }
});

test('高级功能关闭时，冷启动读取和快速缓存都跳过有效的临时主页与时段', async () => {
  const config = {
    ...workweek,
    advancedEnabled: false,
    temporaryHomepage: { homepage: temporaryHomepage, startsAt: friday(17, 30), expiresAt: friday(18, 30) },
  };
  for (const settings of [{ mirror: config }, { loadSettings: async () => config }]) {
    const tab = runRedirect({ ...settings, now: () => friday(17, 45) });
    await tab.finished;
    assert.deepEqual(tab.navigations, [savedHomepage]);
  }
});

test('没有新版缓存时使用本机配置，并按发起新标签时的时刻计算', async () => {
  let instant = friday(17, 59);
  let finishLoad;
  const tab = runRedirect({
    now: () => instant,
    loadSettings: () => new Promise((resolve) => { finishLoad = resolve; }),
  });
  assert.deepEqual(tab.navigations, []);
  instant = friday(18, 0);
  finishLoad(workweek);
  await tab.finished;
  assert.deepEqual(tab.navigations, [scheduleHomepage]);
  tab.timeOut();
  assert.equal(tab.elements.get('target').href, scheduleHomepage);

  const nextTab = runRedirect({ mirror: workweek, now: () => instant });
  assert.deepEqual(nextTab.navigations, [savedHomepage]);
  await nextTab.finished;
});

test('从缓存解析出的临时主页导航失败时只尝试一次并保留手动地址', async () => {
  const tab = runRedirect({
    mirror: {
      ...workweek,
      temporaryHomepage: { homepage: temporaryHomepage, startsAt: friday(17, 30), expiresAt: friday(18, 30) },
    },
    now: () => friday(17, 45),
    replace() { throw new Error('Navigation failed'); },
  });
  await tab.finished;
  assert.deepEqual(tab.navigations, [temporaryHomepage]);
  assert.equal(tab.elements.get('target').href, temporaryHomepage);
  assert.equal(tab.elements.get('message').textContent, 'recoveryRedirectFail');
});

test('旧版与损坏的缓存都从真实存储重建，并保留主页的路径、查询和锚点', async () => {
  const homepage = `${savedHomepage}#notes`;
  const values = new Map([
    ['localHomepage', fallbackHomepage],
    ['localHomepageConfigV1', '{broken json'],
  ]);
  let storageReads = 0;
  const realStorage = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    navigator: { locks: { request: async (_name, callback) => callback() } },
    chromeStorage: {
      local: {
        get(_keys, callback) {
          storageReads += 1;
          queueMicrotask(() => callback({ homepage, syncEnabled: false }));
        },
      },
    },
  };
  const coldTab = runRedirect({ realStorage });
  assert.deepEqual(coldTab.navigations, []);
  await coldTab.finished;
  assert.deepEqual(coldTab.navigations, [homepage]);

  const warmTab = runRedirect({ realStorage });
  assert.deepEqual(warmTab.navigations, [homepage]);
  await warmTab.finished;
  assert.equal(storageReads, 1);
});
