(function () {
  var DUPLICABLE_PANEL_KINDS = {
    hierarchy: true,
    dashboard: true,
    logs: true
  };

  var instancesByKind = {
    hierarchy: {},
    dashboard: {},
    logs: {}
  };

  function createHierarchyPanelElement(instanceId) {
    var root = document.createElement('div');
    root.className = 'sidebar lexera-shared-panel lexera-shared-panel-hierarchy';
    root.setAttribute('data-shared-panel-kind', 'hierarchy');
    root.setAttribute('data-shared-panel-instance', instanceId);
    root.innerHTML =
      '<div class="sidebar-header">' +
        '<button class="workspace-panel-drag-handle" type="button" title="Drag Workspaces view" data-ws-panel-drag-handle="' + instanceId + '" aria-label="Drag Workspaces view">&#8942;&#8942;</button>' +
        '<div class="workspace-select-wrap">' +
          '<select class="workspace-select lexera-shared-workspace-select" title="Active workspace"></select>' +
        '</div>' +
        '<div class="sidebar-header-actions">' +
          '<button class="sidebar-btn lexera-shared-workspace-menu" title="Hierarchy options" type="button">&#9776;</button>' +
        '</div>' +
      '</div>' +
      '<div class="board-list lexera-shared-board-list"></div>';
    return root;
  }

  function createDashboardPanelElement(instanceId) {
    var root = document.createElement('div');
    root.className = 'sidebar-dashboard lexera-shared-panel lexera-shared-panel-dashboard';
    root.setAttribute('data-shared-panel-kind', 'dashboard');
    root.setAttribute('data-shared-panel-instance', instanceId);
    root.innerHTML =
      '<div class="sidebar-header sidebar-dashboard-header">' +
        '<button class="workspace-panel-drag-handle" type="button" title="Drag Dashboard view" data-ws-panel-drag-handle="' + instanceId + '" aria-label="Drag Dashboard view">&#8942;&#8942;</button>' +
        '<span>Dashboard</span>' +
      '</div>' +
      '<div class="sidebar-dashboard-controls">' +
        '<div class="dashboard-query-row">' +
          '<input class="dashboard-search-input lexera-shared-dashboard-search" type="text" placeholder="Search board content...">' +
          '<button class="sidebar-btn dashboard-search-btn lexera-shared-dashboard-search-btn" type="button" title="Run dashboard search">&#8981;</button>' +
        '</div>' +
        '<div class="dashboard-filter-row">' +
          '<div class="workspace-select-wrap dashboard-select-wrap">' +
            '<select class="dashboard-select lexera-shared-dashboard-scope" title="Search scope">' +
              '<option value="active">Active Board</option>' +
              '<option value="all">All Boards</option>' +
            '</select>' +
          '</div>' +
          '<button class="board-action-btn lexera-shared-dashboard-pin" type="button" title="Pin current dashboard query">Pin</button>' +
        '</div>' +
        '<div class="dashboard-quick-row">' +
          '<button class="board-action-btn dashboard-chip" data-dashboard-query="is:open due:overdue" type="button">Overdue</button>' +
          '<button class="board-action-btn dashboard-chip" data-dashboard-query="is:open due:today" type="button">Today</button>' +
          '<button class="board-action-btn dashboard-chip" data-dashboard-query="is:open due:week" type="button">Week</button>' +
          '<button class="board-action-btn dashboard-chip" data-dashboard-query="is:open #hidden-internal-parked" type="button">Parked</button>' +
        '</div>' +
      '</div>' +
      '<div class="sidebar-dashboard-body">' +
        '<div class="dashboard-group">' +
          '<div class="dashboard-group-header">Pinned Searches</div>' +
          '<div class="dashboard-list lexera-shared-dashboard-pinned"></div>' +
        '</div>' +
        '<div class="dashboard-group">' +
          '<div class="dashboard-group-header">Results</div>' +
          '<div class="dashboard-list lexera-shared-dashboard-results"></div>' +
        '</div>' +
        '<div class="dashboard-group">' +
          '<div class="dashboard-group-header">Tasks with Deadlines</div>' +
          '<div class="dashboard-list lexera-shared-dashboard-deadlines"></div>' +
        '</div>' +
        '<div class="dashboard-group">' +
          '<div class="dashboard-group-header">Overdue</div>' +
          '<div class="dashboard-list lexera-shared-dashboard-overdue"></div>' +
        '</div>' +
      '</div>';
    return root;
  }

  function createLogsPanelElement(instanceId) {
    var root = document.createElement('div');
    root.className = 'log-panel lexera-shared-panel lexera-shared-panel-logs';
    root.setAttribute('data-shared-panel-kind', 'logs');
    root.setAttribute('data-shared-panel-instance', instanceId);
    root.innerHTML =
      '<div class="log-panel-header">' +
        '<div class="log-panel-header-main">' +
          '<button class="workspace-panel-drag-handle" type="button" title="Drag Logs view" data-ws-panel-drag-handle="' + instanceId + '" aria-label="Drag Logs view">&#8942;&#8942;</button>' +
          '<span class="log-panel-title">Logs</span>' +
          '<div class="log-panel-tabs">' +
            '<button class="log-panel-tab lexera-shared-log-tab-backend active" type="button">Backend</button>' +
            '<button class="log-panel-tab lexera-shared-log-tab-frontend" type="button">Frontend</button>' +
          '</div>' +
        '</div>' +
        '<div class="log-panel-actions">' +
          '<button class="log-panel-btn lexera-shared-log-refresh" title="Reload backend logs" type="button">Reload</button>' +
          '<button class="log-panel-btn lexera-shared-log-copy" title="Copy logs to clipboard" type="button">Copy</button>' +
          '<button class="log-panel-btn lexera-shared-log-clear" title="Clear log" type="button">Clear</button>' +
          '<button class="log-panel-btn lexera-shared-log-close" title="Close log" type="button">&#10005;</button>' +
        '</div>' +
      '</div>' +
      '<div class="log-panel-body">' +
        '<div class="log-panel-main">' +
          '<div class="log-entries lexera-shared-log-entries-backend"></div>' +
          '<div class="log-entries lexera-shared-log-entries-frontend hidden"></div>' +
          '<div class="log-entries lexera-shared-log-entries-stats hidden"></div>' +
        '</div>' +
      '</div>';
    return root;
  }

  function createPanelElement(kind, instanceId) {
    if (kind === 'hierarchy') return createHierarchyPanelElement(instanceId);
    if (kind === 'dashboard') return createDashboardPanelElement(instanceId);
    if (kind === 'logs') return createLogsPanelElement(instanceId);
    return null;
  }

  function registerInstance(kind, instanceId, element) {
    if (!DUPLICABLE_PANEL_KINDS[kind] || !instanceId || !element) return null;
    instancesByKind[kind][instanceId] = element;
    return element;
  }

  function unregisterInstance(instanceId) {
    if (!instanceId) return;
    var kinds = Object.keys(instancesByKind);
    for (var i = 0; i < kinds.length; i++) {
      if (instancesByKind[kinds[i]][instanceId]) {
        delete instancesByKind[kinds[i]][instanceId];
        return;
      }
    }
  }

  function getRoots(kind) {
    if (!DUPLICABLE_PANEL_KINDS[kind]) return [];
    return Object.keys(instancesByKind[kind]).map(function (instanceId) {
      return instancesByKind[kind][instanceId];
    }).filter(Boolean);
  }

  window.LexeraSharedPanels = {
    isDuplicableKind: function (kind) {
      return !!DUPLICABLE_PANEL_KINDS[kind];
    },
    createPanelElement: function (kind, instanceId) {
      var element = createPanelElement(kind, instanceId);
      if (!element) return null;
      registerInstance(kind, instanceId, element);
      if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('lexera-shared-panel-created', {
          detail: { kind: kind, instanceId: instanceId }
        }));
      }
      return element;
    },
    unregisterInstance: unregisterInstance,
    getRoots: getRoots
  };
})();
