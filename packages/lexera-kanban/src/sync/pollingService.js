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

  // --- Polling ---

  async function poll() {
    try {
      var ok = await _deps.LexeraApi.checkStatus();
      setConnected(ok);
      if (!ok) return;
    } catch (err) {
      _callDep('logFrontendIssue', 'warn', 'poll.status', 'Failed to check backend status', err);
      setConnected(false);
      return;
    }

    _callDep('connectSSEIfReady');
    _callDep('connectBackendLogStreamIfReady');

    try {
      // Load workspaces
      try {
        var wsData = await _deps.LexeraApi.request('/config/workspaces');
        var wsList = Array.isArray(wsData.workspaces) ? wsData.workspaces : [];
        _callDep('setWorkspaces', wsList);
        _callDep('resolveActiveWorkspaceId', wsData.default_workspace || null);
        _callDep('renderWorkspaceSelect');
      } catch (err) {
        _callDep('logFrontendIssue', 'warn', 'poll.workspaces', 'Failed to load workspaces', err);
      }

      var data = await _deps.LexeraApi.getBoards();
      var boardsList = data.boards || [];
      _callDep('setBoards', boardsList);
      try {
        var rb = await _deps.LexeraApi.getRemoteBoards();
        var remoteBoardsList = (rb.boards || []).map(function (board) {
          if (board) board.isRemote = true;
          return board;
        });
        _callDep('setRemoteBoards', remoteBoardsList);
      } catch (err) {
        _callDep('logFrontendIssue', 'warn', 'boards.remote', 'Failed to load remote boards', err);
        _callDep('setRemoteBoards', []);
      }
      await _callDep('refreshBoardHierarchyCache', _dep('boards'));
      _callDep('renderBoardList');
      if (_dep('workspaceShellEnabled') && _dep('WorkspaceShell') && typeof _dep('WorkspaceShell').onBoardsUpdated === 'function') {
        _dep('WorkspaceShell').onBoardsUpdated(_dep('boards').concat(_dep('remoteBoards')));
      }
      if (_dep('workspaceShellEnabled')) {
        if (!_dep('searchMode')) {
          if (_dep('activeBoardId') && !_callDep('findBoardMeta', _dep('activeBoardId'))) {
            console.warn('[poll] active board ' + _dep('activeBoardId') + ' not found in board list (' + (_dep('boards') ? _dep('boards').length : 0) + ' boards), clearing');
            _callDep('setShellActiveBoard', null);
          }
          if (!_dep('activeBoardId')) {
            var initialBoardId = _dep('embeddedMode')
              ? _dep('embeddedPreferredBoardId')
              : (_dep('urlParams').get('board') || localStorage.getItem('lexera-last-board') || (_dep('boards')[0] && _dep('boards')[0].id) || '');
            if (initialBoardId && _callDep('findBoardMeta', initialBoardId) && typeof _dep('WorkspaceShell').ensureInitialTab === 'function') {
              _dep('WorkspaceShell').ensureInitialTab(initialBoardId);
            }
          }
        }
        _callDep('refreshHeaderFileControls');
        _callDep('scheduleDashboardRefresh', 120);
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
          if (!_dep('embeddedMode')) localStorage.removeItem('lexera-last-board');
          _callDep('renderMainView');
        }
      } else if (!activeBoardId && !_dep('searchMode')) {
        var lastBoard = _dep('embeddedMode') ? _dep('embeddedPreferredBoardId') : (_dep('urlParams').get('board') || localStorage.getItem('lexera-last-board'));
        if (lastBoard) {
          var found = _callDep('findBoardMeta', lastBoard);
          if (found) {
            await _callDep('selectBoard', lastBoard);
          }
        }
      }
      _callDep('refreshHeaderFileControls');
      _callDep('scheduleDashboardRefresh', 120);
    } catch (err) {
      _callDep('logFrontendIssue', 'warn', 'poll.refresh', 'Failed to refresh board list or active board state', err);
      // keep previous state
      _callDep('refreshHeaderFileControls');
      _callDep('scheduleDashboardRefresh', 250);
    }
  }

  function setConnected(state) {
    if (state && !_dep('connected')) _callDep('loadTemplatesOnce');
    _callDep('setConnectedState', state);
    if (typeof window.setLogBackendConnectionState === 'function') {
      window.setLogBackendConnectionState(state);
    }
    syncConnectionStatusButton(
      _callDep('getElConnectionStatusBtn'),
      _callDep('getElConnectionDot'),
      state
    );
  }

  function syncConnectionStatusButton(buttonEl, dotEl, state) {
    var isConnected = !!state;
    var title = isConnected
      ? 'Backend connected. Open backend settings'
      : 'Backend disconnected. Open backend settings';
    if (buttonEl) {
      buttonEl.classList.toggle('connected', isConnected);
      buttonEl.classList.toggle('disconnected', !isConnected);
      buttonEl.setAttribute('data-connection-state', isConnected ? 'connected' : 'disconnected');
      buttonEl.title = title;
      buttonEl.setAttribute('aria-label', title);
      var labelEl = buttonEl.querySelector('.connection-status-label');
      if (labelEl) labelEl.textContent = isConnected ? 'Connected' : 'Disconnected';
    }
    if (dotEl) {
      dotEl.classList.toggle('connected', isConnected);
      dotEl.classList.toggle('disconnected', !isConnected);
    }
  }

  return {
    init: init,
    poll: poll,
    setConnected: setConnected,
    syncConnectionStatusButton: syncConnectionStatusButton
  };
})();
window.LexeraPollingService = LexeraPollingService;
