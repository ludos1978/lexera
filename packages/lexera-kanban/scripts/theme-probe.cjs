#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const FRONTEND_URL = process.env.LEXERA_FRONTEND_URL || 'http://127.0.0.1:1431/';
const BACKEND_URL = process.env.LEXERA_BACKEND_URL || 'http://127.0.0.1:13080';
const OUTPUT_PATH = process.env.LEXERA_THEME_PROBE_OUT || '/tmp/lexera-theme-probe.png';
const THEME_ID = process.env.LEXERA_THEME_PROBE_THEME || 'sleek-uniform';
const EDITOR_OUTPUT_PATH = OUTPUT_PATH.replace(/(\.[^.]+)?$/, '-editor$1');

async function readJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = { raw: text };
  }
  if (!response.ok) {
    const error = new Error('HTTP ' + response.status + ' for ' + url);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

async function getBoardAuth() {
  const me = await readJson(BACKEND_URL + '/collab/me');
  if (!me || !me.token) {
    throw new Error('Missing token from /collab/me');
  }
  const boards = await readJson(BACKEND_URL + '/boards', {
    headers: {
      Authorization: 'Bearer ' + me.token
    }
  });
  const entries = boards && Array.isArray(boards.boards) ? boards.boards : [];
  if (!entries.length || !entries[0] || !entries[0].id) {
    throw new Error('No boards returned from authenticated /boards');
  }
  return {
    token: me.token,
    boardId: entries[0].id
  };
}

async function run() {
  const auth = await getBoardAuth();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1100 },
    deviceScaleFactor: 2,
    extraHTTPHeaders: {
      Authorization: 'Bearer ' + auth.token
    }
  });
  const page = await context.newPage();

  page.on('console', (message) => {
    console.log('[console:' + message.type() + ']', message.text());
  });
  page.on('pageerror', (error) => {
    console.log('[pageerror]', error && (error.stack || error.message || String(error)));
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    console.log('[requestfailed]', request.url(), failure && failure.errorText);
  });

  try {
    await page.goto(FRONTEND_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(function () {
      return !!(window.LexeraWorkspaceShell && window.LexeraWorkspaceShell.openBoard);
    }, null, { timeout: 30000 });
    await page.evaluate(function (themeId) {
      try {
        localStorage.setItem('lexera-visual-theme', themeId);
      } catch (error) {
        console.log(error);
      }
    }, THEME_ID);
    await page.reload({ waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(4000);
    const openResult = await page.evaluate(async function (targetBoardId) {
      try {
        var tab = await window.LexeraWorkspaceShell.openBoard(targetBoardId, {
          preferExisting: true
        });
        return {
          ok: true,
          tabId: tab && tab.id ? tab.id : null
        };
      } catch (error) {
        return {
          ok: false,
          reason: error && (error.stack || error.message || String(error))
        };
      }
    }, auth.boardId);
    console.log('[open-result]', JSON.stringify(openResult));
    await page.waitForTimeout(5000);
    const shellInfo = await page.evaluate(function () {
      function uniqueSizes(selector) {
        var nodes = Array.prototype.slice.call(document.querySelectorAll(selector)).slice(0, 20);
        var seen = {};
        var values = [];
        for (var i = 0; i < nodes.length; i++) {
          var rect = nodes[i].getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) continue;
          var key = Math.round(rect.width) + 'x' + Math.round(rect.height);
          if (seen[key]) continue;
          seen[key] = true;
          values.push(key);
        }
        return values;
      }
      function selectorSizes(selectors) {
        return selectors.map(function (selector) {
          return {
            selector: selector,
            sizes: uniqueSizes(selector)
          };
        }).filter(function (entry) {
          return entry.sizes && entry.sizes.length;
        });
      }
      function pickMetrics(selector) {
        var node = document.querySelector(selector);
        if (!node) return null;
        var style = window.getComputedStyle(node);
        return {
          width: style.width,
          height: style.height,
          fontSize: style.fontSize
        };
      }
      return {
        boardItems: document.querySelectorAll('.board-item').length,
        workspaceEmpty: !!document.querySelector('.workspace-empty-state'),
        shellIconSizes: uniqueSizes('.ws-view-drag, .ws-view-fold, .ws-view-close, .ws-view-tab-close, .ws-fold-indicator, .ws-tab-overflow-menu-item-close'),
        sidebarIconSizes: uniqueSizes('.board-item-remove, .tree-grip, .dashboard-item-remove'),
        shellButtonSelectorSizes: selectorSizes([
          '.sidebar-btn',
          '.log-panel-btn',
          '.log-panel-status-btn',
          '.log-panel-tab',
          '.mgmt-btn'
        ]),
        shellDragMetrics: pickMetrics('.ws-view-drag'),
        shellFoldMetrics: pickMetrics('.ws-view-fold'),
        shellCloseMetrics: pickMetrics('.ws-view-close'),
        shellTabCloseMetrics: pickMetrics('.ws-view-tab-close')
      };
    });
    const frameLocator = page.locator('.workspace-shell-frame').first();
    await frameLocator.waitFor({ state: 'attached', timeout: 30000 });
    const frameHandle = await frameLocator.elementHandle();
    const frame = frameHandle ? await frameHandle.contentFrame() : null;
    if (!frame) {
      throw new Error('Workspace board frame not available');
    }
    await frame.waitForLoadState('load', { timeout: 30000 });
    await frame.waitForTimeout(5000);
    const frameInfo = await frame.evaluate(function () {
      function uniqueSizes(selector) {
        var nodes = Array.prototype.slice.call(document.querySelectorAll(selector)).slice(0, 20);
        var seen = {};
        var values = [];
        for (var i = 0; i < nodes.length; i++) {
          var rect = nodes[i].getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) continue;
          var key = Math.round(rect.width) + 'x' + Math.round(rect.height);
          if (seen[key]) continue;
          seen[key] = true;
          values.push(key);
        }
        return values;
      }
      function selectorSizes(selectors) {
        return selectors.map(function (selector) {
          return {
            selector: selector,
            sizes: uniqueSizes(selector)
          };
        }).filter(function (entry) {
          return entry.sizes && entry.sizes.length;
        });
      }
      function pickStyle(selector, property) {
        var node = document.querySelector(selector);
        if (!node) return null;
        return window.getComputedStyle(node).getPropertyValue(property);
      }
      return {
        title: (document.querySelector('.board-header-file-title') || {}).textContent || '',
        columns: document.querySelectorAll('.column').length,
        cards: document.querySelectorAll('.card').length,
        canvasStacks: document.querySelectorAll('.canvas-stack').length,
        overlayEditors: document.querySelectorAll('.editor-overlay').length,
        sidebarBoards: document.querySelectorAll('.board-item').length,
        bodyClass: document.body.className || '',
        headerHeight: pickStyle('.board-header', 'min-height') || pickStyle('.board-header', 'height'),
        boardActionSizes: uniqueSizes('.board-action-btn'),
        iconButtonSizes: uniqueSizes('.btn-icon, .fold-btn, .column-menu-btn, .column-add-btn, .column-edit-btn, .card-menu-btn, .embed-menu-btn'),
        iconButtonSelectorSizes: selectorSizes([
          '.btn-icon',
          '.fold-btn',
          '.column-menu-btn',
          '.column-add-btn',
          '.column-edit-btn',
          '.card-menu-btn',
          '.embed-menu-btn',
          '.wiki-menu-btn'
        ]),
        specialButtonSelectorSizes: selectorSizes([
          '.wiki-menu-btn',
          '.external-embed-open-btn',
          '.external-embed-secondary-btn'
        ]),
        dragHandleSizes: uniqueSizes('.card-drag-handle, .drag-grip'),
        cardHeaderPadding: pickStyle('.card-header', 'padding'),
        cardContentPadding: pickStyle('.card-content', 'padding'),
        columnHeaderPadding: pickStyle('.column-header', 'padding'),
        rowHeaderPadding: pickStyle('.board-row-header', 'padding')
      };
    });
    console.log('[shell-ui]', JSON.stringify(shellInfo));
    console.log('[frame-ui]', JSON.stringify(frameInfo));
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    await page.screenshot({ path: OUTPUT_PATH, fullPage: true });

    const editorResult = await frame.evaluate(async function () {
      var firstCard = document.querySelector('.card[data-col-index][data-card-index]');
      if (!firstCard || !window.CardEditor || typeof window.CardEditor.openCardEditor !== 'function') {
        return { ok: false, reason: 'Card editor unavailable' };
      }
      var colIndex = parseInt(firstCard.getAttribute('data-col-index'), 10);
      var cardIndex = parseInt(firstCard.getAttribute('data-card-index'), 10);
      window.CardEditor.openCardEditor(firstCard, colIndex, cardIndex, 'overlay');
      return {
        ok: true,
        colIndex: colIndex,
        cardIndex: cardIndex
      };
    });
    console.log('[editor-open]', JSON.stringify(editorResult));
    if (editorResult && editorResult.ok) {
      await frame.waitForSelector('.card-editor-dialog, .editor-overlay', { timeout: 30000 });
      await frame.waitForTimeout(1200);
      const editorInfo = await frame.evaluate(function () {
        function uniqueSizes(selector) {
          var nodes = Array.prototype.slice.call(document.querySelectorAll(selector)).slice(0, 20);
          var seen = {};
          var values = [];
          for (var i = 0; i < nodes.length; i++) {
            var rect = nodes[i].getBoundingClientRect();
            var key = Math.round(rect.width) + 'x' + Math.round(rect.height);
            if (seen[key]) continue;
            seen[key] = true;
            values.push(key);
          }
          return values;
        }
        function pickStyle(selector, property) {
          var node = document.querySelector(selector);
          if (!node) return null;
          return window.getComputedStyle(node).getPropertyValue(property);
        }
        var dialog = document.querySelector('.card-editor-dialog, .editor-overlay');
        var rect = dialog ? dialog.getBoundingClientRect() : null;
        return {
          overlayEditors: document.querySelectorAll('.card-editor-dialog, .editor-overlay').length,
          dialogSize: rect ? (Math.round(rect.width) + 'x' + Math.round(rect.height)) : null,
          headerPadding: pickStyle('.card-editor-header', 'padding'),
          toolbarPadding: pickStyle('.card-editor-toolbar', 'padding'),
          paneTitlePadding: pickStyle('.card-editor-pane-title', 'padding'),
          modeToggleSizes: uniqueSizes('.card-editor-mode-toggle .board-action-btn'),
          toolbarButtonSizes: uniqueSizes('.card-editor-toolbar .board-action-btn'),
          utilityButtonSizes: uniqueSizes('.btn-small, .file-search-cat'),
          utilityButtonSelectorSizes: [
            {
              selector: '.btn-small',
              sizes: uniqueSizes('.btn-small')
            },
            {
              selector: '.file-search-cat',
              sizes: uniqueSizes('.file-search-cat')
            }
          ].filter(function (entry) {
            return entry.sizes && entry.sizes.length;
          })
        };
      });
      console.log('[editor-ui]', JSON.stringify(editorInfo));
      await page.screenshot({ path: EDITOR_OUTPUT_PATH, fullPage: true });
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error('[fatal]', error && (error.stack || error.message || String(error)));
  process.exitCode = 1;
});
