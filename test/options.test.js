const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const HomepageRules = require('../src/shared/homepage.js');
const { DEFAULT_HOMEPAGE, normalizeHomepage } = require('../src/shared/settings.js');

const script = fs.readFileSync(require.resolve('../src/options/options.js'), 'utf8');
const settle = () => new Promise(setImmediate);

function element() {
  const handlers = new Map();
  return {
    value: '',
    textContent: '',
    dataset: {},
    children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute(name, value) { this[name] = value; },
    getAttribute(name) { return this[name]; },
    removeAttribute(name) { delete this[name]; },
    addEventListener(type, handler) { handlers.set(type, handler); },
    dispatch(type) { return handlers.get(type)({ preventDefault() {} }); },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    get firstChild() { return this.children[0]; },
    get firstElementChild() { return this.children[0]; },
    get lastElementChild() { return this.children.at(-1); },
    focus() {},
  };
}

function ruleNode() {
  const node = element();
  const fields = ['name', 'days', 'start', 'end', 'homepage', 'enabled'].map((field) => {
    const control = element();
    control.dataset.field = field;
    return control;
  });
  const remove = element();
  node.querySelectorAll = (selector) => selector === '[data-field]' ? fields : [];
  node.querySelector = () => remove;
  return node;
}

function setup(homepage, options = {}) {
  const listeners = [];
  let { rules = [], temporaryHomepage = null, now = Date.now(), persistedHomepage } = options;
  let revision = 0;
  let writeFailed = false;
  let callbackId = 0;
  const scheduled = new Map();
  const advanceTo = (target) => {
    now = target;
    for (const [id, { callback, instant }] of [...scheduled]) {
      if (target < instant) continue;
      scheduled.delete(id);
      callback();
    }
  };
  const loadSettings = async () => {
    const normalized = normalizeHomepage(homepage);
    return structuredClone({
      homepage: normalized || DEFAULT_HOMEPAGE,
      needsRepair: !normalized,
      warning: normalized ? '' : 'warnInvalidSaved',
      rules,
      temporaryHomepage,
      revision,
      persistedHomepage,
    });
  };

  function notify(changed) {
    for (const listener of listeners) listener({ [changed]: {} }, 'local');
  }

  const api = {
    async saveSettings({ homepage: nextHomepage, rules: nextRules, expectedRevision, expectedHomepage }) {
      if (writeFailed) throw new Error('storage unavailable');
      const persistedAddress = persistedHomepage ?? normalizeHomepage(homepage) ?? DEFAULT_HOMEPAGE;
      if (revision !== expectedRevision || persistedAddress !== expectedHomepage) {
        throw Object.assign(new Error('conflict'), { code: 'SCHEDULE_CONFLICT' });
      }
      homepage = nextHomepage;
      persistedHomepage = undefined;
      rules = nextRules;
      revision += 1;
      notify('homepageSchedule');
      return loadSettings();
    },
    async saveTemporaryHomepage({ homepage, durationMs, expiresAt }) {
      if (writeFailed) throw new Error('storage unavailable');
      temporaryHomepage = { homepage, startsAt: now, expiresAt: expiresAt ?? now + durationMs };
      notify('temporaryHomepage');
      return loadSettings();
    },
    async clearTemporaryHomepage() {
      temporaryHomepage = null;
      notify('temporaryHomepage');
      return loadSettings();
    },
  };

  function openPage() {
    const elements = new Map();
    const normalizedInputs = [];
    const logoWrites = [];
    const messages = new Map();
    function getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    }
    const preset = getElementById('kagi');
    preset.dataset = { url: DEFAULT_HOMEPAGE, icon: '../../icons/kagi.svg' };
    preset.textContent = 'Kagi';
    getElementById('temporaryDuration').value = '1800000';
    getElementById('ruleTemplate').content = { firstElementChild: { cloneNode: ruleNode } };
    Object.defineProperty(getElementById('siteLogo'), 'src', {
      set(value) { logoWrites.push(value); },
    });
    let ruleId = 0;
    vm.runInNewContext(script, {
      URL,
      Date: class extends Date { static now() { return now; } },
      setTimeout(callback, delay) {
        const id = ++callbackId;
        scheduled.set(id, { callback, instant: now + delay });
        return id;
      },
      clearTimeout(id) { scheduled.delete(id); },
      addEventListener() {},
      crypto: { randomUUID() { return 'rule-' + ++ruleId; } },
      HomepageRules,
      HomepageSettings: {
        ...api,
        DEFAULT_HOMEPAGE,
        loadSettings,
        normalizeHomepage(value) {
          normalizedInputs.push(value);
          return normalizeHomepage(value);
        },
      },
      document: {
        getElementById,
        querySelectorAll: () => [preset],
        createElement: element,
        addEventListener() {},
      },
      chrome: {
        i18n: {
          getUILanguage: () => 'en-US',
          getMessage(key, substitutions) {
            messages.set(key, substitutions);
            return key;
          },
        },
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
      messages,
      element: getElementById,
      edit(value, id = 'hp') {
        const field = getElementById(id);
        field.value = value;
        field.dispatch('input');
      },
      click(id) { return getElementById(id).dispatch('click'); },
      submit(id = 'settingsForm') { return getElementById(id).dispatch('submit'); },
      target(id = 'currentResult') { return getElementById(id).firstElementChild?.textContent; },
      addFridayRule(name, start, end, address) {
        getElementById('addRule').dispatch('click');
        const row = getElementById('rules').children.at(-1);
        const fields = Object.fromEntries(row.querySelectorAll('[data-field]').map(
          (field) => [field.dataset.field, field],
        ));
        Object.assign(fields.name, { value: name });
        Object.assign(fields.start, { value: start });
        Object.assign(fields.end, { value: end });
        Object.assign(fields.homepage, { value: address });
        fields.days.children.find((day) => day.firstChild.value === '5').firstChild.checked = true;
        row.dispatch('input');
        return fields;
      },
    };
  }

  return {
    openPage,
    advanceTo,
    loadSettings,
    getHomepage: () => homepage,
    failWrites() { writeFailed = true; },
    migrateHomepage(value) { homepage = value; notify('homepage'); },
  };
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
  assert.equal(second.status.textContent, '');
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
  assert.equal(second.save.disabled, true);
  assert.equal(second.element('scheduleConflict').hidden, false);

  first.edit('https://draft.example/path');
  await first.submit();
  await settle();
  assert.equal(second.input.value, 'draft.example/path');
  assert.equal(second.status.textContent, '');
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

test('临时主页与排程草稿独立保存，预览在到期点使用草稿', async () => {
  const now = new Date(2026, 10, 27, 17, 30).getTime();
  const work = {
    id: 'work', name: 'Work', days: [5], start: '09:00', end: '18:00',
    homepage: 'https://work.example/', enabled: true,
  };
  const { openPage, advanceTo, loadSettings } = setup(DEFAULT_HOMEPAGE, { now, rules: [work] });
  const page = openPage();
  await settle();
  assert.equal(page.target(), 'https://work.example/');

  page.edit('draft.example');
  page.edit('meeting.example', 'temporaryUrl');
  await page.submit('temporaryForm');
  assert.equal(page.input.value, 'draft.example');
  assert.equal(page.target(), 'https://meeting.example/');
  assert.equal(page.messages.get('currentTemporary')[1], DEFAULT_HOMEPAGE);
  assert.equal(page.element('previewDraft').hidden, false);
  assert.equal(page.element('startTemporary').textContent, 'replaceTemporary');
  assert.equal(page.element('endTemporary').hidden, false);

  page.edit('2026-11-27T17:29', 'previewDate');
  assert.equal(page.target('previewResult'), 'https://work.example/');
  page.click('previewExpiry');
  assert.equal(page.target('previewResult'), 'https://draft.example/');
  const saved = await loadSettings();
  assert.equal(saved.homepage, DEFAULT_HOMEPAGE);
  assert.equal(saved.temporaryHomepage.startsAt, now);
  advanceTo(saved.temporaryHomepage.expiresAt);
  assert.equal(page.target(), DEFAULT_HOMEPAGE);
  assert.equal(page.element('endTemporary').hidden, true);
  assert.equal(page.element('startTemporary').textContent, 'startTemporary');
});

test('同一版本的迁移配置会刷新当前主页并要求复核已有草稿', async () => {
  const { openPage, getHomepage, migrateHomepage } = setup(DEFAULT_HOMEPAGE);
  const clean = openPage();
  const editing = openPage();
  await settle();
  editing.edit('draft.example');

  migrateHomepage('https://migrated.example/');
  await settle();
  assert.equal(clean.input.value, 'https://migrated.example/');
  assert.equal(editing.target(), 'https://migrated.example/');
  assert.equal(editing.input.value, 'draft.example');
  assert.equal(editing.save.disabled, true);
  assert.equal(editing.element('scheduleConflict').hidden, false);
  await editing.submit();
  assert.equal(getHomepage(), 'https://migrated.example/');

  editing.click('keepScheduleDraft');
  assert.equal(editing.save.disabled, false);
  await editing.submit();
  assert.equal(getHomepage(), 'https://draft.example/');
});

test('冲突时段标出相交星期和时间，停用冲突规则后即可保存', async () => {
  const { openPage, loadSettings } = setup(DEFAULT_HOMEPAGE);
  const page = openPage();
  await settle();
  const first = page.addFridayRule('First', '09:00', '12:00', 'first.example');
  const second = page.addFridayRule('Second', '11:00', '14:00', 'second.example');
  await page.submit();
  assert.equal(page.element('ruleErrors').hidden, false);
  assert.equal(first.start['aria-invalid'], 'true');
  assert.equal(second.start['aria-invalid'], 'true');
  assert.deepEqual(Array.from(page.messages.get('ruleOverlap')), ['Second', 'First', 'Friday', 'timeRange']);
  assert.deepEqual((await loadSettings()).rules, []);
  second.enabled.checked = false;
  page.element('rules').children.at(-1).dispatch('input');
  assert.equal(page.element('ruleErrors').hidden, true);
  await page.submit();
  assert.deepEqual((await loadSettings()).rules.map(({ enabled }) => enabled), [true, false]);
});

test('临时主页写入失败会保留两个表单的输入', async () => {
  const { openPage, failWrites } = setup(DEFAULT_HOMEPAGE);
  const page = openPage();
  await settle();
  page.edit('draft.example');
  page.edit('meeting.example', 'temporaryUrl');
  failWrites();
  await page.submit('temporaryForm');
  assert.equal(page.target(), DEFAULT_HOMEPAGE);
  assert.equal(page.input.value, 'draft.example');
  assert.equal(page.element('temporaryUrl').value, 'meeting.example');
  assert.equal(page.element('temporaryStatus').textContent, 'statusSaveFail');
});

test('结束临时主页时，另一设置页保留未保存的排程', async () => {
  const now = new Date(2026, 10, 27, 17, 30).getTime();
  const temporaryHomepage = { homepage: 'https://meeting.example/', startsAt: now, expiresAt: now + 3600_000 };
  const { openPage, loadSettings } = setup(DEFAULT_HOMEPAGE, { now, temporaryHomepage });
  const editing = openPage();
  const ending = openPage();
  await settle();

  editing.addFridayRule('Work', '09:00', '18:00', 'work.example');
  await ending.click('endTemporary');
  await settle();
  assert.equal(editing.target(), DEFAULT_HOMEPAGE);
  assert.equal(editing.target('previewResult'), 'https://work.example/');
  assert.equal(editing.element('scheduleConflict').hidden, true);
  await editing.submit();
  const saved = await loadSettings();
  assert.equal(saved.rules[0].homepage, 'https://work.example/');
  assert.equal(saved.temporaryHomepage, null);
});

test('指定结束时刻必须在未来，写入后使用该时刻的时间戳', async () => {
  const now = new Date(2026, 10, 27, 17, 30).getTime();
  const { openPage, loadSettings } = setup(DEFAULT_HOMEPAGE, { now });
  const page = openPage();
  await settle();

  page.edit('meeting.example', 'temporaryUrl');
  page.edit('custom', 'temporaryDuration');
  page.edit('2026-11-27T17:30', 'temporaryDate');
  await page.submit('temporaryForm');
  assert.equal(page.element('temporaryDateError').textContent, 'invalidTemporaryDate');
  assert.equal((await loadSettings()).temporaryHomepage, null);

  page.edit('2026-11-27T18:03', 'temporaryDate');
  await page.submit('temporaryForm');
  assert.equal(
    (await loadSettings()).temporaryHomepage.expiresAt,
    new Date(2026, 10, 27, 18, 3).getTime(),
  );
});

test('旧设置迁移暂时写入失败时，排程保存使用本机基准', async () => {
  const { openPage, getHomepage } = setup('https://sync.example/', { persistedHomepage: DEFAULT_HOMEPAGE });
  const page = openPage();
  await settle();
  assert.equal(page.input.value, 'https://sync.example/');
  page.edit('chosen.example');
  await page.submit();
  assert.equal(getHomepage(), 'https://chosen.example/');
});
