/* ============================================================
 * Micropolis 2000 — main.js
 * Boot, title screen, game loop, mouse/keyboard/touch input.
 * ============================================================ */
'use strict';

const GAME = {
  S: null,
  speed: 1,            // 0 pause, 1, 2, 4
  started: false,
  replaceState(newS) {
    this.S = newS;
    markPowerDirty();
  },
  setSpeed(v, fromNet) {
    this.speed = v;
    updateTopbar(this.S, this.speed);
    if (!fromNet && Net.mode === 'host') hostBroadcast({ t: 'speed', v });
  },
};
window.GAME = GAME;

// guests receive speed changes
const _guestHandleOrig = guestHandle;
guestHandle = function (m) {
  if (m.t === 'speed') { GAME.setSpeed(m.v, true); return; }
  if ((m.t === 'welcome' || m.t === 'sync') && m.speed != null) GAME.speed = m.v != null ? m.v : m.speed;
  _guestHandleOrig(m);
};

/* ---------------- boot / title ---------------- */
function boot() {
  const canvas = $('game');
  const resize = () => {
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
  };
  window.addEventListener('resize', resize);
  resize();

  // title screen
  const params = new URLSearchParams(location.search);
  const room = params.get('room');
  if (room) {
    $('titleJoinRow').style.display = '';
    $('titleRoom').textContent = room.toUpperCase();
  }
  $('newCityBtn').onclick = () => {
    const name = $('cityName').value.trim() || 'New City';
    const seedTxt = $('mapSeed').value.trim();
    const seed = seedTxt ? [...seedTxt].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) : (Math.random() * 0xFFFFFFFF) >>> 0;
    startGame(newCity(seed, name));
  };
  $('titleJoinBtn').onclick = () => {
    const name = $('titleName').value.trim() || 'Visitor';
    localStorage.setItem('micropolis2k.name', name);
    $('titleJoinBtn').disabled = true;
    $('titleJoinStatus').textContent = 'Connecting to room ' + room.toUpperCase() + '…';
    // start with a placeholder city; the host snapshot replaces it
    startGame(newCity(1234, 'Joining…'), true);
    $('mpName').value = name;
    netJoin(room, name, (err) => {
      $('titleJoinStatus').textContent = 'Could not join: ' + err;
      addTicker('Could not join room: ' + err, 'bad');
    });
  };
  $('titleLoadBtn').onclick = () => {
    for (let k = 1; k <= 3; k++) {
      const raw = localStorage.getItem(SAVE_PREFIX + k);
      if (raw) {
        try { startGame(deserializeState(JSON.parse(raw))); return; } catch (e) { /* try next */ }
      }
    }
    $('titleLoadStatus').textContent = 'No saved city found.';
  };
  const savedName = localStorage.getItem('micropolis2k.name');
  if (savedName) $('titleName').value = savedName;
}

function newCity(seed, name) {
  const S = newState(seed, name);
  generateTerrain(S);
  recomputeRoads(S);
  recomputeCoverage(S);
  recomputeCrimeAndValue(S);
  return S;
}

function startGame(S, joining) {
  GAME.S = S;
  GAME.started = true;
  $('title').style.display = 'none';
  $('hud').style.display = '';
  initUI(GAME);
  centerCamera($('game'));
  if (!joining) addTicker('🏗️ Welcome to ' + S.cityName + '! You have ' + fmtMoney(S.funds) + ' to build your dream city.', 'good');
  requestAnimationFrame(frame);
}

/* ---------------- input ---------------- */
const Input = {
  drag: null,          // {tool, x, y, x1, y1} while placing
  panning: false,
  lastPan: null,
  hover: null,         // [tx, ty]
  pinch: null,
};

function canvasPos(e) {
  const cv = $('game');
  const r = cv.getBoundingClientRect();
  return [(e.clientX - r.left) * devicePixelRatio, (e.clientY - r.top) * devicePixelRatio];
}
function tileAt(e) {
  const [px, py] = canvasPos(e);
  const [wx, wy] = screenToWorld(px, py);
  return [Math.floor(wx), Math.floor(wy)];
}

