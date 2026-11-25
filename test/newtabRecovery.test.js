const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const script = fs.readFileSync(require.resolve('../src/newtab/newtab.js'), 'utf8');
const defaultHomepage = 'https://kagi.com/';
const savedHomepage = 'https://example.org/path?x=1&y=2';
const fallbackHomepage = 'https://local.example/';

function runRedirect({ loadSettings, replace, mirror } = {}) {
  const elements = new Map();
  const navigations = [];
  let timer;
  const context = {
    HomepageSettings: {
      DEFAULT_HOMEPAGE: defaultHomepage,
      loadSettings: loadSettings || (async () => ({ homepage: savedHomepage })),
      readHomepageMirror: () => mirror,
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
  const finished = vm.runInNewContext(script, context);
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
  const tab = runRedirect({ loadSettings(onLocalHomepage) {
    onLocalHomepage(fallbackHomepage);
    return new Promise((resolve) => { finishLoad = resolve; });
  } });
  tab.timeOut();
  assert.equal(tab.elements.get('target').href, fallbackHomepage);
  finishLoad({ homepage: savedHomepage });
  await tab.finished;
  assert.equal(tab.elements.get('target').href, savedHomepage);
});

test('本机读取失败时，有效缓存优先，否则恢复链接使用默认主页', async () => {
  for (const mirror of [fallbackHomepage, undefined]) {
    const tab = runRedirect({ mirror, async loadSettings() { throw new Error('Read failed'); } });
    await tab.finished;
    assert.equal(tab.elements.get('target').href, mirror || defaultHomepage);
    assert.equal(tab.elements.get('message').textContent, 'recoveryLoadFail');
  }
});

test('已发起快速跳转时避免重复导航，超时仍使用已确认的地址', async () => {
  const tab = runRedirect({ mirror: savedHomepage });
  await tab.finished;
  assert.deepEqual(tab.navigations, [savedHomepage]);
  tab.timeOut();
  assert.equal(tab.elements.get('target').href, savedHomepage);
});
