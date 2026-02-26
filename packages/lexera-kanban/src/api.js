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

  async function search(query, options) {
    const params = new URLSearchParams();
    params.set('q', query || '');
    if (options && options.regex) params.set('regex', 'true');
    if (options && options.caseSensitive) params.set('caseSensitive', 'true');
    return request('/search?' + params.toString());
  }

  async function checkStatus() {
    try {
      const url = await discover();
      if (!url) return false;
      const res = await fetch(url + '/status');
      return res.ok;
    } catch { return false; }
  }

  function mediaUrl(boardId, filename) {
    return (baseUrl || '') + '/boards/' + boardId + '/media/' + encodeURIComponent(filename);
  }

  function fileUrl(boardId, path) {
    return (baseUrl || '') + '/boards/' + boardId + '/file?path=' + encodeURIComponent(path);
  }

  async function fileInfo(boardId, path) {
    return request('/boards/' + boardId + '/file-info?path=' + encodeURIComponent(path));
  }

  async function saveBoard(boardId, boardData) {
    return request('/boards/' + boardId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(boardData),
    });
  }

  async function uploadMedia(boardId, file) {
    var url = await discover();
    if (!url) throw new Error('Backend not available');
    var form = new FormData();
    form.append('file', file, file.name);
    var res = await fetch(url + '/boards/' + boardId + '/media', { method: 'POST', body: form });
    if (!res.ok) {
      var text = await res.text().catch(function () { return res.statusText; });
      throw new Error(res.status + ': ' + text);
    }
    return res.json();
  }

  function connectSSE(onEvent) {
    if (!baseUrl) return null;
    var es = new EventSource(baseUrl + '/events');
    es.onmessage = function (msg) {
      try { onEvent(JSON.parse(msg.data)); } catch (e) { /* ignore parse errors */ }
    };
    return es;
  }

  async function addBoard(filePath) {
    return request('/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: filePath }),
    });
  }

  async function removeBoard(boardId) {
    return request('/boards/' + boardId, { method: 'DELETE' });
  }

  return { discover, request, getBoards, getBoardColumns, addCard, saveBoard, search, checkStatus, connectSSE, mediaUrl, fileUrl, fileInfo, uploadMedia, addBoard, removeBoard };
})();