function isDragTool(tool) {
  if (tool === TOOL_DOZE || tool === TOOL_TERRA_TREE || tool === TOOL_TERRA_WATER || tool === TOOL_TERRA_LAND) return true;
  const b = BLD[tool];
  return !!(b && b.drag);
}

function applyToolAt(tool, tx, ty) {
  if (!inBounds(tx, ty)) return;
  if (tool === TOOL_INSPECT) { showInspect(GAME.S, tx, ty); return; }
  if (tool === TOOL_DOZE) { netAction({ t: 'doze', x: tx, y: ty }); return; }
  if (tool === TOOL_TERRA_TREE) { netAction({ t: 'terr', kind: 'tree', x: tx, y: ty }); return; }
  if (tool === TOOL_TERRA_WATER) { netAction({ t: 'terr', kind: 'water', x: tx, y: ty }); return; }
  if (tool === TOOL_TERRA_LAND) { netAction({ t: 'terr', kind: 'land', x: tx, y: ty }); return; }
  netAction({ t: 'build', code: +tool, x: tx, y: ty });
}

function commitDrag() {
  const d = Input.drag;
  if (!d) return;
  const tiles = ghostTiles(d);
  for (const [tx, ty] of tiles) applyToolAt(d.tool, tx, ty);
  Input.drag = null;
}

function initInput() {
  const cv = $('game');

  cv.addEventListener('mousedown', (e) => {
    if (!GAME.started) return;
    if (e.button === 1 || e.button === 2) {
      Input.panning = true;
      Input.lastPan = [e.clientX, e.clientY];
      e.preventDefault();
      return;
    }
    if (e.button === 0) {
      const [tx, ty] = tileAt(e);
      if (!inBounds(tx, ty)) return;
      if (UI.tool === TOOL_INSPECT) { showInspect(GAME.S, tx, ty); return; }
      if (isDragTool(UI.tool)) Input.drag = { tool: UI.tool, x: tx, y: ty, x1: tx, y1: ty };
      else applyToolAt(UI.tool, tx, ty);
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (!GAME.started) return;
    if (Input.panning && Input.lastPan) {
      CAM.x += (e.clientX - Input.lastPan[0]) * devicePixelRatio / CAM.zoom;
      CAM.y += (e.clientY - Input.lastPan[1]) * devicePixelRatio / CAM.zoom;
      Input.lastPan = [e.clientX, e.clientY];
      return;
    }
    const [tx, ty] = tileAt(e);
    Input.hover = [tx, ty];
    if (Input.drag) { Input.drag.x1 = tx; Input.drag.y1 = ty; }
    if (inBounds(tx, ty)) netSendCursor(tx, ty);
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 1 || e.button === 2) { Input.panning = false; return; }
    if (e.button === 0 && Input.drag) commitDrag();
  });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [px, py] = canvasPos(e);
    const [wx0, wy0] = screenToWorld(px, py);
    CAM.zoom = clamp(CAM.zoom * (e.deltaY < 0 ? 1.15 : 0.87), CAM.min, CAM.max);
    // keep the point under the cursor fixed
    const [wx1, wy1] = screenToWorld(px, py);
    CAM.x += ((wx1 - wx0) - (wy1 - wy0)) * HALF_W;
    CAM.y += ((wx1 - wx0) + (wy1 - wy0)) * HALF_H;
  }, { passive: false });

  // touch: 1 finger = tool, 2 fingers = pan/zoom
  cv.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      Input.pinch = {
        d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2,
      };
      Input.drag = null;
    } else if (e.touches.length === 1) {
      const [tx, ty] = tileAt(e.touches[0]);
      if (inBounds(tx, ty) && isDragTool(UI.tool)) Input.drag = { tool: UI.tool, x: tx, y: ty, x1: tx, y1: ty };
    }
    e.preventDefault();
  }, { passive: false });
  cv.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && Input.pinch) {
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2;
      CAM.zoom = clamp(CAM.zoom * d / Input.pinch.d, CAM.min, CAM.max);
      CAM.x += (cx - Input.pinch.cx) * devicePixelRatio / CAM.zoom;
      CAM.y += (cy - Input.pinch.cy) * devicePixelRatio / CAM.zoom;
      Input.pinch = { d, cx, cy };
    } else if (e.touches.length === 1 && Input.drag) {
      const [tx, ty] = tileAt(e.touches[0]);
      Input.drag.x1 = tx; Input.drag.y1 = ty;
      Input.hover = [tx, ty];
    }
    e.preventDefault();
  }, { passive: false });
  cv.addEventListener('touchend', (e) => {
    if (Input.pinch && e.touches.length < 2) { Input.pinch = null; return; }
    if (Input.drag && e.touches.length === 0) {
      if (UI.tool === TOOL_INSPECT) showInspect(GAME.S, Input.drag.x, Input.drag.y);
      else commitDrag();
    } else if (e.changedTouches.length === 1 && !Input.drag && UI.tool === TOOL_INSPECT) {
      const [tx, ty] = tileAt(e.changedTouches[0]);
      if (inBounds(tx, ty)) showInspect(GAME.S, tx, ty);
    }
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (!GAME.started) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { Input.drag = null; closeModals(); }
    else if (k === ' ') { GAME.setSpeed(GAME.speed === 0 ? 1 : 0); e.preventDefault(); }
    else if (k === 'q') setTool(TOOL_INSPECT);
    else if (k === 'b') setTool(TOOL_DOZE);
    else if (k === 'r') setTool(B_ROAD);
    else if (k === 'p') setTool(B_WIRE);
    else if (k === 't') setTool(TOOL_TERRA_TREE);
    else if (k === '1') setTool(B_RES);
    else if (k === '2') setTool(B_COM);
    else if (k === '3') setTool(B_IND);
    else if (k === 'arrowup') CAM.y += 60 / CAM.zoom;
    else if (k === 'arrowdown') CAM.y -= 60 / CAM.zoom;
    else if (k === 'arrowleft') CAM.x += 60 / CAM.zoom;
    else if (k === 'arrowright') CAM.x -= 60 / CAM.zoom;
    else if (k === '+' || k === '=') CAM.zoom = clamp(CAM.zoom * 1.15, CAM.min, CAM.max);
    else if (k === '-') CAM.zoom = clamp(CAM.zoom * 0.87, CAM.min, CAM.max);
  });
}

