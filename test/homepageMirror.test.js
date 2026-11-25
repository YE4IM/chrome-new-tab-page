const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const settings = require('../src/shared/settings.js');

function installLocalStorageStub() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
  };
  return globalThis.localStorage;
}

const mirrorKey = 'localHomepageConfigV1';
const homepage = 'https://example.com/';
const cached = { version: 1, homepage, rules: [], temporaryHomepage: null };

test('readHomepageMirror 读取完整的新版配置', () => {
  const storage = installLocalStorageStub();
  storage.setItem(mirrorKey, JSON.stringify(cached));
  assert.deepStrictEqual(settings.readHomepageMirror(), { homepage, rules: [], temporaryHomepage: null });
});

test('readHomepageMirror 拒绝损坏或未知版本的配置', () => {
  const storage = installLocalStorageStub();
  assert.strictEqual(settings.readHomepageMirror(), null);
  for (const value of [
    'not-json',
    JSON.stringify({ ...cached, version: 2 }),
    JSON.stringify({ ...cached, homepage: 'javascript:alert(1)' }),
    JSON.stringify({ ...cached, rules: [{ homepage }] }),
    JSON.stringify({ ...cached, temporaryHomepage: { homepage, startsAt: 1, expiresAt: 0 } }),
    JSON.stringify({ ...cached, temporaryHomepage: undefined }),
  ]) {
    storage.setItem(mirrorKey, value);
    assert.strictEqual(settings.readHomepageMirror(), null);
  }
});

test('只有旧版缓存时忽略，等待异步加载', () => {
  const storage = installLocalStorageStub();
  storage.setItem('homepage', 'https://old.example/');
  storage.setItem('localHomepage', 'https://previous-local.example/');
  assert.strictEqual(settings.readHomepageMirror(), null);
});

for (const page of ['src/newtab/newtab.html', 'src/options/options.html']) {
  test(`${page} 无内联脚本（MV3 CSP 下内联脚本被静默拦截）`, () => {
    const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
    for (const m of html.matchAll(/<script\b([^>]*)>/g)) {
      assert.match(m[1], /\bsrc=/, `${page} 出现无 src 的 <script>`);
    }
  });
}
