/**
 * HTTP client for ludos-sync REST API.
 * IIFE module pattern — exposes window.LudosApi.
 */
const LudosApi = (function () {
  let baseUrl = localStorage.getItem('ludos-dashboard-url') || 'http://localhost:13080';

  function setBaseUrl(url) {
    baseUrl = url.replace(/\/+$/, '');
    localStorage.setItem('ludos-dashboard-url', baseUrl);
  }

  function getBaseUrl() {
    return baseUrl;
  }

  async function request(path, options) {
    const res = await fetch(baseUrl + path, options);
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`${res.status}: ${text}`);
    }
    return res.json();
  }

  async function getBoards() {
    return request('/api/boards');
  }

  async function getBoardColumns(boardId) {
    return request('/api/boards/' + boardId + '/columns');
  }

  async function addCard(boardId, colIndex, content) {
    return request('/api/boards/' + boardId + '/columns/' + colIndex + '/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  }

  async function search(query) {
    return request('/api/search?q=' + encodeURIComponent(query));
  }

  async function checkStatus() {
    // Use /api/boards (which has CORS headers) instead of /status (which doesn't)
    const res = await fetch(baseUrl + '/api/boards');
    return res.ok;
  }

  return { setBaseUrl, getBaseUrl, getBoards, getBoardColumns, addCard, search, checkStatus };
})();
