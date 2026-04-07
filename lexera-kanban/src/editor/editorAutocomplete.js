var EditorAutocomplete = (function () {
  'use strict';

  var _dropdown = null;
  var _activeIndex = 0;
  var _items = [];
  var _onSelect = null;
  var _keyHandler = null;
  var _clickHandler = null;

  // Layout/structural tag names to skip — not user-defined, not useful as autocomplete suggestions
  var SKIP_TAG_RE = /^(row\d+|span\d+|stack|nostack|header|noheader|footer|nofooter|wip-\d+|nowip|sticky|width\{\d+\}|height\{\d+\}|hidden\b|hidden-internal[-\w]*)$/i;

  function collectBoardTags(boardData) {
    if (!boardData) return [];
    var tagSet = {};
    var tagRe = /#([a-zA-Z0-9_-]+)/g;

    function scanCard(card) {
      if (!card || !card.content) return;
      var m;
      tagRe.lastIndex = 0;
      while ((m = tagRe.exec(card.content)) !== null) {
        var name = m[1];
        if (!SKIP_TAG_RE.test(name)) {
          tagSet['#' + name.toLowerCase()] = true;
        }
      }
    }

    function scanCols(cols) {
      if (!Array.isArray(cols)) return;
      cols.forEach(function (col) {
        if (Array.isArray(col.cards)) col.cards.forEach(scanCard);
      });
    }

    if (Array.isArray(boardData.columns)) {
      scanCols(boardData.columns);
    } else if (Array.isArray(boardData.rows)) {
      boardData.rows.forEach(function (row) {
        if (Array.isArray(row.stacks)) {
          row.stacks.forEach(function (stack) { scanCols(stack.columns); });
        }
      });
    }

    return Object.keys(tagSet).sort();
  }

  function getDateItems() {
    var now = new Date();

    function pad(n) { return String(n).padStart(2, '0'); }
    function fmt(d) {
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
    function isoWeek(d) {
      var tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      var dow = tmp.getUTCDay() || 7;
      tmp.setUTCDate(tmp.getUTCDate() + 4 - dow);
      var jan1 = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
      return Math.ceil((((tmp - jan1) / 86400000) + 1) / 7);
    }

    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    var items = [];
    items.push({ label: 'today  (' + fmt(today) + ')',    value: '@' + fmt(today) });
    items.push({ label: 'tomorrow  (' + fmt(tomorrow) + ')', value: '@' + fmt(tomorrow) });

    var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (var i = 1; i <= 7; i++) {
      var d = new Date(today);
      d.setDate(today.getDate() + i);
      var dow = d.getDay();
      if (dow >= 1 && dow <= 5) {
        items.push({ label: dayNames[dow] + '  (' + fmt(d) + ')', value: '@' + fmt(d) });
      }
    }

    var kw = isoWeek(today);
    var nextWeekDate = new Date(today);
    nextWeekDate.setDate(today.getDate() + 7);
    var kwNext = isoWeek(nextWeekDate);
    items.push({ label: 'KW' + kw + '  (this week)',  value: '@KW' + kw });
    items.push({ label: 'KW' + kwNext + '  (next week)', value: '@KW' + kwNext });

    return items;
  }

  function getTagPrefix(textarea) {
    var before = textarea.value.slice(0, textarea.selectionStart);
    var m = before.match(/#([a-zA-Z0-9_-]*)$/);
    if (!m) return null;
    return { prefix: m[0], partial: m[1] };
  }

  function getDatePrefix(textarea) {
    var before = textarea.value.slice(0, textarea.selectionStart);
    var m = before.match(/@([a-zA-Z0-9_-]*)$/);
    if (!m) return null;
    return { prefix: m[0], partial: m[1] };
  }

  function renderItems() {
    if (!_dropdown) return;
    _dropdown.innerHTML = '';
    _items.forEach(function (item, idx) {
      var el = document.createElement('div');
      el.className = 'editor-autocomplete-item' + (idx === _activeIndex ? ' active' : '');
      el.textContent = typeof item === 'string' ? item : item.label;
      el.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        _activeIndex = idx;
        confirmSelection();
      });
      _dropdown.appendChild(el);
    });
    var activeEl = _dropdown.querySelector('.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  function positionNear(textarea) {
    var rect = textarea.getBoundingClientRect();
    _dropdown.style.left = rect.left + 'px';
    _dropdown.style.top = (rect.bottom + 4) + 'px';
    _dropdown.style.minWidth = Math.min(220, rect.width) + 'px';
    _dropdown.style.maxWidth = Math.max(220, rect.width) + 'px';
    requestAnimationFrame(function () {
      if (!_dropdown) return;
      var ddRect = _dropdown.getBoundingClientRect();
      if (ddRect.bottom > window.innerHeight - 16 && ddRect.height < rect.top - 16) {
        _dropdown.style.top = (rect.top - ddRect.height - 4) + 'px';
      }
    });
  }

  function confirmSelection() {
    if (!_items.length) return;
    var item = _items[_activeIndex];
    var cb = _onSelect;
    hideDropdown();
    if (cb) cb(typeof item === 'string' ? item : item.value);
  }

  function hideDropdown() {
    if (_keyHandler) {
      document.removeEventListener('keydown', _keyHandler, true);
      _keyHandler = null;
    }
    if (_clickHandler) {
      document.removeEventListener('mousedown', _clickHandler);
      _clickHandler = null;
    }
    if (_dropdown) {
      _dropdown.remove();
      _dropdown = null;
    }
    _items = [];
    _activeIndex = 0;
    _onSelect = null;
  }

  function showDropdown(textarea, items, onSelect) {
    hideDropdown();
    if (!items || !items.length) return false;

    _items = items;
    _activeIndex = 0;
    _onSelect = onSelect;

    _dropdown = document.createElement('div');
    _dropdown.className = 'editor-autocomplete-dropdown';

    renderItems();
    document.body.appendChild(_dropdown);
    positionNear(textarea);

    _keyHandler = function (ev) {
      if (!_dropdown) return;
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        ev.stopPropagation();
        _activeIndex = Math.min(_activeIndex + 1, _items.length - 1);
        renderItems();
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        ev.stopPropagation();
        _activeIndex = Math.max(_activeIndex - 1, 0);
        renderItems();
      } else if (ev.key === 'Tab' || ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        confirmSelection();
        textarea.focus();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        hideDropdown();
        textarea.focus();
      } else if (ev.key !== 'Shift' && ev.key !== 'Control' && ev.key !== 'Alt' && ev.key !== 'Meta') {
        hideDropdown();
      }
    };
    document.addEventListener('keydown', _keyHandler, true);

    _clickHandler = function (ev) {
      if (_dropdown && !_dropdown.contains(ev.target)) hideDropdown();
    };
    document.addEventListener('mousedown', _clickHandler);

    return true;
  }

  function insertCompletion(textarea, prefix, value) {
    var pos = textarea.selectionStart;
    var text = textarea.value;
    var prefixStart = pos - prefix.length;
    if (prefixStart < 0) return;
    textarea.value = text.slice(0, prefixStart) + value + text.slice(pos);
    var newPos = prefixStart + value.length;
    textarea.setSelectionRange(newPos, newPos);
    textarea.dispatchEvent(new Event('input'));
  }

  function handleAltTab(e, textarea, boardData) {
    if (!e.altKey || e.key !== 'Tab') return false;

    // @-date prefix takes priority over # (user typed @ then Alt+Tab)
    var datePfx = getDatePrefix(textarea);
    if (datePfx !== null) {
      e.preventDefault();
      showDropdown(textarea, getDateItems(), function (value) {
        insertCompletion(textarea, datePfx.prefix, value);
        textarea.focus();
      });
      return true;
    }

    // #-tag prefix
    var tagPfx = getTagPrefix(textarea);
    if (tagPfx !== null) {
      e.preventDefault();
      var allTags = collectBoardTags(boardData);
      var partial = tagPfx.partial.toLowerCase();
      var filtered = allTags.filter(function (t) {
        return partial === '' || t.slice(1).indexOf(partial) === 0;
      });
      showDropdown(textarea, filtered, function (value) {
        insertCompletion(textarea, tagPfx.prefix, value);
        textarea.focus();
      });
      return true;
    }

    return false;
  }

  return {
    handleAltTab: handleAltTab,
    hideDropdown: hideDropdown,
    collectBoardTags: collectBoardTags,
    getDateItems: getDateItems,
  };
})();
