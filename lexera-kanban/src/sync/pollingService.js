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
  var _Settings = typeof LexeraSettings !== 'undefined' ? LexeraSettings : null;

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
  // Light fingerprint: serialize id+title (or id+name) of each item.
  // Much cheaper than full deep-equal but catches additions, removals,
  // renames, and reorders — which are the cases that matter for UI.
  var _lastWorkspacesFingerprint = '';
  var _lastBoardsFingerprint = '';
  var _lastRemoteBoardsFingerprint = '';

  function fingerprint(list, titleKey) {
    if (!Array.isArray(list) || list.length === 0) return '0';
    var parts = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      parts.push((item.id || '') + ':' + (item[titleKey || 'title'] || '') + ':' + (item.generation !== undefined ? item.generation : ''));
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
      var ok = await _deps.LexeraApi.checkStatus();
      setConnected(ok);
      if (!ok) return;
    } catch (err) {
      _callDep('logFrontendIssue', 'warn', 'poll.status', 'Failed to check backend status', err);
      setConnected(false);
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
        var wsFp = fingerprint(wsList, 'name');
        if (wsFp !== _lastWorkspacesFingerprint) {
          _lastWorkspacesFingerprint = wsFp;
          workspacesChanged = true;
          _callDep('setWorkspaces', wsList);
          _callDep('resolveActiveWorkspaceId', wsData.default_workspace || null);
          _callDep('renderWorkspaceSelect');
        }
      }

      // Process boards
      var boardsList = data.boards || [];
      var boardsFp = fingerprint(boardsList, 'title');
      var boardsChanged = boardsFp !== _lastBoardsFingerprint;
      if (boardsChanged) {
        _lastBoardsFingerprint = boardsFp;
        _callDep('setBoards', boardsList);
      }

      // Process remote boards
      var remoteBoardsChanged = false;
      if (rb) {
        var remoteBoardsList = (rb.boards || []).map(function (board) {
          if (board) board.isRemote = true;
          return board;
        });
        var remoteFp = fingerprint(remoteBoardsList, 'title');
        remoteBoardsChanged = remoteFp !== _lastRemoteBoardsFingerprint;
        if (remoteBoardsChanged) {
          _lastRemoteBoardsFingerprint = remoteFp;
          _callDep('setRemoteBoards', remoteBoardsList);
        }
      } else {
        _callDep('setRemoteBoards', []);
        _lastRemoteBoardsFingerprint = '';
        remoteBoardsChanged = true;
      }
      if (workspacesChanged || boardsChanged || remoteBoardsChanged) {
        _callDep('renderBoardList');
      }
      var hierarchyRefresh = boardsChanged ? _callDep('refreshBoardHierarchyCache', _dep('boards')) : null;
      if (hierarchyRefresh && typeof hierarchyRefresh.catch === 'function') {
        hierarchyRefresh.catch(function (err) {
          _callDep('logFrontendIssue', 'warn', 'hierarchy.cache', 'Failed to refresh board hierarchy cache', err);
        });
      }
      if ((boardsChanged || remoteBoardsChanged) && _dep('workspaceShellEnabled') && _dep('WorkspaceShell') && typeof _dep('WorkspaceShell').onBoardsUpdated === 'function') {
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
              : (_dep('urlParams').get('board') || (_Settings ? _Settings.get('lastBoard') : localStorage.getItem('lexera-last-board')) || (_dep('boards')[0] && _dep('boards')[0].id) || '');
            if (initialBoardId && _callDep('findBoardMeta', initialBoardId) && typeof _dep('WorkspaceShell').ensureInitialTab === 'function') {
              _dep('WorkspaceShell').ensureInitialTab(initialBoardId);
            }
          }
        }
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
          if (!_dep('embeddedMode')) {
            if (_Settings) { _Settings.set('lastBoard', ''); }
            else { localStorage.removeItem('lexera-last-board'); }
          }
          _callDep('renderMainView');
        }
      } else if (!activeBoardId && !_dep('searchMode')) {
        // Auto-select a board on first load:
        // - Embedded iframes: use the board ID from ?board= URL param
        // - Top-level window: use last board from localStorage
        var lastBoard = _dep('embeddedMode')
          ? _dep('embeddedPreferredBoardId')
          : (_dep('urlParams').get('board') || (_Settings ? _Settings.get('lastBoard') : localStorage.getItem('lexera-last-board')));
        if (lastBoard) {
          var found = _callDep('findBoardMeta', lastBoard);
          if (found) {
            await _callDep('selectBoard', lastBoard);
          }
        }
      }
      finalizePollUi(120);
    } catch (err) {
      _callDep('logFrontendIssue', 'warn', 'poll.refresh', 'Failed to refresh board list or active board state', err);
      // keep previous state
      finalizePollUi(250);
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

  /** Force the next poll to treat all data as changed (e.g. after user-triggered refresh). */
  function resetFingerprints() {
    _lastWorkspacesFingerprint = '';
    _lastBoardsFingerprint = '';
    _lastRemoteBoardsFingerprint = '';
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
