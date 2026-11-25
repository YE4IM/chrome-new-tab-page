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

test('saveHomepageMirror 写入并读回同一规范化地址', () => {
  const stub = installLocalStorageStub();
  assert.strictEqual(settings.saveHomepageMirror('https://example.com/'), true);
  assert.strictEqual(stub.getItem('localHomepage'), 'https://example.com/');
  assert.strictEqual(settings.readHomepageMirror(), 'https://example.com/');
});

test('readHomepageMirror：空存储返回 null；非 http/https 协议拒绝；脏 JSON 无关字符串拒绝', () => {
  installLocalStorageStub();
  assert.strictEqual(settings.readHomepageMirror(), null);
  settings.saveHomepageMirror('javascript:alert(1)');
  assert.strictEqual(settings.readHomepageMirror(), null);
  globalThis.localStorage.setItem('localHomepage', 'not-a-url');
  assert.strictEqual(settings.readHomepageMirror(), null);
});

test('只有旧版缓存时忽略，等待异步加载', () => {
  const storage = installLocalStorageStub();
  storage.setItem('homepage', 'https://old.example/');
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
