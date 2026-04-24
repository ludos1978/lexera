// Board sub-app — runs in a child webview (board-a / board-b / board-c).
//
// Drag flow:
//   1. pointerdown on a card → start tracking
//   2. on first move past threshold → call drag_start in Rust, set
//      pointer capture so all subsequent moves come back to us
//   3. on each move, forward pointer position (in shell-local coords)
//      to Rust via drag_pointer_move
//   4. on pointerup → forward to drag_pointer_up
//   5. on Escape → forward to drag_cancel
//
// Drop flow (when this board is the target):
//   - listen for 'drag-enter' / 'drag-over' / 'drag-leave' events from
//     Rust; highlight columns based on local pointer coords
//   - listen for 'drop' event; insert the card payload into the
//     appropriate column, ack via drop_ack
//
// Source completion flow:
//   - listen for 'drag-complete' from Rust → remove the dragged card
//   - listen for 'drag-cancelled' → unhide the dragged card

const { invoke } = window.__TAURI__.core;
const { getCurrentWebview } = window.__TAURI__.webview;

const myWebview = getCurrentWebview();
const myLabel = myWebview.label;

// IMPORTANT: use myWebview.listen (scoped) instead of the global
// listen() from @tauri-apps/api/event. The global listen defaults to
// EventTarget::Any and would receive events emitted_to OTHER webviews,
// causing every board to react to a drop targeted at one board.
const listen = (event, handler) => myWebview.listen(event, handler);

const titleEl = document.getElementById('board-title');
const statusEl = document.getElementById('status');
titleEl.textContent = myLabel;

function setStatus(text) {
  statusEl.textContent = text;
}

// Seed each board with N synthetic cards so we can measure perf
// under realistic density. Override via ?cards=N in the URL.
function getSeedCount() {
  const params = new URLSearchParams(window.location.search);
  const n = parseInt(params.get('cards') || '500', 10);
  return Number.isFinite(n) && n > 0 ? n : 500;
}

function generateSeedCards(label, count) {
  const prefix = label.replace('board-', '').toUpperCase();
  const columns = ['todo', 'doing', 'done'];
  const cards = [];
  for (let i = 0; i < count; i++) {
    cards.push({
      id: `${label}-${i}`,
      column: columns[i % 3],
      text: `${prefix}#${i}: ${randomTitle()}`,
    });
  }
  return cards;
}

function randomTitle() {
  const verbs = ['Refactor', 'Implement', 'Test', 'Document', 'Review',
    'Optimize', 'Debug', 'Deploy', 'Migrate', 'Profile', 'Verify',
    'Investigate', 'Fix', 'Audit', 'Polish'];
  const nouns = ['parser', 'cache', 'API', 'auth flow', 'scheduler',
    'indexer', 'serializer', 'router', 'pipeline', 'sync engine',
    'export module', 'menu bar', 'theme', 'panel layout', 'dock divider'];
  const v = verbs[Math.floor(Math.random() * verbs.length)];
  const n = nouns[Math.floor(Math.random() * nouns.length)];
  return `${v} ${n}`;
}

const seedCards = {
  [myLabel]: generateSeedCards(myLabel, getSeedCount()),
};

function makeCardEl(card) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.cardId = card.id;
  el.textContent = card.text;
  bindCardDrag(el, card);
  return el;
}

function appendCardTo(columnId, card, opts = {}) {
  const zone = document.querySelector(`.col-cards[data-drop-zone="${columnId}"]`);
  if (!zone) return;
  const el = makeCardEl(card);
  if (opts.incoming) {
    el.classList.add('is-incoming');
    setTimeout(() => el.classList.remove('is-incoming'), 1500);
  }
  zone.appendChild(el);
}

(seedCards[myLabel] || []).forEach((c) => appendCardTo(c.column, c));

const DRAG_THRESHOLD = 4;

let activePointerId = null;
let dragInProgress = false;
let dragSourceEl = null;
let dragPayload = null;
let pointerStartPos = null;
let myShellPos = null; // {x, y} of this webview's top-left in shell coords

