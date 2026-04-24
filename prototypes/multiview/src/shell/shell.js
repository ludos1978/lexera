// Shell webview: window manager.
//
// Responsibilities:
// - Compute slot rectangles based on the body's grid layout
// - On window resize / divider drag, push new geometry to Rust so child
//   webviews follow the slots
// - During cross-webview drag, receive pointer-position updates from
//   the source webview (forwarded via Rust events) and trigger
//   visual indicators if needed

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const HEADER_HEIGHT = 32;

// Slot widths as fractions; updated when the user drags a divider.
const slotFractions = [1 / 3, 1 / 3, 1 / 3];
const dividerWidth = 5;

const slotEls = Array.from(document.querySelectorAll('.slot'));
const dividerEls = Array.from(document.querySelectorAll('.divider'));
const statusEl = document.getElementById('status');

function setStatus(text) {
  statusEl.textContent = text;
}

function applyGridTemplate() {
  document.getElementById('shell-body').style.gridTemplateColumns =
    `${slotFractions[0]}fr ${dividerWidth}px ${slotFractions[1]}fr ${dividerWidth}px ${slotFractions[2]}fr`;
}

function computeSlotRects() {
  const body = document.getElementById('shell-body');
  const bodyRect = body.getBoundingClientRect();
  return slotEls.map((slot) => {
    const r = slot.getBoundingClientRect();
    return {
      label: slot.dataset.slot,
      x: r.left,
      y: r.top,
      width: r.width,
      height: r.height,
    };
  });
}

async function pushGeometryToRust() {
  const rects = computeSlotRects();
  const updates = rects.map((r) => ({
    label: r.label,
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
  }));
  try {
    await invoke('set_webview_geometry', { updates });
  } catch (err) {
    console.error('set_webview_geometry failed', err);
    setStatus('geometry push failed: ' + err);
  }
}

// Push initial geometry once layout settles.
function pushInitialGeometry() {
  // Wait two RAFs to ensure layout has been computed
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      pushGeometryToRust();
      setStatus('ready — drag cards across boards');
    });
  });
}

// Re-push on window resize.
window.addEventListener('resize', () => {
  pushGeometryToRust();
});

// Divider drag — adjust slot fractions live.
function bindDivider(el) {
  el.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    el.setPointerCapture(event.pointerId);
    el.classList.add('is-dragging');
    const dividerKey = el.dataset.divider; // 'a-b' or 'b-c'
    const bodyRect = document.getElementById('shell-body').getBoundingClientRect();
    const startX = event.clientX;
    const initial = slotFractions.slice();
    const sumAB = initial[0] + initial[1];
    const sumBC = initial[1] + initial[2];

    function onMove(ev) {
      const dx = ev.clientX - startX;
      const totalWidth = bodyRect.width - dividerWidth * 2;
      const dFrac = dx / totalWidth;
      if (dividerKey === 'a-b') {
        const newA = Math.max(0.1, Math.min(sumAB - 0.1, initial[0] + dFrac));
        slotFractions[0] = newA;
        slotFractions[1] = sumAB - newA;
      } else {
        const newB = Math.max(0.1, Math.min(sumBC - 0.1, initial[1] + dFrac));
        slotFractions[1] = newB;
        slotFractions[2] = sumBC - newB;
      }
      applyGridTemplate();
      // Push geometry on next frame
      requestAnimationFrame(pushGeometryToRust);
    }
    function onUp(ev) {
      el.releasePointerCapture(event.pointerId);
      el.classList.remove('is-dragging');
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    }
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  });
}
dividerEls.forEach(bindDivider);

// Listen for drag-began event so we can update status / show overlay.
listen('drag-began', (event) => {
  setStatus(`drag started by ${event.payload.source}`);
});
listen('drag-ended', () => {
  setStatus('ready — drag cards across boards');
});

// Escape key cancels active drag (forwarded to Rust).
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    invoke('drag_cancel').catch(() => {});
  }
});

applyGridTemplate();
pushInitialGeometry();

// ── FPS counter ─────────────────────────────────────────────────
// Measures the shell webview's main-thread paint rate. During a
// dock-divider drag, this is the FPS at which the shell can keep
// up with pointer events + IPC calls + grid template updates.
// Each child webview's content reflows in its own process, so it
// doesn't show up here — that's the whole point: shell perf is
// independent of board content density.
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
