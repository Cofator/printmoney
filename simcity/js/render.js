/* ============================================================
 * Micropolis 2000 — render.js
 * Isometric camera, main canvas draw loop, overlays, minimap.
 * ============================================================ */
'use strict';

const CAM = {
  x: 0, y: 0,       // screen offset of world origin (in canvas px, pre-zoom)
  zoom: 1,
  min: 0.35, max: 2.5,
};

function worldToScreen(wx, wy) { // tile coords (float) -> canvas px
  return [
    ((wx - wy) * HALF_W + CAM.x) * CAM.zoom,
    ((wx + wy) * HALF_H + CAM.y) * CAM.zoom,
  ];
}
function screenToWorld(px, py) { // canvas px -> tile coords (float)
  const ux = px / CAM.zoom - CAM.x, uy = py / CAM.zoom - CAM.y;
  return [
    (ux / HALF_W + uy / HALF_H) / 2,
    (uy / HALF_H - ux / HALF_W) / 2,
  ];
}

function centerCamera(canvas) {
  const [cx, cy] = [W / 2, H / 2];
  CAM.x = canvas.width / (2 * CAM.zoom) - (cx - cy) * HALF_W;
  CAM.y = canvas.height / (2 * CAM.zoom) - (cx + cy) * HALF_H;
}

const OVERLAYS = {
  none: null,
  power: { label: 'Power grid' },
  water: { label: 'Water coverage' },
  poll: { label: 'Pollution' },
  crime: { label: 'Crime' },
  lval: { label: 'Land value' },
  traffic: { label: 'Traffic' },
  pcov: { label: 'Police coverage' },
  fcov: { label: 'Fire coverage' },
  ecov: { label: 'Education' },
  hcov: { label: 'Health' },
};

