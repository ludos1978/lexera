(function () {
  var DUPLICABLE_PANEL_KINDS = {
    hierarchy: true,
    dashboard: true,
    logs: true,
    backendSettings: true,
    frontendSettings: true,
    files: true
  };

  var instancesByKind = {
    hierarchy: {},
    dashboard: {},
    logs: {},
    backendSettings: {},
    frontendSettings: {},
    files: {}
  };

  function createPanelRoot(className, kind, instanceId) {
    var root = document.createElement('div');
    root.className = className;
    root.setAttribute('data-shared-panel-kind', kind);
    root.setAttribute('data-shared-panel-instance', instanceId);
    return root;
  }

  function createHierarchyPanelElement(instanceId) {
    var root = createPanelRoot('sidebar lexera-shared-panel lexera-shared-panel-hierarchy', 'hierarchy', instanceId);
    root.innerHTML =
      '<div class="sidebar-header">' +
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
    var root = createPanelRoot('sidebar-dashboard lexera-shared-panel lexera-shared-panel-dashboard', 'dashboard', instanceId);
    root.innerHTML =
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
    var root = createPanelRoot('log-panel lexera-shared-panel lexera-shared-panel-logs', 'logs', instanceId);
    root.innerHTML =
      '<div class="log-panel-header">' +
        '<div class="log-panel-header-main">' +
          '<span class="log-panel-title">Logs</span>' +
          '<div class="log-panel-tabs">' +
            '<button class="log-panel-tab lexera-shared-log-tab-backend active" type="button">Backend</button>' +
            '<button class="log-panel-tab lexera-shared-log-tab-frontend" type="button">Frontend</button>' +
            '<button class="log-panel-tab lexera-shared-log-tab-stats" type="button">Stats</button>' +
          '</div>' +
        '</div>' +
        '<div class="log-panel-actions">' +
          '<button class="log-panel-btn lexera-shared-log-refresh" title="Reload backend logs" type="button">Reload</button>' +
          '<button class="log-panel-btn lexera-shared-log-copy" title="Copy logs to clipboard" type="button">Copy</button>' +
          '<button class="log-panel-btn lexera-shared-log-clear" title="Clear log" type="button">Clear</button>' +
        '</div>' +
      '</div>' +
      '<div class="log-panel-status">' +
        '<span id="status-msg" class="status-msg"></span>' +
        '<button id="btn-connection-status" class="log-panel-status-btn connection-status-btn disconnected" type="button" title="Backend disconnected. Open backend settings" aria-label="Backend disconnected. Open backend settings">' +
          '<span id="connection-dot" class="connection-dot" aria-hidden="true"></span>' +
          '<span class="connection-status-label">Disconnected</span>' +
        '</button>' +
        '<button id="btn-inspector" class="log-panel-status-btn" type="button" title="Open Inspector (F12 / Ctrl+Shift+I / Alt+I)">&lt;&gt;</button>' +
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

  function createBackendSettingsPanelElement(instanceId) {
    var root = createPanelRoot('shell-settings-panel lexera-shared-panel lexera-shared-panel-backend-settings', 'backendSettings', instanceId);
    root.innerHTML =
      '<div class="shell-settings-container lexera-shared-backend-settings-container"></div>';
    return root;
  }

  function createFrontendSettingsPanelElement(instanceId) {
    var root = createPanelRoot('shell-settings-panel frontend-settings-panel lexera-shared-panel lexera-shared-panel-frontend-settings', 'frontendSettings', instanceId);
    root.innerHTML =
      '<div class="shell-settings-header">' +
        '<span class="shell-settings-title">Frontend Settings</span>' +
      '</div>' +
      '<div class="shell-settings-body">' +
        '<div class="mgmt-section" data-frontend-settings-section="theme">' +
          '<div class="mgmt-section-title">Theme</div>' +
          '<div class="mgmt-field-row">' +
            '<label class="mgmt-field-label">Theme</label>' +
            '<select class="mgmt-field-input lexera-shared-frontend-settings-theme-select"></select>' +
          '</div>' +
        '</div>' +
        '<div class="mgmt-section" data-frontend-settings-section="editors">' +
          '<div class="mgmt-section-title">Editors</div>' +
          '<label class="frontend-settings-toggle">' +
            '<input class="lexera-shared-frontend-settings-overlay-editor" type="checkbox">' +
            '<span>Overlay editor</span>' +
          '</label>' +
          '<label class="frontend-settings-toggle">' +
            '<input class="lexera-shared-frontend-settings-wysiwyg-editor" type="checkbox">' +
            '<span>WYSIWYG editor</span>' +
          '</label>' +
          '<label class="frontend-settings-toggle">' +
            '<input class="lexera-shared-frontend-settings-marp-settings" type="checkbox">' +
            '<span>Show Marp settings</span>' +
          '</label>' +
          '<label class="frontend-settings-toggle">' +
            '<input class="lexera-shared-frontend-settings-special-chars" type="checkbox">' +
            '<span>Show special characters</span>' +
          '</label>' +
        '</div>' +
        '<div class="mgmt-section" data-frontend-settings-section="hierarchy">' +
          '<div class="mgmt-section-title">Hierarchy</div>' +
          '<label class="frontend-settings-toggle">' +
            '<input class="lexera-shared-frontend-settings-sidebar-counts" type="checkbox">' +
            '<span>Counts</span>' +
          '</label>' +
          '<label class="frontend-settings-toggle">' +
            '<input class="lexera-shared-frontend-settings-sidebar-presence" type="checkbox">' +
            '<span>Presence badges</span>' +
          '</label>' +
          '<label class="frontend-settings-toggle">' +
            '<input class="lexera-shared-frontend-settings-sidebar-grips" type="checkbox">' +
            '<span>Drag icons</span>' +
          '</label>' +
        '</div>' +
        '<div class="mgmt-section" data-frontend-settings-section="debug">' +
          '<div class="mgmt-section-title">Diagnostics</div>' +
          '<div class="mgmt-field-row">' +
            '<button class="mgmt-btn mgmt-btn-small lexera-shared-frontend-settings-open-inspector" type="button">Open Inspector</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    return root;
  }

  function createFilesPanelElement(instanceId) {
    var root = createPanelRoot('shell-settings-panel lexera-shared-panel lexera-shared-panel-files', 'files', instanceId);
    root.innerHTML =
      '<div class="shell-settings-container lexera-shared-files-container"></div>';
    return root;
  }

  var PANEL_FACTORIES = {
    hierarchy: createHierarchyPanelElement,
    dashboard: createDashboardPanelElement,
    logs: createLogsPanelElement,
    backendSettings: createBackendSettingsPanelElement,
    frontendSettings: createFrontendSettingsPanelElement,
    files: createFilesPanelElement
  };

  function createPanelElement(kind, instanceId) {
    var factory = PANEL_FACTORIES[kind];
    return factory ? factory(instanceId) : null;
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
          detail: { kind: kind, instanceId: instanceId, element: element }
        }));
      }
      return element;
    },
    unregisterInstance: unregisterInstance,
    getRoots: getRoots
  };
})();
