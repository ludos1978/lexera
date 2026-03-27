(function () {
  'use strict';
  var DUPLICABLE_PANEL_KINDS = {
    hierarchy: true,
    dashboard: true,
    logs: true,
    backendSettings: true,
    frontendSettings: true,
    renderApps: true,
    files: true
  };

  var instancesByKind = {
    hierarchy: {},
    dashboard: {},
    logs: {},
    backendSettings: {},
    frontendSettings: {},
    renderApps: {},
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
          '<button class="board-action-btn dashboard-chip" data-dashboard-query="is:open due:overdue" type="button"><span class="chip-icon">!!</span>Overdue</button>' +
          '<button class="board-action-btn dashboard-chip" data-dashboard-query="is:open due:today" type="button"><span class="chip-icon">&#9679;</span>Today</button>' +
          '<button class="board-action-btn dashboard-chip" data-dashboard-query="is:open due:week" type="button"><span class="chip-icon">&#9670;</span>Week</button>' +
          '<button class="board-action-btn dashboard-chip" data-dashboard-query="is:open #hidden-internal-parked" type="button"><span class="chip-icon">&#9646;</span>Parked</button>' +
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
          '<div class="dashboard-group-header">Overdue</div>' +
          '<div class="dashboard-list lexera-shared-dashboard-overdue"></div>' +
        '</div>' +
        '<div class="dashboard-group">' +
          '<div class="dashboard-group-header">Today</div>' +
          '<div class="dashboard-list lexera-shared-dashboard-today"></div>' +
        '</div>' +
        '<div class="dashboard-group">' +
          '<div class="dashboard-group-header">This Week</div>' +
          '<div class="dashboard-list lexera-shared-dashboard-thisweek"></div>' +
        '</div>' +
        '<div class="dashboard-group">' +
          '<div class="dashboard-group-header">Upcoming</div>' +
          '<div class="dashboard-list lexera-shared-dashboard-upcoming"></div>' +
        '</div>' +
        '<div class="dashboard-group">' +
          '<div class="dashboard-group-header">Later</div>' +
          '<div class="dashboard-list lexera-shared-dashboard-later"></div>' +
        '</div>' +
        '<div class="dashboard-group">' +
          '<div class="dashboard-group-header">Open Tasks</div>' +
          '<div class="dashboard-list lexera-shared-dashboard-todos"></div>' +
        '</div>' +
        '<div class="dashboard-group">' +
          '<div class="dashboard-group-header">Tagged Items</div>' +
          '<div class="dashboard-list lexera-shared-dashboard-tagged"></div>' +
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
        // Appearance
        '<div class="mgmt-section" data-frontend-settings-section="appearance">' +
          '<div class="mgmt-section-title">Appearance</div>' +
          '<div class="mgmt-field-row">' +
            '<label class="mgmt-field-label">Color Theme</label>' +
            '<select class="mgmt-field-input lexera-shared-frontend-settings-theme-select"></select>' +
          '</div>' +
          '<div class="mgmt-field-row">' +
            '<label class="mgmt-field-label">Visual Theme</label>' +
            '<select class="mgmt-field-input lexera-shared-frontend-settings-visual-theme"></select>' +
          '</div>' +
          '<div class="mgmt-field-row">' +
            '<label class="mgmt-field-label">UI Scale</label>' +
            '<select class="mgmt-field-input lexera-shared-frontend-settings-ui-scale">' +
              '<option value="0.75">75%</option><option value="0.85">85%</option>' +
              '<option value="0.95">95%</option><option value="1">100%</option>' +
              '<option value="1.1">110%</option><option value="1.25">125%</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
        // Interaction
        '<div class="mgmt-section" data-frontend-settings-section="interaction">' +
          '<div class="mgmt-section-title">Interaction</div>' +
          '<div class="mgmt-field-row">' +
            '<label class="mgmt-field-label">Scroll Speed</label>' +
            '<select class="mgmt-field-input lexera-shared-frontend-settings-scroll-speed">' +
              '<option value="0.1">10%</option>' +
              '<option value="0.32">32%</option>' +
              '<option value="0.56">56%</option>' +
              '<option value="1">100% (default)</option>' +
              '<option value="1.33">133%</option>' +
              '<option value="2">200%</option>' +
              '<option value="3">300%</option>' +
            '</select>' +
          '</div>' +
          '<div class="mgmt-field-row">' +
            '<label class="mgmt-field-label">Zoom Speed</label>' +
            '<select class="mgmt-field-input lexera-shared-frontend-settings-zoom-speed">' +
              '<option value="0.01">1% (finest)</option>' +
              '<option value="0.02">2%</option>' +
              '<option value="0.03">3%</option>' +
              '<option value="0.06">6% (default)</option>' +
              '<option value="0.1">10%</option>' +
              '<option value="0.18">18%</option>' +
              '<option value="0.32">32%</option>' +
              '<option value="0.56">56%</option>' +
              '<option value="1">100%</option>' +
              '<option value="2">200% (fastest)</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
        // Display Defaults
        '<div class="mgmt-section" data-frontend-settings-section="display">' +
          '<div class="mgmt-section-title">Display</div>' +
          '<div class="mgmt-field-row">' +
            '<label class="mgmt-field-label">Tag Visibility</label>' +
            '<select class="mgmt-field-input lexera-shared-frontend-settings-tag-visibility">' +
              '<option value="all">All</option>' +
              '<option value="allexcludinglayout">All (excl. layout)</option>' +
              '<option value="customonly">Custom only</option>' +
              '<option value="mentionsonly">Mentions only</option>' +
              '<option value="dim">Dim</option>' +
              '<option value="none">None</option>' +
            '</select>' +
          '</div>' +
          '<div class="mgmt-field-row">' +
            '<label class="mgmt-field-label">HTML Comments</label>' +
            '<select class="mgmt-field-input lexera-shared-frontend-settings-html-comments">' +
              '<option value="hidden">Hidden</option>' +
              '<option value="text">Text</option>' +
              '<option value="dim">Dim</option>' +
            '</select>' +
          '</div>' +
          '<div class="mgmt-field-row">' +
            '<label class="mgmt-field-label">HTML Content</label>' +
            '<select class="mgmt-field-input lexera-shared-frontend-settings-html-content">' +
              '<option value="html">Render HTML</option>' +
              '<option value="text">Plain Text</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
        // Tag Groups
        '<div class="mgmt-section" data-frontend-settings-section="tag-groups">' +
          '<div class="mgmt-section-title">Tag Groups in Menus</div>' +
          '<div class="tag-group-row"><span class="tag-group-scope-label">Card</span><div class="lexera-shared-frontend-settings-tag-groups-card tag-group-chips"></div></div>' +
          '<div class="tag-group-row"><span class="tag-group-scope-label">Column</span><div class="lexera-shared-frontend-settings-tag-groups-column tag-group-chips"></div></div>' +
          '<div class="tag-group-row"><span class="tag-group-scope-label">Stack</span><div class="lexera-shared-frontend-settings-tag-groups-stack tag-group-chips"></div></div>' +
          '<div class="tag-group-row"><span class="tag-group-scope-label">Row</span><div class="lexera-shared-frontend-settings-tag-groups-row tag-group-chips"></div></div>' +
        '</div>' +
        // Editors
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
        // Hierarchy
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
      '</div>';
    return root;
  }

  function createRenderAppsPanelElement(instanceId) {
    var root = createPanelRoot('shell-settings-panel render-apps-settings-panel lexera-shared-panel lexera-shared-panel-render-apps', 'renderApps', instanceId);
    root.innerHTML =
      '<div class="shell-settings-header">' +
        '<span class="shell-settings-title">Render Applications</span>' +
      '</div>' +
      '<div class="shell-settings-body">' +
        '<div class="mgmt-section">' +
          '<div class="mgmt-section-title">Application Paths</div>' +
          '<p class="render-apps-description">Configure paths to external tools used for rendering and export. ' +
            'Leave empty to use automatic detection.</p>' +
          '<div class="mgmt-settings-grid render-apps-grid">' +
            '<label for="render-app-drawio">Draw.io</label>' +
            '<input class="mgmt-field-input lexera-shared-render-apps-drawio" id="render-app-drawio" type="text" placeholder="Auto-detect">' +
            '<label for="render-app-marp">Marp CLI</label>' +
            '<input class="mgmt-field-input lexera-shared-render-apps-marp" id="render-app-marp" type="text" placeholder="Auto-detect (npx or marp)">' +
            '<label for="render-app-pandoc">Pandoc</label>' +
            '<input class="mgmt-field-input lexera-shared-render-apps-pandoc" id="render-app-pandoc" type="text" placeholder="Auto-detect">' +
            '<label for="render-app-soffice">LibreOffice</label>' +
            '<input class="mgmt-field-input lexera-shared-render-apps-soffice" id="render-app-soffice" type="text" placeholder="Auto-detect">' +
            '<label for="render-app-pdftoppm">pdftoppm</label>' +
            '<input class="mgmt-field-input lexera-shared-render-apps-pdftoppm" id="render-app-pdftoppm" type="text" placeholder="Auto-detect">' +
            '<label for="render-app-mutool">mutool</label>' +
            '<input class="mgmt-field-input lexera-shared-render-apps-mutool" id="render-app-mutool" type="text" placeholder="Auto-detect">' +
          '</div>' +
          '<div class="mgmt-settings-actions">' +
            '<button class="mgmt-btn mgmt-btn-small lexera-shared-render-apps-reload" type="button">Reload</button>' +
            '<button class="mgmt-btn mgmt-btn-small mgmt-btn-primary lexera-shared-render-apps-save" type="button">Save</button>' +
          '</div>' +
          '<div class="mgmt-status lexera-shared-render-apps-status"></div>' +
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
    renderApps: createRenderAppsPanelElement,
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
