/**
 * LexeraTemplates — Template system for entity creation.
 * Provides template loading, parsing, variable processing, dialog, and entity builders.
 * Communicates with backend via LexeraApi and returns built entities for app.js to insert.
 */
const LexeraTemplates = (function () {

  // ── Cache ──────────────────────────────────────────────────────────────

  var templateCache = null; // array of TemplateSummary from backend

  // ── API: Load & Query ──────────────────────────────────────────────────

  /**
   * Fetch template list from backend, cache it.
   */
  async function loadTemplates() {
    try {
      var list = await LexeraApi.request('/templates');
      templateCache = Array.isArray(list) ? list : [];
    } catch (e) {
      templateCache = [];
    }
    return templateCache;
  }

  /**
   * Return cached templates filtered by entity type.
   * @param {string} type - "card" | "column" | "stack" | "row"
   */
  function getTemplatesForType(type) {
    if (!templateCache) return [];
    return templateCache.filter(function (t) { return t.templateType === type; });
  }

  /**
   * Fetch full template content from backend, parse it.
   * @param {string} id - Template folder name
   * @returns {{ content, files, parsed }}
   */
  async function getFullTemplate(id) {
    var data = await LexeraApi.request('/templates/' + encodeURIComponent(id));
    var parsed = parseTemplate(data.content);
    return { content: data.content, files: data.files || [], parsed: parsed };
  }

  // ── Parser (ported from TemplateParser.ts) ─────────────────────────────

  function parseTemplate(content) {
    var parts = splitFrontmatter(content);
    var meta = parseFrontmatter(parts.frontmatter);
    var body = parseBody(parts.body, meta.type || 'card');
    return {
      name: meta.name || '',
      type: meta.type || 'card',
      description: meta.description || '',
      icon: meta.icon || '',
      variables: meta.variables || [],
      body: body
    };
  }

  function splitFrontmatter(content) {
    var match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (match) {
      return { frontmatter: match[1], body: match[2] };
    }
    return { frontmatter: '', body: content };
  }

  function parseFrontmatter(yaml) {
    if (!yaml.trim()) return {};
    var result = {};
    var lines = yaml.split('\n');
    var inVariables = false;
    var currentVariable = null;
    var indent = 0;
    result.variables = [];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim()) continue;

      // Top-level keys
      var topMatch = line.match(/^(\w+):\s*(.*)$/);
      if (topMatch) {
        var key = topMatch[1];
        var value = topMatch[2].trim();
        if (key === 'name') { result.name = unquote(value); inVariables = false; }
        else if (key === 'type') { result.type = unquote(value); inVariables = false; }
        else if (key === 'description') { result.description = unquote(value); inVariables = false; }
        else if (key === 'icon') { result.icon = unquote(value); inVariables = false; }
        else if (key === 'variables') { inVariables = true; }
        continue;
      }

      if (inVariables) {
        // New variable item (starts with -)
        var itemMatch = line.match(/^\s*-\s*(\w+):\s*(.*)$/);
        if (itemMatch) {
          if (currentVariable && currentVariable.name) {
            result.variables.push(normalizeVariable(currentVariable));
          }
          currentVariable = {};
          currentVariable[itemMatch[1]] = unquote(itemMatch[2].trim());
          indent = line.search(/\S/);
          continue;
        }
        // Variable property continuation
        var propMatch = line.match(/^\s+(\w+):\s*(.*)$/);
        if (propMatch && currentVariable) {
          var propIndent = line.search(/\S/);
          if (propIndent > indent) {
            var pKey = propMatch[1];
            var pVal = unquote(propMatch[2].trim());
            if (pKey === 'required') pVal = (pVal === 'true');
            else if (pKey === 'default' && currentVariable.type === 'number') pVal = parseInt(pVal, 10);
            currentVariable[pKey] = pVal;
          }
        }
      }
    }
    if (currentVariable && currentVariable.name) {
      result.variables.push(normalizeVariable(currentVariable));
    }
    return result;
  }

  function unquote(s) {
    if ((s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') ||
        (s.charAt(0) === "'" && s.charAt(s.length - 1) === "'")) {
      return s.slice(1, -1);
    }
    return s;
  }

  function normalizeVariable(partial) {
    return {
      name: partial.name || '',
      label: partial.label || partial.name || '',
      type: partial.type || 'string',
      format: partial.format || null,
      default: partial['default'] !== undefined ? partial['default'] : undefined,
      required: partial.required !== undefined ? partial.required : true
    };
  }

  /**
   * Parse template body according to entity type.
   * - card: raw text = card content
   * - column: ## Title + - [ ] task lines → one column with cards
   * - stack: multiple ## Title sections → multiple columns
   * - row: # StackTitle (h1) = stack boundaries, ## ColTitle (h2) = columns, - [ ] = cards
   */
  function parseBody(body, type) {
    if (type === 'card') {
      return { cardContent: body.trim() };
    }
    if (type === 'column') {
      return { columns: parseColumns(body) };
    }
    if (type === 'stack') {
      return { columns: parseColumns(body) };
    }
    if (type === 'row') {
      return parseRowBody(body);
    }
    return { cardContent: body.trim() };
  }

  /**
   * Parse ## headers + - [ ] tasks into column array.
   */
  function parseColumns(body) {
    var columns = [];
    var currentCol = null;
    var currentTask = null;
    var descLines = [];

    function flushDesc() {
      if (currentTask && descLines.length > 0) {
        var desc = descLines.join('\n').trim();
        if (desc) currentTask.content = currentTask.content + '\n' + desc;
        descLines = [];
      }
    }

    var lines = body.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      var colMatch = line.match(/^##\s+(.+)$/);
      if (colMatch) {
        flushDesc();
        currentTask = null;
        if (currentCol) columns.push(currentCol);
        currentCol = { title: colMatch[1].trim(), cards: [] };
        continue;
      }

      var taskMatch = line.match(/^-\s+\[([ x])\]\s+(.+)$/);
      if (taskMatch && currentCol) {
        flushDesc();
        currentTask = { content: taskMatch[2].trim(), checked: taskMatch[1] === 'x' };
        currentCol.cards.push(currentTask);
        continue;
      }

      if (currentTask && line.match(/^\s{2,}/)) {
        descLines.push(line.trim());
        continue;
      }

      if (currentTask && line.trim() && !line.match(/^\s/)) {
        flushDesc();
      }
    }
    flushDesc();
    if (currentCol) columns.push(currentCol);
    return columns;
  }

  /**
   * Parse row body: # = stack boundaries, ## = columns, - [ ] = cards
   */
  function parseRowBody(body) {
    var stacks = [];
    var currentStack = null;
    var currentCol = null;
    var currentTask = null;
    var descLines = [];

    function flushDesc() {
      if (currentTask && descLines.length > 0) {
        var desc = descLines.join('\n').trim();
        if (desc) currentTask.content = currentTask.content + '\n' + desc;
        descLines = [];
      }
    }

    function flushCol() {
      flushDesc();
      currentTask = null;
      if (currentCol && currentStack) currentStack.columns.push(currentCol);
      currentCol = null;
    }

    function flushStack() {
      flushCol();
      if (currentStack) stacks.push(currentStack);
      currentStack = null;
    }

    var lines = body.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      // # Stack header (h1, but NOT ##)
      var stackMatch = line.match(/^#\s+([^#].*)$/);
      if (stackMatch) {
        flushStack();
        currentStack = { title: stackMatch[1].trim(), columns: [] };
        continue;
      }

      var colMatch = line.match(/^##\s+(.+)$/);
      if (colMatch) {
        flushCol();
        if (!currentStack) {
          currentStack = { title: 'Default', columns: [] };
        }
        currentCol = { title: colMatch[1].trim(), cards: [] };
        continue;
      }

      var taskMatch = line.match(/^-\s+\[([ x])\]\s+(.+)$/);
      if (taskMatch && currentCol) {
        flushDesc();
        currentTask = { content: taskMatch[2].trim(), checked: taskMatch[1] === 'x' };
        currentCol.cards.push(currentTask);
        continue;
      }

      if (currentTask && line.match(/^\s{2,}/)) {
        descLines.push(line.trim());
        continue;
      }

      if (currentTask && line.trim() && !line.match(/^\s/)) {
        flushDesc();
      }
    }
    flushStack();
    return { stacks: stacks };
  }

  // ── Variable Processor (ported from VariableProcessor.ts) ──────────────

  /**
   * Substitute all variables in content.
   */
  function substitute(content, values, variables) {
    var result = processConditionals(content, values);
    result = substituteVariables(result, values, variables);
    return result;
  }

  /**
   * Substitute variables in a filename with filesystem sanitization.
   */
  function substituteFilename(filename, values, variables) {
    var result = substitute(filename, values, variables);
    return result.replace(/[<>:"\\|?*]/g, '_');
  }

  function substituteVariables(content, values, variables) {
    return content.replace(/\{(\w+)(?::([^}]+))?\}/g, function (match, varName, format) {
      var value = values[varName];
      if (value === undefined) return match;

      if (!format && variables) {
        for (var i = 0; i < variables.length; i++) {
          if (variables[i].name === varName && variables[i].format) {
            format = variables[i].format;
            break;
          }
        }
      }

      if (format) return formatValue(value, format);
      return String(value);
    });
  }

  function formatValue(value, format) {
    // Integer with zero padding: 02d, 03d, etc.
    var intMatch = format.match(/^0?(\d+)d$/);
    if (intMatch) {
      var width = parseInt(intMatch[1], 10);
      var num = typeof value === 'number' ? value : parseInt(String(value), 10);
      return String(num).padStart(width, '0');
    }
    if (format === 'd') {
      return String(typeof value === 'number' ? value : parseInt(String(value), 10));
    }
    if (format === 's') return String(value);
    // Float: .2f
    var floatMatch = format.match(/^\.(\d+)f$/);
    if (floatMatch) {
      var precision = parseInt(floatMatch[1], 10);
      var fNum = typeof value === 'number' ? value : parseFloat(String(value));
      return fNum.toFixed(precision);
    }
    if (format === 'upper' || format === 'U') return String(value).toUpperCase();
    if (format === 'lower' || format === 'L') return String(value).toLowerCase();
    if (format === 'title' || format === 'T') {
      return String(value).replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }
    if (format === 'slug') {
      return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }
    return String(value);
  }

  function processConditionals(content, values) {
    var result = content;
    var changed = true;
    var iterations = 0;
    while (changed && iterations < 100) {
      changed = false;
      iterations++;
      result = result.replace(
        /\{#if\s+(\w+)\}((?:(?!\{#if).)*?)\{\/if\}/gs,
        function (_match, varName, body) {
          changed = true;
          var isTruthy = checkTruthy(values[varName]);
          var elseParts = body.split('{#else}');
          if (elseParts.length === 2) {
            return isTruthy ? elseParts[0] : elseParts[1];
          }
          return isTruthy ? body : '';
        }
      );
    }
    return result;
  }

  function checkTruthy(value) {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (typeof value === 'number') return value !== 0;
    return Boolean(value);
  }

  function validateVariables(variables, values) {
    var missing = [];
    for (var i = 0; i < variables.length; i++) {
      var v = variables[i];
      if (v.required !== false) {
        var val = values[v.name];
        if (val === undefined || val === '') {
          missing.push(v.label || v.name);
        }
      }
    }
    return { valid: missing.length === 0, missing: missing };
  }

  function applyDefaults(variables, values) {
    var result = {};
    for (var k in values) {
      if (values.hasOwnProperty(k)) result[k] = values[k];
    }
    for (var i = 0; i < variables.length; i++) {
      var v = variables[i];
      if (result[v.name] === undefined && v['default'] !== undefined) {
        result[v.name] = v['default'];
      }
    }
    return result;
  }

  // ── Variable Dialog (ported from templateDialog.js) ────────────────────

  /**
   * Show modal dialog for collecting template variable values.
   * @param {string} templateName
   * @param {Array} variables
   * @returns {Promise<object|null>} values or null on cancel
   */
  function showVariableDialog(templateName, variables) {
    return new Promise(function (resolve) {
      if (!variables || variables.length === 0) {
        resolve({});
        return;
      }

      var overlay = document.createElement('div');
      overlay.className = 'template-dialog-overlay';

      var dialog = document.createElement('div');
      dialog.className = 'template-dialog';

      // Header
      var header = document.createElement('div');
      header.className = 'template-dialog-header';
      var h3 = document.createElement('h3');
      h3.textContent = 'Configure: ' + (templateName || 'Template');
      header.appendChild(h3);
      var closeBtn = document.createElement('button');
      closeBtn.className = 'template-dialog-close';
      closeBtn.innerHTML = '&times;';
      closeBtn.addEventListener('click', function () { cleanup(null); });
      header.appendChild(closeBtn);
      dialog.appendChild(header);

      // Form
      var form = document.createElement('form');
      form.className = 'template-dialog-form';

      for (var i = 0; i < variables.length; i++) {
        var v = variables[i];
        var field = document.createElement('div');
        field.className = 'template-dialog-field';

        var label = document.createElement('label');
        label.setAttribute('for', 'tpl-var-' + v.name);
        label.textContent = v.label || v.name;
        if (v.required !== false) {
          var req = document.createElement('span');
          req.className = 'required';
          req.textContent = ' *';
          label.appendChild(req);
        }
        field.appendChild(label);

        var input = document.createElement('input');
        input.type = v.type === 'number' ? 'number' : 'text';
        input.id = 'tpl-var-' + v.name;
        input.name = v.name;
        input.placeholder = v.format ? 'Format: ' + v.format : '';
        if (v['default'] !== undefined) input.value = v['default'];
        if (v.required !== false) input.required = true;
        field.appendChild(input);

        form.appendChild(field);
      }
      dialog.appendChild(form);

      // Footer
      var footer = document.createElement('div');
      footer.className = 'template-dialog-footer';
      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'template-dialog-btn template-dialog-cancel';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', function () { cleanup(null); });
      footer.appendChild(cancelBtn);
      var submitBtn = document.createElement('button');
      submitBtn.type = 'button';
      submitBtn.className = 'template-dialog-btn template-dialog-submit';
      submitBtn.textContent = 'Apply Template';
      submitBtn.addEventListener('click', function () { collectAndSubmit(); });
      footer.appendChild(submitBtn);
      dialog.appendChild(footer);

      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      // Focus first input
      var firstInput = form.querySelector('input');
      if (firstInput) firstInput.focus();

      // Keyboard handlers
      form.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          collectAndSubmit();
        }
      });
      overlay.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          cleanup(null);
        }
      });

      function collectAndSubmit() {
        var vals = {};
        for (var j = 0; j < variables.length; j++) {
          var vDef = variables[j];
          var inp = form.querySelector('#tpl-var-' + vDef.name);
          if (!inp) continue;
          if (vDef.type === 'number') {
            vals[vDef.name] = parseFloat(inp.value) || 0;
          } else {
            vals[vDef.name] = inp.value;
          }
        }
        var validation = validateVariables(variables, vals);
        if (!validation.valid) {
          alert('Please fill in required fields: ' + validation.missing.join(', '));
          return;
        }
        cleanup(vals);
      }

      function cleanup(result) {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(result);
      }
    });
  }

  // ── Entity Builders ────────────────────────────────────────────────────

  /**
   * Build a card from a parsed template + variable values.
   * @returns {{ id, content, checked }}
   */
  function buildCardFromTemplate(parsed, values) {
    var content = parsed.body.cardContent || '';
    content = substitute(content, values, parsed.variables);
    return {
      id: 'card-' + Date.now(),
      content: content,
      checked: false
    };
  }

  /**
   * Build column(s) from a parsed template + variable values.
   * @returns {Array<{ id, title, cards }>}
   */
  function buildColumnFromTemplate(parsed, values) {
    var cols = parsed.body.columns || [];
    var result = [];
    for (var i = 0; i < cols.length; i++) {
      var col = cols[i];
      var title = substitute(col.title, values, parsed.variables);
      var cards = [];
      for (var j = 0; j < col.cards.length; j++) {
        var card = col.cards[j];
        cards.push({
          id: 'card-' + Date.now() + '-' + j,
          content: substitute(card.content, values, parsed.variables),
          checked: card.checked || false
        });
      }
      result.push({
        id: 'col-' + Date.now() + '-' + i,
        title: title,
        cards: cards
      });
    }
    // If no columns parsed, return one empty column
    if (result.length === 0) {
      result.push({ id: 'col-' + Date.now(), title: 'New Column', cards: [] });
    }
    return result;
  }

  /**
   * Build a stack from a parsed template + variable values.
   * @returns {{ id, title, columns }}
   */
  function buildStackFromTemplate(parsed, values) {
    var columns = buildColumnFromTemplate(parsed, values);
    return {
      id: 'stack-' + Date.now(),
      title: substitute(parsed.name || 'New Stack', values, parsed.variables),
      columns: columns
    };
  }

  /**
   * Build a row from a parsed template + variable values.
   * @returns {{ id, title, stacks }}
   */
  function buildRowFromTemplate(parsed, values) {
    var rowStacks = [];
    if (parsed.body.stacks && parsed.body.stacks.length > 0) {
      for (var si = 0; si < parsed.body.stacks.length; si++) {
        var src = parsed.body.stacks[si];
        var stackCols = [];
        for (var ci = 0; ci < src.columns.length; ci++) {
          var col = src.columns[ci];
          var cards = [];
          for (var ki = 0; ki < col.cards.length; ki++) {
            var card = col.cards[ki];
            cards.push({
              id: 'card-' + Date.now() + '-' + si + '-' + ci + '-' + ki,
              content: substitute(card.content, values, parsed.variables),
              checked: card.checked || false
            });
          }
          stackCols.push({
            id: 'col-' + Date.now() + '-' + si + '-' + ci,
            title: substitute(col.title, values, parsed.variables),
            cards: cards
          });
        }
        rowStacks.push({
          id: 'stack-' + Date.now() + '-' + si,
          title: substitute(src.title, values, parsed.variables),
          columns: stackCols
        });
      }
    }
    // Fallback: use columns as single stack (for type=row templates that use ## only)
    if (rowStacks.length === 0 && parsed.body.columns && parsed.body.columns.length > 0) {
      var stack = buildStackFromTemplate(parsed, values);
      rowStacks.push(stack);
    }
    // Fallback: empty stack
    if (rowStacks.length === 0) {
      rowStacks.push({
        id: 'stack-' + Date.now(),
        title: 'Default',
        columns: [{ id: 'col-' + Date.now(), title: 'New Column', cards: [] }]
      });
    }
    return {
      id: 'row-' + Date.now(),
      title: substitute(parsed.name || 'New Row', values, parsed.variables),
      stacks: rowStacks
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────

  return {
    loadTemplates: loadTemplates,
    getTemplatesForType: getTemplatesForType,
    getFullTemplate: getFullTemplate,
    showVariableDialog: showVariableDialog,
    substitute: substitute,
    substituteFilename: substituteFilename,
    applyDefaults: applyDefaults,
    buildCardFromTemplate: buildCardFromTemplate,
    buildColumnFromTemplate: buildColumnFromTemplate,
    buildStackFromTemplate: buildStackFromTemplate,
    buildRowFromTemplate: buildRowFromTemplate
  };
})();
