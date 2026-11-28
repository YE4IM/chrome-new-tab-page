'use strict';

(function () {
  const byId = (id) => document.getElementById(id);
  const t = (key, subs) => chrome.i18n.getMessage(key, subs) || '';
  const statusEl = byId('status');
  const retryBtn = byId('retry');

  if (typeof HomepageSettings === 'undefined' || typeof HomepageRules === 'undefined') {
    statusEl.textContent = t('statusLoadFail');
    statusEl.className = 'status error';
    retryBtn.hidden = false;
    retryBtn.addEventListener('click', () => location.reload());
    return;
  }

  const {
    DEFAULT_HOMEPAGE, normalizeHomepage, loadSettings, saveSettings,
    saveSchedule, saveAdvancedEnabled, saveTemporaryHomepage, clearTemporaryHomepage,
  } = HomepageSettings;
  const { resolveHomepage, validateSchedule } = HomepageRules;
  const form = byId('settingsForm');
  const homepageFieldsets = ['settingsFields', 'settingsActions'].map(byId);
  const scheduleForm = byId('scheduleForm');
  const scheduleFieldsets = ['scheduleFields', 'scheduleActions'].map(byId);
  const input = byId('hp');
  const saveBtn = byId('save');
  const saveScheduleBtn = byId('saveSchedule');
  const advancedToggle = byId('advancedEnabled');
  const advancedStatus = byId('advancedStatus');
  const logoImg = byId('siteLogo');
  const customChip = byId('customChip');
  const presetChips = Array.from(document.querySelectorAll('.chip[data-url]'));
  const scheduleDetails = byId('scheduleDetails');
  const rulesContainer = byId('rules');
  const ruleErrors = byId('ruleErrors');
  const scheduleStatus = byId('scheduleStatus');
  const homepageConflict = byId('homepageConflict');
  const scheduleConflict = byId('scheduleConflict');
  const temporaryForm = byId('temporaryForm');
  const temporaryFields = byId('temporaryFields');
  const temporaryUrl = byId('temporaryUrl');
  const temporaryDuration = byId('temporaryDuration');
  const temporaryDate = byId('temporaryDate');
  const startTemporary = byId('startTemporary');
  const endTemporary = byId('endTemporary');
  const temporaryStatus = byId('temporaryStatus');
  const previewDate = byId('previewDate');
  const language = chrome.i18n.getUILanguage();
  const dayOrder = [1, 2, 3, 4, 5, 6, 0];
  const minute = 60_000;
  const settingsKeys = ['homepage', 'homepageSchedule', 'temporaryHomepage', 'advancedEnabled'];

  let savedSettings = null;
  let draftRevision;
  let draftHomepage;
  let draftHomepageNeedsRepair = false;
  let homepageConflicting = false;
  let scheduleConflicting = false;
  let draftUrl;
  let draftRules;
  let showRuleErrors = false;
  let activeChip;
  let logoKey;
  let savingHomepage = false;
  let savingSchedule = false;
  let changingTemporary = false;
  let changingMode = false;
  let refreshPending = false;
  let refreshing = false;
  let writesStarted = 0;
  let homepageBtnRevertTimer;
  let scheduleBtnRevertTimer;
  let clockTimer;
  let previewMode = 'now';
  const rows = [];
  const advancedEnabled = () => savedSettings?.advancedEnabled === true;
  const writing = () => savingHomepage || savingSchedule || changingTemporary || changingMode;

  function writeText(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }

  function showStatus(element, message, kind = '') {
    writeText(element, message);
    element.className = kind ? `status ${kind}` : 'status';
  }

  function showAdvancedState(enabled = advancedEnabled()) {
    showStatus(advancedStatus, t(enabled ? 'advancedOn' : 'advancedOff'), enabled ? 'success' : '');
  }

  function fieldError(field, error, message = '') {
    field.setAttribute('aria-invalid', String(Boolean(message)));
    error.hidden = !message;
    if (message) writeText(error, message);
  }

  function settingsStatus(settings) {
    const warning = settings.warning;
    showStatus(statusEl, warning ? t(warning) : '', warning ? 'error' : '');
  }

  function updateWarnings(settings) {
    const scheduleWarning = byId('scheduleWarning');
    scheduleWarning.hidden = !settings.scheduleNeedsRepair;
    writeText(scheduleWarning, settings.scheduleNeedsRepair ? t('warnInvalidSchedule') : '');
    const temporaryWarning = byId('temporaryWarning');
    temporaryWarning.hidden = !settings.temporaryNeedsRepair;
    writeText(temporaryWarning, settings.temporaryNeedsRepair ? t('warnInvalidTemporary') : '');
  }

  function weekday(day, length = 'long') {
    const sunday = Date.UTC(2024, 0, 7 + day);
    return new Intl.DateTimeFormat(language, { weekday: length, timeZone: 'UTC' }).format(sunday);
  }

  function formatTime(value) {
    const minutes = typeof value === 'number'
      ? value
      : Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    if (minutes === 1440) return '24:00';
    return new Intl.DateTimeFormat(language, {
      hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
    }).format(minutes * minute);
  }

  function formatDate(instant) {
    return new Intl.DateTimeFormat(language, {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(instant);
  }

  function formatDateInput(instant) {
    const date = new Date(instant);
    const pad = (value) => String(value).padStart(2, '0');
    const year = String(date.getFullYear()).padStart(4, '0');
    return `${year}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function parseDateInput(value) {
    const match = /^(\d{4,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
    if (!match) return NaN;
    const [, year, month, day, hour, minutes] = match.map(Number);
    const date = new Date(0);
    // Date uses the earlier occurrence when a wall time repeats.
    date.setFullYear(year, month - 1, day);
    date.setHours(hour, minutes, 0, 0);
    const instant = date.getTime();
    return Number.isFinite(instant) && formatDateInput(instant) === value ? instant : NaN;
  }

  function repeatsLocalTime(instant) {
    const tomorrow = new Date(instant);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const shift = tomorrow.getTime() - instant - 24 * 60 * minute;
    return shift > 0 && formatDateInput(instant + shift) === formatDateInput(instant);
  }

  function describedTime(start, end) {
    return t('timeRange', [formatTime(start), formatTime(end)]);
  }

  function ruleName(row, index) {
    return row?.controls.name.value.trim() || t('unnamedRule', [String(index + 1)]);
  }

  function addRuleRow(rule) {
    const template = byId('ruleTemplate');
    const node = template.content.firstElementChild.cloneNode(true);
    const controls = {};
    node.querySelectorAll('[data-label]').forEach((label) => {
      label.textContent = t(label.dataset.label);
    });
    node.querySelectorAll('[data-field]').forEach((control) => {
      controls[control.dataset.field] = control;
    });
    const { name, days, start, end, homepage, enabled } = controls;
    name.value = rule.name;
    start.value = rule.start;
    end.value = rule.end;
    homepage.value = rule.homepage;
    enabled.checked = rule.enabled;
    const dayInputs = dayOrder.map((day) => {
      const label = document.createElement('label');
      label.className = 'day';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = String(day);
      checkbox.checked = rule.days.includes(day);
      checkbox.setAttribute('aria-label', weekday(day));
      const text = document.createElement('span');
      text.textContent = weekday(day, 'short');
      text.setAttribute('aria-hidden', 'true');
      label.append(checkbox, text);
      days.append(label);
      return checkbox;
    });
    const remove = node.querySelector('[data-remove]');
    const row = { id: rule.id, node, controls, dayInputs, remove };
    rows.push(row);
    node.addEventListener('input', editRules);
    remove.addEventListener('click', () => {
      const index = rows.indexOf(row);
      rows.splice(index, 1);
      node.remove();
      editRules();
      (rows[index]?.controls.name || rows[index - 1]?.controls.name || byId('addRule')).focus();
    });
    rulesContainer.append(node);
    return row;
  }

  function readRules() {
    return rows.map(({ id, controls, dayInputs }) => ({
      id,
      name: controls.name.value,
      days: dayInputs.filter((day) => day.checked).map((day) => Number(day.value)),
      start: controls.start.value,
      end: controls.end.value,
      homepage: controls.homepage.value,
      enabled: controls.enabled.checked,
    }));
  }

  function rulesSignature(rules) {
    return JSON.stringify(rules.map(({ id, name, days, start, end, homepage, enabled }) => [
      id, name, [...days].sort(), start, end, homepage, enabled,
    ]));
  }

  function getDraftState() {
    const value = input.value;
    if (draftUrl?.value !== value) {
      const homepage = normalizeHomepage(value);
      draftUrl = { value, homepage, comparisonValue: homepage || value.trim() };
    }
    draftRules ||= validateSchedule(readRules());
    const { rules, errors } = draftRules;
    const homepageEdited = Boolean(savedSettings && draftUrl.comparisonValue !== savedSettings.homepage);
    const rulesEdited = Boolean(savedSettings && (
      errors.length || rulesSignature(rules) !== rulesSignature(savedSettings.rules)
    ));
    const advanced = advancedEnabled();
    return {
      homepage: draftUrl.homepage,
      rules,
      errors,
      homepageEdited,
      rulesEdited,
      canSaveHomepage: homepageEdited || Boolean(savedSettings?.needsRepair),
      canSaveSchedule: advanced && (rulesEdited || Boolean(savedSettings?.scheduleNeedsRepair)),
    };
  }

  function updateRuleLabels() {
    rows.forEach((row, index) => {
      const label = ruleName(row, index);
      row.node.setAttribute('aria-label', label);
      row.remove.setAttribute('aria-label', t('removeNamedRule', [label]));
    });
  }

  function renderRuleErrors(errors) {
    ruleErrors.replaceChildren();
    for (const row of rows) {
      for (const control of Object.values(row.controls)) {
        control.removeAttribute('aria-invalid');
        control.removeAttribute('aria-describedby');
      }
    }
    let first;
    const fields = {
      name: 'ruleNameError', days: 'ruleDaysError', start: 'ruleTimeError',
      end: 'ruleTimeError', homepage: 'errMsg',
    };
    errors.forEach((error, index) => {
      const row = rows[error.index];
      if (!row) return;
      const name = ruleName(row, error.index);
      const item = document.createElement('li');
      item.id = `ruleError-${index}`;
      const mark = (target, keys) => {
        for (const key of keys) {
          const element = target.controls[key];
          element.setAttribute('aria-invalid', 'true');
          const existing = element.getAttribute('aria-describedby');
          element.setAttribute('aria-describedby', [existing, item.id].filter(Boolean).join(' '));
          first ||= key === 'days' ? target.dayInputs[0] : element;
        }
      };
      if (error.code === 'overlap') {
        const other = rows[error.otherIndex];
        item.textContent = t('ruleOverlap', [
          name, ruleName(other, error.otherIndex), weekday(error.day), describedTime(error.start, error.end),
        ]);
        mark(row, ['start', 'end']);
        mark(other, ['start', 'end']);
      } else {
        const key = error.code === 'equalTimes' ? 'ruleEqualTimes' : fields[error.field] || 'ruleGenericError';
        item.textContent = t('ruleFieldError', [name, t(key)]);
        mark(row, [row.controls[error.field] ? error.field : 'name']);
      }
      ruleErrors.append(item);
    });
    ruleErrors.hidden = errors.length === 0;
    return first;
  }

  // Preset and custom icons are available locally.
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
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><style>rect{fill:#26604b}text{fill:#fff}@media(prefers-color-scheme:dark){rect{fill:#a6d7b7}text{fill:#112b20}}</style><rect width="64" height="64" rx="14"/><text x="32" y="43" font-family="system-ui,sans-serif" font-size="32" font-weight="600" text-anchor="middle">${letter}</text></svg>`;
    logoImg.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    logoImg.alt = host ? t('logoHostAlt', [host]) : t('logoCustomAlt');
  }

  function renderDraft() {
    const state = getDraftState();
    const matched = presetChips.find((chip) => chip.dataset.url === state.homepage);
    const nextChip = matched || customChip;
    if (nextChip !== activeChip) {
      activeChip?.classList.remove('active');
      activeChip?.setAttribute('aria-pressed', 'false');
      nextChip.classList.add('active');
      nextChip.setAttribute('aria-pressed', 'true');
      activeChip = nextChip;
    }
    const nextHomepageConflicting = Boolean(
      savedSettings && state.homepageEdited && (
        draftHomepage !== (savedSettings.persistedHomepage ?? savedSettings.homepage) ||
        draftHomepageNeedsRepair !== Boolean(savedSettings.needsRepair)
      ),
    );
    const nextScheduleConflicting = Boolean(
      savedSettings && advancedEnabled() && state.rulesEdited && draftRevision !== savedSettings.revision,
    );
    const scheduleNewlyConflicted = nextScheduleConflicting && !scheduleConflicting;
    homepageConflicting = nextHomepageConflicting;
    scheduleConflicting = nextScheduleConflicting;
    renderHomepageConflict();
    renderScheduleConflict();
    if (scheduleNewlyConflicted) scheduleDetails.open = true;
    saveBtn.disabled = savingHomepage || changingMode || homepageConflicting || !state.canSaveHomepage;
    saveScheduleBtn.disabled = savingSchedule || changingMode || scheduleConflicting || !state.canSaveSchedule;
    updateLogo(state.homepage, matched);
    renderPreview();
    return state;
  }

  function clearHomepageSavedFeedback() {
    clearTimeout(homepageBtnRevertTimer);
    writeText(saveBtn, t('saveHomepage'));
    saveBtn.classList.remove('saved');
  }

  function clearScheduleSavedFeedback() {
    clearTimeout(scheduleBtnRevertTimer);
    writeText(saveScheduleBtn, t('saveBtn'));
    saveScheduleBtn.classList.remove('saved');
  }

  function homepageDraftEdited() {
    clearHomepageSavedFeedback();
    const { homepageEdited } = getDraftState();
    if (!homepageEdited) {
      draftHomepage = savedSettings.persistedHomepage ?? savedSettings.homepage;
      draftHomepageNeedsRepair = Boolean(savedSettings.needsRepair);
    }
    renderDraft();
    if (homepageConflicting) showStatus(statusEl, t('statusOtherPageUpdate'));
    else if (homepageEdited) showStatus(statusEl, t('statusDirty'));
    else settingsStatus(savedSettings);
  }

  function scheduleDraftEdited() {
    clearScheduleSavedFeedback();
    const { rulesEdited } = getDraftState();
    if (!rulesEdited) draftRevision = savedSettings.revision;
    renderDraft();
    if (scheduleConflicting) showStatus(scheduleStatus, t('statusOtherPageUpdate'));
    else if (rulesEdited) showStatus(scheduleStatus, t('statusDirty'));
    else showStatus(scheduleStatus, '');
  }

  function editDraft() {
    byId('inputWrap').classList.remove('invalid');
    fieldError(input, byId('errMsg'));
    homepageDraftEdited();
  }

  function editRules() {
    draftRules = undefined;
    updateRuleLabels();
    if (showRuleErrors) renderRuleErrors(getDraftState().errors);
    scheduleDraftEdited();
  }

  function applyHomepageDraft(settings) {
    draftHomepage = settings.persistedHomepage ?? settings.homepage;
    draftHomepageNeedsRepair = Boolean(settings.needsRepair);
    input.value = settings.homepage;
    byId('inputWrap').classList.remove('invalid');
    fieldError(input, byId('errMsg'));
  }

  function applyRulesDraft(settings) {
    draftRevision = settings.revision;
    rows.length = 0;
    rulesContainer.replaceChildren();
    for (const rule of settings.rules) addRuleRow(rule);
    draftRules = undefined;
    showRuleErrors = false;
    renderRuleErrors([]);
    updateRuleLabels();
  }

  function renderHomepageConflict() {
    homepageConflict.hidden = !homepageConflicting;
    if (!homepageConflicting) return;
    writeText(byId('homepageConflictMessage'), t('homepageConflict'));
    writeText(byId('homepageConflictSummary'), t('savedHomepage'));
    writeText(byId('useSavedHomepage'), t('useSavedHomepage'));
    byId('conflictHomepage').textContent = savedSettings.homepage;
  }

  function renderScheduleConflict() {
    scheduleConflict.hidden = !scheduleConflicting;
    if (!scheduleConflicting) return;
    writeText(byId('conflictMessage'), t('scheduleConflict'));
    writeText(byId('conflictSummary'), t('savedSchedule'));
    writeText(byId('useSavedSchedule'), t('useSavedSchedule'));
    const list = byId('conflictRules');
    list.replaceChildren();
    if (!savedSettings.rules.length) {
      const item = document.createElement('li');
      item.textContent = t('noSavedRules');
      list.append(item);
    }
    for (const rule of savedSettings.rules) {
      const item = document.createElement('li');
      const days = dayOrder.filter((day) => rule.days.includes(day)).map((day) => weekday(day, 'short'));
      const dayList = new Intl.ListFormat(language).format(days);
      item.textContent = t('savedRuleSummary', [
        rule.name, dayList, describedTime(rule.start, rule.end), rule.homepage,
        t(rule.enabled ? 'ruleEnabled' : 'ruleDisabled'),
      ]);
      list.append(item);
    }
  }

  function applySaved(settings, replaceDraft = false) {
    const previous = savedSettings;
    const { homepageEdited, rulesEdited } = previous ? getDraftState() : {};
    const homepageChanged = settings.homepage !== previous?.homepage ||
      settings.persistedHomepage !== previous?.persistedHomepage;
    const rulesChanged = settings.revision !== previous?.revision;
    const modeChanged = settings.advancedEnabled !== previous?.advancedEnabled;
    savedSettings = settings;
    const current = getDraftState();
    if (replaceDraft || (homepageChanged && !homepageEdited)) applyHomepageDraft(settings);
    else if (!current.homepageEdited) {
      draftHomepage = settings.persistedHomepage ?? settings.homepage;
      draftHomepageNeedsRepair = Boolean(settings.needsRepair);
    }
    const preserveRules = rulesEdited && current.rulesEdited;
    if (replaceDraft || (rulesChanged && !preserveRules)) applyRulesDraft(settings);
    else if (!current.rulesEdited) draftRevision = settings.revision;
    if (replaceDraft) clearHomepageSavedFeedback();
    if (replaceDraft || modeChanged) clearScheduleSavedFeedback();
    if ((replaceDraft || modeChanged) && !changingMode) showAdvancedState();
    renderMode();
    updateWarnings(settings);
    const { homepageEdited: nextHomepageEdited, rulesEdited: nextRulesEdited } = renderDraft();
    if (replaceDraft || homepageChanged || settings.warning !== previous?.warning) {
      if (homepageConflicting) showStatus(statusEl, t('statusOtherPageUpdate'));
      else if (nextHomepageEdited) showStatus(statusEl, t('statusDirty'));
      else settingsStatus(settings);
    }
    if (replaceDraft || rulesChanged || modeChanged) {
      if (scheduleConflicting) showStatus(scheduleStatus, t('statusOtherPageUpdate'));
      else if (nextRulesEdited) showStatus(scheduleStatus, t('statusDirty'));
      else showStatus(scheduleStatus, '');
    }
    updateClock();
  }

  function renderMode() {
    const advanced = advancedEnabled();
    advancedToggle.checked = advanced;
    advancedToggle.disabled = !savedSettings;
    advancedToggle.setAttribute('aria-disabled', String(writing()));
    for (const id of ['temporaryForm', 'scheduleForm', 'previewSection']) {
      byId(id).hidden = !advanced;
    }
  }

  function renderResult(id, result, reason) {
    const element = byId(id);
    if (!result) {
      if (element.firstChild) element.replaceChildren();
      return;
    }
    if (!element.firstChild) element.append(document.createElement('strong'), document.createElement('p'));
    writeText(element.firstElementChild, result.homepage);
    writeText(element.lastElementChild, reason);
  }

  function describeResult(result, settings) {
    if (result.source === 'schedule') {
      const rule = settings.rules.find(({ id }) => id === result.ruleId);
      return t('sourceSchedule', [rule.name, describedTime(rule.start, rule.end)]);
    }
    return t(result.source === 'temporary' ? 'sourceTemporary' : 'sourceBase');
  }

  function renderPreview(now = Date.now()) {
    if (!advancedEnabled()) return;
    const { temporaryHomepage } = savedSettings;
    if (previewMode === 'expiry' && !temporaryHomepage) previewMode = 'now';
    let instant = now;
    if (previewMode === 'expiry' && temporaryHomepage) instant = temporaryHomepage.expiresAt;
    if (previewMode === 'custom') instant = parseDateInput(previewDate.value);
    else {
      const value = formatDateInput(instant);
      if (previewDate.value !== value) previewDate.value = value;
    }
    const dateError = !Number.isFinite(instant);
    const zone = new Intl.DateTimeFormat(language, { timeZoneName: 'shortOffset' });
    const zoneInstant = dateError ? now : instant;
    const offset = zone.formatToParts(zoneInstant).find(({ type }) => type === 'timeZoneName')?.value;
    const notes = [t('previewZone', [zone.resolvedOptions().timeZone, offset || ''])];
    if (previewMode === 'custom' && !dateError && repeatsLocalTime(instant)) notes.push(t('repeatedLocalTime'));
    writeText(byId('previewZone'), notes.join(' '));
    byId('previewExpiry').hidden = !temporaryHomepage;

    const { homepage, rules, errors, homepageEdited, rulesEdited } = getDraftState();
    byId('previewDraft').hidden = !(homepageEdited || rulesEdited);
    const error = byId('previewError');
    const message = dateError ? t('invalidDate') : !homepage || errors.length ? t('previewInvalidDraft') : '';
    fieldError(previewDate, error, dateError ? message : '');
    error.hidden = !message;
    if (message) {
      writeText(error, message);
      renderResult('previewResult');
      return;
    }
    const config = { homepage, rules, temporaryHomepage, advancedEnabled: true };
    const result = resolveHomepage(config, instant);
    renderResult('previewResult', result, describeResult(result, config));
  }

  function proposedExpiry(now) {
    return temporaryDuration.value === 'custom' ? parseDateInput(temporaryDate.value) : now + Number(temporaryDuration.value);
  }

  function renderTemporaryControls(now, active) {
    const custom = temporaryDuration.value === 'custom';
    byId('temporaryDateField').hidden = !custom;
    endTemporary.hidden = !active;
    endTemporary.disabled = changingTemporary || changingMode;
    writeText(startTemporary, t(active ? 'replaceTemporary' : 'startTemporary'));
    const expiry = proposedExpiry(now);
    const hint = byId('temporaryEndHint');
    hint.hidden = !(temporaryUrl.value.trim() && Number.isFinite(expiry) && expiry > now);
    if (!hint.hidden) {
      const notes = [t('temporaryEndHint', [formatDate(expiry)])];
      if (custom && repeatsLocalTime(expiry)) notes.push(t('repeatedLocalTime'));
      writeText(hint, notes.join(' '));
    }
  }

  function updateClock() {
    clearTimeout(clockTimer);
    if (!savedSettings) return;
    const now = Date.now();
    const advanced = advancedEnabled();
    const { temporaryHomepage } = savedSettings;
    const result = resolveHomepage(savedSettings, now);
    const active = advanced && result.source === 'temporary';
    const reason = active
      ? t('currentTemporary', [
          formatDate(temporaryHomepage.expiresAt),
          resolveHomepage(savedSettings, temporaryHomepage.expiresAt).homepage,
        ])
      : describeResult(result, savedSettings);
    renderResult('currentResult', result, reason);
    endTemporary.hidden = !active;
    if (!advanced) return;
    renderTemporaryControls(now, active);
    renderPreview(now);

    const boundaries = [minute - (now % minute)];
    if (temporaryHomepage?.startsAt > now) boundaries.push(temporaryHomepage.startsAt - now);
    if (temporaryHomepage?.expiresAt > now) boundaries.push(temporaryHomepage.expiresAt - now);
    clockTimer = setTimeout(updateClock, Math.min(...boundaries));
  }

  async function refreshSavedSettings() {
    refreshPending = true;
    if (writing() || refreshing || !savedSettings) return;
    refreshing = true;
    try {
      do {
        refreshPending = false;
        const writeCount = writesStarted;
        const settings = await loadSettings();
        if (writing()) {
          refreshPending = true;
          break;
        }
        if (writeCount !== writesStarted) refreshPending = true;
        // If an event arrived while reading, load again before applying the snapshot.
        if (!refreshPending) applySaved(settings);
      } while (refreshPending);
    } catch {
      showStatus(statusEl, t('statusRefreshFail'), 'error');
    } finally {
      refreshing = false;
    }
  }

  function setHomepageDisabled(disabled) {
    for (const fieldset of homepageFieldsets) fieldset.disabled = disabled;
  }

  function setScheduleDisabled(disabled) {
    for (const fieldset of scheduleFieldsets) fieldset.disabled = disabled;
  }

  async function initialize() {
    setHomepageDisabled(true);
    setScheduleDisabled(true);
    temporaryFields.disabled = true;
    byId('previewFields').disabled = true;
    retryBtn.hidden = true;
    showStatus(statusEl, t('statusLoading'));
    try {
      applySaved(await loadSettings(), true);
      setHomepageDisabled(false);
      setScheduleDisabled(false);
      temporaryFields.disabled = false;
      byId('previewFields').disabled = false;
      if (refreshPending) void refreshSavedSettings();
    } catch {
      showStatus(statusEl, t('statusLoadFail'), 'error');
      retryBtn.hidden = false;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (savingHomepage || changingMode || !savedSettings || homepageConflicting) return;
    const { homepage, canSaveHomepage } = getDraftState();
    if (!canSaveHomepage) return;
    if (!homepage) {
      byId('inputWrap').classList.add('invalid');
      fieldError(input, byId('errMsg'), t('errMsg'));
      input.focus();
      return;
    }

    savingHomepage = true;
    renderMode();
    const writeId = ++writesStarted;
    setHomepageDisabled(true);
    form.setAttribute('aria-busy', 'true');
    clearHomepageSavedFeedback();
    writeText(saveBtn, t('saveBtnSaving'));
    showStatus(statusEl, t('statusSaving'));
    try {
      const saved = await saveSettings({
        homepage, expectedHomepage: draftHomepage,
      });
      applyHomepageDraft(saved);
      if (writesStarted === writeId) applySaved(saved);
      else refreshPending = true;
      showStatus(statusEl, t('statusSaved'), 'success');
      writeText(saveBtn, t('saveBtnSaved'));
      saveBtn.classList.add('saved');
      homepageBtnRevertTimer = setTimeout(clearHomepageSavedFeedback, 2000);
    } catch (error) {
      clearHomepageSavedFeedback();
      if (error?.code === 'SCHEDULE_CONFLICT') {
        showStatus(statusEl, t('statusOtherPageUpdate'), 'error');
        refreshPending = true;
      } else {
        showStatus(statusEl, t('statusSaveFail'), 'error');
      }
    } finally {
      savingHomepage = false;
      setHomepageDisabled(false);
      form.setAttribute('aria-busy', 'false');
      renderMode();
      renderDraft();
      if (refreshPending) void refreshSavedSettings();
    }
  });

  scheduleForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (savingSchedule || changingMode || !savedSettings || !advancedEnabled() || scheduleConflicting) return;
    const { rules, errors, canSaveSchedule } = getDraftState();
    if (!canSaveSchedule) return;
    if (errors.length) {
      showRuleErrors = true;
      scheduleDetails.open = true;
    }
    const firstRuleError = renderRuleErrors(errors);
    if (firstRuleError) {
      firstRuleError.focus();
      return;
    }

    savingSchedule = true;
    renderMode();
    const writeId = ++writesStarted;
    setScheduleDisabled(true);
    scheduleForm.setAttribute('aria-busy', 'true');
    clearScheduleSavedFeedback();
    writeText(saveScheduleBtn, t('saveBtnSaving'));
    showStatus(scheduleStatus, t('statusSaving'));
    try {
      const saved = await saveSchedule({
        rules, expectedRevision: draftRevision,
      });
      applyRulesDraft(saved);
      if (writesStarted === writeId) applySaved(saved);
      else refreshPending = true;
      showStatus(scheduleStatus, t('statusSaved'), 'success');
      writeText(saveScheduleBtn, t('saveBtnSaved'));
      saveScheduleBtn.classList.add('saved');
      scheduleBtnRevertTimer = setTimeout(clearScheduleSavedFeedback, 2000);
    } catch (error) {
      clearScheduleSavedFeedback();
      if (error?.code === 'SCHEDULE_CONFLICT' || error?.code === 'ADVANCED_DISABLED') {
        showStatus(scheduleStatus, t('statusOtherPageUpdate'), 'error');
        refreshPending = true;
      } else {
        showStatus(scheduleStatus, t('statusSaveFail'), 'error');
      }
    } finally {
      savingSchedule = false;
      setScheduleDisabled(false);
      scheduleForm.setAttribute('aria-busy', 'false');
      renderMode();
      renderDraft();
      if (refreshPending) void refreshSavedSettings();
    }
  });

  advancedToggle.addEventListener('change', async () => {
    if (writing() || !savedSettings) {
      advancedToggle.checked = advancedEnabled();
      return;
    }
    const enabled = advancedToggle.checked;
    changingMode = true;
    writesStarted += 1;
    renderMode();
    renderDraft();
    showStatus(advancedStatus, t('statusSaving'));
    try {
      applySaved(await saveAdvancedEnabled(enabled));
      showAdvancedState(enabled);
    } catch {
      showStatus(advancedStatus, t('statusSaveFail'), 'error');
    } finally {
      changingMode = false;
      renderMode();
      renderDraft();
      if (refreshPending) void refreshSavedSettings();
    }
  });

  async function changeTemporary(operation, success) {
    if (changingTemporary || changingMode || !advancedEnabled()) return;
    changingTemporary = true;
    renderMode();
    renderDraft();
    const writeId = ++writesStarted;
    temporaryFields.disabled = true;
    endTemporary.disabled = true;
    temporaryForm.setAttribute('aria-busy', 'true');
    showStatus(temporaryStatus, t('statusSaving'));
    try {
      const settings = await operation();
      if (writesStarted === writeId) applySaved(settings);
      else refreshPending = true;
      showStatus(temporaryStatus, t(success), 'success');
      return true;
    } catch (error) {
      const message = {
        TEMPORARY_CONFLICT: 'temporaryChanged',
        INVALID_TEMPORARY_EXPIRY: 'invalidTemporaryDate',
      }[error?.code] || 'statusSaveFail';
      showStatus(temporaryStatus, t(message), 'error');
      refreshPending = true;
      return false;
    } finally {
      changingTemporary = false;
      temporaryFields.disabled = false;
      endTemporary.disabled = false;
      temporaryForm.setAttribute('aria-busy', 'false');
      renderMode();
      renderDraft();
      if (refreshPending) void refreshSavedSettings();
    }
  }

  temporaryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (changingTemporary || changingMode || !advancedEnabled()) return;
    const homepage = normalizeHomepage(temporaryUrl.value);
    fieldError(temporaryUrl, byId('temporaryUrlError'), homepage ? '' : t('errMsg'));
    const now = Date.now();
    const custom = temporaryDuration.value === 'custom';
    const expiresAt = proposedExpiry(now);
    const expiryValid = !custom || expiresAt > now;
    fieldError(temporaryDate, byId('temporaryDateError'), expiryValid ? '' : t('invalidTemporaryDate'));
    if (!homepage || !expiryValid) {
      (homepage ? temporaryDate : temporaryUrl).focus();
      return;
    }
    const options = custom ? { homepage, expiresAt } : { homepage, durationMs: Number(temporaryDuration.value) };
    if (await changeTemporary(() => saveTemporaryHomepage(options), 'temporaryStarted')) {
      temporaryUrl.value = '';
      temporaryDate.value = '';
      updateClock();
    }
  });

  endTemporary.addEventListener('click', async () => {
    const temporaryHomepage = savedSettings?.temporaryHomepage;
    if (!temporaryHomepage) return;
    if (await changeTemporary(() => clearTemporaryHomepage(temporaryHomepage), 'temporaryEnded')) {
      startTemporary.focus();
    }
  });

  for (const element of [temporaryUrl, temporaryDuration, temporaryDate]) {
    element.addEventListener('input', () => {
      fieldError(temporaryUrl, byId('temporaryUrlError'));
      fieldError(temporaryDate, byId('temporaryDateError'));
      updateClock();
    });
  }

  input.addEventListener('input', editDraft);
  byId('reset').addEventListener('click', () => {
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
  byId('addRule').addEventListener('click', () => {
    const row = addRuleRow({
      id: crypto.randomUUID(), name: '', days: [], start: '09:00', end: '18:00', homepage: '', enabled: true,
    });
    editRules();
    row.controls.name.focus();
  });
  byId('useSavedHomepage').addEventListener('click', () => {
    applyHomepageDraft(savedSettings);
    homepageDraftEdited();
    input.focus();
  });
  byId('keepHomepageDraft').addEventListener('click', () => {
    draftHomepage = savedSettings.persistedHomepage ?? savedSettings.homepage;
    draftHomepageNeedsRepair = Boolean(savedSettings.needsRepair);
    homepageDraftEdited();
    saveBtn.focus();
  });
  byId('useSavedSchedule').addEventListener('click', () => {
    applyRulesDraft(savedSettings);
    scheduleDraftEdited();
    byId('addRule').focus();
  });
  byId('keepScheduleDraft').addEventListener('click', () => {
    draftRevision = savedSettings.revision;
    scheduleDraftEdited();
    saveScheduleBtn.focus();
  });
  previewDate.addEventListener('input', () => {
    previewMode = 'custom';
    renderPreview();
  });
  byId('previewNow').addEventListener('click', () => {
    previewMode = 'now';
    renderPreview();
  });
  byId('previewExpiry').addEventListener('click', () => {
    previewMode = 'expiry';
    renderPreview();
  });
  retryBtn.addEventListener('click', initialize);
  function refreshOnReturn() {
    updateClock();
    if (savedSettings) void refreshSavedSettings();
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshOnReturn();
  });
  addEventListener('focus', refreshOnReturn);
  addEventListener('pageshow', refreshOnReturn);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && settingsKeys.some((key) => Object.hasOwn(changes, key))) {
      void refreshSavedSettings();
    }
  });

  initialize();
})();
