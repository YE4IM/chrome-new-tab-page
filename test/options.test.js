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
  let { rules = [], temporaryHomepage = null, advancedEnabled = true, now = Date.now(), persistedHomepage } = options;
  let revision = 0;
  let ruleId = 0;
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
      advancedEnabled,
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
      if ((nextRules !== undefined && revision !== expectedRevision) ||
          (expectedHomepage !== undefined && persistedAddress !== expectedHomepage)) {
        throw Object.assign(new Error('conflict'), { code: 'SCHEDULE_CONFLICT' });
      }
      homepage = nextHomepage;
      persistedHomepage = undefined;
      if (nextRules !== undefined) {
        rules = nextRules;
        revision += 1;
        notify('homepageSchedule');
      }
      notify('homepage');
      return loadSettings();
    },
    async saveSchedule({ rules: nextRules, expectedRevision }) {
      if (writeFailed) throw new Error('storage unavailable');
      if (!advancedEnabled) throw Object.assign(new Error('disabled'), { code: 'ADVANCED_DISABLED' });
      if (expectedRevision !== undefined && revision !== expectedRevision) {
        throw Object.assign(new Error('conflict'), { code: 'SCHEDULE_CONFLICT' });
      }
      rules = nextRules;
      revision += 1;
      notify('homepageSchedule');
      return loadSettings();
    },
    async saveAdvancedEnabled(enabled) {
      if (writeFailed) throw new Error('storage unavailable');
      advancedEnabled = enabled;
      notify('advancedEnabled');
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
      toggleAdvanced(enabled) {
        const toggle = getElementById('advancedEnabled');
        toggle.checked = enabled;
        return toggle.dispatch('change');
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
  assert.equal(second.element('homepageConflict').hidden, false);

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
  assert.equal(editing.element('homepageConflict').hidden, false);
  await editing.submit();
  assert.equal(getHomepage(), 'https://migrated.example/');

  editing.click('keepHomepageDraft');
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
  await page.submit('scheduleForm');
  assert.equal(page.element('ruleErrors').hidden, false);
  assert.equal(first.start['aria-invalid'], 'true');
  assert.equal(second.start['aria-invalid'], 'true');
  assert.deepEqual(Array.from(page.messages.get('ruleOverlap')), ['Second', 'First', 'Friday', 'timeRange']);
  assert.deepEqual((await loadSettings()).rules, []);
  second.enabled.checked = false;
  page.element('rules').children.at(-1).dispatch('input');
  assert.equal(page.element('ruleErrors').hidden, true);
  await page.submit('scheduleForm');
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
  await editing.submit('scheduleForm');
  const saved = await loadSettings();
  assert.equal(saved.rules[0].homepage, 'https://work.example/');
  assert.equal(saved.temporaryHomepage, null);
});

test('跨设置页切换时保留隐藏草稿，基础主页可独立保存且到期的临时主页不再生效', async () => {
  const now = new Date(2026, 10, 27, 9, 30).getTime();
  const work = {
    id: 'work', name: 'Work', days: [5], start: '09:00', end: '18:00',
    homepage: 'https://work.example/', enabled: true,
  };
  const temporaryHomepage = { homepage: 'https://meeting.example/', startsAt: now, expiresAt: now + 3600_000 };
  const { openPage, advanceTo, loadSettings } = setup(DEFAULT_HOMEPAGE, { now, rules: [work], temporaryHomepage });
  const editing = openPage();
  const switching = openPage();
  await settle();
  assert.equal(editing.target(), temporaryHomepage.homepage);

  const draft = editing.addFridayRule('Draft', '09:00', '10:00', '');
  editing.edit('base.example');
  editing.edit('temporary-draft.example', 'temporaryUrl');
  await switching.toggleAdvanced(false);
  await settle();
  assert.equal(editing.element('advancedEnabled').checked, false);
  assert.equal(editing.element('scheduleForm').hidden, true);
  assert.equal(editing.element('previewSection').hidden, true);
  assert.equal(editing.save.textContent, 'saveHomepage');
  await editing.submit();
  assert.deepEqual((await loadSettings()).rules, [work]);
  assert.deepEqual((await loadSettings()).temporaryHomepage, temporaryHomepage);
  assert.equal((await loadSettings()).homepage, 'https://base.example/');

  advanceTo(temporaryHomepage.expiresAt);
  await switching.toggleAdvanced(true);
  await settle();
  assert.equal(editing.element('scheduleForm').hidden, false);
  assert.equal(editing.save.textContent, 'saveHomepage');
  assert.equal(editing.element('saveSchedule').textContent, 'saveBtn');
  assert.equal(editing.input.value, 'https://base.example/');
  assert.equal(editing.element('temporaryUrl').value, 'temporary-draft.example');
  assert.equal(editing.element('rules').children.length, 2);
  assert.equal(draft.name.value, 'Draft');
  assert.equal(editing.target(), work.homepage);
  assert.equal(editing.element('endTemporary').hidden, true);
});

