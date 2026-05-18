/**
 * LexeraPollingService — Polling loop, connection status, server health.
 *
 * Extracted from the "Polling" section of app.js.
 *
 * IIFE module — no const/let, no ES imports.
 */
var LexeraPollingService = (function () {
  'use strict';

  // --- Dependencies (injected via init) ---
  var _deps = {};

  function _dep(name) {
    return _deps[name];
  }

  function _callDep(name) {
    var fn = _deps[name];
    if (typeof fn === 'function') return fn.apply(null, Array.prototype.slice.call(arguments, 1));
    return undefined;
  }

  function init(deps) {
    if (typeof window !== 'undefined' && window.LexeraRuntime) {
      window.LexeraRuntime.mergeDeps(_deps, deps);
    } else {
      _deps = deps || {};
    }
  }

  // --- Change-detection fingerprints ---
  var _lastWorkspacesFingerprint = '';
  var _lastBoardsCatalogFingerprint = '';
  var _lastBoardsContentFingerprint = '';
  var _lastRemoteBoardsCatalogFingerprint = '';
  var _lastRemoteBoardsContentFingerprint = '';

  function fingerprint(list, titleKey) {
    if (!Array.isArray(list) || list.length === 0) return '0';
    var parts = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      parts.push((item.id || '') + ':' + (item[titleKey || 'title'] || '') + ':' + (item.generation !== undefined ? item.generation : ''));
    }
    return list.length + '|' + parts.join(',');
  }

  function workspaceIdsFingerprint(item) {
    if (!item) return '';
    var raw = item.workspace_ids || item.workspaceIds || (item.workspace_id || item.workspaceId ? [item.workspace_id || item.workspaceId] : []);
    if (!Array.isArray(raw)) raw = [raw];
    var ids = [];
    for (var i = 0; i < raw.length; i++) {
      if (raw[i] == null || raw[i] === '') continue;
      ids.push(String(raw[i]));
    }
    ids.sort();
    return ids.join(';');
  }

  function boardCatalogFingerprint(list, titleKey) {
    if (!Array.isArray(list) || list.length === 0) return '0';
    var parts = [];
    var key = titleKey || 'title';
    for (var i = 0; i < list.length; i++) {
      var item = list[i] || {};
      parts.push([
        item.id || '',
        item[key] || '',
        item.filePath || item.name || '',
        workspaceIdsFingerprint(item)
      ].join(':'));
    }
    return list.length + '|' + parts.join(',');
  }

  function boardContentFingerprint(list) {
    if (!Array.isArray(list) || list.length === 0) return '0';
    var parts = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i] || {};
      parts.push((item.id || '') + ':' +
        (item.generation !== undefined ? item.generation : '') + ':' +
        (item.revision || ''));
    }
    return list.length + '|' + parts.join(',');
  }

  function finalizePollUi(delayMs) {
    _callDep('refreshHeaderFileControls');
    if (!_dep('embeddedMode')) _callDep('scheduleDashboardRefresh', delayMs);
  }

  async function pollEmbeddedBoard() {
    var targetBoardId = _dep('activeBoardId') || _dep('embeddedPreferredBoardId') || (_dep('urlParams') && _dep('urlParams').get('board')) || '';
    if (!targetBoardId || _dep('searchMode')) {
      finalizePollUi(0);
      return;
    }

    if (!_dep('activeBoardId') || _dep('activeBoardId') !== targetBoardId) {
      await _callDep('selectBoard', targetBoardId);
      finalizePollUi(0);
      return;
    }

    if (_callDep('isBoardDirty') || _dep('isEditing')) {
      _callDep('traceFrontendAction', 'warn', 'poll.embedded.skipDirty', 'Skipped embedded polling reload because active board is dirty or being edited', {
        boardId: targetBoardId,
        dirty: _callDep('isBoardDirty'),
        editing: _dep('isEditing'),
        generation: _dep('_lastLoadedGeneration'),
        revision: _dep('_lastLoadedRevision') || null
      });
      finalizePollUi(0);
      return;
    }

    var pollGen = _dep('_lastLoadedGeneration');
    var deltaApplied = false;
    if (
      typeof pollGen === 'number' &&
      _deps.LexeraApi &&
      typeof _deps.LexeraApi.getBoardChanges === 'function'
    ) {
      try {
        var deltaPayload = await _deps.LexeraApi.getBoardChanges(targetBoardId, pollGen);
        if (deltaPayload && typeof deltaPayload.generation === 'number' && deltaPayload.generation === pollGen) {
          finalizePollUi(0);
          return;
        }
        deltaApplied = !!_callDep('applyPollingBoardDelta', targetBoardId, deltaPayload);
        if (!deltaApplied) {
          _callDep('traceFrontendAction', 'warn', 'poll.embedded.delta.unavailable', 'Embedded polling delta unavailable; falling back to full board reload', {
            boardId: targetBoardId,
            loadedGeneration: pollGen,
            serverGeneration: deltaPayload && typeof deltaPayload.generation === 'number' ? deltaPayload.generation : null,
            deltaAvailable: !!(deltaPayload && deltaPayload.available)
          });
        }
      } catch (deltaErr) {
        _callDep('logFrontendIssue', 'warn', 'poll.embedded.delta', 'Failed to load embedded board delta during polling refresh', deltaErr);
      }
    }

    if (!deltaApplied) {
      await _callDep('loadBoard', targetBoardId);
    }
    finalizePollUi(0);
  }

  // --- Polling ---

  async function poll() {
    try {
      var url = await _deps.LexeraApi.discover();
      if (!url) { setConnected('none'); return; }
      setConnected('busy');
    } catch (err) {
      _callDep('logFrontendIssue', 'warn', 'poll.status', 'Failed to check backend status', err);
      setConnected('none');
      return;
    }

    // Only the top-level window should manage SSE and log streams — embedded
    // iframes (multi-board workspace) must not open duplicate connections.
    if (!_dep('embeddedMode')) {
      _callDep('connectSSEIfReady');
      _callDep('connectBackendLogStreamIfReady');
    }

    if (_dep('embeddedMode')) {
      try {
        await pollEmbeddedBoard();
      } catch (err) {
        _callDep('logFrontendIssue', 'warn', 'poll.embedded.refresh', 'Failed to refresh embedded board state', err);
        finalizePollUi(0);
      }
      return;
    }

    try {
      // Fetch workspaces, boards, and remote boards in parallel
      var results = await Promise.all([
        _deps.LexeraApi.request('/config/workspaces').catch(function (err) {
          _callDep('logFrontendIssue', 'warn', 'poll.workspaces', 'Failed to load workspaces', err);
          return null;
        }),
        _deps.LexeraApi.getBoards(),
        _deps.LexeraApi.getRemoteBoards().catch(function (err) {
          _callDep('logFrontendIssue', 'warn', 'boards.remote', 'Failed to load remote boards', err);
          return null;
        })
      ]);
      var wsData = results[0];
      var data = results[1];
      var rb = results[2];

      // Process workspaces
      var workspacesChanged = false;
      if (wsData) {
        var wsList = Array.isArray(wsData.workspaces) ? wsData.workspaces : [];
        var defaultWsId = wsData.default_workspace || null;
        // Stamp `isDefault` onto the matching workspace so
        // setWorkspacesState's pickDefaultWorkspaceId() can promote
        // it instead of falling back to list[0].
        if (defaultWsId) {
          var defaultIdStr = String(defaultWsId);
          wsList = wsList.map(function (ws) {
            if (ws && String(ws.id) === defaultIdStr) {
              return Object.assign({}, ws, { isDefault: true });
            }
            return ws;
          });
        }
        var wsFp = fingerprint(wsList, 'name');
        if (wsFp !== _lastWorkspacesFingerprint) {
          _lastWorkspacesFingerprint = wsFp;
          workspacesChanged = true;
          _callDep('setWorkspaces', wsList);
          _callDep('resolveActiveWorkspaceId', defaultWsId);
        }
      }

      // Process boards
      var boardsList = data.boards || [];
      var boardsCatalogFp = boardCatalogFingerprint(boardsList, 'title');
      var boardsContentFp = boardContentFingerprint(boardsList);
      var boardsCatalogChanged = boardsCatalogFp !== _lastBoardsCatalogFingerprint;
      var boardsContentChanged = boardsContentFp !== _lastBoardsContentFingerprint;
      if (boardsCatalogChanged) {
        _lastBoardsCatalogFingerprint = boardsCatalogFp;
        _lastBoardsContentFingerprint = boardsContentFp;
        _callDep('setBoards', boardsList);
      } else if (boardsContentChanged) {
        _lastBoardsContentFingerprint = boardsContentFp;
      }

      // Process remote boards
      var remoteBoardsCatalogChanged = false;
      var remoteBoardsContentChanged = false;
      if (rb) {
        var remoteBoardsList = (rb.boards || []).map(function (board) {
          if (board) board.isRemote = true;
          return board;
        });
        var remoteCatalogFp = boardCatalogFingerprint(remoteBoardsList, 'title');
        var remoteContentFp = boardContentFingerprint(remoteBoardsList);
        remoteBoardsCatalogChanged = remoteCatalogFp !== _lastRemoteBoardsCatalogFingerprint;
        remoteBoardsContentChanged = remoteContentFp !== _lastRemoteBoardsContentFingerprint;
        if (remoteBoardsCatalogChanged) {
          _lastRemoteBoardsCatalogFingerprint = remoteCatalogFp;
          _lastRemoteBoardsContentFingerprint = remoteContentFp;
          _callDep('setRemoteBoards', remoteBoardsList);
        } else if (remoteBoardsContentChanged) {
          _lastRemoteBoardsContentFingerprint = remoteContentFp;
        }
      } else {
        _callDep('setRemoteBoards', []);
        _lastRemoteBoardsCatalogFingerprint = '';
        _lastRemoteBoardsContentFingerprint = '';
        remoteBoardsCatalogChanged = true;
        remoteBoardsContentChanged = true;
      }
      if (workspacesChanged || boardsCatalogChanged || remoteBoardsCatalogChanged) {
        _callDep('renderBoardList');
      }
      var hierarchyRefresh = (boardsCatalogChanged || boardsContentChanged) ? _callDep('refreshBoardHierarchyCache', _dep('boards')) : null;
      if (hierarchyRefresh && typeof hierarchyRefresh.catch === 'function') {
        hierarchyRefresh.catch(function (err) {
          _callDep('logFrontendIssue', 'warn', 'hierarchy.cache', 'Failed to refresh board hierarchy cache', err);
        });
      }
      if ((boardsCatalogChanged || remoteBoardsCatalogChanged) && _dep('workspaceShellEnabled') && _dep('WorkspaceShell') && typeof _dep('WorkspaceShell').onBoardsUpdated === 'function') {
        _dep('WorkspaceShell').onBoardsUpdated(_dep('boards').concat(_dep('remoteBoards')));
      }
      if (_dep('workspaceShellEnabled')) {
        if (!_dep('searchMode')) {
          if (_dep('activeBoardId') && !_callDep('findBoardMeta', _dep('activeBoardId'))) {
            console.warn('[poll] active board ' + _dep('activeBoardId') + ' not found in board list (' + (_dep('boards') ? _dep('boards').length : 0) + ' boards), clearing');
            _callDep('setShellActiveBoard', null);
          }
          if (_dep('workspaceShellBoardHostEnabled') && !_dep('activeBoardId')) {
            // Initial board is per-window — URL `?board=` first, then
            // first-available fallback. NEVER read the shared
            // `lastBoard` setting, which would auto-mirror sibling
            // windows together on cold start.
            var allBoards = _dep('boards') || [];
            var viewWs = _dep('viewWorkspaceId') || _dep('activeWorkspaceId');
            var boardsForWs = viewWs ? allBoards.filter(function (b) {
              if (!b) return false;
              var wsIds = b.workspace_ids || b.workspaceIds || (b.workspace_id || b.workspaceId ? [b.workspace_id || b.workspaceId] : []);
              for (var i = 0; i < wsIds.length; i++) { if (String(wsIds[i]) === String(viewWs)) return true; }
              return false;
            }) : allBoards;
            var initialBoardId = _dep('embeddedMode')
              ? _dep('embeddedPreferredBoardId')
              : (_dep('urlParams').get('board') || (boardsForWs[0] && boardsForWs[0].id) || '');
            if (initialBoardId && _callDep('findBoardMeta', initialBoardId) && typeof _dep('WorkspaceShell').ensureInitialTab === 'function') {
              _dep('WorkspaceShell').ensureInitialTab(initialBoardId);
            }
          }
        }
        setConnected('ready');
        _callDep('refreshHeaderFileControls');
        finalizePollUi(120);
        return;
      }

      var activeBoardId = _dep('activeBoardId');
      if (activeBoardId && !_dep('searchMode')) {
        var stillExists = !!_callDep('findBoardMeta', activeBoardId);
        if (stillExists) {
          // Never reload the board if there are unsaved changes or the user
          // is actively editing a card — that would discard work.
          // Also skip reload if the board hasn't changed (same generation).
          if (!_callDep('isBoardDirty') && !_dep('isEditing')) {
            var pollGen = _dep('_lastLoadedGeneration');
            var serverGen = data.boards ? (function () {
              for (var bi = 0; bi < boardsList.length; bi++) {
                if (boardsList[bi].id === activeBoardId) return boardsList[bi].generation;
              }
              return null;
            })() : null;
            if (serverGen !== null && typeof pollGen === 'number' && serverGen === pollGen) {
              // Board hasn't changed — skip reload
            } else {
              var deltaApplied = false;
              if (
                serverGen !== null &&
                typeof pollGen === 'number' &&
                serverGen > pollGen &&
                _deps.LexeraApi &&
                typeof _deps.LexeraApi.getBoardChanges === 'function'
              ) {
                try {
                  var deltaPayload = await _deps.LexeraApi.getBoardChanges(activeBoardId, pollGen);
                  deltaApplied = !!_callDep('applyPollingBoardDelta', activeBoardId, deltaPayload);
                  if (!deltaApplied) {
                    _callDep('traceFrontendAction', 'warn', 'poll.delta.unavailable', 'Polling delta unavailable; falling back to full board reload', {
                      boardId: activeBoardId,
                      loadedGeneration: pollGen,
                      serverGeneration: serverGen,
                      deltaAvailable: !!(deltaPayload && deltaPayload.available)
                    });
                  }
                } catch (deltaErr) {
                  _callDep('logFrontendIssue', 'warn', 'poll.delta', 'Failed to load board delta during polling refresh', deltaErr);
                }
              }
              if (deltaApplied) {
                finalizePollUi(120);
                return;
              }
              _callDep('traceFrontendAction', 'info', 'poll.reload', 'Polling reload for active board (clean, generation changed)', {
                boardId: activeBoardId,
                revision: _dep('_lastLoadedRevision') || null,
                loadedGeneration: pollGen,
                serverGeneration: serverGen
              });
              await _callDep('loadBoard', activeBoardId);
            }
          } else {
            _callDep('traceFrontendAction', 'warn', 'poll.reload.skipDirty', 'Skipped polling reload because active board is dirty or being edited', {
              boardId: activeBoardId,
              isRemoteBoard: _callDep('isActiveRemoteBoard'),
              dirty: _callDep('isBoardDirty'),
              editing: _dep('isEditing'),
              revision: _dep('_lastLoadedRevision') || null,
              generation: _dep('_lastLoadedGeneration'),
              summary: _callDep('summarizeBoardHierarchy', _dep('fullBoardData'))
            });
          }
        } else {
          // Board was removed while we had it open.  If the user is editing
          // or has unsaved changes, write a crashsave so work is not lost.
          if (_callDep('isBoardDirty') || _dep('isEditing')) {
            _callDep('logFrontendIssue', 'warn', 'poll.boardRemoved', 'Active board removed while dirty/editing — creating crashsave', { boardId: activeBoardId });
            try { await _deps.LexeraApi.writeBoardCrashsave(activeBoardId, _dep('fullBoardData')); } catch (_) { /* best-effort */ }
          }
          await _callDep('closeLiveSyncSession', activeBoardId);
          _deps.LexeraApi.disconnectSync();
          _callDep('setActiveBoardId', null);
          _callDep('setActiveBoardData', null);
          _callDep('setFullBoardData', null);
          _callDep('setLastLoadedGeneration', null);
          _callDep('setLastLoadedRevision', null);
          // Active board is per-window state — never persisted to the
          // shared Settings store.
          _callDep('renderMainView');
        }
      } else if (!activeBoardId && !_dep('searchMode')) {
        // Auto-select a board on first load. Each window picks its
        // initial board from URL `?board=` only — never from the
        // shared `lastBoard` setting, which would couple windows
        // together (window A switches → window B opens later → B
        // auto-loads A's board because lastBoard is shared via
        // localStorage). Embedded iframes use their parent-supplied
        // preferred id.
        var lastBoard = _dep('embeddedMode')
          ? _dep('embeddedPreferredBoardId')
          : _dep('urlParams').get('board');
        if (!lastBoard) {
          var allBoards = _dep('boards') || [];
          var viewWs = _dep('viewWorkspaceId') || _dep('activeWorkspaceId');
          var boardsForWs = viewWs ? allBoards.filter(function (b) {
            if (!b) return false;
            var wsIds = b.workspace_ids || b.workspaceIds || (b.workspace_id || b.workspaceId ? [b.workspace_id || b.workspaceId] : []);
            for (var i = 0; i < wsIds.length; i++) { if (String(wsIds[i]) === String(viewWs)) return true; }
            return false;
          }) : allBoards;
          if (boardsForWs[0]) lastBoard = boardsForWs[0].id;
        }
        if (lastBoard) {
          var found = _callDep('findBoardMeta', lastBoard);
          if (found) {
            await _callDep('selectBoard', lastBoard);
          }
        }
      }
      setConnected('ready');
      finalizePollUi(120);
    } catch (err) {
      _callDep('logFrontendIssue', 'warn', 'poll.refresh', 'Failed to refresh board list or active board state', err);
      setConnected('busy');
      finalizePollUi(250);
    }
  }

  function setConnected(state) {
    // state: 'none' | 'busy' | 'ready' (or legacy boolean true/false)
    // Normalize legacy boolean callers
    if (state === true) state = 'ready';
    if (state === false) state = 'none';
    var isConnected = state !== 'none';
    if (isConnected && !_dep('connected')) _callDep('loadTemplatesOnce');
    _callDep('setConnectedState', isConnected);
    if (typeof window.setLogBackendConnectionState === 'function') {
      window.setLogBackendConnectionState(isConnected);
    }
    syncConnectionStatusButton(
      _callDep('getElConnectionStatusBtn'),
      _callDep('getElConnectionDot'),
      state
    );
  }

  function syncConnectionStatusButton(buttonEl, dotEl, state) {
    // Normalize legacy boolean callers
    if (state === true) state = 'ready';
    if (state === false || state == null) state = 'none';
    var titles = {
      none: 'No connection to backend',
      busy: 'Backend busy\u2026',
      ready: 'Backend ready',
      testing: 'Preparing tests\u2026'
    };
    var labels = {
      none: 'No Connection',
      busy: 'Busy\u2026',
      ready: 'Ready',
      testing: 'Testing\u2026'
    };
    var title = (titles[state] || titles.none) + '. Open backend settings';
    var label = labels[state] || labels.none;
    if (buttonEl) {
      buttonEl.classList.toggle('connected', state === 'ready');
      buttonEl.classList.toggle('busy', state === 'busy');
      buttonEl.classList.toggle('disconnected', state === 'none');
      buttonEl.setAttribute('data-connection-state', state || 'none');
      buttonEl.title = title;
      buttonEl.setAttribute('aria-label', title);
      var labelEl = buttonEl.querySelector('.connection-status-label');
      if (labelEl) labelEl.textContent = label;
    }
    if (dotEl) {
      dotEl.classList.toggle('connected', state === 'ready');
      dotEl.classList.toggle('busy', state === 'busy');
      dotEl.classList.toggle('disconnected', state === 'none');
    }
  }

  /** Force the next poll to treat all data as changed (e.g. after user-triggered refresh). */
  function resetFingerprints() {
    _lastWorkspacesFingerprint = '';
    _lastBoardsCatalogFingerprint = '';
    _lastBoardsContentFingerprint = '';
    _lastRemoteBoardsCatalogFingerprint = '';
    _lastRemoteBoardsContentFingerprint = '';
  }

  return {
    init: init,
    poll: poll,
    setConnected: setConnected,
    syncConnectionStatusButton: syncConnectionStatusButton,
    resetFingerprints: resetFingerprints
  };
})();
window.LexeraPollingService = LexeraPollingService;