function overlayColor(mode, S, i) {
  switch (mode) {
    case 'power':
      if (!isConductor(S, i)) return null;
      return S.pwr[i] ? 'rgba(80,255,120,0.55)' : 'rgba(255,60,60,0.65)';
    case 'water':
      return S.wtr[i] ? 'rgba(60,160,255,0.45)' : null;
    case 'poll': return heat(S.poll[i], [255, 40, 200]);
    case 'crime': return heat(S.crime[i], [255, 60, 60]);
    case 'lval': return heat(S.lval[i], [60, 220, 120]);
    case 'traffic': return heat(S.traffic[i], [255, 170, 40]);
    case 'pcov': return heat(S.pcov[i], [70, 120, 255]);
    case 'fcov': return heat(S.fcov[i], [255, 120, 60]);
    case 'ecov': return heat(S.ecov[i], [180, 120, 255]);
    case 'hcov': return heat(S.hcov[i], [255, 255, 120]);
  }
  return null;
}
function heat(v, rgb) {
  if (v < 8) return null;
  const a = Math.min(0.72, v / 255 * 0.9);
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(2)})`;
}

// Draw the whole scene.
function renderWorld(ctx, S, view) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  ctx.fillStyle = '#101820';
  ctx.fillRect(0, 0, cw, ch);
  ctx.save();
  if (view.shakeAmt) {
    ctx.translate((Math.random() - 0.5) * view.shakeAmt, (Math.random() - 0.5) * view.shakeAmt);
  }
  ctx.scale(CAM.zoom, CAM.zoom);
  ctx.translate(CAM.x, CAM.y);
  ctx.imageSmoothingEnabled = CAM.zoom < 1;

  // visible tile bounds (conservative)
  const corners = [screenToWorld(0, -SPRITE_PAD_TOP * CAM.zoom), screenToWorld(cw, 0), screenToWorld(0, ch), screenToWorld(cw, ch + TILE_H * CAM.zoom)];
  let minX = W, maxX = 0, minY = H, maxY = 0;
  for (const c of corners) {
    minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
    minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
  }
  minX = clamp(Math.floor(minX) - 2, 0, W - 1); maxX = clamp(Math.ceil(maxX) + 2, 0, W - 1);
  minY = clamp(Math.floor(minY) - 4, 0, H - 1); maxY = clamp(Math.ceil(maxY) + 4, 0, H - 1);

  const anim = view.animFrame;
  const mode = view.overlay;

  // draw in painter order (y then x works for iso diamonds row by row)
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      const i = ty * W + tx;
      const t = S.type[i];
      // Multi-tile buildings are drawn once, when the loop reaches the
      // bottom corner of their footprint (correct painter order).
      let sprite = null, ax = tx, ay = ty;
      const bHere = BLD[t];
      if (bHere && bHere.size > 1) {
        const a = S.anch[i];
        if (a < 0) continue;
        const bb = BLD[S.type[a]];
        if (!bb) continue;
        ax = a % W; ay = (a / W) | 0;
        if (tx !== ax + bb.size - 1 || ty !== ay + bb.size - 1) continue;
        sprite = spriteForTile(S, a, anim);
      } else {
        sprite = spriteForTile(S, i, anim);
      }
      if (!sprite) continue;
      // sprite's footprint top corner maps to canvas (w/2, PAD)
      ctx.drawImage(sprite,
        (ax - ay) * HALF_W - sprite.width / 2,
        (ax + ay) * HALF_H - SPRITE_PAD_TOP);

      if (S.wireOn[i]) {
        const ws = wireOverlaySprite(S, i);
        ctx.drawImage(ws,
          (tx - ty) * HALF_W - ws.width / 2,
          (tx + ty) * HALF_H - SPRITE_PAD_TOP);
      }

      // overlay tint
      if (mode) {
        const col = overlayColor(mode, S, i);
        if (col) {
          const cx0 = (tx - ty) * HALF_W, cy0 = (tx + ty) * HALF_H;
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(cx0, cy0);
          ctx.lineTo(cx0 + HALF_W, cy0 + HALF_H);
          ctx.lineTo(cx0, cy0 + TILE_H);
          ctx.lineTo(cx0 - HALF_W, cy0 + HALF_H);
          ctx.closePath();
          ctx.fill();
        }
      }
      // no-power blink icon on zones
      if ((t === B_RES || t === B_COM || t === B_IND) && S.lvl[i] > 0 && !S.pwr[i] && (anim & 2)) {
        const cx0 = (tx - ty) * HALF_W, cy0 = (tx + ty) * HALF_H;
        ctx.fillStyle = '#ffd52e';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('⚡', cx0, cy0 - 6);
      }
      // fire
      if (S.fire[i]) {
        const fs = getSprite('fire' + (anim & 1), 1, (c, o) => paintFire(c, o, anim & 1));
        const cx0 = (tx - ty) * HALF_W, cy0 = (tx + ty) * HALF_H;
        ctx.drawImage(fs, cx0 - fs.width / 2, cy0 + TILE_H - fs.height);
      }
    }
  }

  // disasters (tornado / monster icons)
  for (const d of S.disasters) {
    const [sx, sy] = [(d.x - d.y) * HALF_W, (d.x + d.y) * HALF_H];
    ctx.font = '28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.kind === DIS_TORNADO ? '🌪️' : '👾', sx, sy - 4 - (anim & 1) * 3);
  }

  // hover ghost / drag rect
  if (view.ghost) drawGhost(ctx, S, view.ghost);

  // remote player cursors
  if (view.cursors) {
    for (const c of view.cursors) {
      const [sx, sy] = [(c.x - c.y) * HALF_W, (c.x + c.y) * HALF_H];
      ctx.strokeStyle = c.color; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy); ctx.lineTo(sx + HALF_W, sy + HALF_H); ctx.lineTo(sx, sy + TILE_H); ctx.lineTo(sx - HALF_W, sy + HALF_H);
      ctx.closePath(); ctx.stroke();
      ctx.fillStyle = c.color;
      ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(c.name, sx, sy - 6);
    }
  }
  ctx.restore();
}

function drawGhost(ctx, S, g) {
  // g = {tool, x, y, x1, y1, ok}   (x1,y1 for drag lines/rects)
  const tiles = ghostTiles(g);
  for (const [tx, ty] of tiles) {
    if (!inBounds(tx, ty)) continue;
    const sx = (tx - ty) * HALF_W, sy = (tx + ty) * HALF_H;
    ctx.beginPath();
    ctx.moveTo(sx, sy); ctx.lineTo(sx + HALF_W, sy + HALF_H); ctx.lineTo(sx, sy + TILE_H); ctx.lineTo(sx - HALF_W, sy + HALF_H);
    ctx.closePath();
    ctx.fillStyle = g.ok ? 'rgba(120,255,140,0.3)' : 'rgba(255,80,80,0.35)';
    ctx.fill();
    ctx.strokeStyle = g.ok ? 'rgba(160,255,180,0.9)' : 'rgba(255,120,120,0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

// tiles the current tool application would affect
function ghostTiles(g) {
  const out = [];
  const b = BLD[g.tool];
  if (b && !b.drag) { // footprint
    for (let dy = 0; dy < b.size; dy++) for (let dx = 0; dx < b.size; dx++) out.push([g.x + dx, g.y + dy]);
    return out;
  }
  if (g.x1 == null) { out.push([g.x, g.y]); return out; }
  // drag: roads/wires/rails follow an L path; zones/parks/doze fill the rect
  const isLine = g.tool === B_ROAD || g.tool === B_WIRE || g.tool === B_RAIL;
  if (isLine) {
    const dx = Math.sign(g.x1 - g.x), dy = Math.sign(g.y1 - g.y);
    let cx = g.x, cy = g.y;
    out.push([cx, cy]);
    while (cx !== g.x1) { cx += dx; out.push([cx, cy]); }
    while (cy !== g.y1) { cy += dy; out.push([cx, cy]); }
  } else {
    const x0 = Math.min(g.x, g.x1), x1 = Math.max(g.x, g.x1);
    const y0 = Math.min(g.y, g.y1), y1 = Math.max(g.y, g.y1);
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) out.push([xx, yy]);
  }
  return out;
}

/* ---------------- minimap ---------------- */
function renderMinimap(cv, S, mode) {
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let i = 0; i < NT; i++) {
    let r = 40, g = 90, b = 40;
    const t = S.type[i];
    if (S.terr[i] === T_WATER) { r = 30; g = 70; b = 160; }
    else if (S.terr[i] === T_TREE) { r = 25; g = 70; b = 30; }
    else if (S.terr[i] === T_SAND) { r = 180; g = 170; b = 110; }
    if (t === B_ROAD) { r = g = b = 70; }
    else if (t === B_RAIL) { r = 90; g = 75; b = 55; }
    else if (t === B_WIRE) { r = 150; g = 140; b = 60; }
    else if (t === B_RES) { const v = 90 + S.lvl[i] * 18; r = 40; g = v; b = 40; }
    else if (t === B_COM) { const v = 90 + S.lvl[i] * 18; r = 40; g = 60; b = v; }
    else if (t === B_IND) { const v = 90 + S.lvl[i] * 18; r = v; g = v - 20; b = 30; }
    else if (t !== B_NONE) { r = 170; g = 170; b = 180; }
    if (S.fire[i]) { r = 255; g = 120; b = 0; }
    if (mode && mode !== 'none') {
      const col = overlayColor(mode, S, i);
      if (col) {
        const m = col.match(/rgba?\((\d+),(\d+),(\d+),([\d.]+)\)/);
        if (m) {
          const a = parseFloat(m[4]);
          r = r * (1 - a) + (+m[1]) * a; g = g * (1 - a) + (+m[2]) * a; b = b * (1 - a) + (+m[3]) * a;
        }
      }
    }
    const p = i * 4;
    d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
  }
  // scale up
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  off.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(off, 0, 0, cv.width, cv.height);
  // viewport rectangle
  const mainCv = document.getElementById('game');
  const a = screenToWorld(0, 0), bpt = screenToWorld(mainCv.width, mainCv.height);
  const sx = cv.width / W, sy = cv.height / H;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
  ctx.strokeRect(
    Math.min(a[0], bpt[0]) * sx, Math.min(a[1], bpt[1]) * sy,
    Math.abs(bpt[0] - a[0]) * sx, Math.abs(bpt[1] - a[1]) * sy);
}
