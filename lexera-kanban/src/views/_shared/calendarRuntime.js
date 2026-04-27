// Calendar runtime — minimal week/month grid renderers for the
// `weekCalendar` and `monthCalendar` sub-apps.
//
// The legacy in-shell renderers in `orderHelpers.js` are private to its
// IIFE and depend on shell-side helpers (`_callDep`, etc.), so they
// can't be reused directly in a child webview without significant
// refactor. This runtime provides simple, self-contained grid renderers
// that subscribe to `calendar-tasks-update` multiview events.
//
// The active board (or any other shell consumer) is expected to compute
// the calendar task list and broadcast it. Until that bridge lands the
// sub-app shows an empty calendar — better than the previous stub
// because the user sees the real grid layout.

(function () {
  'use strict';

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function ymd(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function startOfWeek(date) {
    var d = new Date(date.getTime());
    var day = d.getDay();              // 0 = Sun
    var diff = (day + 6) % 7;          // make Monday the first day
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function startOfMonth(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  var WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function renderWeekGrid(host, tasks, refDate) {
    if (!host) return;
    var ref = refDate || new Date();
    var weekStart = startOfWeek(ref);
    var todayKey = ymd(new Date());

    // Group tasks by day key
    var byDay = {};
    (tasks || []).forEach(function (t) {
      if (!t || !t.due) return;
      var key = String(t.due).slice(0, 10);
      (byDay[key] = byDay[key] || []).push(t);
    });

    host.innerHTML = '';
    var grid = document.createElement('div');
    grid.className = 'cal-week-grid';
    for (var i = 0; i < 7; i++) {
      var day = new Date(weekStart.getTime());
      day.setDate(day.getDate() + i);
      var key = ymd(day);
      var col = document.createElement('div');
      col.className = 'cal-week-col' + (key === todayKey ? ' is-today' : '');
      var header = document.createElement('div');
      header.className = 'cal-week-col-header';
      header.innerHTML =
        '<div class="cal-week-col-weekday">' + WEEKDAY_LABELS[i] + '</div>' +
        '<div class="cal-week-col-date">' + day.getDate() + '</div>';
      col.appendChild(header);
      var body = document.createElement('div');
      body.className = 'cal-week-col-body';
      var dayTasks = byDay[key] || [];
      if (dayTasks.length === 0) {
        body.innerHTML = '<div class="cal-empty">·</div>';
      } else {
        dayTasks.forEach(function (t) {
          var item = document.createElement('div');
          item.className = 'cal-task';
          item.textContent = t.title || t.text || '(untitled)';
          item.title = (t.boardName || '') + (t.boardName ? ' · ' : '') + (t.title || '');
          if (t.boardId) {
            item.addEventListener('click', function () {
              if (window.LexeraSubApp) {
                LexeraSubApp.navigate({ type: 'open-board', boardId: t.boardId });
              }
            });
          }
          body.appendChild(item);
        });
      }
      col.appendChild(body);
      grid.appendChild(col);
    }
    host.appendChild(grid);
  }

  function renderMonthGrid(host, tasks, refDate) {
    if (!host) return;
    var ref = refDate || new Date();
    var monthStart = startOfMonth(ref);
    var monthEnd = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
    var gridStart = startOfWeek(monthStart);
    var todayKey = ymd(new Date());

    var byDay = {};
    (tasks || []).forEach(function (t) {
      if (!t || !t.due) return;
      var key = String(t.due).slice(0, 10);
      (byDay[key] = byDay[key] || []).push(t);
    });

    host.innerHTML = '';
    var title = document.createElement('div');
    title.className = 'cal-month-title';
    title.textContent = monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    host.appendChild(title);

    var grid = document.createElement('div');
    grid.className = 'cal-month-grid';

    // Weekday header row
    for (var w = 0; w < 7; w++) {
      var hd = document.createElement('div');
      hd.className = 'cal-month-weekday';
      hd.textContent = WEEKDAY_LABELS[w];
      grid.appendChild(hd);
    }

    // Day cells (6 weeks max)
    var cur = new Date(gridStart.getTime());
    for (var c = 0; c < 42; c++) {
      var key2 = ymd(cur);
      var inMonth = cur >= monthStart && cur <= monthEnd;
      var cell = document.createElement('div');
      cell.className = 'cal-month-cell' +
        (inMonth ? '' : ' is-out-of-month') +
        (key2 === todayKey ? ' is-today' : '');
      var label = document.createElement('div');
      label.className = 'cal-month-cell-date';
      label.textContent = cur.getDate();
      cell.appendChild(label);
      var dayTasks2 = byDay[key2] || [];
      if (dayTasks2.length > 0) {
        var dot = document.createElement('div');
        dot.className = 'cal-month-cell-dots';
        dot.textContent = dayTasks2.length > 9 ? '9+' : String(dayTasks2.length);
        cell.appendChild(dot);
      }
      grid.appendChild(cell);
      cur.setDate(cur.getDate() + 1);
      if (cur > monthEnd && cur.getDay() === 1) break; // stop at start of next-next week
    }
    host.appendChild(grid);
  }

  function renderTaskList(host, tasks) {
    if (!host) return;
    host.innerHTML = '';
    if (!tasks || !tasks.length) {
      host.innerHTML = '<div class="cal-empty">No tasks with due dates yet.</div>';
      return;
    }
    var sorted = tasks.slice().sort(function (a, b) {
      return String(a.due || '').localeCompare(String(b.due || ''));
    });
    var ul = document.createElement('ul');
    ul.className = 'cal-task-list';
    sorted.forEach(function (t) {
      var li = document.createElement('li');
      li.className = 'cal-task-list-item';
      li.innerHTML =
        '<span class="cal-task-list-due">' + String(t.due || '').slice(0, 10) + '</span>' +
        '<span class="cal-task-list-title">' + (t.title || t.text || '(untitled)') + '</span>' +
        '<span class="cal-task-list-board">' + (t.boardName || '') + '</span>';
      if (t.boardId) {
        li.addEventListener('click', function () {
          if (window.LexeraSubApp) {
            LexeraSubApp.navigate({ type: 'open-board', boardId: t.boardId });
          }
        });
      }
      ul.appendChild(li);
    });
    host.appendChild(ul);
  }

  /**
   * Normalize a backend `SearchResult`-shaped task (camelCase via serde)
   * into the field names this runtime's renderers expect.
   */
  function normalizeTask(t) {
    if (!t) return null;
    var due = t.due || t.dueDate || '';
    if (!due) return null;
    return {
      due: due,
      title: t.title || t.cardContent || t.text || '',
      boardId: t.boardId || t.board_id || '',
      boardName: t.boardName || t.boardTitle || t.board_title || '',
      cardId: t.cardId || t.card_id || ''
    };
  }

  function normalizeTasks(arr) {
    var out = [];
    if (!Array.isArray(arr)) return out;
    for (var i = 0; i < arr.length; i++) {
      var n = normalizeTask(arr[i]);
      if (n) out.push(n);
    }
    return out;
  }

  /**
   * Fetch calendar tasks directly from the backend via `LexeraApi`.
   * Returns a Promise<task[]>. The `/calendar/tasks` endpoint returns
   * `{ results: [...], groups: {...} }`; we use the flat `results` array.
   */
  function fetchCalendarTasks(opts) {
    if (typeof window === 'undefined' || !window.LexeraApi || typeof window.LexeraApi.getCalendarTasks !== 'function') {
      return Promise.resolve([]);
    }
    return window.LexeraApi.getCalendarTasks(opts || {})
      .then(function (resp) {
        var raw = resp && resp.results;
        return normalizeTasks(raw);
      })
      .catch(function () { return []; });
  }

  /**
   * Mount a calendar sub-app onto `panelEl` (the panel root). Renders the
   * grid + task list immediately (empty state), then fetches tasks from
   * the backend and re-renders. Also re-fetches on board mutation events
   * (`management-board-mutation`) and on a configurable polling interval.
   *
   * `opts.kind` should be 'week' or 'month'.
   * `opts.pollMs` (default 30000) — re-fetch interval; pass 0 to disable.
   */
  function mount(panelEl, opts) {
    opts = opts || {};
    var gridSelector = opts.kind === 'month'
      ? '.lexera-shared-calendar-month-view'
      : '.lexera-shared-calendar-week-view';
    var listSelector = '.lexera-shared-calendar-task-list';
    var gridEl = panelEl.querySelector(gridSelector);
    var listEl = panelEl.querySelector(listSelector);

    var renderer = opts.kind === 'month' ? renderMonthGrid : renderWeekGrid;

    // Initial render with empty tasks so the layout is visible while we
    // wait for the first fetch.
    renderer(gridEl, []);
    renderTaskList(listEl, []);

    function refresh() {
      fetchCalendarTasks().then(function (tasks) {
        renderer(gridEl, tasks);
        renderTaskList(listEl, tasks);
      });
    }

    refresh();

    // Light periodic refresh in case mutation events are missed.
    // The caller is expected to also pass `instance.refresh` into
    // `LexeraSubApp.init({onCustom: ...})` so backend mutation events
    // ('management-board-mutation', 'calendar-tasks-update') drive a
    // re-fetch without a reload. Doing the SubApp.init here used to
    // double-init the runtime when the bootstrap already called init,
    // which created duplicate event listeners and re-broadcast
    // theme-request/panel-ready unnecessarily.
    var pollMs = opts.pollMs == null ? 30000 : opts.pollMs;
    if (pollMs > 0) {
      setInterval(refresh, pollMs);
    }

    return { refresh: refresh };
  }

  if (typeof window !== 'undefined') {
    window.LexeraCalendarRuntime = {
      mount: mount,
      renderWeekGrid: renderWeekGrid,
      renderMonthGrid: renderMonthGrid,
      renderTaskList: renderTaskList,
      fetchCalendarTasks: fetchCalendarTasks,
      normalizeTasks: normalizeTasks,
      ymd: ymd,
      startOfWeek: startOfWeek,
      startOfMonth: startOfMonth
    };
  }
})();
