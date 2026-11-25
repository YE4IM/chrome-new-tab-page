const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { DEFAULT_HOMEPAGE, normalizeHomepage } = require('../src/shared/settings.js');

const script = fs.readFileSync(require.resolve('../src/options/options.js'), 'utf8');
const settle = () => new Promise(setImmediate);

function setup(homepage) {
  const listeners = [];
  const loadSettings = async () => {
    const normalized = normalizeHomepage(homepage);
    return {
      homepage: normalized || DEFAULT_HOMEPAGE,
      needsRepair: !normalized,
      warning: normalized ? '' : 'warnInvalidSaved',
    };
  };

  function openPage() {
    const elements = new Map();
    const normalizedInputs = [];
    const logoWrites = [];
    function getElementById(id) {
      if (!elements.has(id)) {
        const handlers = new Map();
        elements.set(id, {
          value: '',
          classList: { add() {}, remove() {}, toggle() {} },
          setAttribute(name, value) { this[name] = value; },
          addEventListener(type, handler) { handlers.set(type, handler); },
          dispatch(type) { return handlers.get(type)({ preventDefault() {} }); },
          set src(value) { logoWrites.push(value); },
        });
      }
      return elements.get(id);
    }
    const preset = getElementById('kagi');
    preset.dataset = { url: DEFAULT_HOMEPAGE, icon: '../../icons/kagi.svg' };
    preset.textContent = 'Kagi';
    vm.runInNewContext(script, {
      URL,
      setTimeout() {},
      clearTimeout() {},
      HomepageSettings: {
        DEFAULT_HOMEPAGE,
        loadSettings,
        normalizeHomepage(value) {
          normalizedInputs.push(value);
          return normalizeHomepage(value);
        },
        async saveSettings({ homepage: nextHomepage }) {
          const oldValue = homepage;
          homepage = nextHomepage;
          for (const listener of listeners) listener({ homepage: { oldValue, newValue: homepage } }, 'local');
          return loadSettings();
        },
      },
      document: { getElementById, querySelectorAll: () => [preset] },
      chrome: {
        i18n: { getMessage: (key) => key },
        storage: { onChanged: { addListener: (listener) => listeners.push(listener) } },
      },
    });
    const input = getElementById('hp');
    return {
      input,
      save: getElementById('save'),
      status: getElementById('status'),
      logo: getElementById('siteLogo'),
      custom: getElementById('customChip'),
      preset,
      normalizedInputs,
      logoWrites,
      edit(value) { input.value = value; input.dispatch('input'); },
      submit() { return getElementById('settingsForm').dispatch('submit'); },
    };
  }

  return { openPage, getHomepage: () => homepage };
}

test('修复损坏的主页时，未编辑的设置页跟随保存结果，不能覆盖回默认地址', async () => {
  const { openPage, getHomepage } = setup('file:///invalid');
  const first = openPage();
  const second = openPage();
  await settle();
  assert.equal(second.input.value, DEFAULT_HOMEPAGE);
  assert.equal(second.status.textContent, 'warnInvalidSaved');
  assert.equal(second.save.disabled, false);

  first.edit('updated.example');
  await first.submit();
  await settle();
  assert.equal(second.input.value, 'https://updated.example/');
  assert.equal(second.status.textContent, 'statusCurrent');
  assert.equal(second.save.disabled, true);
  await second.submit();
  assert.equal(getHomepage(), 'https://updated.example/');
});

test('另一个设置页保存后保留已编辑的草稿，并以新地址为基准判断能否保存', async () => {
  const { openPage, getHomepage } = setup('file:///invalid');
  const first = openPage();
  const second = openPage();
  await settle();
  second.edit('draft.example/path');
  await first.submit(); // 仍可直接保存默认值来修复坏地址。
  await settle();
  assert.equal(getHomepage(), DEFAULT_HOMEPAGE);
  assert.equal(second.input.value, 'draft.example/path');
  assert.equal(second.status.textContent, 'statusOtherPageUpdate');
  assert.equal(second.save.disabled, false);

  first.edit('https://draft.example/path');
  await first.submit();
  await settle();
  assert.equal(second.input.value, 'draft.example/path');
  assert.equal(second.status.textContent, 'statusCurrent');
  assert.equal(second.save.disabled, true);
});

test('输入只规范化一次，图标只在域名、预设或有效性改变时更新', async () => {
  const page = setup(DEFAULT_HOMEPAGE).openPage();
  await settle();
  assert.equal(page.preset['aria-pressed'], 'true');
  page.logoWrites.length = 0;
  page.normalizedInputs.length = 0;

  page.edit('example.org/path');
  assert.equal(page.custom['aria-pressed'], 'true');
  assert.equal(page.preset['aria-pressed'], 'false');
  assert.equal(page.logo.alt, 'logoHostAlt');
  page.edit('example.org/other?x=1');
  assert.deepEqual(page.normalizedInputs, ['example.org/path', 'example.org/other?x=1']);
  assert.equal(page.logoWrites.length, 1);

  page.edit('different.example/path');
  page.edit('file:///invalid');
  assert.equal(page.logo.alt, 'logoCustomAlt');
  page.edit(DEFAULT_HOMEPAGE);
  assert.equal(page.logoWrites.length, 4);
  assert.equal(page.logoWrites.at(-1), page.preset.dataset.icon);
  assert.equal(page.save.disabled, true);
});