// Held across the async drag-complete / drag-cancelled round-trip
// because cleanupDrag() runs first and clears dragSourceEl.
let pendingSourceCardEl = null;

async function refreshShellPos() {
  // Ask Rust for the current geometry of this webview so we can
  // translate pointer coords (webview-local) into shell-local.
  try {
    const all = await invoke('list_webviews');
    const me = all.find((w) => w.label === myLabel);
    if (me) {
      myShellPos = { x: me.x, y: me.y };
    }
  } catch (err) {
    console.error('list_webviews failed', err);
  }
}
refreshShellPos();

function localToShell(localX, localY) {
  if (!myShellPos) return { x: localX, y: localY };
  return { x: localX + myShellPos.x, y: localY + myShellPos.y };
}

function bindCardDrag(cardEl, card) {
  cardEl.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    // Prevent the browser from starting a text selection or any other
    // default before our threshold logic kicks in. setPointerCapture
    // alone doesn't always block selection on macOS WKWebView.
    event.preventDefault();
    activePointerId = event.pointerId;
    dragSourceEl = cardEl;
    dragPayload = { ...card };
    pointerStartPos = { x: event.clientX, y: event.clientY };
    dragInProgress = false;
    cardEl.setPointerCapture(event.pointerId);
    cardEl.addEventListener('pointermove', onCardPointerMove);
    cardEl.addEventListener('pointerup', onCardPointerUp);
    cardEl.addEventListener('pointercancel', onCardPointerCancel);
  });
}

async function onCardPointerMove(event) {
  if (event.pointerId !== activePointerId) return;
  if (!dragInProgress) {
    const dx = event.clientX - pointerStartPos.x;
    const dy = event.clientY - pointerStartPos.y;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    dragInProgress = true;
    dragSourceEl.classList.add('is-dragging');
    setStatus('dragging ' + dragPayload.id);
    await refreshShellPos();
    try {
      await invoke('drag_start', {
        payload: {
          source: myLabel,
          payload: dragPayload,
        },
      });
    } catch (err) {
      console.error('drag_start failed', err);
      cleanupDrag();
      return;
    }
  }
  const shellPos = localToShell(event.clientX, event.clientY);
  invoke('drag_pointer_move', {
    pos: { x: shellPos.x, y: shellPos.y },
  }).catch((err) => console.error('drag_pointer_move failed', err));
}

async function onCardPointerUp(event) {
  if (event.pointerId !== activePointerId) return;
  if (dragInProgress) {
    // Hand off the source ref BEFORE awaiting Rust. The drag-complete
    // event can arrive in either order relative to this await
    // resolving; setting it here makes both orders work.
    pendingSourceCardEl = dragSourceEl;
    const shellPos = localToShell(event.clientX, event.clientY);
    try {
      await invoke('drag_pointer_up', {
        pos: { x: shellPos.x, y: shellPos.y },
      });
    } catch (err) {
      console.error('drag_pointer_up failed', err);
    }
  }
  cleanupDrag();
}

function onCardPointerCancel(event) {
  if (event.pointerId !== activePointerId) return;
  invoke('drag_cancel').catch(() => {});
  cleanupDrag();
}

function cleanupDrag() {
  if (dragSourceEl) {
    dragSourceEl.classList.remove('is-dragging');
    try { dragSourceEl.releasePointerCapture(activePointerId); } catch (_) {}
    dragSourceEl.removeEventListener('pointermove', onCardPointerMove);
    dragSourceEl.removeEventListener('pointerup', onCardPointerUp);
    dragSourceEl.removeEventListener('pointercancel', onCardPointerCancel);
    // Hand off the source card ref so drag-complete / drag-cancelled
    // can decide whether to remove or restore it.
    pendingSourceCardEl = dragSourceEl;
  }
  activePointerId = null;
  dragSourceEl = null;
  dragPayload = null;
  pointerStartPos = null;
  dragInProgress = false;
  setStatus('');
}

// ── Drop target handling ────────────────────────────────────────

let dropHighlightZone = null;

