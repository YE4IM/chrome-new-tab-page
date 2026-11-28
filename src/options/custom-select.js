'use strict';

(function (root) {
  function findNextEnabledIndex(options, currentIndex, delta) {
    if (!Array.isArray(options) || options.length === 0) return -1;
    const step = delta >= 0 ? 1 : -1;
    let index = Number.isInteger(currentIndex) ? currentIndex : (step > 0 ? -1 : options.length);
    for (let i = index + step; i >= 0 && i < options.length; i += step) {
      if (!options[i]?.disabled) return i;
    }
    return findEdgeEnabledIndex(options, step > 0);
  }

  function findEdgeEnabledIndex(options, fromEnd) {
    if (!Array.isArray(options) || options.length === 0) return -1;
    if (fromEnd) {
      for (let i = options.length - 1; i >= 0; i -= 1) {
        if (!options[i]?.disabled) return i;
      }
    } else {
      for (let i = 0; i < options.length; i += 1) {
        if (!options[i]?.disabled) return i;
      }
    }
    return -1;
  }

  function findTypeaheadIndex(options, query, startIndex = -1) {
    if (!Array.isArray(options) || options.length === 0 || typeof query !== 'string') return -1;
    const needle = query.trim().toLowerCase();
    if (!needle) return -1;
    const len = options.length;
    const start = Number.isInteger(startIndex) && startIndex >= -1 && startIndex < len ? startIndex : -1;
    for (let offset = 1; offset <= len; offset += 1) {
      const idx = (start + offset) % len;
      const opt = options[idx];
      if (opt?.disabled) continue;
      const label = String(opt?.label ?? opt?.textContent ?? opt?.text ?? '').trim().toLowerCase();
      if (label.startsWith(needle)) return idx;
    }
    return -1;
  }

  function computePopoverPosition(triggerRect, popoverSize, viewport, { margin = 12, gap = 6 } = {}) {
    const maxWidth = Math.max(0, viewport.width - margin * 2);
    const width = Math.min(triggerRect.width, maxWidth);
    const maxLeft = Math.max(margin, viewport.width - width - margin);
    const left = Math.max(margin, Math.min(triggerRect.left, maxLeft));

    const spaceBelow = viewport.height - triggerRect.bottom - margin;
    const spaceAbove = triggerRect.top - margin;
    let placement;
    let top;
    if (spaceBelow >= popoverSize.height + gap || spaceBelow >= spaceAbove) {
      placement = 'bottom';
      top = Math.min(triggerRect.bottom + gap, Math.max(margin, viewport.height - popoverSize.height - margin));
    } else {
      placement = 'top';
      top = Math.max(margin, triggerRect.top - popoverSize.height - gap);
    }

    return {
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(width),
      placement,
    };
  }

  const api = {
    findNextEnabledIndex,
    findEdgeEnabledIndex,
    findTypeaheadIndex,
    computePopoverPosition,
  };
  root.CustomSelect = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (typeof document === 'undefined' || typeof HTMLSelectElement === 'undefined') return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const nativeValueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  const nativeSelectedIndexDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');

  let uidCounter = 0;
  let popover = null;
  let activeEntry = null;
  let optionButtons = [];
  let activeIndex = -1;
  let positionFrame = 0;
  let typeaheadQuery = '';
  let typeaheadTimer = 0;

  function createSvgIcon(kind) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');

    const polyline = document.createElementNS(SVG_NS, 'polyline');
    if (kind === 'chevron-down') {
      svg.classList.add('cselect-chevron');
      svg.setAttribute('stroke-width', '1.8');
      polyline.setAttribute('points', '6 9 12 15 18 9');
    } else {
      svg.classList.add('cselect-check');
      svg.setAttribute('stroke-width', '2.2');
      polyline.setAttribute('points', '20 6 9 17 4 12');
    }
    svg.append(polyline);
    return svg;
  }

  function ensurePopover() {
    if (popover) return popover;
    const list = document.createElement('div');
    list.id = `cselect-listbox-${++uidCounter}`;
    list.className = 'cselect-popover';
    list.setAttribute('role', 'listbox');
    list.tabIndex = -1;
    list.hidden = true;

    list.addEventListener('pointerdown', (event) => {
      event.preventDefault();
    });

    list.addEventListener('click', (event) => {
      const optBtn = event.target.closest('.cselect-option');
      if (!optBtn || optBtn.disabled || !activeEntry) return;
      const index = Number(optBtn.dataset.index);
      commitOption(index);
    });

    list.addEventListener('pointermove', (event) => {
      const optBtn = event.target.closest('.cselect-option');
      if (!optBtn || optBtn.disabled) return;
      const index = Number(optBtn.dataset.index);
      if (index !== activeIndex) setActiveIndex(index, { scroll: false });
    });

    document.body.append(list);
    popover = { list };
    return popover;
  }

  function readOptions(select) {
    return Array.from(select.options).map((opt) => ({
      value: opt.value,
      label: opt.textContent,
      disabled: opt.disabled,
    }));
  }

  function setActiveIndex(index, { scroll = true } = {}) {
    activeIndex = index;
    optionButtons.forEach((btn, idx) => {
      btn.classList.toggle('is-active', idx === activeIndex);
    });
    const activeBtn = optionButtons[activeIndex];
    if (activeEntry) {
      if (activeBtn) activeEntry.trigger.setAttribute('aria-activedescendant', activeBtn.id);
      else activeEntry.trigger.removeAttribute('aria-activedescendant');
    }
    if (scroll && activeBtn) {
      activeBtn.scrollIntoView({ block: 'nearest' });
    }
  }

  function buildOptions(entry) {
    const { list } = ensurePopover();
    const options = readOptions(entry.select);
    const currentIndex = nativeSelectedIndexDesc.get.call(entry.select);
    list.replaceChildren();
    optionButtons = options.map((opt, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = `${list.id}-opt-${idx}`;
      btn.className = 'cselect-option';
      btn.setAttribute('role', 'option');
      btn.tabIndex = -1;
      btn.disabled = opt.disabled;
      btn.dataset.index = String(idx);
      const selected = idx === currentIndex;
      btn.classList.toggle('is-selected', selected);
      btn.setAttribute('aria-selected', String(selected));

      const labelSpan = document.createElement('span');
      labelSpan.className = 'cselect-option-label';
      labelSpan.textContent = opt.label;
      btn.append(labelSpan, createSvgIcon('check'));
      list.append(btn);
      return btn;
    });

    if (entry.labelId) list.setAttribute('aria-labelledby', entry.labelId);
    else list.removeAttribute('aria-labelledby');

    const initialIndex = currentIndex >= 0 && !options[currentIndex]?.disabled
      ? currentIndex
      : findEdgeEnabledIndex(options, false);
    setActiveIndex(initialIndex, { scroll: true });
  }

  function positionPopover() {
    if (!popover || !activeEntry || popover.list.hidden) return;
    if (
      !activeEntry.trigger.isConnected
      || activeEntry.trigger.offsetParent === null
      || activeEntry.trigger.disabled
      || activeEntry.trigger.matches(':disabled')
    ) {
      closePopover({ focusTrigger: false });
      return;
    }

    const triggerRect = activeEntry.trigger.getBoundingClientRect();
    popover.list.style.left = '0px';
    popover.list.style.top = '0px';
    popover.list.style.width = `${Math.round(Math.min(triggerRect.width, Math.max(0, window.innerWidth - 24)))}px`;
    const popRect = popover.list.getBoundingClientRect();

    const pos = computePopoverPosition(
      triggerRect,
      { width: popRect.width, height: popRect.height },
      { width: window.innerWidth, height: window.innerHeight },
    );

    popover.list.dataset.placement = pos.placement;
    popover.list.style.left = `${pos.left}px`;
    popover.list.style.top = `${pos.top}px`;
    popover.list.style.width = `${pos.width}px`;
  }

  function scheduleReposition() {
    if (!popover || popover.list.hidden || positionFrame) return;
    positionFrame = requestAnimationFrame(() => {
      positionFrame = 0;
      positionPopover();
    });
  }

  function openPopover(entry, initialIndex = null) {
    if (entry.trigger.disabled || entry.trigger.matches(':disabled')) return;
    if (activeEntry === entry && popover && !popover.list.hidden) {
      closePopover({ focusTrigger: false });
      return;
    }
    if (activeEntry && activeEntry !== entry) {
      activeEntry.trigger.setAttribute('aria-expanded', 'false');
      activeEntry.trigger.classList.remove('is-open');
      activeEntry.trigger.removeAttribute('aria-activedescendant');
      activeEntry.trigger.removeAttribute('aria-controls');
    }

    ensurePopover();
    activeEntry = entry;
    buildOptions(entry);
    if (Number.isInteger(initialIndex) && initialIndex >= 0 && initialIndex < optionButtons.length) {
      setActiveIndex(initialIndex, { scroll: true });
    }

    popover.list.hidden = false;
    entry.trigger.setAttribute('aria-expanded', 'true');
    entry.trigger.setAttribute('aria-controls', popover.list.id);
    entry.trigger.classList.add('is-open');

    positionPopover();
    const activeBtn = optionButtons[activeIndex];
    if (activeBtn) activeBtn.scrollIntoView({ block: 'nearest' });
  }

  function closePopover({ focusTrigger = false } = {}) {
    if (!popover || popover.list.hidden) return;
    const closingEntry = activeEntry;
    popover.list.hidden = true;
    activeEntry = null;
    activeIndex = -1;
    optionButtons = [];
    if (closingEntry) {
      closingEntry.trigger.setAttribute('aria-expanded', 'false');
      closingEntry.trigger.classList.remove('is-open');
      closingEntry.trigger.removeAttribute('aria-activedescendant');
      closingEntry.trigger.removeAttribute('aria-controls');
      if (focusTrigger) closingEntry.trigger.focus();
    }
  }

  function commitOption(index) {
    if (!activeEntry) return;
    const entry = activeEntry;
    const opt = entry.select.options[index];
    if (!opt || opt.disabled) return;
    const prevValue = nativeValueDesc.get.call(entry.select);
    const changed = opt.value !== prevValue || nativeSelectedIndexDesc.get.call(entry.select) !== index;
    if (changed) {
      nativeSelectedIndexDesc.set.call(entry.select, index);
      entry.syncDisplay();
    }
    closePopover({ focusTrigger: true });
    if (changed) {
      entry.select.dispatchEvent(new Event('input', { bubbles: true }));
      entry.select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function resetTypeaheadSoon() {
    clearTimeout(typeaheadTimer);
    typeaheadTimer = setTimeout(() => {
      typeaheadQuery = '';
    }, 500);
  }

  function handleTriggerKeydown(entry, event) {
    if (entry.trigger.disabled || entry.trigger.matches(':disabled')) return;
    const isOpen = activeEntry === entry && popover && !popover.list.hidden;
    const options = readOptions(entry.select);

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      if (!isOpen) {
        const current = nativeSelectedIndexDesc.get.call(entry.select);
        const startIdx = current >= 0 && !options[current]?.disabled
          ? current
          : findEdgeEnabledIndex(options, delta < 0);
        openPopover(entry, startIdx);
      } else {
        setActiveIndex(findNextEnabledIndex(options, activeIndex, delta));
      }
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const target = findEdgeEnabledIndex(options, event.key === 'End');
      if (!isOpen) {
        openPopover(entry, target);
      } else {
        setActiveIndex(target);
      }
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!isOpen) {
        openPopover(entry);
      } else if (activeIndex >= 0) {
        commitOption(activeIndex);
      } else {
        closePopover({ focusTrigger: true });
      }
      return;
    }

    if (event.key === 'Escape') {
      if (isOpen) {
        event.preventDefault();
        closePopover({ focusTrigger: true });
      }
      return;
    }

    if (event.key === 'Tab') {
      if (isOpen) closePopover({ focusTrigger: false });
      return;
    }

    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      typeaheadQuery += event.key;
      resetTypeaheadSoon();
      const baseIndex = isOpen ? activeIndex : nativeSelectedIndexDesc.get.call(entry.select);
      let match = findTypeaheadIndex(options, typeaheadQuery, baseIndex);
      if (match === -1 && typeaheadQuery.length > 1) {
        typeaheadQuery = event.key;
        match = findTypeaheadIndex(options, typeaheadQuery, baseIndex);
      }
      if (match !== -1) {
        event.preventDefault();
        if (isOpen) {
          setActiveIndex(match);
        } else {
          const prev = nativeSelectedIndexDesc.get.call(entry.select);
          if (match !== prev) {
            nativeSelectedIndexDesc.set.call(entry.select, match);
            entry.syncDisplay();
            entry.select.dispatchEvent(new Event('input', { bubbles: true }));
            entry.select.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      }
    }
  }

  function enhanceSelect(select) {
    if (!select || select.dataset.cselectEnhanced === 'true') return;
    if (!select.parentNode || select.multiple || select.size > 1) return;

    select.dataset.cselectEnhanced = 'true';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cselect-trigger';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const valueSpan = document.createElement('span');
    valueSpan.id = `cselect-val-${++uidCounter}`;
    valueSpan.className = 'cselect-value';
    trigger.append(valueSpan, createSvgIcon('chevron-down'));

    const labelEl = select.closest('label')?.querySelector('.field-label');
    let labelId = '';
    if (labelEl) {
      if (!labelEl.id) labelEl.id = `cselect-label-${++uidCounter}`;
      labelId = labelEl.id;
      trigger.setAttribute('aria-labelledby', `${labelId} ${valueSpan.id}`);
    }

    select.parentNode.insertBefore(trigger, select);
    select.classList.add('cselect-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const syncAria = () => {
      const invalid = select.getAttribute('aria-invalid');
      if (invalid != null) trigger.setAttribute('aria-invalid', invalid);
      else trigger.removeAttribute('aria-invalid');

      const describedBy = select.getAttribute('aria-describedby');
      if (describedBy) trigger.setAttribute('aria-describedby', describedBy);
      else trigger.removeAttribute('aria-describedby');

      trigger.disabled = select.disabled;
    };

    const syncDisplay = () => {
      const selectedOption = select.options[nativeSelectedIndexDesc.get.call(select)];
      valueSpan.textContent = selectedOption ? selectedOption.textContent : '';
    };

    const entry = { select, trigger, labelId, syncDisplay };

    const syncAfterProgrammaticChange = () => {
      syncDisplay();
      if (activeEntry === entry && popover && !popover.list.hidden) {
        buildOptions(entry);
      }
    };

    Object.defineProperty(select, 'value', {
      configurable: true,
      get() {
        return nativeValueDesc.get.call(this);
      },
      set(next) {
        nativeValueDesc.set.call(this, next);
        syncAfterProgrammaticChange();
      },
    });

    Object.defineProperty(select, 'selectedIndex', {
      configurable: true,
      get() {
        return nativeSelectedIndexDesc.get.call(this);
      },
      set(next) {
        nativeSelectedIndexDesc.set.call(this, next);
        syncAfterProgrammaticChange();
      },
    });

    select.focus = (opts) => trigger.focus(opts);

    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => {
        syncAria();
        syncAfterProgrammaticChange();
      });
      observer.observe(select, {
        attributes: true,
        attributeFilter: ['aria-invalid', 'aria-describedby', 'disabled'],
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    trigger.addEventListener('click', () => openPopover(entry));
    trigger.addEventListener('keydown', (event) => handleTriggerKeydown(entry, event));
    trigger.addEventListener('blur', (event) => {
      if (activeEntry === entry && popover && !popover.list.contains(event.relatedTarget)) {
        closePopover({ focusTrigger: false });
      }
    });

    syncAria();
    syncDisplay();
  }

  function enhanceAll(rootNode = document) {
    rootNode.querySelectorAll('select').forEach(enhanceSelect);
  }

  function init() {
    enhanceAll(document);

    document.addEventListener('pointerdown', (event) => {
      if (!popover || popover.list.hidden || !activeEntry) return;
      if (popover.list.contains(event.target)) return;
      if (activeEntry.trigger.contains(event.target)) return;
      const enclosingLabel = activeEntry.select.closest('label');
      if (enclosingLabel && enclosingLabel.contains(event.target)) return;
      closePopover({ focusTrigger: false });
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && popover && !popover.list.hidden) {
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
