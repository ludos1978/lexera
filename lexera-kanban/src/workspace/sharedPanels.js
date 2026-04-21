(function () {
  'use strict';
  var DUPLICABLE_PANEL_KINDS = {
    hierarchy: true,
    dashboard: true,
    weekCalendar: true,
    monthCalendar: true,
    logs: true,
    backendSettings: true,
    frontendSettings: true,
    renderApps: true,
    files: true,
    frontendTests: true
  };

  var instancesByKind = {
    hierarchy: {},
    dashboard: {},
    weekCalendar: {},
    monthCalendar: {},
    logs: {},
    backendSettings: {},
    frontendSettings: {},
    renderApps: {},
    files: {},
    frontendTests: {}
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
        '<div class="sidebar-header-title lexera-shared-workspace-title" title="All Workspaces">All Workspaces</div>' +
        '<div class="sidebar-header-actions">' +
          '<button class="sidebar-btn lexera-shared-workspace-menu" title="Hierarchy options" type="button">&#9776;</button>' +
        '</div>' +
      '</div>' +
      '<div class="board-list lexera-shared-board-list view-loading"></div>';
    return root;
  }

  function _dashboardGroupHtml(key, title, listClass) {
    return '<div class="dashboard-group tree-entry" data-dashboard-group-key="' + key + '">' +
      '<div class="dashboard-group-header tree-node" data-tree-node-role="branch" data-tree-structural-role="section" aria-expanded="true">' +
        '<span class="tree-indent tree-indent-root" aria-hidden="true"></span>' +
        '<span class="dashboard-group-toggle tree-toggle expanded" aria-hidden="true"></span>' +
        '<span class="tree-label dashboard-group-title">' + title + '</span>' +
        '<span class="tree-meta"><span class="tree-meta-presence tree-meta-presence-spacer" aria-hidden="true"></span><span class="tree-count hidden"></span><span class="tree-meta-action tree-meta-action-spacer" aria-hidden="true"></span><span class="tree-grip tree-grip-spacer" aria-hidden="true"></span></span>' +
      '</div>' +
      '<div class="dashboard-list tree-children expanded ' + listClass + '" data-hierarchy-section-body="true"></div>' +
    '</div>';
  }

  function createDashboardPanelElement(instanceId) {
    var root = createPanelRoot('sidebar-dashboard lexera-shared-panel lexera-shared-panel-dashboard', 'dashboard', instanceId);
    root.innerHTML =
      '<div class="sidebar-dashboard-controls">' +
        '<div class="dashboard-query-row">' +
          '<input class="dashboard-search-input lexera-shared-dashboard-search" type="text" placeholder="Search board content...">' +
        '</div>' +
        '<div class="dashboard-filter-row">' +
          '<button class="sidebar-btn dashboard-search-btn lexera-shared-dashboard-search-btn" type="button" title="Run dashboard search">&#8981;</button>' +
          '<label class="dashboard-scope-label" title="Search all boards instead of only the active board"><input class="dashboard-scope-checkbox lexera-shared-dashboard-scope" type="checkbox" title="Search all boards">All Boards</label>' +
          '<button class="board-action-btn lexera-shared-dashboard-pin" type="button" title="Pin current dashboard query">Pin</button>' +
        '</div>' +
      '</div>' +
      '<div class="sidebar-dashboard-body view-loading">' +
        _dashboardGroupHtml('results', 'Results', 'lexera-shared-dashboard-results') +
        _dashboardGroupHtml('pinned', 'Pinned Searches', 'lexera-shared-dashboard-pinned') +
        _dashboardGroupHtml('overdue', 'Overdue', 'lexera-shared-dashboard-overdue') +
        _dashboardGroupHtml('upcoming', 'Upcoming', 'lexera-shared-dashboard-upcoming') +
        _dashboardGroupHtml('open-tasks', 'Open Tasks', 'lexera-shared-dashboard-todos') +
        _dashboardGroupHtml('tagged', 'Tagged Items', 'lexera-shared-dashboard-tagged') +
        _dashboardGroupHtml('file-embeds', 'File Embeds', 'lexera-shared-dashboard-embeds') +
        _dashboardGroupHtml('broken-elements', 'Broken Elements', 'lexera-shared-dashboard-broken') +
        _dashboardGroupHtml('included-files', 'Included Files', 'lexera-shared-dashboard-included') +
      '</div>';
    return root;
  }

  function createLogsPanelElement(instanceId) {
    var root = createPanelRoot('log-panel lexera-shared-panel lexera-shared-panel-logs', 'logs', instanceId);
    root.innerHTML =
      '<div class="log-panel-header">' +
        '<div class="log-panel-header-main">' +
          '<span class="log-panel-title">Logs</span>' +
          '<div class="log-panel-source-dropdown">' +
            '<button class="log-panel-tab lexera-shared-log-source-btn" type="button" aria-haspopup="true" aria-expanded="false" title="Filter log sources">' +
              '<span class="lexera-shared-log-source-label">Sources</span>' +
              '<span class="log-panel-source-caret" aria-hidden="true">&#9662;</span>' +
            '</button>' +
            '<button class="log-panel-filter-clear lexera-shared-log-source-clear hidden" type="button" title="Show all sources" aria-label="Show all sources">&times;</button>' +
            '<div class="log-panel-source-menu lexera-shared-log-source-menu hidden" role="menu"></div>' +
          '</div>' +
          '<div class="log-panel-source-dropdown">' +
            '<button class="log-panel-tab lexera-shared-log-level-btn" type="button" aria-haspopup="true" aria-expanded="false" title="Filter log levels">' +
              '<span class="lexera-shared-log-level-label">Levels</span>' +
              '<span class="log-panel-source-caret" aria-hidden="true">&#9662;</span>' +
            '</button>' +
            '<button class="log-panel-filter-clear lexera-shared-log-level-clear hidden" type="button" title="Show all levels" aria-label="Show all levels">&times;</button>' +
            '<div class="log-panel-source-menu lexera-shared-log-level-menu hidden" role="menu"></div>' +
          '</div>' +
          '<div class="log-panel-search-wrap">' +
            '<input class="log-panel-search lexera-shared-log-search" type="text" placeholder="Filter..." aria-label="Filter log entries by text" autocomplete="off" spellcheck="false" />' +
            '<button class="log-panel-filter-clear log-panel-search-clear lexera-shared-log-search-clear hidden" type="button" title="Clear search filter" aria-label="Clear search filter">&times;</button>' +
          '</div>' +
        '</div>' +
        '<div class="log-panel-actions">' +
          '<button class="log-panel-status-btn connection-status-btn disconnected" type="button" title="Backend disconnected" aria-label="Backend disconnected">' +
            '<span class="connection-dot" aria-hidden="true"></span>' +
            '<span class="connection-status-label">Disconnected</span>' +
          '</button>' +
          '<button class="log-panel-btn lexera-shared-log-refresh" title="Reload backend logs" type="button">Reload</button>' +
          '<button class="log-panel-btn lexera-shared-log-copy" title="Copy visible logs to clipboard" type="button">Copy</button>' +
          '<button class="log-panel-btn lexera-shared-log-clear" title="Clear log" type="button">Clear</button>' +
        '</div>' +
      '</div>' +
      '<div class="log-panel-status">' +
        '<span class="status-msg"></span>' +
      '</div>' +
      '<div class="log-panel-body">' +
        '<div class="log-panel-main view-loading">' +
          '<div class="log-entries lexera-shared-log-entries"></div>' +
          '<div class="log-entries lexera-shared-log-entries-stats hidden"></div>' +
        '</div>' +
      '</div>';
    return root;
  }

  function createBackendSettingsPanelElement(instanceId) {
    var root = createPanelRoot('shell-settings-panel lexera-shared-panel lexera-shared-panel-backend-settings', 'backendSettings', instanceId);
    root.innerHTML =
      '<div class="shell-settings-container lexera-shared-backend-settings-container view-loading"></div>';
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
        // Controls (placed early so users find it without scrolling)
        '<div class="mgmt-section" data-frontend-settings-section="controls">' +
          '<div class="mgmt-section-title">Controls</div>' +
          '<div class="controls-settings-group" data-controls-mode="kanban">' +
            '<div class="controls-settings-mode-label">Kanban Mode</div>' +
            '<div class="controls-settings-action" data-controls-action="move">' +
              '<span class="controls-settings-action-label">Move View</span>' +
              '<div class="controls-settings-chips lexera-shared-controls-chips"></div>' +
              '<button class="controls-settings-add mgmt-btn mgmt-btn-small" type="button" data-controls-add="true" title="Add binding">+</button>' +
            '</div>' +
            '<div class="controls-settings-action" data-controls-action="zoom">' +
              '<span class="controls-settings-action-label">Zoom View</span>' +
              '<div class="controls-settings-chips lexera-shared-controls-chips"></div>' +
              '<button class="controls-settings-add mgmt-btn mgmt-btn-small" type="button" data-controls-add="true" title="Add binding">+</button>' +
            '</div>' +
            '<div class="controls-settings-action" data-controls-action="edit">' +
              '<span class="controls-settings-action-label">Edit Field</span>' +
              '<div class="controls-settings-chips lexera-shared-controls-chips"></div>' +
              '<button class="controls-settings-add mgmt-btn mgmt-btn-small" type="button" data-controls-add="true" title="Add binding">+</button>' +
            '</div>' +
            '<div class="controls-settings-action" data-controls-action="enter">' +
              '<span class="controls-settings-action-label">Enter / Drill In</span>' +
              '<div class="controls-settings-chips lexera-shared-controls-chips"></div>' +
              '<button class="controls-settings-add mgmt-btn mgmt-btn-small" type="button" data-controls-add="true" title="Add binding">+</button>' +
            '</div>' +
            '<div class="controls-settings-action" data-controls-action="drag-card">' +
              '<span class="controls-settings-action-label">Drag Card</span>' +
              '<div class="controls-settings-chips lexera-shared-controls-chips"></div>' +
              '<button class="controls-settings-add mgmt-btn mgmt-btn-small" type="button" data-controls-add="true" title="Add binding">+</button>' +
            '</div>' +
            '<div class="controls-settings-action" data-controls-action="drag-column">' +
              '<span class="controls-settings-action-label">Drag Column</span>' +
              '<div class="controls-settings-chips lexera-shared-controls-chips"></div>' +
              '<button class="controls-settings-add mgmt-btn mgmt-btn-small" type="button" data-controls-add="true" title="Add binding">+</button>' +
            '</div>' +
            '<div class="controls-settings-action" data-controls-action="drag-stack">' +
              '<span class="controls-settings-action-label">Drag Stack</span>' +
              '<div class="controls-settings-chips lexera-shared-controls-chips"></div>' +
              '<button class="controls-settings-add mgmt-btn mgmt-btn-small" type="button" data-controls-add="true" title="Add binding">+</button>' +
            '</div>' +
            '<div class="controls-settings-action" data-controls-action="drag-row">' +
              '<span class="controls-settings-action-label">Drag Row</span>' +
              '<div class="controls-settings-chips lexera-shared-controls-chips"></div>' +
              '<button class="controls-settings-add mgmt-btn mgmt-btn-small" type="button" data-controls-add="true" title="Add binding">+</button>' +
            '</div>' +
          '</div>' +
          '<div class="controls-settings-group" data-controls-mode="canvas">' +
            '<div class="controls-settings-mode-label">Canvas Mode</div>' +
            '<div class="controls-settings-action" data-controls-action="move">' +
              '<span class="controls-settings-action-label">Move View</span>' +
              '<div class="controls-settings-chips lexera-shared-controls-chips"></div>' +
              '<button class="controls-settings-add mgmt-btn mgmt-btn-small" type="button" data-controls-add="true" title="Add binding">+</button>' +
            '</div>' +
            '<div class="controls-settings-action" data-controls-action="zoom">' +
              '<span class="controls-settings-action-label">Zoom View</span>' +
              '<div class="controls-settings-chips lexera-shared-controls-chips"></div>' +
              '<button class="controls-settings-add mgmt-btn mgmt-btn-small" type="button" data-controls-add="true" title="Add binding">+</button>' +
            '</div>' +
            '<div class="controls-settings-action" data-controls-action="edit">' +
              '<span class="controls-settings-action-label">Edit Field</span>' +
              '<div class="controls-settings-chips lexera-shared-controls-chips"></div>' +
              '<button class="controls-settings-add mgmt-btn mgmt-btn-small" type="button" data-controls-add="true" title="Add binding">+</button>' +
            '</div>' +
            '<div class="controls-settings-action" data-controls-action="enter">' +
              '<span class="controls-settings-action-label">Enter / Drill In</span>' +
              '<div class="controls-settings-chips lexera-shared-controls-chips"></div>' +
              '<button class="controls-settings-add mgmt-btn mgmt-btn-small" type="button" data-controls-add="true" title="Add binding">+</button>' +
            '</div>' +
            '<div class="controls-settings-action" data-controls-action="drag-card">' +
              '<span class="controls-settings-action-label">Drag Card</span>' +
              '<div class="controls-settings-chips lexera-shared-controls-chips"></div>' +
              '<button class="controls-settings-add mgmt-btn mgmt-btn-small" type="button" data-controls-add="true" title="Add binding">+</button>' +
            '</div>' +
            '<div class="controls-settings-action" data-controls-action="drag-column">' +
              '<span class="controls-settings-action-label">Drag Column</span>' +
              '<div class="controls-settings-chips lexera-shared-controls-chips"></div>' +
              '<button class="controls-settings-add mgmt-btn mgmt-btn-small" type="button" data-controls-add="true" title="Add binding">+</button>' +
            '</div>' +
            '<div class="controls-settings-action" data-controls-action="drag-stack">' +
              '<span class="controls-settings-action-label">Drag Stack</span>' +
              '<div class="controls-settings-chips lexera-shared-controls-chips"></div>' +
              '<button class="controls-settings-add mgmt-btn mgmt-btn-small" type="button" data-controls-add="true" title="Add binding">+</button>' +
            '</div>' +
            '<div class="controls-settings-action" data-controls-action="drag-row">' +
              '<span class="controls-settings-action-label">Drag Row</span>' +
              '<div class="controls-settings-chips lexera-shared-controls-chips"></div>' +
              '<button class="controls-settings-add mgmt-btn mgmt-btn-small" type="button" data-controls-add="true" title="Add binding">+</button>' +
            '</div>' +
          '</div>' +
          '<button class="controls-settings-reset mgmt-btn mgmt-btn-small" type="button" data-controls-reset="true">Reset to Defaults</button>' +
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
          '<label class="frontend-settings-toggle">' +
            '<input class="lexera-shared-frontend-settings-sidebar-menus" type="checkbox">' +
            '<span>Burger menus</span>' +
          '</label>' +
        '</div>' +
      '</div>';
    return root;
  }

  function createRenderAppsPanelElement(instanceId) {
    var root = createPanelRoot('shell-settings-panel render-apps-settings-panel lexera-shared-panel lexera-shared-panel-render-apps', 'renderApps', instanceId);
    root.innerHTML =
      '<div class="shell-settings-header">' +
        '<span class="shell-settings-title">Plugin Settings</span>' +
      '</div>' +
      '<div class="shell-settings-body">' +
        '<div class="mgmt-section">' +
          '<div class="mgmt-section-title">Application Paths</div>' +
          '<p class="render-apps-description">Configure paths to external tools used for rendering and export. ' +
            'Leave empty to use automatic detection.</p>' +
          '<div class="mgmt-settings-grid render-apps-grid">' +
            '<label for="render-app-drawio">Draw.io</label>' +
            '<input class="mgmt-field-input lexera-shared-render-apps-drawio" id="render-app-drawio" type="text" placeholder="Auto-detect">' +
            '<span class="render-apps-indicator lexera-shared-render-apps-indicator-drawio" aria-live="polite"></span>' +
            '<label for="render-app-marp">Marp CLI</label>' +
            '<input class="mgmt-field-input lexera-shared-render-apps-marp" id="render-app-marp" type="text" placeholder="Auto-detect (npx or marp)">' +
            '<span class="render-apps-indicator lexera-shared-render-apps-indicator-marp" aria-live="polite"></span>' +
            '<label for="render-app-pandoc">Pandoc</label>' +
            '<input class="mgmt-field-input lexera-shared-render-apps-pandoc" id="render-app-pandoc" type="text" placeholder="Auto-detect">' +
            '<span class="render-apps-indicator lexera-shared-render-apps-indicator-pandoc" aria-live="polite"></span>' +
            '<label for="render-app-soffice">LibreOffice</label>' +
            '<input class="mgmt-field-input lexera-shared-render-apps-soffice" id="render-app-soffice" type="text" placeholder="Auto-detect">' +
            '<span class="render-apps-indicator lexera-shared-render-apps-indicator-soffice" aria-live="polite"></span>' +
            '<label for="render-app-pdftoppm">pdftoppm</label>' +
            '<input class="mgmt-field-input lexera-shared-render-apps-pdftoppm" id="render-app-pdftoppm" type="text" placeholder="Auto-detect">' +
            '<span class="render-apps-indicator lexera-shared-render-apps-indicator-pdftoppm" aria-live="polite"></span>' +
            '<label for="render-app-mutool">mutool</label>' +
            '<input class="mgmt-field-input lexera-shared-render-apps-mutool" id="render-app-mutool" type="text" placeholder="Auto-detect">' +
            '<span class="render-apps-indicator lexera-shared-render-apps-indicator-mutool" aria-live="polite"></span>' +
          '</div>' +
        '</div>' +
        '<div class="mgmt-section">' +
          '<div class="mgmt-section-title">Marp Plugin</div>' +
          '<p class="render-apps-description">Override the bundled Marp engine with a custom <code>engine.js</code>, ' +
            'and/or point Marp at a folder of custom theme CSS files.</p>' +
          '<div class="mgmt-settings-grid render-apps-grid">' +
            '<label for="render-app-marp-engine-path">Custom engine.js</label>' +
            '<input class="mgmt-field-input lexera-shared-render-apps-marpEnginePath" id="render-app-marp-engine-path" type="text" placeholder="Leave empty to use bundled engine.js">' +
            '<button class="mgmt-btn mgmt-btn-small lexera-shared-render-apps-marpEnginePath-browse" type="button" title="Browse for a JS file">Browse\u2026</button>' +
            '<label for="render-app-marp-templates-path">Templates folder</label>' +
            '<input class="mgmt-field-input lexera-shared-render-apps-marpTemplatesPath" id="render-app-marp-templates-path" type="text" placeholder="Directory containing .css theme templates">' +
            '<button class="mgmt-btn mgmt-btn-small lexera-shared-render-apps-marpTemplatesPath-browse" type="button" title="Browse for a folder">Browse\u2026</button>' +
          '</div>' +
          '<div class="render-apps-themes-section">' +
            '<div class="render-apps-themes-header">' +
              '<span class="render-apps-themes-label">Discovered themes</span>' +
              '<button class="mgmt-btn mgmt-btn-small lexera-shared-render-apps-themes-refresh" type="button" title="Re-scan the templates folder">Refresh</button>' +
            '</div>' +
            '<div class="render-apps-themes lexera-shared-render-apps-themes"></div>' +
          '</div>' +
        '</div>' +
        '<div class="mgmt-section">' +
          '<div class="render-apps-tool-status lexera-shared-render-apps-tool-status"></div>' +
          '<div class="mgmt-settings-actions">' +
            '<button class="mgmt-btn mgmt-btn-small lexera-shared-render-apps-test" type="button" title="Run --version on each tool">Test Version</button>' +
            '<button class="mgmt-btn mgmt-btn-small lexera-shared-render-apps-test-run" type="button" title="Run a minimal end-to-end render with each tool (slower)">Test Run</button>' +
            '<button class="mgmt-btn mgmt-btn-small lexera-shared-render-apps-reload" type="button">Reload</button>' +
            '<button class="mgmt-btn mgmt-btn-small mgmt-btn-primary lexera-shared-render-apps-save" type="button">Save</button>' +
          '</div>' +
          '<div class="mgmt-status lexera-shared-render-apps-status"></div>' +
        '</div>' +
      '</div>';
    return root;
  }

  function createWeekCalendarPanelElement(instanceId) {
    var root = createPanelRoot('calendar-panel lexera-shared-panel lexera-shared-panel-week-calendar', 'weekCalendar', instanceId);
    root.innerHTML =
      '<div class="calendar-panel-header">' +
        '<span class="calendar-panel-title">Week Calendar</span>' +
        '<div class="calendar-panel-controls">' +
          '<div class="workspace-select-wrap calendar-scope-wrap">' +
            '<select class="calendar-scope-select lexera-shared-calendar-scope" title="Calendar scope">' +
              '<option value="active">Active Board</option>' +
              '<option value="all">All Boards</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="calendar-panel-body view-loading">' +
        '<div class="dashboard-calendar lexera-shared-calendar-week-view"></div>' +
        '<div class="dashboard-list lexera-shared-calendar-task-list"></div>' +
      '</div>';
    return root;
  }

  function createMonthCalendarPanelElement(instanceId) {
    var root = createPanelRoot('calendar-panel lexera-shared-panel lexera-shared-panel-month-calendar', 'monthCalendar', instanceId);
    root.innerHTML =
      '<div class="calendar-panel-header">' +
        '<span class="calendar-panel-title">Month Calendar</span>' +
        '<div class="calendar-panel-controls">' +
          '<div class="workspace-select-wrap calendar-scope-wrap">' +
            '<select class="calendar-scope-select lexera-shared-calendar-scope" title="Calendar scope">' +
              '<option value="active">Active Board</option>' +
              '<option value="all">All Boards</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="calendar-panel-body view-loading">' +
        '<div class="dashboard-calendar lexera-shared-calendar-month-view"></div>' +
        '<div class="dashboard-list lexera-shared-calendar-task-list"></div>' +
      '</div>';
    return root;
  }

  function createFilesPanelElement(instanceId) {
    var root = createPanelRoot('shell-settings-panel lexera-shared-panel lexera-shared-panel-files', 'files', instanceId);
    root.innerHTML =
      '<div class="shell-settings-container lexera-shared-files-container view-loading"></div>';
    return root;
  }

  function createFrontendTestsPanelElement(instanceId) {
    var root = createPanelRoot('test-panel lexera-shared-panel lexera-shared-panel-frontend-tests', 'frontendTests', instanceId);
    root.innerHTML =
      '<div class="test-panel-header">' +
        '<div class="test-panel-actions">' +
          '<div class="test-panel-action-group test-panel-action-group-run">' +
            '<select class="test-panel-board-select lexera-shared-test-board-select" title="Board to test"></select>' +
            '<input class="test-panel-filter lexera-shared-test-filter" type="search" placeholder="Search tests or categories\u2026" title="Search by test name or category (substring match)" />' +
            '<span class="test-panel-control-cluster" aria-label="Category controls">' +
              '<button class="test-panel-btn lexera-shared-test-expand-all" type="button" title="Expand all categories">Expand All</button>' +
              '<button class="test-panel-btn lexera-shared-test-collapse-all" type="button" title="Collapse all categories">Collapse All</button>' +
            '</span>' +
            '<span class="test-panel-control-cluster test-panel-run-controls" aria-label="Run controls">' +
              '<button class="test-panel-btn lexera-shared-test-run-all" type="button">Run All</button>' +
              '<button class="test-panel-btn test-panel-btn-stop lexera-shared-test-stop" type="button">Stop Run</button>' +
              '<button class="test-panel-btn lexera-shared-test-clear-results" type="button" title="Clear all result indicators, durations, and errors">Clear Results</button>' +
            '</span>' +
            '<span class="test-panel-control-cluster test-panel-restore-controls">' +
              '<label class="test-panel-restore-toggle" title="Pause after each test mutation, before the harness restores the snapshot. This is not app undo or Ctrl+Z.">' +
                '<input class="lexera-shared-test-manual-inspect" type="checkbox"> Pause after Do' +
              '</label>' +
              '<button class="test-panel-btn lexera-shared-test-continue-undo" type="button" title="Restore the test snapshot and continue. This is not Ctrl+Z." disabled>Restore Snapshot</button>' +
            '</span>' +
          '</div>' +
          '<div class="test-panel-action-group test-panel-action-group-copy">' +
            '<select class="test-panel-copy-scope lexera-shared-test-copy-scope" title="Copy scope">' +
              '<option value="all">All Results</option>' +
              '<option value="errors">Only Errors</option>' +
              '<option value="errors-with-logs">Errors + FE/BE Logs</option>' +
            '</select>' +
            '<button class="test-panel-btn lexera-shared-test-copy" type="button">Copy</button>' +
            '<span class="test-panel-copy-feedback lexera-shared-test-copy-feedback" aria-live="polite"></span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="test-panel-summary lexera-shared-test-summary"></div>' +
      '<div class="test-panel-body lexera-shared-test-list"></div>';
    return root;
  }

  var PANEL_FACTORIES = {
    hierarchy: createHierarchyPanelElement,
    dashboard: createDashboardPanelElement,
    weekCalendar: createWeekCalendarPanelElement,
    monthCalendar: createMonthCalendarPanelElement,
    logs: createLogsPanelElement,
    backendSettings: createBackendSettingsPanelElement,
    frontendSettings: createFrontendSettingsPanelElement,
    renderApps: createRenderAppsPanelElement,
    files: createFilesPanelElement,
    frontendTests: createFrontendTestsPanelElement
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
