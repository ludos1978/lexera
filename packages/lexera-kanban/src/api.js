/**
 * HTTP client for Lexera Backend REST API.
 * Auto-discovers the backend by trying common ports.
 */
const LexeraApi = (function () {
  let baseUrl = null;

  async function discover() {
    if (baseUrl) return baseUrl;
    const ports = [8083, 8080, 8081, 8082, 9080];
    for (const port of ports) {
      try {
        const res = await fetch(`http://localhost:${port}/status`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'running') {
            baseUrl = `http://localhost:${data.port}`;
            return baseUrl;
          }
        }
      } catch (e) {
        // Try next port
      }
    }
    return null;
  }

  async function request(path, options) {
    const url = await discover();
    if (!url) throw new Error('Backend not available');
    const res = await fetch(url + path, options);
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
      const url = await discover();
      if (!url) return false;
      const res = await fetch(url + '/status');
      return res.ok;
    } catch { return false; }
  }

  return { discover, getBoards, getBoardColumns, addCard, search, checkStatus };
})();
