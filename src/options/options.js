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
    saveTemporaryHomepage, clearTemporaryHomepage,
  } = HomepageSettings;
  const { resolveHomepage, validateSchedule } = HomepageRules;
  const form = byId('settingsForm');
  const fields = byId('settingsFields');
  const input = byId('hp');
  const saveBtn = byId('save');
  const logoImg = byId('siteLogo');
  const customChip = byId('customChip');
  const presetChips = Array.from(document.querySelectorAll('.chip[data-url]'));
  const scheduleDetails = byId('scheduleDetails');
  const rulesContainer = byId('rules');
  const ruleErrors = byId('ruleErrors');
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
  const scheduleKeys = ['homepage', 'homepageSchedule', 'temporaryHomepage'];

  let savedSettings = null;
  let draftRevision;
  let draftHomepage;
  let conflicting = false;
  let draftUrl;
  let draftRules;
  let showRuleErrors = false;
  let activeChip;
  let logoKey;
  let saving = false;
  let changingTemporary = false;
  let refreshPending = false;
  let refreshing = false;
  let writesStarted = 0;
  let btnRevertTimer;
  let clockTimer;
  let previewMode = 'now';
  const rows = [];

  function writeText(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }

  function showStatus(element, message, kind = '') {
    writeText(element, message);
    element.className = kind ? `status ${kind}` : 'status';
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
    const warnings = [];
    if (settings.scheduleNeedsRepair) warnings.push(t('warnInvalidSchedule'));
    if (settings.temporaryNeedsRepair) warnings.push(t('warnInvalidTemporary'));
    const element = byId('settingsWarnings');
    element.hidden = warnings.length === 0;
    writeText(element, warnings.join(' '));
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
    const hasEdits = Boolean(savedSettings && (
      draftUrl.comparisonValue !== savedSettings.homepage || errors.length ||
      rulesSignature(rules) !== rulesSignature(savedSettings.rules)
    ));
    return {
      homepage: draftUrl.homepage, rules, errors, hasEdits,
      canSave: hasEdits || Boolean(savedSettings?.needsRepair || savedSettings?.scheduleNeedsRepair),
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
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="14" fill="#6366f1"/><text x="32" y="43" font-family="system-ui,sans-serif" font-size="32" font-weight="600" fill="white" text-anchor="middle">${letter}</text></svg>`;
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
    saveBtn.disabled = saving || conflicting || !state.canSave;
    updateLogo(state.homepage, matched);
    renderPreview();
    return state;
  }

  function clearSavedFeedback() {
    clearTimeout(btnRevertTimer);
    writeText(saveBtn, t('saveBtn'));
    saveBtn.classList.remove('saved');
  }

  function draftEdited() {
    clearSavedFeedback();
    const { hasEdits } = renderDraft();
    if (hasEdits) showStatus(statusEl, t('statusDirty'));
    else if (conflicting) applySaved(savedSettings, true);
    else settingsStatus(savedSettings);
  }

  function editDraft() {
    byId('inputWrap').classList.remove('invalid');
    fieldError(input, byId('errMsg'));
    draftEdited();
  }

  function editRules() {
    draftRules = undefined;
    updateRuleLabels();
    if (showRuleErrors) renderRuleErrors(getDraftState().errors);
    draftEdited();
  }

  function updateDraftBaseline(settings) {
    draftRevision = settings.revision;
    draftHomepage = settings.persistedHomepage ?? settings.homepage;
  }

  function applyDraft(settings) {
    updateDraftBaseline(settings);
    input.value = settings.homepage;
    rows.length = 0;
    rulesContainer.replaceChildren();
    for (const rule of settings.rules) addRuleRow(rule);
    draftRules = undefined;
    showRuleErrors = false;
    renderRuleErrors([]);
    byId('inputWrap').classList.remove('invalid');
    fieldError(input, byId('errMsg'));
    clearSavedFeedback();
    updateRuleLabels();
  }

  function renderConflict() {
    scheduleConflict.hidden = !conflicting;
    if (!conflicting) return;
    byId('conflictHomepage').textContent = savedSettings.homepage;
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
    const hadEdits = savedSettings && getDraftState().hasEdits;
    const persistedHomepage = settings.persistedHomepage ?? settings.homepage;
    const scheduleChanged = savedSettings && (
      settings.revision !== savedSettings.revision || settings.homepage !== savedSettings.homepage ||
      persistedHomepage !== (savedSettings.persistedHomepage ?? savedSettings.homepage)
    );
    const warningsChanged = settings.warning !== savedSettings?.warning;
    savedSettings = settings;
    if (replaceDraft || !hadEdits) {
      if (replaceDraft || scheduleChanged) applyDraft(settings);
      conflicting = false;
      if (replaceDraft || scheduleChanged || warningsChanged) settingsStatus(settings);
    } else if (scheduleChanged) {
      const { hasEdits } = getDraftState();
      conflicting = hasEdits && (
        settings.revision !== draftRevision || persistedHomepage !== draftHomepage
      );
      if (conflicting) showStatus(statusEl, t('statusOtherPageUpdate'));
      else {
        updateDraftBaseline(settings);
        if (hasEdits) showStatus(statusEl, t('statusDirty'));
        else settingsStatus(settings);
      }
    }
    renderConflict();
    updateWarnings(settings);
    renderDraft();
    updateClock();
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
    if (!savedSettings) return;
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

    const { homepage, rules, errors, hasEdits } = getDraftState();
    byId('previewDraft').hidden = !hasEdits;
    const error = byId('previewError');
    const message = dateError ? t('invalidDate') : !homepage || errors.length ? t('previewInvalidDraft') : '';
    fieldError(previewDate, error, dateError ? message : '');
    error.hidden = !message;
    if (message) {
      writeText(error, message);
      renderResult('previewResult');
      return;
    }
    const config = { homepage, rules, temporaryHomepage };
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
    endTemporary.disabled = changingTemporary;
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
    const { temporaryHomepage } = savedSettings;
    const result = resolveHomepage(savedSettings, now);
    const active = result.source === 'temporary';
    const reason = active
      ? t('currentTemporary', [
          formatDate(temporaryHomepage.expiresAt),
          resolveHomepage(savedSettings, temporaryHomepage.expiresAt).homepage,
        ])
      : describeResult(result, savedSettings);
    renderResult('currentResult', result, reason);
    renderTemporaryControls(now, active);
    renderPreview(now);

    const boundaries = [minute - (now % minute)];
    if (temporaryHomepage?.startsAt > now) boundaries.push(temporaryHomepage.startsAt - now);
    if (temporaryHomepage?.expiresAt > now) boundaries.push(temporaryHomepage.expiresAt - now);
    clockTimer = setTimeout(updateClock, Math.min(...boundaries));
  }

  async function refreshSavedSettings() {
    refreshPending = true;
    if (saving || changingTemporary || refreshing || !savedSettings) return;
    refreshing = true;
    try {
      do {
        refreshPending = false;
        const writeCount = writesStarted;
        const settings = await loadSettings();
        if (saving || changingTemporary) {
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

  async function initialize() {
    fields.disabled = true;
    temporaryFields.disabled = true;
    byId('previewFields').disabled = true;
    retryBtn.hidden = true;
    showStatus(statusEl, t('statusLoading'));
    try {
      applySaved(await loadSettings(), true);
      fields.disabled = false;
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
    if (saving || !savedSettings || conflicting) return;
    const { homepage, rules, errors, canSave } = getDraftState();
    if (!canSave) return;
    if (errors.length) {
      showRuleErrors = true;
      scheduleDetails.open = true;
    }
    const firstRuleError = renderRuleErrors(errors);
    if (!homepage || firstRuleError) {
      byId('inputWrap').classList.toggle('invalid', !homepage);
      fieldError(input, byId('errMsg'), homepage ? '' : t('errMsg'));
      (homepage ? firstRuleError : input).focus();
      return;
    }

    saving = true;
    writesStarted += 1;
    fields.disabled = true;
    form.setAttribute('aria-busy', 'true');
    clearSavedFeedback();
    writeText(saveBtn, t('saveBtnSaving'));
    showStatus(statusEl, t('statusSaving'));
    try {
      applySaved(await saveSettings({
        homepage, rules, expectedRevision: draftRevision, expectedHomepage: draftHomepage,
      }), true);
      showStatus(statusEl, t('statusSaved'), 'success');
      writeText(saveBtn, t('saveBtnSaved'));
      saveBtn.classList.add('saved');
      btnRevertTimer = setTimeout(clearSavedFeedback, 2000);
    } catch (error) {
      clearSavedFeedback();
      if (error?.code === 'SCHEDULE_CONFLICT') {
        showStatus(statusEl, t('statusOtherPageUpdate'), 'error');
        refreshPending = true;
      } else {
        showStatus(statusEl, t('statusSaveFail'), 'error');
      }
    } finally {
      saving = false;
      fields.disabled = false;
      form.setAttribute('aria-busy', 'false');
      renderDraft();
      if (refreshPending) void refreshSavedSettings();
    }
  });

  async function changeTemporary(operation, success) {
    if (changingTemporary || !savedSettings) return;
    changingTemporary = true;
    writesStarted += 1;
    temporaryFields.disabled = true;
    endTemporary.disabled = true;
    temporaryForm.setAttribute('aria-busy', 'true');
    showStatus(temporaryStatus, t('statusSaving'));
    try {
      const settings = await operation();
      applySaved(settings);
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
      if (refreshPending) void refreshSavedSettings();
    }
  }

  temporaryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (changingTemporary || !savedSettings) return;
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
  byId('useSavedSchedule').addEventListener('click', () => {
    applySaved(savedSettings, true);
    input.focus();
  });
  byId('keepScheduleDraft').addEventListener('click', () => {
    updateDraftBaseline(savedSettings);
    conflicting = false;
    renderConflict();
    renderDraft();
    showStatus(statusEl, t('statusDirty'));
    saveBtn.focus();
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
    if (area === 'local' && scheduleKeys.some((key) => Object.hasOwn(changes, key))) {
      void refreshSavedSettings();
    }
  });

  initialize();
})();
