'use strict';

(function (root) {
  const pad2 = (value) => String(value).padStart(2, '0');
  const pad4 = (value) => String(value).padStart(4, '0');

  function parseDateTimeValue(value) {
    if (typeof value !== 'string') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    if (year < 1000 || month < 0 || month > 11 || day < 1 || day > 31 || hour > 23 || minute > 59) {
      return null;
    }
    const probe = new Date(0);
    probe.setFullYear(year, month, day);
    if (probe.getFullYear() !== year || probe.getMonth() !== month || probe.getDate() !== day) {
      return null;
    }
    return { year, month, day, hour, minute };
  }

  function formatDateTimeValue({ year, month, day, hour, minute }) {
    return `${pad4(year)}-${pad2(month + 1)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}`;
  }

  function parseTimeValue(value) {
    if (typeof value !== 'string') return null;
    const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
  }

  function formatTimeValue({ hour, minute }) {
    return `${pad2(hour)}:${pad2(minute)}`;
  }

  function getFirstDayOfWeek(locale) {
    if (typeof Intl !== 'undefined' && typeof Intl.Locale === 'function' && locale) {
      try {
        const info = new Intl.Locale(locale);
        const weekInfo = typeof info.getWeekInfo === 'function' ? info.getWeekInfo() : info.weekInfo;
        if (weekInfo && Number.isInteger(weekInfo.firstDay) && weekInfo.firstDay >= 1 && weekInfo.firstDay <= 7) {
          return weekInfo.firstDay % 7;
        }
      } catch {
        // Fallback below when Intl.Locale weekInfo is unavailable.
      }
    }
    return /^zh\b/i.test(locale || '') ? 1 : 0;
  }

  function stepMonth(year, month, delta) {
    const minTotal = 1000 * 12;
    const maxTotal = 9999 * 12 + 11;
    const total = Math.max(minTotal, Math.min(maxTotal, year * 12 + month + delta));
    return { year: Math.floor(total / 12), month: total % 12 };
  }

  function buildCalendarCells(year, month, firstDayOfWeek = 0) {
    const firstOfMonth = new Date(0);
    firstOfMonth.setFullYear(year, month, 1);
    const leading = (firstOfMonth.getDay() - firstDayOfWeek + 7) % 7;
    const cells = [];
    for (let i = 0; i < 42; i += 1) {
      const date = new Date(0);
      date.setFullYear(year, month, 1 - leading + i);
      const cellYear = date.getFullYear();
      const cellMonth = date.getMonth();
      cells.push({
        year: cellYear,
        month: cellMonth,
        day: date.getDate(),
        outside: cellYear !== year || cellMonth !== month,
      });
    }
    return cells;
  }

  function clampTimePart(value, max) {
    if (!Number.isFinite(value)) return 0;
    const period = max + 1;
    return ((Math.trunc(value) % period) + period) % period;
  }

  const api = {
    pad2,
    pad4,
    parseDateTimeValue,
    formatDateTimeValue,
    parseTimeValue,
    formatTimeValue,
    getFirstDayOfWeek,
    stepMonth,
    buildCalendarCells,
    clampTimePart,
  };
  root.DateTimePicker = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (typeof document === 'undefined' || typeof HTMLInputElement === 'undefined') return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const nativeValueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const language = (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage?.())
    || document.documentElement?.lang
    || 'en';
  const firstDayOfWeek = getFirstDayOfWeek(language);
  const isZh = /^zh\b/i.test(language);
  const weekdayFormat = isZh ? 'narrow' : 'short';
  const zhFallbacks = {
    pickerPlaceholderDateTime: '选择日期和时间',
    pickerPlaceholderTime: '选择时间',
    pickerDialogDateTime: '选择日期和时间',
    pickerDialogTime: '选择时间',
    pickerPrevMonth: '上个月',
    pickerNextMonth: '下个月',
    pickerChooseMonthYear: '选择年份和月份',
    pickerPrevYear: '上一年',
    pickerNextYear: '下一年',
    pickerHour: '时',
    pickerMinute: '分',
    pickerHourAria: '小时',
    pickerMinuteAria: '分钟',
    pickerNow: '此刻',
    pickerClear: '清除',
    pickerDone: '确定',
    pickerToday: '今天',
  };
  const dateFormatter = new Intl.DateTimeFormat(language, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const monthYearFormatter = new Intl.DateTimeFormat(language, {
    year: 'numeric',
    month: 'long',
  });
  const shortMonthFormatter = new Intl.DateTimeFormat(language, { month: 'short' });
  const fullDateFormatter = new Intl.DateTimeFormat(language, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const weekdayLabels = Array.from({ length: 7 }, (_, index) => {
    const day = (firstDayOfWeek + index) % 7;
    const probe = Date.UTC(2024, 0, 7 + day);
    return new Intl.DateTimeFormat(language, { weekday: weekdayFormat, timeZone: 'UTC' }).format(probe);
  });
  const shortMonths = Array.from({ length: 12 }, (_, month) => (
    shortMonthFormatter.format(new Date(Date.UTC(2024, month, 1)))
  ));

  function t(key, fallback) {
    if (typeof chrome !== 'undefined' && chrome.i18n?.getMessage) {
      const value = chrome.i18n.getMessage(key);
      if (value) return value;
    }
    return (isZh && zhFallbacks[key]) || fallback;
  }

  function createSvgIcon(kind) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');

    const add = (tag, attrs) => {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      svg.append(node);
    };

    if (kind === 'calendar') {
      svg.classList.add('dtp-icon');
      add('rect', { x: '3', y: '4', width: '18', height: '18', rx: '2.5' });
      add('line', { x1: '16', y1: '2', x2: '16', y2: '6' });
      add('line', { x1: '8', y1: '2', x2: '8', y2: '6' });
      add('line', { x1: '3', y1: '10', x2: '21', y2: '10' });
    } else if (kind === 'clock') {
      svg.classList.add('dtp-icon');
      add('circle', { cx: '12', cy: '12', r: '9' });
      add('polyline', { points: '12 7 12 12 15.5 14' });
    } else if (kind === 'chevron-left') {
      add('polyline', { points: '15 18 9 12 15 6' });
    } else if (kind === 'chevron-right') {
      add('polyline', { points: '9 18 15 12 9 6' });
    } else if (kind === 'chevron-down') {
      add('polyline', { points: '6 9 12 15 18 9' });
    }
    return svg;
  }

  function getNowParts(offsetMs = 0) {
    const d = new Date(Date.now() + offsetMs);
    return {
      year: d.getFullYear(),
      month: d.getMonth(),
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes(),
    };
  }

  function sameDay(a, b) {
    return Boolean(a && b && a.year === b.year && a.month === b.month && a.day === b.day);
  }

  function formatDisplayDate(year, month, day) {
    const probe = new Date(0);
    probe.setFullYear(year, month, day);
    return dateFormatter.format(probe);
  }

  function formatMonthYear(year, month) {
    const probe = new Date(0);
    probe.setFullYear(year, month, 1);
    return monthYearFormatter.format(probe);
  }

  function formatFullDayLabel(year, month, day) {
    const probe = new Date(0);
    probe.setFullYear(year, month, day);
    return fullDateFormatter.format(probe);
  }

  let popover = null;
  let activeEntry = null;
  let viewYear = 2026;
  let viewMonth = 0;
  let selectedDate = null;
  let draftTime = { hour: 0, minute: 0 };
  let showingMonths = false;
  let positionFrame = 0;

  function ensurePopover() {
    if (popover) return popover;

    const dialog = document.createElement('div');
    dialog.id = 'dtpPopover';
    dialog.className = 'dtp-popover';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'false');
    dialog.tabIndex = -1;
    dialog.hidden = true;

    const body = document.createElement('div');
    body.className = 'dtp-body';

    // Calendar pane
    const cal = document.createElement('div');
    cal.className = 'dtp-cal';

    const calHead = document.createElement('div');
    calHead.className = 'dtp-cal-head';

    const monthYearBtn = document.createElement('button');
    monthYearBtn.type = 'button';
    monthYearBtn.className = 'dtp-month-toggle';
    monthYearBtn.setAttribute('aria-label', t('pickerChooseMonthYear', 'Choose year and month'));
    monthYearBtn.setAttribute('aria-expanded', 'false');
    const monthYearLabel = document.createElement('span');
    monthYearBtn.append(monthYearLabel, createSvgIcon('chevron-down'));

    const calNav = document.createElement('div');
    calNav.className = 'dtp-cal-nav';

    const prevMonthBtn = document.createElement('button');
    prevMonthBtn.type = 'button';
    prevMonthBtn.className = 'dtp-nav-btn';
    prevMonthBtn.setAttribute('aria-label', t('pickerPrevMonth', 'Previous month'));
    prevMonthBtn.append(createSvgIcon('chevron-left'));

    const nextMonthBtn = document.createElement('button');
    nextMonthBtn.type = 'button';
    nextMonthBtn.className = 'dtp-nav-btn';
    nextMonthBtn.setAttribute('aria-label', t('pickerNextMonth', 'Next month'));
    nextMonthBtn.append(createSvgIcon('chevron-right'));

    calNav.append(prevMonthBtn, nextMonthBtn);
    calHead.append(monthYearBtn, calNav);

    const dayView = document.createElement('div');
    dayView.className = 'dtp-day-view';

    const weekdaysEl = document.createElement('div');
    weekdaysEl.className = 'dtp-weekdays';
    weekdaysEl.setAttribute('aria-hidden', 'true');
    for (const label of weekdayLabels) {
      const span = document.createElement('span');
      span.textContent = label;
      weekdaysEl.append(span);
    }

    const daysGrid = document.createElement('div');
    daysGrid.className = 'dtp-days';
    daysGrid.setAttribute('role', 'grid');
    const dayButtons = Array.from({ length: 42 }, () => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dtp-day';
      btn.setAttribute('role', 'gridcell');
      daysGrid.append(btn);
      return btn;
    });

    dayView.append(weekdaysEl, daysGrid);

    // Month / Year view
    const ymView = document.createElement('div');
    ymView.className = 'dtp-ym-view';
    ymView.hidden = true;

    const ymHead = document.createElement('div');
    ymHead.className = 'dtp-ym-head';

    const prevYearBtn = document.createElement('button');
    prevYearBtn.type = 'button';
    prevYearBtn.className = 'dtp-nav-btn';
    prevYearBtn.setAttribute('aria-label', t('pickerPrevYear', 'Previous year'));
    prevYearBtn.append(createSvgIcon('chevron-left'));

    const yearLabel = document.createElement('span');
    yearLabel.className = 'dtp-ym-year';

    const nextYearBtn = document.createElement('button');
    nextYearBtn.type = 'button';
    nextYearBtn.className = 'dtp-nav-btn';
    nextYearBtn.setAttribute('aria-label', t('pickerNextYear', 'Next year'));
    nextYearBtn.append(createSvgIcon('chevron-right'));

    ymHead.append(prevYearBtn, yearLabel, nextYearBtn);

    const monthsGrid = document.createElement('div');
    monthsGrid.className = 'dtp-months';
    const monthButtons = shortMonths.map((label, monthIndex) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dtp-month';
      btn.textContent = label;
      btn.dataset.month = String(monthIndex);
      monthsGrid.append(btn);
      return btn;
    });

    ymView.append(ymHead, monthsGrid);
    cal.append(calHead, dayView, ymView);

    // Time pane
    const timePane = document.createElement('div');
    timePane.className = 'dtp-time';

    const timeInputs = document.createElement('div');
    timeInputs.className = 'dtp-time-inputs';

    const hourInput = document.createElement('input');
    hourInput.type = 'text';
    hourInput.inputMode = 'numeric';
    hourInput.maxLength = 2;
    hourInput.className = 'dtp-time-field';
    hourInput.setAttribute('aria-label', t('pickerHourAria', 'Hour'));

    const sep = document.createElement('span');
    sep.className = 'dtp-time-sep';
    sep.textContent = ':';
    sep.setAttribute('aria-hidden', 'true');

    const minuteInput = document.createElement('input');
    minuteInput.type = 'text';
    minuteInput.inputMode = 'numeric';
    minuteInput.maxLength = 2;
    minuteInput.className = 'dtp-time-field';
    minuteInput.setAttribute('aria-label', t('pickerMinuteAria', 'Minute'));

    timeInputs.append(hourInput, sep, minuteInput);

    const timeCols = document.createElement('div');
    timeCols.className = 'dtp-time-cols';

    const buildTimeCol = (labelText, count, className) => {
      const col = document.createElement('div');
      col.className = 'dtp-time-col';
      const label = document.createElement('div');
      label.className = 'dtp-time-col-label';
      label.textContent = labelText;
      const list = document.createElement('div');
      list.className = `dtp-time-list ${className}`;
      const buttons = Array.from({ length: count }, (_, value) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dtp-time-opt';
        btn.textContent = pad2(value);
        btn.dataset.value = String(value);
        list.append(btn);
        return btn;
      });
      col.append(label, list);
      return { col, list, buttons };
    };

    const hourCol = buildTimeCol(t('pickerHour', 'Hr'), 24, 'dtp-hours');
    const minuteCol = buildTimeCol(t('pickerMinute', 'Min'), 60, 'dtp-minutes');
    timeCols.append(hourCol.col, minuteCol.col);
    timePane.append(timeInputs, timeCols);

    body.append(cal, timePane);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'dtp-footer';

    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'dtp-footer-action';

    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'dtp-footer-done';
    doneBtn.textContent = t('pickerDone', 'Done');

    footer.append(actionBtn, doneBtn);
    dialog.append(body, footer);
    document.body.append(dialog);

    popover = {
      dialog,
      cal,
      calNav,
      monthYearBtn,
      monthYearLabel,
      prevMonthBtn,
      nextMonthBtn,
      dayView,
      daysGrid,
      dayButtons,
      ymView,
      prevYearBtn,
      yearLabel,
      nextYearBtn,
      monthButtons,
      hourInput,
      minuteInput,
      hourCol,
      minuteCol,
      footer,
      actionBtn,
      doneBtn,
    };

    // Event wiring
    monthYearBtn.addEventListener('click', () => {
      showingMonths = !showingMonths;
      renderPopover({ scrollTime: false });
      if (showingMonths) monthButtons[viewMonth]?.focus();
    });

    prevMonthBtn.addEventListener('click', () => {
      const next = stepMonth(viewYear, viewMonth, -1);
      viewYear = next.year;
      viewMonth = next.month;
      renderPopover({ scrollTime: false });
    });

    nextMonthBtn.addEventListener('click', () => {
      const next = stepMonth(viewYear, viewMonth, 1);
      viewYear = next.year;
      viewMonth = next.month;
      renderPopover({ scrollTime: false });
    });

    prevYearBtn.addEventListener('click', () => {
      viewYear = Math.max(1000, viewYear - 1);
      renderPopover({ scrollTime: false });
    });

    nextYearBtn.addEventListener('click', () => {
      viewYear = Math.min(9999, viewYear + 1);
      renderPopover({ scrollTime: false });
    });

    monthsGrid.addEventListener('click', (event) => {
      const btn = event.target.closest('.dtp-month');
      if (!btn) return;
      viewMonth = Number(btn.dataset.month);
      showingMonths = false;
      renderPopover({ scrollTime: false });
      focusCalendarDay(selectedDate?.year === viewYear && selectedDate?.month === viewMonth ? selectedDate.day : 1);
    });

    daysGrid.addEventListener('click', (event) => {
      const btn = event.target.closest('.dtp-day');
      if (!btn) return;
      selectedDate = {
        year: Number(btn.dataset.year),
        month: Number(btn.dataset.month),
        day: Number(btn.dataset.day),
      };
      viewYear = selectedDate.year;
      viewMonth = selectedDate.month;
      commitDraft();
      renderPopover({ scrollTime: false });
    });

    daysGrid.addEventListener('keydown', (event) => {
      const btn = event.target.closest('.dtp-day');
      if (!btn) return;
      const deltaMap = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -7,
        ArrowDown: 7,
      };
      const curYear = Number(btn.dataset.year);
      const curMonth = Number(btn.dataset.month);
      const curDay = Number(btn.dataset.day);
      let target = null;

      if (Object.hasOwn(deltaMap, event.key)) {
        const d = new Date(0);
        d.setFullYear(curYear, curMonth, curDay + deltaMap[event.key]);
        target = { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
      } else if (event.key === 'PageUp') {
        const stepped = stepMonth(curYear, curMonth, -1);
        const maxDay = new Date(stepped.year, stepped.month + 1, 0).getDate();
        target = { year: stepped.year, month: stepped.month, day: Math.min(curDay, maxDay) };
      } else if (event.key === 'PageDown') {
        const stepped = stepMonth(curYear, curMonth, 1);
        const maxDay = new Date(stepped.year, stepped.month + 1, 0).getDate();
        target = { year: stepped.year, month: stepped.month, day: Math.min(curDay, maxDay) };
      } else if (event.key === 'Home') {
        target = { year: curYear, month: curMonth, day: 1 };
      } else if (event.key === 'End') {
        target = { year: curYear, month: curMonth, day: new Date(curYear, curMonth + 1, 0).getDate() };
      }
      if (!target) return;

      event.preventDefault();
      if (target.year < 1000 || target.year > 9999) return;
      viewYear = target.year;
      viewMonth = target.month;
      renderPopover({ scrollTime: false });
      focusCalendarDay(target.day, target.year, target.month);
    });

    hourCol.list.addEventListener('click', (event) => {
      const btn = event.target.closest('.dtp-time-opt');
      if (!btn) return;
      draftTime.hour = Number(btn.dataset.value);
      ensureDateWhenCommitting();
      commitDraft();
      renderPopover({ scrollTime: false });
    });

    minuteCol.list.addEventListener('click', (event) => {
      const btn = event.target.closest('.dtp-time-opt');
      if (!btn) return;
      draftTime.minute = Number(btn.dataset.value);
      ensureDateWhenCommitting();
      commitDraft();
      renderPopover({ scrollTime: false });
    });

    const wireTimeField = (field, part, max, nextField) => {
      field.addEventListener('focus', () => field.select());
      field.addEventListener('input', () => {
        const digits = field.value.replace(/\D/g, '').slice(0, 2);
        if (field.value !== digits) field.value = digits;
        if (!digits) return;
        const parsed = Number(digits);
        if (parsed <= max) {
          draftTime[part] = parsed;
          ensureDateWhenCommitting();
          commitDraft();
          renderPopover({ scrollTime: true, keepTimeInputFocus: true });
          if (digits.length === 2 && nextField) {
            nextField.focus();
            nextField.select();
          }
        }
      });
      field.addEventListener('blur', () => {
        const digits = field.value.replace(/\D/g, '');
        if (digits) {
          draftTime[part] = Math.min(max, Number(digits));
          ensureDateWhenCommitting();
          commitDraft();
        }
        field.value = pad2(draftTime[part]);
        renderPopover({ scrollTime: false });
      });
      field.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          draftTime[part] = clampTimePart(draftTime[part] + (event.key === 'ArrowUp' ? 1 : -1), max);
          field.value = pad2(draftTime[part]);
          field.select();
          ensureDateWhenCommitting();
          commitDraft();
          renderPopover({ scrollTime: true, keepTimeInputFocus: true });
        } else if (event.key === 'Enter') {
          event.preventDefault();
          closePopover({ focusTrigger: true });
        }
      });
    };

    wireTimeField(hourInput, 'hour', 23, minuteInput);
    wireTimeField(minuteInput, 'minute', 59, null);

    actionBtn.addEventListener('click', () => {
      if (!activeEntry) return;
      const mode = activeEntry.input.dataset.pickerAction;
      if (mode === 'clear') {
        setNativeAndNotify(activeEntry, '');
        closePopover({ focusTrigger: true });
        return;
      }
      if (mode === 'now') {
        const targetId = activeEntry.input.dataset.pickerNowTarget;
        const externalBtn = targetId ? document.getElementById(targetId) : null;
        if (externalBtn) {
          externalBtn.click();
          syncStateFromEntry(activeEntry);
          showingMonths = false;
          renderPopover({ scrollTime: true });
        } else {
          const now = getNowParts();
          selectedDate = { year: now.year, month: now.month, day: now.day };
          viewYear = now.year;
          viewMonth = now.month;
          draftTime = { hour: now.hour, minute: now.minute };
          showingMonths = false;
          commitDraft();
          renderPopover({ scrollTime: true });
        }
      }
    });

    doneBtn.addEventListener('click', () => closePopover({ focusTrigger: true }));

    return popover;
  }

  function ensureDateWhenCommitting() {
    if (!activeEntry || activeEntry.isTimeOnly || selectedDate) return;
    const fallback = getNowParts(3600_000);
    if (viewYear === fallback.year && viewMonth === fallback.month) {
      selectedDate = { year: fallback.year, month: fallback.month, day: fallback.day };
    } else {
      selectedDate = { year: viewYear, month: viewMonth, day: 1 };
    }
  }

  function focusCalendarDay(day, year = viewYear, month = viewMonth) {
    if (!popover) return;
    const match = popover.dayButtons.find((btn) => (
      Number(btn.dataset.year) === year
      && Number(btn.dataset.month) === month
      && Number(btn.dataset.day) === day
    ));
    match?.focus();
  }

  function setNativeAndNotify(entry, nextValue) {
    const prev = nativeValueDesc.get.call(entry.input);
    nativeValueDesc.set.call(entry.input, nextValue);
    entry.syncDisplay();
    if (prev !== nextValue) {
      entry.input.dispatchEvent(new Event('input', { bubbles: true }));
      entry.input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function commitDraft() {
    if (!activeEntry) return;
    const nextValue = activeEntry.isTimeOnly
      ? formatTimeValue(draftTime)
      : formatDateTimeValue({ ...selectedDate, ...draftTime });
    setNativeAndNotify(activeEntry, nextValue);
  }

  function scrollColumnToValue(list, buttons, value) {
    const btn = buttons[value];
    if (!btn) return;
    const rowPitch = buttons[1] ? buttons[1].offsetTop - buttons[0].offsetTop : 30;
    const visibleRows = Math.max(1, Math.floor((list.clientHeight + 2) / rowPitch));
    const topIndex = Math.max(0, Math.min(buttons.length - visibleRows, value - Math.floor((visibleRows - 1) / 2)));
    list.scrollTop = buttons[topIndex] ? Math.max(0, buttons[topIndex].offsetTop - list.offsetTop) : 0;
  }

  function syncStateFromEntry(entry) {
    const raw = nativeValueDesc.get.call(entry.input);
    if (entry.isTimeOnly) {
      const parsed = parseTimeValue(raw);
      draftTime = parsed || { hour: 9, minute: 0 };
      selectedDate = null;
      return;
    }
    const parsed = parseDateTimeValue(raw);
    if (parsed) {
      selectedDate = { year: parsed.year, month: parsed.month, day: parsed.day };
      viewYear = parsed.year;
      viewMonth = parsed.month;
      draftTime = { hour: parsed.hour, minute: parsed.minute };
    } else {
      const fallback = getNowParts(3600_000);
      selectedDate = null;
      viewYear = fallback.year;
      viewMonth = fallback.month;
      draftTime = { hour: fallback.hour, minute: fallback.minute };
    }
  }

  function renderPopover({ scrollTime = false, keepTimeInputFocus = false } = {}) {
    if (!popover || !activeEntry) return;
    const isTimeOnly = activeEntry.isTimeOnly;
    popover.dialog.classList.toggle('is-time-only', isTimeOnly);
    popover.dialog.setAttribute('aria-label', isTimeOnly
      ? t('pickerDialogTime', 'Choose time')
      : t('pickerDialogDateTime', 'Choose date and time'));
    popover.cal.hidden = isTimeOnly;

    if (!isTimeOnly) {
      popover.monthYearLabel.textContent = formatMonthYear(viewYear, viewMonth);
      popover.monthYearBtn.setAttribute('aria-expanded', String(showingMonths));
      popover.calNav.hidden = showingMonths;
      popover.dayView.hidden = showingMonths;
      popover.ymView.hidden = !showingMonths;

      if (showingMonths) {
        popover.yearLabel.textContent = String(viewYear);
        popover.monthButtons.forEach((btn, idx) => {
          const active = selectedDate && selectedDate.year === viewYear && selectedDate.month === idx;
          btn.classList.toggle('is-selected', Boolean(active));
          btn.setAttribute('aria-pressed', String(Boolean(active)));
        });
      } else {
        const today = getNowParts();
        const cells = buildCalendarCells(viewYear, viewMonth, firstDayOfWeek);
        cells.forEach((cell, idx) => {
          const btn = popover.dayButtons[idx];
          btn.textContent = String(cell.day);
          btn.dataset.year = String(cell.year);
          btn.dataset.month = String(cell.month);
          btn.dataset.day = String(cell.day);
          btn.classList.toggle('is-outside', cell.outside);
          const isToday = sameDay(cell, today);
          const isSelected = sameDay(cell, selectedDate);
          btn.classList.toggle('is-today', isToday);
          btn.classList.toggle('is-selected', isSelected);
          btn.setAttribute('aria-selected', String(isSelected));
          btn.setAttribute('aria-label', formatFullDayLabel(cell.year, cell.month, cell.day));
        });
      }
    }

    if (!keepTimeInputFocus || document.activeElement !== popover.hourInput) {
      popover.hourInput.value = pad2(draftTime.hour);
    }
    if (!keepTimeInputFocus || document.activeElement !== popover.minuteInput) {
      popover.minuteInput.value = pad2(draftTime.minute);
    }

    popover.hourCol.buttons.forEach((btn, value) => {
      const selected = value === draftTime.hour;
      btn.classList.toggle('is-selected', selected);
      btn.setAttribute('aria-selected', String(selected));
    });
    popover.minuteCol.buttons.forEach((btn, value) => {
      const selected = value === draftTime.minute;
      btn.classList.toggle('is-selected', selected);
      btn.setAttribute('aria-selected', String(selected));
    });

    const actionMode = activeEntry.input.dataset.pickerAction;
    if (actionMode === 'clear') {
      popover.actionBtn.hidden = false;
      popover.actionBtn.textContent = t('pickerClear', 'Clear');
    } else if (actionMode === 'now') {
      popover.actionBtn.hidden = false;
      popover.actionBtn.textContent = t('pickerNow', 'Now');
    } else {
      popover.actionBtn.hidden = true;
    }

    if (scrollTime) {
      scrollColumnToValue(popover.hourCol.list, popover.hourCol.buttons, draftTime.hour);
      scrollColumnToValue(popover.minuteCol.list, popover.minuteCol.buttons, draftTime.minute);
    }
  }

  function positionPopover() {
    if (!popover || !activeEntry || popover.dialog.hidden) return;
    if (!activeEntry.trigger.isConnected || activeEntry.trigger.offsetParent === null) {
      closePopover({ focusTrigger: false });
      return;
    }
    const margin = 12;
    const gap = 8;
    const triggerRect = activeEntry.trigger.getBoundingClientRect();
    popover.dialog.style.left = '0px';
    popover.dialog.style.top = '0px';
    const popRect = popover.dialog.getBoundingClientRect();

    const maxLeft = Math.max(margin, window.innerWidth - popRect.width - margin);
    const left = Math.max(margin, Math.min(triggerRect.left, maxLeft));

    const spaceBelow = window.innerHeight - triggerRect.bottom - margin;
    const spaceAbove = triggerRect.top - margin;
    let top;
    if (spaceBelow >= popRect.height + gap || spaceBelow >= spaceAbove) {
      top = Math.min(triggerRect.bottom + gap, Math.max(margin, window.innerHeight - popRect.height - margin));
    } else {
      top = Math.max(margin, triggerRect.top - popRect.height - gap);
    }

    popover.dialog.style.left = `${Math.round(left)}px`;
    popover.dialog.style.top = `${Math.round(top)}px`;
  }

  function scheduleReposition() {
    if (!popover || popover.dialog.hidden || positionFrame) return;
    positionFrame = requestAnimationFrame(() => {
      positionFrame = 0;
      positionPopover();
    });
  }

  function openPopover(entry, focusInside = true) {
    if (entry.trigger.disabled || entry.trigger.matches(':disabled')) return;
    if (activeEntry === entry && popover && !popover.dialog.hidden) {
      closePopover({ focusTrigger: false });
      return;
    }
    if (activeEntry && activeEntry !== entry) {
      activeEntry.trigger.setAttribute('aria-expanded', 'false');
      activeEntry.trigger.classList.remove('is-open');
    }

    ensurePopover();
    activeEntry = entry;
    showingMonths = false;
    syncStateFromEntry(entry);

    popover.dialog.hidden = false;
    entry.trigger.setAttribute('aria-expanded', 'true');
    entry.trigger.classList.add('is-open');

    renderPopover({ scrollTime: true });
    positionPopover();

    if (!focusInside) {
      popover.dialog.focus({ preventScroll: true });
    } else if (entry.isTimeOnly) {
      popover.hourInput.focus();
    } else if (selectedDate) {
      focusCalendarDay(selectedDate.day, selectedDate.year, selectedDate.month);
    } else {
      const firstCurrentDay = popover.dayButtons.find((btn) => !btn.classList.contains('is-outside'));
      firstCurrentDay?.focus();
    }
  }

  function closePopover({ focusTrigger = false } = {}) {
    if (!popover || popover.dialog.hidden) return;
    const closingEntry = activeEntry;
    popover.dialog.hidden = true;
    activeEntry = null;
    if (closingEntry) {
      closingEntry.trigger.setAttribute('aria-expanded', 'false');
      closingEntry.trigger.classList.remove('is-open');
      if (focusTrigger) closingEntry.trigger.focus();
    }
  }

  function enhanceInput(input) {
    if (!input || input.dataset.dtpEnhanced === 'true') return;
    const type = input.getAttribute('type');
    if (type !== 'datetime-local' && type !== 'time') return;
    if (!input.parentNode) return;

    input.dataset.dtpEnhanced = 'true';
    const isTimeOnly = type === 'time';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'dtp-trigger';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');

    const valueWrap = document.createElement('span');
    valueWrap.className = 'dtp-trigger-value';
    trigger.append(valueWrap, createSvgIcon(isTimeOnly ? 'clock' : 'calendar'));

    input.parentNode.insertBefore(trigger, input);
    input.classList.add('dtp-native');
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');

    const syncAria = () => {
      const invalid = input.getAttribute('aria-invalid');
      if (invalid != null) trigger.setAttribute('aria-invalid', invalid);
      else trigger.removeAttribute('aria-invalid');

      const describedBy = input.getAttribute('aria-describedby');
      if (describedBy) trigger.setAttribute('aria-describedby', describedBy);
      else trigger.removeAttribute('aria-describedby');

      trigger.disabled = input.disabled;
    };

    const syncDisplay = () => {
      const raw = nativeValueDesc.get.call(input);
      valueWrap.replaceChildren();
      if (isTimeOnly) {
        const parsed = parseTimeValue(raw);
        if (parsed) {
          const text = document.createElement('span');
          text.textContent = formatTimeValue(parsed);
          valueWrap.append(text);
        } else {
          const placeholder = document.createElement('span');
          placeholder.className = 'dtp-placeholder';
          placeholder.textContent = t('pickerPlaceholderTime', 'Select time');
          valueWrap.append(placeholder);
        }
        return;
      }

      const parsed = parseDateTimeValue(raw);
      if (parsed) {
        const dateSpan = document.createElement('span');
        dateSpan.className = 'dtp-date-text';
        dateSpan.textContent = formatDisplayDate(parsed.year, parsed.month, parsed.day);
        const timeBadge = document.createElement('span');
        timeBadge.className = 'dtp-time-badge';
        timeBadge.textContent = formatTimeValue(parsed);
        valueWrap.append(dateSpan, timeBadge);
      } else {
        const placeholder = document.createElement('span');
        placeholder.className = 'dtp-placeholder';
        placeholder.textContent = t('pickerPlaceholderDateTime', 'Select date and time');
        valueWrap.append(placeholder);
      }
    };

    const entry = { input, trigger, isTimeOnly, syncDisplay };

    Object.defineProperty(input, 'value', {
      configurable: true,
      get() {
        return nativeValueDesc.get.call(this);
      },
      set(next) {
        nativeValueDesc.set.call(this, next);
        syncDisplay();
        if (activeEntry === entry && popover && !popover.dialog.hidden) {
          syncStateFromEntry(entry);
          const typingTime = document.activeElement === popover.hourInput
            || document.activeElement === popover.minuteInput;
          renderPopover({ scrollTime: !typingTime, keepTimeInputFocus: typingTime });
        }
      },
    });

    input.focus = (opts) => trigger.focus(opts);

    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(syncAria);
      observer.observe(input, { attributes: true, attributeFilter: ['aria-invalid', 'aria-describedby', 'disabled'] });
    }

    trigger.addEventListener('click', (event) => openPopover(entry, event.detail === 0));
    syncAria();
    syncDisplay();
  }

  function enhanceAll(rootNode = document) {
    rootNode.querySelectorAll('input[type="datetime-local"], input[type="time"]').forEach(enhanceInput);
  }

  function init() {
    enhanceAll(document);

    const rules = document.getElementById('rules');
    if (rules && typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1) enhanceAll(node);
          }
        }
      });
      observer.observe(rules, { childList: true });
    }

    document.addEventListener('pointerdown', (event) => {
      if (!popover || popover.dialog.hidden) return;
      if (popover.dialog.contains(event.target)) return;
      if (activeEntry && activeEntry.trigger.contains(event.target)) return;
      closePopover({ focusTrigger: false });
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && popover && !popover.dialog.hidden) {
        event.preventDefault();
        closePopover({ focusTrigger: true });
      }
    });

    window.addEventListener('scroll', scheduleReposition, true);
    window.addEventListener('resize', scheduleReposition);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(globalThis);
