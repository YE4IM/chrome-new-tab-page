'use strict';

// 顶层 IIFE：settings.js 加载失败时兜底早退（对齐 newtab.js 的模式），不绑定任何依赖
// HomepageSettings 的逻辑；表单字段保持 options.html 初始的 disabled 态，重试重新加载整页。
(function () {
  if (typeof HomepageSettings === 'undefined') {
    const statusEl = document.getElementById('status');
    const retryBtn = document.getElementById('retry');
    statusEl.textContent = chrome.i18n.getMessage('statusLoadFail') || '';
    statusEl.className = 'status error';
    retryBtn.hidden = false;
    retryBtn.addEventListener('click', () => location.reload());
    return;
  }

  const { DEFAULT_HOMEPAGE, normalizeHomepage, loadSettings, saveSettings } = HomepageSettings;
  const form = document.getElementById('settingsForm');
  const fields = document.getElementById('settingsFields');
  const input = document.getElementById('hp');
  const inputWrap = document.getElementById('inputWrap');
  const errMsg = document.getElementById('errMsg');
  const saveBtn = document.getElementById('save');
  const resetBtn = document.getElementById('reset');
  const retryBtn = document.getElementById('retry');
  const statusEl = document.getElementById('status');
  const logoImg = document.getElementById('siteLogo');
  const customChip = document.getElementById('customChip');
  const presetChips = Array.from(document.querySelectorAll('.chip[data-url]'));

  // 文案统一走 chrome.i18n：默认英文，浏览器语言为中文时命中 zh_CN。
  const t = (key, subs) => chrome.i18n.getMessage(key, subs) || '';

  let savedSettings = null;
  let draft;
  let activeChip;
  let logoKey;
  let saving = false;
  let btnRevertTimer;

  function getDraftState() {
    const value = input.value;
    if (draft?.value !== value) {
      const url = normalizeHomepage(value);
      draft = { value, url, comparisonValue: url || value.trim() };
    }
    const hasEdits = Boolean(savedSettings && draft.comparisonValue !== savedSettings.homepage);
    // 损坏的地址可直接保存默认值来修复，即使用户没有编辑过输入框。
    return { url: draft.url, hasEdits, canSave: hasEdits || Boolean(savedSettings?.needsRepair) };
  }

  function showStatus(text, kind = '') {
    statusEl.textContent = text;
    statusEl.className = `status ${kind}`;
  }

  function showInputError(show) {
    inputWrap.classList.toggle('invalid', show);
    input.setAttribute('aria-invalid', String(show));
    errMsg.hidden = !show;
  }

  // 预设使用随扩展打包的品牌图标；自定义图标在本机生成，不请求外部服务。
  function updateLogo(url, preset) {
    const host = !preset && url ? new URL(url).hostname.replace(/^www\./, '') : '';
    const key = preset || host;
    if (key === logoKey) return;
    logoKey = key;
    if (preset) {
      logoImg.src = preset.dataset.icon;
      logoImg.alt = t('logoPresetAlt', [preset.textContent.trim()]);
      return;
    }
    const letter = (host[0] || '?').toUpperCase().replace(/[&<>"']/g, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="14" fill="#6366f1"/><text x="32" y="43" font-family="system-ui,sans-serif" font-size="32" font-weight="600" fill="white" text-anchor="middle">${letter}</text></svg>`;
    logoImg.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    logoImg.alt = host ? t('logoHostAlt', [host]) : t('logoCustomAlt');
  }

  function updateDraft() {
    const state = getDraftState();
    const { url, canSave } = state;
    const matched = presetChips.find((chip) => chip.dataset.url === url);
    const nextChip = matched || customChip;
    if (nextChip !== activeChip) {
      activeChip?.classList.remove('active');
      activeChip?.setAttribute('aria-pressed', 'false');
      nextChip.classList.add('active');
      nextChip.setAttribute('aria-pressed', 'true');
      activeChip = nextChip;
    }
    saveBtn.disabled = saving || !canSave;
    updateLogo(url, matched);
    return state;
  }

  function clearSavedFeedback() {
    clearTimeout(btnRevertTimer);
    saveBtn.textContent = t('saveBtn');
    saveBtn.classList.remove('saved');
  }

  function editDraft() {
    clearSavedFeedback();
    showInputError(false);
    const { canSave } = updateDraft();
    showStatus(canSave ? t('statusDirty') : t('statusCurrent', [savedSettings.homepage]));
  }

  function showSettingsStatus(settings) {
    // settings.warning 是 i18n 键名（settings.js 产出），本地化后展示。
    showStatus(settings.warning ? t(settings.warning) : t('statusCurrent', [settings.homepage]), settings.warning ? 'error' : '');
  }

  function applySettings(settings) {
    savedSettings = settings;
    input.value = settings.homepage;
    fields.disabled = false;
    retryBtn.hidden = true;
    showInputError(false);
    clearSavedFeedback();
    updateDraft();
    showSettingsStatus(settings);
  }

  async function initialize() {
    fields.disabled = true;
    retryBtn.hidden = true;
    showStatus(t('statusLoading'));
    try {
      applySettings(await loadSettings());
    } catch {
      showStatus(t('statusLoadFail'), 'error');
      retryBtn.hidden = false;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving || !savedSettings) return;
    const { url: homepage, canSave } = getDraftState();
    if (!canSave) return;
    if (!homepage) {
      showInputError(true);
      input.focus();
      return;
    }
    saving = true;
    fields.disabled = true;
    form.setAttribute('aria-busy', 'true');
    clearSavedFeedback();
    saveBtn.textContent = t('saveBtnSaving');
    showStatus(t('statusSaving'));
    try {
      applySettings(await saveSettings({ homepage }));
      showStatus(t('statusSaved', [homepage]), 'success');
      saveBtn.textContent = t('saveBtnSaved');
      saveBtn.classList.add('saved');
      btnRevertTimer = setTimeout(clearSavedFeedback, 2000);
    } catch (error) {
      clearSavedFeedback();
      showStatus(t('statusSaveFail') + (error?.message ? ' · ' + error.message : ''), 'error');
    } finally {
      saving = false;
      fields.disabled = false;
      form.setAttribute('aria-busy', 'false');
      updateDraft();
    }
  });

  input.addEventListener('input', editDraft);
  resetBtn.addEventListener('click', () => {
    input.value = DEFAULT_HOMEPAGE;
    editDraft();
  });
  presetChips.forEach((chip) => chip.addEventListener('click', () => {
    input.value = chip.dataset.url;
    editDraft();
  }));
  customChip.addEventListener('click', () => {
    input.focus();
    input.select();
  });
  retryBtn.addEventListener('click', initialize);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.homepage || !savedSettings) return;
    loadSettings().then((settings) => {
      if (saving || (settings.homepage === savedSettings.homepage && settings.needsRepair === savedSettings.needsRepair)) return;
      // 读取期间开始编辑的草稿也保留，并用新的已保存设置判断是否还有改动。
      if (getDraftState().hasEdits) {
        savedSettings = settings;
        const { hasEdits } = updateDraft();
        if (hasEdits) showStatus(t('statusOtherPageUpdate'));
        else showSettingsStatus(settings);
      } else {
        applySettings(settings);
      }
    }).catch(() => {
      if (!saving) showStatus(t('statusRefreshFail'), 'error');
    });
  });

  initialize();
})();