function clearHighlight() {
  if (dropHighlightZone) {
    dropHighlightZone.classList.remove('is-drop-target');
    dropHighlightZone = null;
  }
}

function pickColumnAt(localX, localY) {
  const zones = document.querySelectorAll('.col-cards');
  for (const zone of zones) {
    const r = zone.getBoundingClientRect();
    if (localX >= r.left && localX <= r.right && localY >= r.top && localY <= r.bottom) {
      return zone;
    }
  }
  return null;
}

listen('drag-enter', (event) => {
  setStatus('drag-enter from ' + event.payload.source);
});

listen('drag-leave', () => {
  clearHighlight();
  setStatus('');
});

listen('drag-over', (event) => {
  const { local_x, local_y } = event.payload;
  const zone = pickColumnAt(local_x, local_y);
  if (zone !== dropHighlightZone) {
    clearHighlight();
    if (zone) {
      zone.classList.add('is-drop-target');
      dropHighlightZone = zone;
    }
  }
});

listen('drop', (event) => {
  const { source, payload, local_x, local_y } = event.payload;
  const zone = pickColumnAt(local_x, local_y);
  const columnId = zone ? zone.dataset.dropZone : 'todo';
  // Keep id and text identical to the source card so the visual is
  // a true move (not a copy with annotations). Source webview will
  // remove the original on drag-complete.
  const newCard = {
    id: payload.id,
    column: columnId,
    text: payload.text,
  };
  appendCardTo(columnId, newCard, { incoming: true });
  clearHighlight();
  setStatus('dropped from ' + source);
  console.log('[drop] from', source, 'card', payload.id, '→ column', columnId);
  invoke('drop_ack', { ack: { accepted: true } }).catch(() => {});
});

listen('drag-complete', (event) => {
  console.log('[drag-complete] accepted=', event.payload.accepted,
    'pendingSourceCardEl=', pendingSourceCardEl ? 'present' : 'null');
  if (event.payload.accepted && pendingSourceCardEl) {
    const parent = pendingSourceCardEl.parentElement;
    if (parent) {
      parent.removeChild(pendingSourceCardEl);
      console.log('[drag-complete] source card removed');
    } else {
      console.warn('[drag-complete] source card had no parent — already removed?');
    }
  }
  pendingSourceCardEl = null;
});

listen('drag-cancelled', () => {
  // Source card stays in place; just clear the held reference and
  // visual state.
  pendingSourceCardEl = null;
  setStatus('');
});

listen('drag-ended', () => {
  clearHighlight();
  document.body.classList.remove('is-drag-active');
});

// Suppress text selection in this webview while ANY drag is active
// (whether this view is source or target). Also clear any existing
// selection that was held when the drag began.
listen('drag-began', () => {
  document.body.classList.add('is-drag-active');
  try { window.getSelection()?.removeAllRanges(); } catch (_) {}
});

// Belt-and-braces: also block selectstart while drag is active.
document.addEventListener('selectstart', (event) => {
  if (document.body.classList.contains('is-drag-active')) {
    event.preventDefault();
  }
});

// ── FPS counter (per board's main thread) ───────────────────────
// Each board webview runs in its own OS process. This FPS reflects
// THAT process's main thread. During shell divider drag, the shell
// resizes board geometry — the board's own process reflows its DOM
// in parallel with the shell. If FPS stays high here, it means the
// per-process isolation is doing its job.
const fpsEl = document.getElementById('fps');
let fpsFrames = 0;
let fpsLastReport = performance.now();
function fpsTick() {
  fpsFrames++;
  const now = performance.now();
  const elapsed = now - fpsLastReport;
  if (elapsed >= 500) {
    const fps = Math.round((fpsFrames * 1000) / elapsed);
    fpsEl.textContent = fps + ' fps';
    fpsEl.classList.toggle('is-low', fps < 30);
    fpsEl.classList.toggle('is-mid', fps >= 30 && fps < 55);
    fpsFrames = 0;
    fpsLastReport = now;
  }
  requestAnimationFrame(fpsTick);
}
requestAnimationFrame(fpsTick);
