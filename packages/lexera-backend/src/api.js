/**
 * HTTP client for Lexera Backend REST API.
 * Hardcoded to localhost — the Tauri app hosts the server.
 */
const LexeraApi = (function () {
  const baseUrl = 'http://localhost:8083';

  async function request(path, options) {
    const res = await fetch(baseUrl + path, options);
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`${res.status}: ${text}`);
    }
    return res.json();
  }

  async function getBoards() {
    return request('/boards');
  }

  async function getBoardColumns(boardId) {
    return request('/boards/' + boardId + '/columns');
  }

  async function addCard(boardId, colIndex, content) {
    return request('/boards/' + boardId + '/columns/' + colIndex + '/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  }

  async function search(query) {
    return request('/search?q=' + encodeURIComponent(query));
  }

  async function checkStatus() {
    try {
      const res = await fetch(baseUrl + '/status');
      return res.ok;
    } catch { return false; }
  }

  return { getBoards, getBoardColumns, addCard, search, checkStatus };
})();