test('切换保存失败时恢复开关和当前模式，并保留主页草稿', async () => {
  const { openPage, failWrites } = setup(DEFAULT_HOMEPAGE, { advancedEnabled: false });
  const page = openPage();
  await settle();
  page.edit('draft.example');
  failWrites();
  await page.toggleAdvanced(true);
  assert.equal(page.element('advancedEnabled').checked, false);
  assert.equal(page.element('scheduleForm').hidden, true);
  assert.equal(page.element('temporaryForm').hidden, true);
  assert.equal(page.element('previewSection').hidden, true);
  assert.equal(page.target(), DEFAULT_HOMEPAGE);
  assert.equal(page.element('advancedStatus').textContent, 'statusSaveFail');
  assert.equal(page.input.value, 'draft.example');
  assert.equal(page.save.disabled, false);
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

test('刷新加载和跨设置页切换后，始终显示当前高级功能状态', async () => {
  const offSetup = setup(DEFAULT_HOMEPAGE, { advancedEnabled: false });
  const offPage = offSetup.openPage();
  await settle();
  assert.equal(offPage.element('advancedStatus').textContent, 'advancedOff');
  assert.equal(offPage.element('advancedStatus').className, 'status');

  const onSetup = setup(DEFAULT_HOMEPAGE, { advancedEnabled: true });
  const first = onSetup.openPage();
  const second = onSetup.openPage();
  await settle();
  assert.equal(first.element('advancedStatus').textContent, 'advancedOn');
  assert.equal(first.element('advancedStatus').className, 'status success');

  await second.toggleAdvanced(false);
  await settle();
  assert.equal(first.element('advancedStatus').textContent, 'advancedOff');
  assert.equal(first.element('advancedStatus').className, 'status');
  assert.equal(second.element('advancedStatus').textContent, 'advancedOff');
  assert.equal(second.element('advancedStatus').className, 'status');

  await second.toggleAdvanced(true);
  await settle();
  assert.equal(first.element('advancedStatus').textContent, 'advancedOn');
  assert.equal(first.element('advancedStatus').className, 'status success');
});

test('当前主页在基础和高级模式下都展示并跟随保存与模式切换更新', async () => {
  const now = new Date(2026, 10, 27, 17, 30).getTime();
  const temporaryHomepage = { homepage: 'https://meeting.example/', startsAt: now, expiresAt: now + 3600_000 };
  const { openPage } = setup(DEFAULT_HOMEPAGE, { now, advancedEnabled: false, temporaryHomepage });
  const page = openPage();
  await settle();

  assert.equal(page.target(), DEFAULT_HOMEPAGE);
  assert.equal(page.element('currentResult').lastElementChild.textContent, 'sourceBase');
  assert.equal(page.element('endTemporary').hidden, true);

  page.edit('https://www.google.com/');
  await page.submit();
  assert.equal(page.target(), 'https://www.google.com/');
  assert.equal(page.element('currentResult').lastElementChild.textContent, 'sourceBase');
  assert.equal(page.element('endTemporary').hidden, true);

  await page.toggleAdvanced(true);
  assert.equal(page.target(), temporaryHomepage.homepage);
  assert.equal(page.element('endTemporary').hidden, false);

  await page.toggleAdvanced(false);
  assert.equal(page.target(), 'https://www.google.com/');
  assert.equal(page.element('currentResult').lastElementChild.textContent, 'sourceBase');
  assert.equal(page.element('endTemporary').hidden, true);
});

test('基础主页与每周时段独立保存，各自保留对方的无效或未保存草稿', async () => {
  const { openPage, loadSettings } = setup(DEFAULT_HOMEPAGE);
  const page = openPage();
  await settle();

  const rule = page.addFridayRule('Work', '09:00', '18:00', '');
  page.edit('base.example');
  await page.submit('settingsForm');
  assert.equal((await loadSettings()).homepage, 'https://base.example/');
  assert.deepEqual((await loadSettings()).rules, []);
  assert.equal(page.element('ruleErrors').hidden, true);
  assert.equal(rule.name.value, 'Work');
  assert.equal(page.element('saveSchedule').disabled, false);

  page.edit('file:///invalid');
  rule.homepage.value = 'work.example';
  page.element('rules').children.at(-1).dispatch('input');
  await page.submit('scheduleForm');
  assert.equal((await loadSettings()).homepage, 'https://base.example/');
  assert.equal((await loadSettings()).rules[0].homepage, 'https://work.example/');
  assert.equal(page.input.value, 'file:///invalid');
  assert.equal(page.element('errMsg').hidden, true);
  assert.equal(page.save.disabled, false);
});

test('跨设置页修改基础主页或每周时段互不冲突', async () => {
  const work = {
    id: 'work', name: 'Work', days: [5], start: '09:00', end: '18:00',
    homepage: 'https://work.example/', enabled: true,
  };
  const { openPage, loadSettings } = setup(DEFAULT_HOMEPAGE, { rules: [work] });
  const first = openPage();
  const second = openPage();
  await settle();

  second.edit('base-draft.example');
  first.addFridayRule('Evening', '19:00', '21:00', 'evening.example');
  await first.submit('scheduleForm');
  await settle();
  assert.equal(second.input.value, 'base-draft.example');
  assert.equal(second.element('homepageConflict').hidden, true);
  assert.equal(second.element('scheduleConflict').hidden, true);
  assert.equal(second.save.disabled, false);
  await second.submit('settingsForm');
  await settle();
  assert.equal((await loadSettings()).homepage, 'https://base-draft.example/');

  second.addFridayRule('Night', '22:00', '23:00', 'night.example');
  first.edit('other-base.example');
  await first.submit('settingsForm');
  await settle();
  assert.equal(second.element('homepageConflict').hidden, true);
  assert.equal(second.element('scheduleConflict').hidden, true);
  assert.equal(second.element('saveSchedule').disabled, false);
  await second.submit('scheduleForm');
  assert.equal((await loadSettings()).rules.length, 3);
});

test('每周时段跨设置页冲突会展开每周时段并只阻止保存排程，不影响基础主页', async () => {
  const { openPage, loadSettings } = setup(DEFAULT_HOMEPAGE);
  const first = openPage();
  const second = openPage();
  await settle();

  second.edit('base-draft.example');
  second.addFridayRule('DraftRule', '09:00', '12:00', 'draft-rule.example');
  first.addFridayRule('SavedRule', '10:00', '13:00', 'saved-rule.example');
  await first.submit('scheduleForm');
  await settle();

  assert.equal(second.element('scheduleConflict').hidden, false);
  assert.equal(second.element('scheduleDetails').open, true);
  assert.equal(second.element('saveSchedule').disabled, true);
  assert.equal(second.element('homepageConflict').hidden, true);
  assert.equal(second.save.disabled, false);

  await second.submit('settingsForm');
  await settle();
  assert.equal((await loadSettings()).homepage, 'https://base-draft.example/');
  assert.equal(second.element('scheduleConflict').hidden, false);

  second.click('keepScheduleDraft');
  assert.equal(second.element('scheduleConflict').hidden, true);
  assert.equal(second.element('saveSchedule').disabled, false);
  await second.submit('scheduleForm');
  assert.equal((await loadSettings()).rules[0].homepage, 'https://draft-rule.example/');
});

test('同一设置页并发提交基础主页、每周时段和临时主页全部保留', async () => {
  const now = new Date(2026, 10, 27, 17, 30).getTime();
  const { openPage, loadSettings } = setup(DEFAULT_HOMEPAGE, { now });
  const page = openPage();
  await settle();

  page.edit('base-concurrent.example');
  page.addFridayRule('Work', '09:00', '18:00', 'work-concurrent.example');
  page.edit('temp-concurrent.example', 'temporaryUrl');
  await Promise.all([
    page.submit('settingsForm'),
    page.submit('scheduleForm'),
    page.submit('temporaryForm'),
  ]);
  await settle();

  const saved = await loadSettings();
  assert.equal(saved.homepage, 'https://base-concurrent.example/');
  assert.equal(saved.rules[0].homepage, 'https://work-concurrent.example/');
  assert.equal(saved.temporaryHomepage.homepage, 'https://temp-concurrent.example/');
  assert.equal(page.target(), 'https://temp-concurrent.example/');
});