/* ---------------- main loop ---------------- */
let _acc = 0, _lastT = 0, _animFrame = 0, _animT = 0, _mmT = 0;

function frame(t) {
  const S = GAME.S;
  const dt = Math.min(100, t - _lastT);
  _lastT = t;

  // simulation stepping (host & solo authoritative; guests predict between syncs)
  if (GAME.speed > 0) {
    _acc += dt * GAME.speed;
    let guard = 0;
    while (_acc >= SIM.STEP_MS && guard++ < 8) {
      _acc -= SIM.STEP_MS;
      simStep(S);
    }
  }

  // animation frame counter (water, fire, blink) ~4Hz
  _animT += dt;
  if (_animT > 240) { _animT = 0; _animFrame++; }

  // network upkeep
  netTick(t);
  pumpNews();

  // ghost preview
  let ghost = null;
  if (Input.drag) {
    ghost = { ...Input.drag, ok: true };
  } else if (Input.hover && UI.tool !== TOOL_INSPECT && inBounds(Input.hover[0], Input.hover[1])) {
    const [hx, hy] = Input.hover;
    let ok = true;
    if (BLD[UI.tool]) ok = !placeError(S, +UI.tool, hx, hy) && S.funds >= toolCost(UI.tool);
    ghost = { tool: UI.tool, x: hx, y: hy, x1: null, y1: null, ok };
  }

  if (UI.shake > 0) UI.shake--;

  const cursors = [];
  for (const [id, c] of Net.cursors) if (id !== Net.myId) cursors.push(c);

  const ctx = $('game').getContext('2d');
  renderWorld(ctx, S, {
    animFrame: _animFrame,
    overlay: UI.overlay,
    ghost,
    cursors,
    shakeAmt: UI.shake > 0 ? UI.shake / 2 : 0,
  });

  updateTopbar(S, GAME.speed);

  _mmT += dt;
  if (_mmT > 500) {
    _mmT = 0;
    renderMinimap($('minimap'), S, UI.minimapMode);
  }

  requestAnimationFrame(frame);
}

window.addEventListener('DOMContentLoaded', () => {
  boot();
  initInput();
});
