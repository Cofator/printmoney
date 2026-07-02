/* ============================================================
 * Micropolis 2000 — sprites.js
 * Procedural isometric sprite painter. No external assets:
 * every tile & building is drawn onto cached offscreen canvases.
 * Sprites are baked at 2x resolution for an anti-aliased,
 * realistic look, with a consistent NW light + SE cast shadows.
 * ============================================================ */
'use strict';

const TILE_W = 64, TILE_H = 32, HALF_W = 32, HALF_H = 16;
const SPRITE_PAD_TOP = 110; // headroom above footprint for tall buildings
const SPRITE_SCALE = 2;     // bake resolution multiplier

const SpriteCache = new Map();

function shade(c, f) {
  return `rgb(${clamp(c[0] * f, 0, 255) | 0},${clamp(c[1] * f, 0, 255) | 0},${clamp(c[2] * f, 0, 255) | 0})`;
}
function rgba(c, f, a) {
  return `rgba(${clamp(c[0] * f, 0, 255) | 0},${clamp(c[1] * f, 0, 255) | 0},${clamp(c[2] * f, 0, 255) | 0},${a})`;
}

function makeSprite(n, painter) {
  const w = n * TILE_W, h = n * TILE_H + SPRITE_PAD_TOP;
  const cv = document.createElement('canvas');
  cv.width = w * SPRITE_SCALE; cv.height = h * SPRITE_SCALE;
  cv._w = w; cv._h = h; // logical dims used by the renderer
  const ctx = cv.getContext('2d');
  ctx.scale(SPRITE_SCALE, SPRITE_SCALE);
  const o = {
    n,
    sx: (u, v) => (u - v) * HALF_W + w / 2,
    sy: (u, v, z) => (u + v) * HALF_H + SPRITE_PAD_TOP - (z || 0),
  };
  painter(ctx, o);
  return cv;
}

function quad(ctx, pts, fill) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/* Lighting model: sun from the NW.
 * top faces 1.12 · SE (right) faces 0.82 · SW (left) faces 0.58 */
function box(ctx, o, u0, v0, u1, v1, z0, z1, c) {
  const A = [o.sx(u0, v0), o.sy(u0, v0, z1)];
  const B = [o.sx(u1, v0), o.sy(u1, v0, z1)];
  const C = [o.sx(u1, v1), o.sy(u1, v1, z1)];
  const D = [o.sx(u0, v1), o.sy(u0, v1, z1)];
  const Bb = [o.sx(u1, v0), o.sy(u1, v0, z0)];
  const Cb = [o.sx(u1, v1), o.sy(u1, v1, z0)];
  const Db = [o.sx(u0, v1), o.sy(u0, v1, z0)];
  // right (SE) face with subtle vertical gradient
  const gR = ctx.createLinearGradient(0, C[1], 0, Cb[1]);
  gR.addColorStop(0, shade(c, 0.86)); gR.addColorStop(1, shade(c, 0.74));
  quad(ctx, [B, C, Cb, Bb], gR);
  // left (SW) face, darker
  const gL = ctx.createLinearGradient(0, D[1], 0, Db[1]);
  gL.addColorStop(0, shade(c, 0.60)); gL.addColorStop(1, shade(c, 0.50));
  quad(ctx, [D, C, Cb, Db], gL);
  quad(ctx, [A, B, C, D], shade(c, 1.12)); // top
  // crisp top edge highlight
  ctx.strokeStyle = rgba(c, 1.35, 0.5); ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.moveTo(D[0], D[1]); ctx.lineTo(C[0], C[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
}

// soft SE-cast shadow blob under/next to a footprint
function castShadow(ctx, o, u0, v0, u1, v1, strength) {
  const cx = o.sx((u0 + u1) / 2, (v0 + v1) / 2) + 7;
  const cy = o.sy((u0 + u1) / 2, (v0 + v1) / 2, 0) + 3;
  const rx = (u1 - u0 + v1 - v0) * 0.5 * HALF_W * 0.75;
  const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, rx);
  g.addColorStop(0, `rgba(10,16,10,${strength || 0.30})`);
  g.addColorStop(1, 'rgba(10,16,10,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, rx * 0.5, 0, 0, 7); ctx.fill();
}

// pitched roof with ridge + shingle lines
function roof(ctx, o, u0, v0, u1, v1, zBase, zPeak, c) {
  const um = (u0 + u1) / 2;
  const A = [o.sx(u0, v0), o.sy(u0, v0, zBase)], B = [o.sx(u1, v0), o.sy(u1, v0, zBase)];
  const C = [o.sx(u1, v1), o.sy(u1, v1, zBase)], D = [o.sx(u0, v1), o.sy(u0, v1, zBase)];
  const P0 = [o.sx(um, v0), o.sy(um, v0, zPeak)], P1 = [o.sx(um, v1), o.sy(um, v1, zPeak)];
  quad(ctx, [B, C, P1, P0], shade(c, 0.94));  // sunlit slope
  quad(ctx, [A, D, P1, P0], shade(c, 0.66));  // shaded slope
  quad(ctx, [D, C, P1], shade(c, 0.52));      // gable end
  // shingle lines on the sunlit slope
  ctx.strokeStyle = rgba(c, 0.55, 0.5); ctx.lineWidth = 0.6;
  for (let t = 0.25; t < 1; t += 0.25) {
    ctx.beginPath();
    ctx.moveTo(B[0] + (P0[0] - B[0]) * t, B[1] + (P0[1] - B[1]) * t);
    ctx.lineTo(C[0] + (P1[0] - C[0]) * t, C[1] + (P1[1] - C[1]) * t);
    ctx.stroke();
  }
  // ridge highlight
  ctx.strokeStyle = rgba(c, 1.3, 0.8); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(P0[0], P0[1]); ctx.lineTo(P1[0], P1[1]); ctx.stroke();
}

/* window grids — deterministic mix of lit / dark panes */
function winsRight(ctx, o, u1, v0, v1, zLo, zHi, rows, cols, seed, litRatio) {
  for (let r = 0; r < rows; r++) {
    const z = zLo + (zHi - zLo) * (r + 0.5) / rows;
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const v = v0 + (v1 - v0) * (cIdx + 0.5) / cols;
      const x = o.sx(u1, v), y = o.sy(u1, v, z);
      const lit = hash2(r, cIdx, seed) < (litRatio == null ? 0.4 : litRatio);
      ctx.fillStyle = lit ? '#ffd98a' : '#26333f';
      ctx.fillRect(x - 1.7, y - 2.6, 3.4, 5.2);
      if (!lit) { ctx.fillStyle = 'rgba(160,200,230,0.25)'; ctx.fillRect(x - 1.7, y - 2.6, 3.4, 1.6); }
    }
  }
}
function winsLeft(ctx, o, u0, u1, v1, zLo, zHi, rows, cols, seed, litRatio) {
  for (let r = 0; r < rows; r++) {
    const z = zLo + (zHi - zLo) * (r + 0.5) / rows;
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const u = u0 + (u1 - u0) * (cIdx + 0.5) / cols;
      const x = o.sx(u, v1), y = o.sy(u, v1, z);
      const lit = hash2(r + 31, cIdx, seed) < (litRatio == null ? 0.3 : litRatio);
      ctx.fillStyle = lit ? '#e8b968' : '#1b2733';
      ctx.fillRect(x - 1.7, y - 2.6, 3.4, 5.2);
    }
  }
}

function diamondPath(ctx, o, u0, v0, u1, v1, z) {
  ctx.beginPath();
  ctx.moveTo(o.sx(u0, v0), o.sy(u0, v0, z));
  ctx.lineTo(o.sx(u1, v0), o.sy(u1, v0, z));
  ctx.lineTo(o.sx(u1, v1), o.sy(u1, v1, z));
  ctx.lineTo(o.sx(u0, v1), o.sy(u0, v1, z));
  ctx.closePath();
}

function groundDiamond(ctx, o, n, fill) {
  diamondPath(ctx, o, 0, 0, n, n, 0);
  ctx.fillStyle = fill;
  ctx.fill();
}

// grass base with tonal variation and speckles
function grassBase(ctx, o, n, variant) {
  const t = hash2(variant, 3, 17);
  const base = [92 + t * 14, 138 + t * 16, 70 + t * 10];
  groundDiamond(ctx, o, n, shade(base, 1));
  // mottling
  for (let k = 0; k < 14 * n * n; k++) {
    const u = hash2(k, variant, 5) * n, v = hash2(variant, k, 9) * n;
    const f = 0.9 + hash2(k, variant, 13) * 0.28;
    ctx.fillStyle = rgba(base, f, 0.5);
    const x = o.sx(u, v), y = o.sy(u, v, 0);
    ctx.beginPath(); ctx.ellipse(x, y, 2.6, 1.3, 0, 0, 7); ctx.fill();
  }
  // clip mottling that spilled outside the diamond
  ctx.save();
  diamondPath(ctx, o, 0, 0, n, n, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fill();
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
  // faint tile edge (ambient occlusion between tiles)
  diamondPath(ctx, o, 0, 0, n, n, 0);
  ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 0.6; ctx.stroke();
}

function drawPine(ctx, x, y, s, tone) {
  ctx.fillStyle = 'rgba(10,20,10,0.25)';
  ctx.beginPath(); ctx.ellipse(x + 3, y + 1, 6 * s, 2.6 * s, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#4a3620';
  ctx.fillRect(x - 1, y - 4 * s, 2, 4 * s);
  const dark = [[36, 82, 40], [30, 74, 36], [42, 92, 44]][tone % 3];
  for (let L = 0; L < 3; L++) {
    const w = (6 - L * 1.5) * s, top = (10 + L * 6) * s, bot = (2 + L * 6) * s;
    const g = ctx.createLinearGradient(x - w, 0, x + w, 0);
    g.addColorStop(0, shade(dark, 0.65)); g.addColorStop(0.55, shade(dark, 1.15)); g.addColorStop(1, shade(dark, 0.85));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(x, y - top - 6 * s); ctx.lineTo(x + w, y - bot); ctx.lineTo(x - w, y - bot); ctx.closePath(); ctx.fill();
  }
}
function drawBroadleaf(ctx, x, y, s, tone) {
  ctx.fillStyle = 'rgba(10,20,10,0.25)';
  ctx.beginPath(); ctx.ellipse(x + 3, y + 1, 7 * s, 3 * s, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#4a3620';
  ctx.fillRect(x - 1, y - 7 * s, 2, 7 * s);
  const base = [[52, 110, 48], [66, 122, 44], [46, 100, 52]][tone % 3];
  for (const [dx, dy, r, f] of [[-3, -9, 4.5, 0.8], [3, -10, 4.2, 1.0], [0, -14, 4.6, 1.15], [-1, -8, 3.6, 0.95]]) {
    ctx.fillStyle = shade(base, f);
    ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, r * s, 0, 7); ctx.fill();
  }
}
function drawTreeAt(ctx, x, y, s, tone) {
  if (tone % 3 === 1) drawBroadleaf(ctx, x, y, s, tone);
  else drawPine(ctx, x, y, s, tone);
}

/* ---------------- terrain sprites ---------------- */
function paintGrass(ctx, o, variant) { grassBase(ctx, o, 1, variant); }

// water with depth gradient + foam on shores (mask bits: 1 N, 2 E, 4 S, 8 W)
function paintWater(ctx, o, mask, frame) {
  const top = o.sy(0, 0, 0), bot = o.sy(1, 1, 0);
  const g = ctx.createLinearGradient(0, top, 0, bot);
  g.addColorStop(0, frame ? '#2666a8' : '#2461a1');
  g.addColorStop(1, frame ? '#1c4d85' : '#1e5089');
  diamondPath(ctx, o, 0, 0, 1, 1, 0);
  ctx.fillStyle = g; ctx.fill();
  // shimmer
  ctx.strokeStyle = 'rgba(210,235,255,0.22)';
  ctx.lineWidth = 0.8;
  for (let k = 0; k < 4; k++) {
    const u = 0.15 + hash2(k, frame, 11) * 0.6, v = 0.15 + hash2(frame + 3, k, 13) * 0.6;
    const x = o.sx(u, v), y = o.sy(u, v, 0);
    ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.quadraticCurveTo(x, y - 1.6, x + 5, y); ctx.stroke();
  }
  // foam along land edges
  ctx.strokeStyle = frame ? 'rgba(235,245,255,0.55)' : 'rgba(225,240,252,0.45)';
  ctx.lineWidth = 1.6;
  const E = {
    1: [[0, 0], [1, 0]], 2: [[1, 0], [1, 1]], 4: [[1, 1], [0, 1]], 8: [[0, 1], [0, 0]],
  };
  for (const b of [1, 2, 4, 8]) {
    if (!(mask & b)) continue;
    const [[ua, va], [ub, vb]] = E[b];
    ctx.beginPath();
    ctx.moveTo(o.sx(ua, va), o.sy(ua, va, 0));
    ctx.lineTo(o.sx(ub, vb), o.sy(ub, vb, 0));
    ctx.stroke();
  }
}
function paintSand(ctx, o, variant) {
  const base = [196, 180, 128];
  groundDiamond(ctx, o, 1, shade(base, 1));
  for (let k = 0; k < 10; k++) {
    const u = hash2(k, variant, 25), v = hash2(variant, k, 27);
    ctx.fillStyle = rgba(base, 0.86 + hash2(k, variant, 29) * 0.3, 0.6);
    const x = o.sx(u, v), y = o.sy(u, v, 0);
    ctx.beginPath(); ctx.ellipse(x, y, 2.2, 1.1, 0, 0, 7); ctx.fill();
  }
  ctx.save(); diamondPath(ctx, o, 0, 0, 1, 1, 0);
  ctx.globalCompositeOperation = 'destination-in'; ctx.fill(); ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
}
function paintRubble(ctx, o, variant) {
  groundDiamond(ctx, o, 1, '#5d5a52');
  for (let k = 0; k < 9; k++) {
    const u = 0.12 + hash2(k, variant, 21) * 0.72, v = 0.12 + hash2(variant, k, 23) * 0.72;
    const x = o.sx(u, v), y = o.sy(u, v, 0);
    const s = 1.5 + hash2(k, variant, 31) * 3;
    ctx.fillStyle = ['#4a463f', '#6d6a62', '#3b3833'][k % 3];
    ctx.beginPath();
    ctx.moveTo(x - s, y); ctx.lineTo(x, y - s * 0.8); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s * 0.6);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = 'rgba(30,28,24,0.35)';
  ctx.beginPath(); ctx.ellipse(o.sx(0.5, 0.5), o.sy(0.5, 0.5, 0), 9, 4, 0, 0, 7); ctx.fill();
}
function paintTrees(ctx, o, variant) {
  grassBase(ctx, o, 1, variant);
  const cnt = 1 + variant % 3;
  for (let k = 0; k < cnt; k++) {
    const u = 0.3 + hash2(k, variant, 31) * 0.4, v = 0.3 + hash2(variant, k, 37) * 0.4;
    drawTreeAt(ctx, o.sx(u, v), o.sy(u, v, 0), 0.75 + hash2(k, variant, 41) * 0.5, variant + k);
  }
}

/* ---------------- roads / rails / wires (16 connection masks) ---- */
function edgeEnds(o, mask) {
  const ends = [];
  if (mask & 1) ends.push([o.sx(0.5, 0), o.sy(0.5, 0, 0)]);
  if (mask & 2) ends.push([o.sx(1, 0.5), o.sy(1, 0.5, 0)]);
  if (mask & 4) ends.push([o.sx(0.5, 1), o.sy(0.5, 1, 0)]);
  if (mask & 8) ends.push([o.sx(0, 0.5), o.sy(0, 0.5, 0)]);
  if (!ends.length) ends.push([o.sx(0.5, 0), o.sy(0.5, 0, 0)], [o.sx(0.5, 1), o.sy(0.5, 1, 0)]);
  return ends;
}

function paintRoad(ctx, o, mask) {
  // sidewalk base
  groundDiamond(ctx, o, 1, '#9a978f');
  diamondPath(ctx, o, 0, 0, 1, 1, 0);
  ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 0.7; ctx.stroke();
  const cx = o.sx(0.5, 0.5), cy = o.sy(0.5, 0.5, 0);
  const ends = edgeEnds(o, mask);
  ctx.save();
  diamondPath(ctx, o, 0, 0, 1, 1, 0); ctx.clip();
  // asphalt strips
  ctx.strokeStyle = '#3e3e44'; ctx.lineWidth = 17; ctx.lineCap = 'round';
  for (const e of ends) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(e[0], e[1]); ctx.stroke(); }
  // wear/tone variation
  ctx.strokeStyle = 'rgba(255,255,255,0.045)'; ctx.lineWidth = 10;
  for (const e of ends) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(e[0], e[1]); ctx.stroke(); }
  // curb line
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 0.8;
  for (const e of ends) {
    const dx = e[0] - cx, dy = e[1] - cy;
    const L = Math.hypot(dx, dy) || 1;
    const px = -dy / L * 9, py = dx / L * 9;
    for (const s of [1, -1]) {
      ctx.beginPath(); ctx.moveTo(cx + px * s, cy + py * s); ctx.lineTo(e[0] + px * s, e[1] + py * s); ctx.stroke();
    }
  }
  // center dashes only on straight segments (not big junctions)
  const nConn = (mask & 1 ? 1 : 0) + (mask & 2 ? 1 : 0) + (mask & 4 ? 1 : 0) + (mask & 8 ? 1 : 0);
  if (nConn <= 2) {
    ctx.strokeStyle = '#e8d878'; ctx.lineWidth = 1.1;
    ctx.setLineDash([4, 5]);
    for (const e of ends) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(e[0], e[1]); ctx.stroke(); }
    ctx.setLineDash([]);
  } else {
    // junction: paint crosswalk stripes on each arm
    ctx.strokeStyle = 'rgba(235,235,235,0.75)'; ctx.lineWidth = 1.3;
    for (const e of ends) {
      const dx = e[0] - cx, dy = e[1] - cy;
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L, px = -uy, py = ux;
      const bx = cx + ux * (L * 0.62), by = cy + uy * (L * 0.62);
      for (let s = -6; s <= 6; s += 2.4) {
        ctx.beginPath();
        ctx.moveTo(bx + px * s - ux * 1.6, by + py * s - uy * 1.6);
        ctx.lineTo(bx + px * s + ux * 1.6, by + py * s + uy * 1.6);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function paintRail(ctx, o, mask) {
  grassBase(ctx, o, 1, mask);
  const cx = o.sx(0.5, 0.5), cy = o.sy(0.5, 0.5, 0);
  const ends = edgeEnds(o, mask);
  ctx.save();
  diamondPath(ctx, o, 0, 0, 1, 1, 0); ctx.clip();
  // gravel ballast
  ctx.strokeStyle = '#6f675a'; ctx.lineWidth = 12; ctx.lineCap = 'round';
  for (const e of ends) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(e[0], e[1]); ctx.stroke(); }
  for (const e of ends) {
    const dx = e[0] - cx, dy = e[1] - cy;
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L, px = -uy, py = ux;
    // ties
    ctx.strokeStyle = '#4c3a26'; ctx.lineWidth = 1.6;
    for (let t = 0.12; t < 1; t += 0.16) {
      const bx = cx + dx * t, by = cy + dy * t;
      ctx.beginPath();
      ctx.moveTo(bx - px * 4.5, by - py * 4.5); ctx.lineTo(bx + px * 4.5, by + py * 4.5);
      ctx.stroke();
    }
    // twin rails with highlight
    for (const s of [2.6, -2.6]) {
      ctx.strokeStyle = '#8e939b'; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(cx + px * s, cy + py * s); ctx.lineTo(e[0] + px * s, e[1] + py * s); ctx.stroke();
      ctx.strokeStyle = 'rgba(230,240,250,0.6)'; ctx.lineWidth = 0.4;
      ctx.beginPath(); ctx.moveTo(cx + px * s, cy + py * s); ctx.lineTo(e[0] + px * s, e[1] + py * s); ctx.stroke();
    }
  }
  ctx.restore();
}

function paintWire(ctx, o, mask, noGround) {
  if (!noGround) grassBase(ctx, o, 1, mask + 40);
  const cx = o.sx(0.5, 0.5);
  const cy = o.sy(0.5, 0.5, 0);
  const topZ = 27;
  // pole shadow
  ctx.fillStyle = 'rgba(10,16,10,0.22)';
  ctx.beginPath(); ctx.ellipse(cx + 3, cy + 1, 5, 2, 0, 0, 7); ctx.fill();
  // pole with side shading
  const g = ctx.createLinearGradient(cx - 1.6, 0, cx + 1.6, 0);
  g.addColorStop(0, '#5a4227'); g.addColorStop(0.5, '#7a5c38'); g.addColorStop(1, '#4c3820');
  ctx.fillStyle = g;
  ctx.fillRect(cx - 1.6, cy - topZ, 3.2, topZ);
  // crossarm + insulators
  ctx.fillStyle = '#5f4830';
  ctx.fillRect(cx - 7, cy - topZ + 3, 14, 2);
  ctx.fillStyle = '#b9c4cc';
  ctx.fillRect(cx - 6, cy - topZ + 1.4, 2, 2); ctx.fillRect(cx + 4, cy - topZ + 1.4, 2, 2);
  // wires to connected edges (catenary sag)
  ctx.strokeStyle = 'rgba(25,25,28,0.85)'; ctx.lineWidth = 0.8;
  const endsZ = [];
  if (mask & 1) endsZ.push([o.sx(0.5, 0), o.sy(0.5, 0, topZ)]);
  if (mask & 2) endsZ.push([o.sx(1, 0.5), o.sy(1, 0.5, topZ)]);
  if (mask & 4) endsZ.push([o.sx(0.5, 1), o.sy(0.5, 1, topZ)]);
  if (mask & 8) endsZ.push([o.sx(0, 0.5), o.sy(0, 0.5, topZ)]);
  for (const e of endsZ) {
    for (const off of [-4.5, 4.5]) {
      ctx.beginPath(); ctx.moveTo(cx + (off < 0 ? -5 : 5), cy - topZ + 2.4);
      ctx.quadraticCurveTo((cx + e[0]) / 2 + off * 0.3, (cy - topZ + e[1]) / 2 + 6, e[0], e[1]);
      ctx.stroke();
    }
  }
}

/* ---------------- zones ---------------- */
const ZONE_TINT = { [B_RES]: '#4cae57', [B_COM]: '#4c86d6', [B_IND]: '#d6b53f' };
const ZONE_LETTER = { [B_RES]: 'R', [B_COM]: 'C', [B_IND]: 'I' };

function paintZoneEmpty(ctx, o, ztype) {
  // cleared dirt lot
  const base = [124, 104, 76];
  groundDiamond(ctx, o, 1, shade(base, 1));
  for (let k = 0; k < 8; k++) {
    const u = hash2(k, ztype, 61), v = hash2(ztype, k, 63);
    ctx.fillStyle = rgba(base, 0.85 + hash2(k, ztype, 65) * 0.3, 0.6);
    ctx.beginPath(); ctx.ellipse(o.sx(u, v), o.sy(u, v, 0), 2.4, 1.2, 0, 0, 7); ctx.fill();
  }
  ctx.save(); diamondPath(ctx, o, 0, 0, 1, 1, 0);
  ctx.globalCompositeOperation = 'destination-in'; ctx.fill(); ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = ZONE_TINT[ztype]; ctx.lineWidth = 1.4;
  ctx.setLineDash([3, 2.5]);
  diamondPath(ctx, o, 0.08, 0.08, 0.92, 0.92, 0); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = ZONE_TINT[ztype];
  ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(ZONE_LETTER[ztype], o.sx(0.5, 0.5), o.sy(0.5, 0.5, 0) + 3);
}

const HOUSE_WALLS = [[188, 154, 112], [201, 178, 140], [172, 134, 100], [162, 162, 168], [190, 160, 128]];
const ROOF_COLS = [[128, 58, 48], [96, 74, 58], [82, 88, 96], [118, 84, 52], [104, 52, 44]];

function paintRes(ctx, o, lvl, variant) {
  grassBase(ctx, o, 1, variant + 7);
  const wall = HOUSE_WALLS[variant % HOUSE_WALLS.length];
  const rc = ROOF_COLS[(variant + lvl) % ROOF_COLS.length];
  if (lvl <= 2) { // detached house with garden
    castShadow(ctx, o, 0.25, 0.3, 0.8, 0.85, 0.28);
    box(ctx, o, 0.28, 0.32, 0.78, 0.82, 0, 11, wall);
    roof(ctx, o, 0.22, 0.26, 0.84, 0.88, 11, 21, rc);
    // door + window
    const dx = o.sx(0.78, 0.62), dy = o.sy(0.78, 0.62, 0);
    ctx.fillStyle = '#4a3320'; ctx.fillRect(dx - 1.6, dy - 7, 3.2, 7);
    const wx = o.sx(0.78, 0.44), wy = o.sy(0.78, 0.44, 5.5);
    ctx.fillStyle = hash2(variant, 1, 71) < 0.5 ? '#ffd98a' : '#2a3845';
    ctx.fillRect(wx - 1.7, wy - 2.2, 3.4, 4.4);
    // garden
    drawTreeAt(ctx, o.sx(0.13, 0.72), o.sy(0.13, 0.72, 0), 0.5, variant);
    ctx.fillStyle = '#87b25f';
    ctx.beginPath(); ctx.ellipse(o.sx(0.5, 0.14), o.sy(0.5, 0.14, 0), 6, 2.6, 0, 0, 7); ctx.fill();
  } else if (lvl <= 4) { // two houses
    castShadow(ctx, o, 0.1, 0.15, 0.95, 0.9, 0.3);
    box(ctx, o, 0.1, 0.15, 0.55, 0.85, 0, 15, wall);
    roof(ctx, o, 0.05, 0.1, 0.6, 0.9, 15, 25, rc);
    const wall2 = HOUSE_WALLS[(variant + 2) % HOUSE_WALLS.length];
    box(ctx, o, 0.63, 0.35, 0.96, 0.85, 0, 11, wall2);
    roof(ctx, o, 0.59, 0.3, 1.0, 0.9, 11, 18, ROOF_COLS[(variant + 3) % ROOF_COLS.length]);
    winsRight(ctx, o, 0.55, 0.3, 0.75, 4, 12, 2, 2, variant * 3 + 1, 0.45);
  } else if (lvl <= 6) { // brick apartment block
    const hgt = 30 + lvl * 3;
    castShadow(ctx, o, 0.1, 0.1, 0.95, 0.95, 0.34);
    box(ctx, o, 0.12, 0.12, 0.88, 0.88, 0, hgt, [158, 108, 82]);
    // floor bands
    ctx.strokeStyle = 'rgba(60,35,25,0.35)'; ctx.lineWidth = 0.7;
    for (let z = 10; z < hgt - 4; z += 10) {
      ctx.beginPath();
      ctx.moveTo(o.sx(0.12, 0.88), o.sy(0.12, 0.88, z));
      ctx.lineTo(o.sx(0.88, 0.88), o.sy(0.88, 0.88, z));
      ctx.lineTo(o.sx(0.88, 0.12), o.sy(0.88, 0.12, z));
      ctx.stroke();
    }
    winsRight(ctx, o, 0.88, 0.2, 0.8, 5, hgt - 6, Math.max(3, lvl - 2), 3, variant * 7 + lvl, 0.5);
    winsLeft(ctx, o, 0.2, 0.8, 0.88, 5, hgt - 6, Math.max(3, lvl - 2), 3, variant * 5 + lvl, 0.35);
    // flat roof: parapet + AC units
    box(ctx, o, 0.12, 0.12, 0.88, 0.2, hgt, hgt + 2.5, [120, 80, 60]);
    box(ctx, o, 0.3, 0.4, 0.48, 0.58, hgt, hgt + 4, [168, 172, 178]);
    box(ctx, o, 0.58, 0.55, 0.72, 0.69, hgt, hgt + 3.5, [148, 152, 158]);
  } else { // residential tower
    const hgt = 54 + lvl * 4 + (variant % 3) * 6;
    castShadow(ctx, o, 0.1, 0.1, 1.0, 1.0, 0.38);
    box(ctx, o, 0.15, 0.15, 0.85, 0.85, 0, hgt, [172, 170, 176]);
    winsRight(ctx, o, 0.85, 0.2, 0.8, 6, hgt - 8, 7, 3, variant * 11 + 2, 0.55);
    winsLeft(ctx, o, 0.2, 0.8, 0.85, 6, hgt - 8, 7, 3, variant * 13 + 4, 0.4);
    // balconies band
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 0.7;
    for (let z = 12; z < hgt - 6; z += 12) {
      ctx.beginPath();
      ctx.moveTo(o.sx(0.15, 0.85), o.sy(0.15, 0.85, z));
      ctx.lineTo(o.sx(0.85, 0.85), o.sy(0.85, 0.85, z));
      ctx.stroke();
    }
    box(ctx, o, 0.38, 0.38, 0.62, 0.62, hgt, hgt + 6, [140, 138, 146]);
    // antenna
    const axp = o.sx(0.5, 0.5);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(axp, o.sy(0.5, 0.5, hgt + 6)); ctx.lineTo(axp, o.sy(0.5, 0.5, hgt + 16)); ctx.stroke();
    ctx.fillStyle = '#e33';
    ctx.beginPath(); ctx.arc(axp, o.sy(0.5, 0.5, hgt + 16), 1.2, 0, 7); ctx.fill();
  }
}

function paintCom(ctx, o, lvl, variant) {
  // paved lot
  groundDiamond(ctx, o, 1, '#8b8d90');
  diamondPath(ctx, o, 0, 0, 1, 1, 0);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 0.6; ctx.stroke();
  const SIGN_COLS = ['#d64545', '#3f9e63', '#d68f2e', '#7a5fd0', '#3f8ed0'];
  const sign = SIGN_COLS[variant % SIGN_COLS.length];
  if (lvl <= 2) { // corner shop with awning
    castShadow(ctx, o, 0.15, 0.2, 0.9, 0.9, 0.28);
    box(ctx, o, 0.15, 0.2, 0.85, 0.85, 0, 13, [198, 186, 164]);
    // storefront glass
    ctx.fillStyle = 'rgba(120,180,215,0.8)';
    const g0 = [o.sx(0.85, 0.3), o.sy(0.85, 0.3, 9)], g1 = [o.sx(0.85, 0.75), o.sy(0.85, 0.75, 9)];
    quad(ctx, [[g0[0], g0[1]], [g1[0], g1[1]], [g1[0], g1[1] + 8], [g0[0], g0[1] + 8]], 'rgba(130,190,225,0.85)');
    // awning
    quad(ctx, [
      [o.sx(0.88, 0.25), o.sy(0.88, 0.25, 10)], [o.sx(0.88, 0.8), o.sy(0.88, 0.8, 10)],
      [o.sx(1.0, 0.8), o.sy(1.0, 0.8, 6)], [o.sx(1.0, 0.25), o.sy(1.0, 0.25, 6)],
    ], sign);
    box(ctx, o, 0.15, 0.2, 0.85, 0.34, 13, 17, [90, 84, 78]);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 4.5px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('SHOP', o.sx(0.5, 0.27), o.sy(0.5, 0.27, 13.5));
  } else if (lvl <= 4) { // strip mall / mid-rise
    castShadow(ctx, o, 0.1, 0.15, 0.95, 0.95, 0.3);
    box(ctx, o, 0.1, 0.15, 0.9, 0.9, 0, 22, [148, 158, 170]);
    winsRight(ctx, o, 0.9, 0.2, 0.85, 4, 18, 2, 4, variant * 3, 0.7);
    winsLeft(ctx, o, 0.2, 0.85, 0.9, 4, 18, 2, 4, variant * 5, 0.5);
    box(ctx, o, 0.1, 0.15, 0.9, 0.3, 22, 26.5, [70, 66, 62]);
    ctx.fillStyle = sign;
    ctx.fillRect(o.sx(0.85, 0.22) - 7, o.sy(0.85, 0.22, 25.5), 14, 3.4);
  } else if (lvl <= 6) { // office block
    const hgt = 42 + lvl * 4;
    castShadow(ctx, o, 0.08, 0.08, 0.98, 0.98, 0.34);
    box(ctx, o, 0.12, 0.12, 0.88, 0.88, 0, hgt, [116, 142, 168]);
    winsRight(ctx, o, 0.88, 0.17, 0.83, 5, hgt - 5, 6, 4, variant * 7, 0.65);
    winsLeft(ctx, o, 0.17, 0.83, 0.88, 5, hgt - 5, 6, 4, variant * 9, 0.5);
    box(ctx, o, 0.3, 0.3, 0.5, 0.5, hgt, hgt + 4, [96, 118, 140]);
    box(ctx, o, 0.6, 0.55, 0.74, 0.69, hgt, hgt + 3, [150, 154, 160]);
  } else { // glass tower
    const hgt = 68 + lvl * 5 + (variant % 3) * 8;
    castShadow(ctx, o, 0.05, 0.05, 1.0, 1.0, 0.4);
    const glass = [64, 128, 176];
    box(ctx, o, 0.18, 0.18, 0.82, 0.82, 0, hgt, glass);
    // curtain-wall bands + sky reflection
    for (let z = 7; z < hgt - 4; z += 8) {
      const x0 = o.sx(0.82, 0.18), y0 = o.sy(0.82, 0.18, z);
      const x1 = o.sx(0.82, 0.82), y1 = o.sy(0.82, 0.82, z);
      const x2 = o.sx(0.18, 0.82), y2 = o.sy(0.18, 0.82, z);
      quad(ctx, [[x0, y0], [x1, y1], [x1, y1 + 2.6], [x0, y0 + 2.6]], `rgba(215,240,255,${0.32 + 0.25 * (z / hgt)})`);
      quad(ctx, [[x1, y1], [x2, y2], [x2, y2 + 2.6], [x1, y1 + 2.6]], 'rgba(190,225,248,0.2)');
    }
    // vertical mullions
    ctx.strokeStyle = 'rgba(30,60,85,0.5)'; ctx.lineWidth = 0.6;
    for (let t = 0.25; t < 1; t += 0.25) {
      const v = 0.18 + (0.82 - 0.18) * t;
      ctx.beginPath();
      ctx.moveTo(o.sx(0.82, v), o.sy(0.82, v, 0));
      ctx.lineTo(o.sx(0.82, v), o.sy(0.82, v, hgt));
      ctx.stroke();
    }
    box(ctx, o, 0.38, 0.38, 0.62, 0.62, hgt, hgt + 8, [52, 104, 148]);
    const axp = o.sx(0.5, 0.5);
    ctx.strokeStyle = '#444'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(axp, o.sy(0.5, 0.5, hgt + 8)); ctx.lineTo(axp, o.sy(0.5, 0.5, hgt + 20)); ctx.stroke();
  }
}

function paintInd(ctx, o, lvl, variant) {
  // gravel/concrete yard
  groundDiamond(ctx, o, 1, '#8a8474');
  diamondPath(ctx, o, 0, 0, 1, 1, 0);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 0.6; ctx.stroke();
  if (lvl <= 2) { // warehouse with roller door
    castShadow(ctx, o, 0.1, 0.2, 0.95, 0.9, 0.28);
    box(ctx, o, 0.1, 0.2, 0.9, 0.85, 0, 13, [152, 142, 128]);
    // curved metal roof
    roof(ctx, o, 0.07, 0.17, 0.93, 0.88, 13, 18, [104, 108, 114]);
    // roller door
    const dx0 = o.sx(0.9, 0.4), dy0 = o.sy(0.9, 0.4, 9);
    const dx1 = o.sx(0.9, 0.66), dy1 = o.sy(0.9, 0.66, 9);
    quad(ctx, [[dx0, dy0], [dx1, dy1], [dx1, dy1 + 9], [dx0, dy0 + 9]], '#7d8188');
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.5;
    for (let t = 0.2; t < 1; t += 0.2) {
      ctx.beginPath(); ctx.moveTo(dx0, dy0 + 9 * t); ctx.lineTo(dx1, dy1 + 9 * t); ctx.stroke();
    }
    // pallet stack
    box(ctx, o, 0.16, 0.9, 0.3, 1.0 - 0.02, 0, 4, [150, 112, 62]);
  } else if (lvl <= 5) { // factory + stack
    castShadow(ctx, o, 0.05, 0.2, 0.95, 0.95, 0.32);
    box(ctx, o, 0.08, 0.25, 0.75, 0.9, 0, 17, [138, 130, 120]);
    // sawtooth roof
    for (let t = 0; t < 3; t++) {
      const u0 = 0.08 + t * 0.223, u1 = 0.08 + (t + 1) * 0.223;
      roof(ctx, o, u0, 0.25, u1, 0.9, 17, 23, [92, 96, 104]);
    }
    winsRight(ctx, o, 0.75, 0.35, 0.8, 4, 13, 2, 3, variant * 3 + 9, 0.6);
    // smokestack (smoke itself is animated by the renderer)
    box(ctx, o, 0.82, 0.36, 0.93, 0.5, 0, 36, [96, 88, 84]);
    ctx.fillStyle = '#c8443a';
    ctx.fillRect(o.sx(0.875, 0.43) - 2.6, o.sy(0.875, 0.43, 36) - 1, 5.2, 2);
  } else { // heavy industry
    castShadow(ctx, o, 0.0, 0.05, 1.0, 0.98, 0.36);
    box(ctx, o, 0.05, 0.1, 0.95, 0.9, 0, 21, [122, 115, 108]);
    box(ctx, o, 0.15, 0.2, 0.5, 0.55, 21, 33, [102, 96, 90]);
    // piping
    ctx.strokeStyle = '#8e949c'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(o.sx(0.5, 0.35), o.sy(0.5, 0.35, 27));
    ctx.lineTo(o.sx(0.72, 0.35), o.sy(0.72, 0.35, 27));
    ctx.lineTo(o.sx(0.72, 0.35), o.sy(0.72, 0.35, 8));
    ctx.stroke();
    // twin stacks with warning bands
    for (const su of [0.68, 0.84]) {
      box(ctx, o, su, 0.25, su + 0.1, 0.38, 21, 54, [88, 82, 78]);
      ctx.fillStyle = '#c8443a';
      ctx.fillRect(o.sx(su + 0.05, 0.315) - 2.4, o.sy(su + 0.05, 0.315, 54) - 1, 4.8, 2);
    }
    // storage tanks
    for (const [tu, tv] of [[0.25, 0.72], [0.42, 0.78]]) {
      const x = o.sx(tu, tv), yb = o.sy(tu, tv, 21);
      ctx.fillStyle = '#9aa2ac';
      ctx.beginPath(); ctx.ellipse(x, yb - 8, 5.5, 3, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#848c96';
      ctx.fillRect(x - 5.5, yb - 8, 11, 8);
      ctx.beginPath(); ctx.ellipse(x, yb, 5.5, 3, 0, 0, 7); ctx.fill();
    }
    winsRight(ctx, o, 0.95, 0.2, 0.8, 4, 17, 2, 5, variant * 5, 0.5);
  }
}

/* ---------------- civic / special buildings ---------------- */
function pavedBase(ctx, o, n, tone) {
  const base = tone || [154, 158, 164];
  groundDiamond(ctx, o, n, shade(base, 1));
  // expansion joints
  ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 0.6;
  for (let t = 1; t < n * 2; t++) {
    ctx.beginPath();
    ctx.moveTo(o.sx(t / 2, 0), o.sy(t / 2, 0, 0)); ctx.lineTo(o.sx(t / 2, n), o.sy(t / 2, n, 0)); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(o.sx(0, t / 2), o.sy(0, t / 2, 0)); ctx.lineTo(o.sx(n, t / 2), o.sy(n, t / 2, 0)); ctx.stroke();
  }
  diamondPath(ctx, o, 0, 0, n, n, 0);
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 0.8; ctx.stroke();
}

function paintCivic(ctx, o, code) {
  const b = BLD[code];
  const n = b.size;
  switch (code) {
    case B_COAL: {
      pavedBase(ctx, o, n, [126, 122, 120]);
      castShadow(ctx, o, 0.2, 0.3, 2.6, 2.7, 0.4);
      box(ctx, o, 0.2, 0.3, 2.0, 2.7, 0, 27, [92, 86, 88]);
      box(ctx, o, 2.1, 0.9, 2.8, 2.4, 0, 19, [76, 72, 74]);
      // coal pile
      ctx.fillStyle = '#26242a';
      ctx.beginPath(); ctx.ellipse(o.sx(2.45, 2.7), o.sy(2.45, 2.7, 0), 10, 5, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#3a3842';
      ctx.beginPath(); ctx.ellipse(o.sx(2.45, 2.7), o.sy(2.45, 2.7, 2), 7, 3.4, 0, 0, 7); ctx.fill();
      for (const su of [0.5, 1.1]) {
        box(ctx, o, su, 0.5, su + 0.28, 0.85, 27, 76, [66, 62, 64]);
        ctx.fillStyle = '#c8443a';
        ctx.fillRect(o.sx(su + 0.14, 0.675) - 3, o.sy(su + 0.14, 0.675, 76) - 1.4, 6, 2.8);
      }
      winsRight(ctx, o, 2.0, 0.5, 2.5, 5, 21, 2, 4, 3, 0.7);
      break;
    }
    case B_GAS: {
      pavedBase(ctx, o, n, [136, 140, 138]);
      castShadow(ctx, o, 0.2, 0.3, 1.7, 1.8, 0.34);
      box(ctx, o, 0.2, 0.3, 1.5, 1.7, 0, 21, [118, 126, 134]);
      box(ctx, o, 0.4, 0.5, 0.7, 0.8, 21, 47, [96, 102, 110]);
      // spherical gas tank
      const gx = o.sx(1.35, 1.35), gy = o.sy(1.35, 1.35, 14);
      const gg = ctx.createRadialGradient(gx - 3, gy - 3, 1, gx, gy, 10);
      gg.addColorStop(0, '#9fd0f2'); gg.addColorStop(1, '#3277ab');
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(gx, gy, 9, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.ellipse(gx, gy, 9, 3.4, 0, 0, 7); ctx.stroke();
      break;
    }
    case B_NUKE: {
      pavedBase(ctx, o, n, [168, 172, 170]);
      castShadow(ctx, o, 0.2, 0.2, 2.8, 2.7, 0.36);
      box(ctx, o, 0.2, 0.2, 1.6, 2.6, 0, 23, [198, 202, 206]);
      // containment dome
      const dx = o.sx(0.9, 1.4), dyb = o.sy(0.9, 1.4, 23);
      const dg = ctx.createRadialGradient(dx - 4, dyb - 12, 2, dx, dyb - 6, 14);
      dg.addColorStop(0, '#e8ecf0'); dg.addColorStop(1, '#a8b0b8');
      ctx.fillStyle = dg;
      ctx.beginPath(); ctx.arc(dx, dyb - 4, 12, Math.PI, 0); ctx.lineTo(dx + 12, dyb); ctx.lineTo(dx - 12, dyb); ctx.closePath(); ctx.fill();
      // cooling towers (hyperboloid)
      for (const [tu, tv] of [[2.15, 0.8], [2.15, 2.0]]) {
        const x = o.sx(tu, tv), yb = o.sy(tu, tv, 0);
        const tg = ctx.createLinearGradient(x - 12, 0, x + 12, 0);
        tg.addColorStop(0, '#8d949c'); tg.addColorStop(0.45, '#d3d9df'); tg.addColorStop(1, '#a0a8b0');
        ctx.fillStyle = tg;
        ctx.beginPath();
        ctx.moveTo(x - 12, yb); ctx.quadraticCurveTo(x - 5, yb - 30, x - 8, yb - 53);
        ctx.lineTo(x + 8, yb - 53); ctx.quadraticCurveTo(x + 5, yb - 30, x + 12, yb);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#6e767e';
        ctx.beginPath(); ctx.ellipse(x, yb - 53, 8, 2.6, 0, 0, 7); ctx.fill();
      }
      ctx.fillStyle = '#e8c22a';
      ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('☢', o.sx(0.9, 2.2), o.sy(0.9, 2.2, 12));
      break;
    }
    case B_WIND: {
      grassBase(ctx, o, 1, 9);
      const x = o.sx(0.5, 0.5), yb = o.sy(0.5, 0.5, 0);
      ctx.fillStyle = 'rgba(10,16,10,0.22)';
      ctx.beginPath(); ctx.ellipse(x + 4, yb + 1, 7, 2.6, 0, 0, 7); ctx.fill();
      const tg = ctx.createLinearGradient(x - 2, 0, x + 2, 0);
      tg.addColorStop(0, '#c9ced4'); tg.addColorStop(0.5, '#f2f5f8'); tg.addColorStop(1, '#aeb5bc');
      ctx.strokeStyle = tg; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, yb); ctx.lineTo(x, yb - 44); ctx.stroke();
      ctx.fillStyle = '#e8ecf0';
      ctx.beginPath(); ctx.arc(x, yb - 44, 2.2, 0, 7); ctx.fill();
      ctx.strokeStyle = '#e8ecf0'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      for (let a = 0; a < 3; a++) {
        const ang = a * 2.094 + 0.6;
        ctx.beginPath(); ctx.moveTo(x, yb - 44);
        ctx.lineTo(x + Math.cos(ang) * 15, yb - 44 + Math.sin(ang) * 15); ctx.stroke();
      }
      break;
    }
    case B_SOLAR: {
      grassBase(ctx, o, 2, 5);
      for (let r = 0; r < 3; r++) for (let cIdx = 0; cIdx < 3; cIdx++) {
        const u0 = 0.2 + cIdx * 0.55, v0 = 0.2 + r * 0.55;
        castShadow(ctx, o, u0, v0, u0 + 0.45, v0 + 0.45, 0.2);
        // tilted panel: dark cell face with sun glint
        const A = [o.sx(u0, v0), o.sy(u0, v0, 8)], B = [o.sx(u0 + 0.45, v0), o.sy(u0 + 0.45, v0, 8)];
        const C = [o.sx(u0 + 0.45, v0 + 0.45), o.sy(u0 + 0.45, v0 + 0.45, 2)], D = [o.sx(u0, v0 + 0.45), o.sy(u0, v0 + 0.45, 2)];
        quad(ctx, [A, B, C, D], '#1d3a6b');
        ctx.strokeStyle = 'rgba(150,190,240,0.5)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo((A[0] + D[0]) / 2, (A[1] + D[1]) / 2); ctx.lineTo((B[0] + C[0]) / 2, (B[1] + C[1]) / 2); ctx.stroke();
        quad(ctx, [A, B, [B[0] + 1, B[1] + 1], [A[0] + 1, A[1] + 1]], 'rgba(220,240,255,0.5)');
      }
      break;
    }
    case B_POLICE:
      pavedBase(ctx, o, n);
      castShadow(ctx, o, 0.2, 0.2, 1.9, 1.9, 0.32);
      box(ctx, o, 0.2, 0.2, 1.8, 1.8, 0, 23, [82, 112, 172]);
      winsRight(ctx, o, 1.8, 0.4, 1.6, 6, 19, 2, 3, 21, 0.75);
      winsLeft(ctx, o, 0.4, 1.6, 1.8, 6, 19, 2, 3, 23, 0.6);
      box(ctx, o, 0.7, 0.7, 1.3, 1.3, 23, 29, [64, 90, 142]);
      ctx.fillStyle = '#dce6f5'; ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('POLICE', o.sx(1, 1), o.sy(1, 1, 33));
      // patrol car
      ctx.fillStyle = '#e8eaee';
      ctx.fillRect(o.sx(1.75, 0.35) - 4, o.sy(1.75, 0.35, 2) - 2, 8, 4);
      ctx.fillStyle = '#2255aa';
      ctx.fillRect(o.sx(1.75, 0.35) - 2.4, o.sy(1.75, 0.35, 2) - 2, 4.8, 1.6);
      break;
    case B_FIRE:
      pavedBase(ctx, o, n);
      castShadow(ctx, o, 0.2, 0.2, 1.9, 1.9, 0.32);
      box(ctx, o, 0.2, 0.2, 1.8, 1.8, 0, 21, [178, 62, 52]);
      // garage doors
      for (const v0 of [0.45, 1.05]) {
        const d0 = [o.sx(1.8, v0), o.sy(1.8, v0, 14)], d1 = [o.sx(1.8, v0 + 0.45), o.sy(1.8, v0 + 0.45, 14)];
        quad(ctx, [[d0[0], d0[1]], [d1[0], d1[1]], [d1[0], d1[1] + 13], [d0[0], d0[1] + 13]], '#d8d2c4');
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.5;
        for (let t = 0.25; t < 1; t += 0.25) {
          ctx.beginPath(); ctx.moveTo(d0[0], d0[1] + 13 * t); ctx.lineTo(d1[0], d1[1] + 13 * t); ctx.stroke();
        }
      }
      // hose tower
      box(ctx, o, 0.3, 0.3, 0.85, 0.85, 21, 42, [156, 52, 44]);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('FIRE', o.sx(0.58, 0.58), o.sy(0.58, 0.58, 46));
      break;
    case B_HOSP:
      pavedBase(ctx, o, n);
      castShadow(ctx, o, 0.15, 0.15, 1.95, 1.95, 0.34);
      box(ctx, o, 0.15, 0.15, 1.85, 1.85, 0, 31, [225, 228, 232]);
      winsRight(ctx, o, 1.85, 0.3, 1.7, 5, 27, 3, 4, 41, 0.8);
      winsLeft(ctx, o, 0.3, 1.7, 1.85, 5, 27, 3, 4, 43, 0.7);
      // helipad
      box(ctx, o, 0.5, 0.5, 1.5, 1.5, 31, 32.5, [88, 94, 100]);
      ctx.strokeStyle = '#e8d84a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(o.sx(1, 1), o.sy(1, 1, 33), 8, 3.6, 0, 0, 7); ctx.stroke();
      ctx.fillStyle = '#e8d84a'; ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('H', o.sx(1, 1), o.sy(1, 1, 31.5));
      // red cross on facade
      ctx.fillStyle = '#d33';
      { const x = o.sx(1.85, 1), y = o.sy(1.85, 1, 20);
        ctx.fillRect(x - 1.6, y - 5, 3.2, 10); ctx.fillRect(x - 5, y - 1.6, 10, 3.2); }
      break;
    case B_SCHOOL: {
      grassBase(ctx, o, n, 3);
      castShadow(ctx, o, 0.2, 0.3, 1.85, 1.75, 0.3);
      box(ctx, o, 0.2, 0.3, 1.8, 1.7, 0, 17, [196, 142, 96]);
      roof(ctx, o, 0.14, 0.24, 1.86, 1.76, 17, 29, [140, 66, 52]);
      winsRight(ctx, o, 1.8, 0.5, 1.5, 5, 14, 2, 3, 51, 0.85);
      // flag pole
      const fx = o.sx(0.45, 1.62), fy = o.sy(0.45, 1.62, 0);
      ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - 26); ctx.stroke();
      ctx.fillStyle = '#d84040'; ctx.fillRect(fx, fy - 26, 8, 4.6);
      // playground
      ctx.fillStyle = '#caa96a';
      ctx.beginPath(); ctx.ellipse(o.sx(1.55, 0.35), o.sy(1.55, 0.35, 0), 9, 4, 0, 0, 7); ctx.fill();
      break;
    }
    case B_COLLEGE:
      grassBase(ctx, o, n, 11);
      castShadow(ctx, o, 0.2, 0.2, 2.85, 2.85, 0.34);
      box(ctx, o, 0.2, 0.2, 2.8, 2.8, 0, 19, [186, 176, 156]);
      // colonnade
      { const step = (2.8 - 0.4) / 6;
        for (let k = 0; k <= 6; k++) {
          const v = 0.4 + k * step;
          const x = o.sx(2.8, v), y = o.sy(2.8, v, 0);
          ctx.fillStyle = '#efe9dc'; ctx.fillRect(x - 1.2, y - 15, 2.4, 15);
        } }
      box(ctx, o, 1.0, 1.0, 2.0, 2.0, 19, 36, [172, 162, 142]);
      roof(ctx, o, 0.95, 0.95, 2.05, 2.05, 36, 48, [78, 104, 72]);
      // clock
      ctx.fillStyle = '#f4f0e2';
      ctx.beginPath(); ctx.arc(o.sx(2.0, 1.5), o.sy(2.0, 1.5, 28), 3, 0, 7); ctx.fill();
      winsRight(ctx, o, 2.8, 0.5, 2.5, 4, 15, 2, 6, 61, 0.6);
      // quad trees
      drawBroadleaf(ctx, o.sx(0.5, 2.5), o.sy(0.5, 2.5, 0), 0.8, 1);
      drawBroadleaf(ctx, o.sx(2.5, 0.5), o.sy(2.5, 0.5, 0), 0.7, 4);
      break;
    case B_LIBRARY:
      pavedBase(ctx, o, n, [172, 168, 158]);
      castShadow(ctx, o, 0.2, 0.25, 1.85, 1.8, 0.3);
      box(ctx, o, 0.2, 0.25, 1.8, 1.75, 0, 19, [198, 188, 168]);
      { const step = 1.2 / 3;
        for (let k = 0; k <= 3; k++) {
          const v = 0.4 + k * step;
          const x = o.sx(1.8, v), y = o.sy(1.8, v, 0);
          ctx.fillStyle = '#efe9dc'; ctx.fillRect(x - 1.4, y - 17, 2.8, 17);
        } }
      // pediment
      roof(ctx, o, 0.14, 0.19, 1.86, 1.81, 19, 27, [130, 124, 114]);
      // steps
      box(ctx, o, 1.8, 0.55, 1.98, 1.45, 0, 2.4, [178, 172, 160]);
      break;
    case B_PARK: {
      grassBase(ctx, o, 1, 23);
      // lawn highlight
      ctx.fillStyle = 'rgba(150,210,110,0.4)';
      diamondPath(ctx, o, 0.15, 0.15, 0.85, 0.85, 0); ctx.fill();
      // pond
      const px = o.sx(0.6, 0.32), py = o.sy(0.6, 0.32, 0);
      ctx.fillStyle = '#3a7ec2';
      ctx.beginPath(); ctx.ellipse(px, py, 6.5, 3, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.ellipse(px - 1.5, py - 0.8, 2.4, 1, 0, 0, 7); ctx.fill();
      // path
      ctx.strokeStyle = '#cdb98a'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(o.sx(0.1, 0.55), o.sy(0.1, 0.55, 0));
      ctx.quadraticCurveTo(o.sx(0.5, 0.75), o.sy(0.5, 0.75, 0), o.sx(0.9, 0.55), o.sy(0.9, 0.55, 0));
      ctx.stroke();
      drawBroadleaf(ctx, o.sx(0.32, 0.42), o.sy(0.32, 0.42, 0), 0.72, 1);
      drawPine(ctx, o.sx(0.72, 0.68), o.sy(0.72, 0.68, 0), 0.55, 2);
      // bench
      ctx.fillStyle = '#7a5836';
      ctx.fillRect(o.sx(0.45, 0.6) - 2.6, o.sy(0.45, 0.6, 2) - 1, 5.2, 1.6);
      break;
    }
    case B_ZOO:
      grassBase(ctx, o, 3, 31);
      for (const [tu, tv] of [[0.6, 0.6], [2.2, 0.8], [1.5, 2.3], [0.8, 1.8], [2.5, 2.5]])
        drawTreeAt(ctx, o.sx(tu, tv), o.sy(tu, tv, 0), 0.85, (tu * 10) | 0);
      // pens
      ctx.strokeStyle = '#8a6d3f'; ctx.lineWidth = 1;
      diamondPath(ctx, o, 0.15, 0.15, 2.85, 2.85, 0); ctx.stroke();
      diamondPath(ctx, o, 1.9, 1.6, 2.75, 2.45, 0); ctx.stroke();
      ctx.fillStyle = '#c2ab74';
      diamondPath(ctx, o, 1.95, 1.65, 2.7, 2.4, 0); ctx.fill();
      // pond enclosure
      ctx.fillStyle = '#3a7ec2';
      ctx.beginPath(); ctx.ellipse(o.sx(0.7, 2.4), o.sy(0.7, 2.4, 0), 9, 4, 0, 0, 7); ctx.fill();
      // entrance building
      castShadow(ctx, o, 1.2, 1.0, 2.05, 1.65, 0.26);
      box(ctx, o, 1.2, 1.0, 2.0, 1.6, 0, 11, [176, 144, 104]);
      roof(ctx, o, 1.14, 0.94, 2.06, 1.66, 11, 19, [124, 84, 56]);
      break;
    case B_STADIUM: {
      pavedBase(ctx, o, n, [148, 152, 158]);
      const cx = o.sx(2, 2), cy = o.sy(2, 2, 0);
      castShadow(ctx, o, 0.4, 0.4, 3.6, 3.6, 0.4);
      // outer bowl with vertical wall
      ctx.fillStyle = '#a9aeb6';
      ctx.beginPath(); ctx.ellipse(cx, cy - 4, 57, 30, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#8d939c';
      ctx.beginPath(); ctx.ellipse(cx, cy, 57, 30, 0, 0, Math.PI); ctx.fill();
      ctx.fillStyle = '#a9aeb6';
      ctx.beginPath(); ctx.ellipse(cx, cy - 4, 57, 30, 0, 0, 7); ctx.fill();
      // tiered stands
      ctx.fillStyle = '#6a717c';
      ctx.beginPath(); ctx.ellipse(cx, cy - 6, 48, 24, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#586069';
      ctx.beginPath(); ctx.ellipse(cx, cy - 7, 42, 20.5, 0, 0, 7); ctx.fill();
      // pitch
      const pg = ctx.createLinearGradient(cx - 30, cy, cx + 30, cy);
      pg.addColorStop(0, '#3f8a3a'); pg.addColorStop(0.5, '#54a349'); pg.addColorStop(1, '#3f8a3a');
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.ellipse(cx, cy - 8, 33, 15.5, 0, 0, 7); ctx.fill();
      // mowing stripes + field lines
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.ellipse(cx, cy - 8, 20, 9, 0, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - 17); ctx.lineTo(cx, cy + 1); ctx.stroke();
      ctx.fillStyle = 'rgba(60,120,55,0.4)';
      for (let s = -24; s < 30; s += 12) {
        ctx.beginPath(); ctx.ellipse(cx + s, cy - 8, 5, 15.5, 0, 0, 7); ctx.fill();
      }
      // floodlight masts
      for (const [lx, ly] of [[cx - 48, cy - 22], [cx + 48, cy - 22], [cx - 48, cy + 6], [cx + 48, cy + 6]]) {
        ctx.strokeStyle = '#9aa2ac'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx, ly - 22); ctx.stroke();
        ctx.fillStyle = '#f2ecc8'; ctx.fillRect(lx - 2.6, ly - 25, 5.2, 3.2);
      }
      break;
    }
    case B_MARINA: {
      // water base
      paintWaterBase(ctx, o, n);
      // quay
      castShadow(ctx, o, 0.1, 0.1, 0.95, 0.95, 0.22);
      box(ctx, o, 0.08, 0.08, 0.95, 0.95, 0, 4, [188, 174, 148]);
      box(ctx, o, 0.15, 0.15, 0.7, 0.7, 4, 14, [206, 196, 176]);
      roof(ctx, o, 0.1, 0.1, 0.75, 0.75, 14, 20, [92, 118, 146]);
      // jetty
      ctx.fillStyle = '#b9a273';
      const jx = o.sx(1.0, 0.5), jy = o.sy(1.0, 0.5, 3);
      ctx.save();
      ctx.transform(1, 0.5, 0, 1, 0, 0); // shear to lie flat-ish
      ctx.restore();
      ctx.fillRect(jx - 2, jy - 1.6, 30, 3.2);
      ctx.fillRect(jx + 8, jy - 8, 2.6, 16);
      // sailboats
      for (const [bx2, by2] of [[jx + 14, jy - 7], [jx + 22, jy + 6]]) {
        ctx.fillStyle = '#f2f4f6';
        ctx.beginPath(); ctx.ellipse(bx2, by2, 4.6, 1.8, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = '#888'; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(bx2, by2); ctx.lineTo(bx2, by2 - 12); ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.moveTo(bx2, by2 - 12); ctx.lineTo(bx2 + 5, by2 - 3); ctx.lineTo(bx2, by2 - 3); ctx.closePath(); ctx.fill();
      }
      break;
    }
    case B_PUMP: {
      grassBase(ctx, o, 1, 17);
      castShadow(ctx, o, 0.28, 0.28, 0.75, 0.75, 0.26);
      box(ctx, o, 0.3, 0.3, 0.7, 0.7, 0, 12, [88, 134, 178]);
      // intake pipe
      ctx.strokeStyle = '#7a828c'; ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(o.sx(0.7, 0.5), o.sy(0.7, 0.5, 6));
      ctx.lineTo(o.sx(1.05, 0.5), o.sy(1.05, 0.5, 2));
      ctx.stroke();
      // pump wheel
      ctx.fillStyle = '#d8e6f2';
      ctx.beginPath(); ctx.arc(o.sx(0.5, 0.5), o.sy(0.5, 0.5, 17), 3.6, 0, 7); ctx.fill();
      ctx.strokeStyle = '#4a7aa8'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(o.sx(0.5, 0.5), o.sy(0.5, 0.5, 17), 3.6, 0, 7); ctx.stroke();
      break;
    }
    case B_WTOWER: {
      grassBase(ctx, o, 2, 19);
      const x = o.sx(1, 1), yb = o.sy(1, 1, 0);
      ctx.fillStyle = 'rgba(10,16,10,0.24)';
      ctx.beginPath(); ctx.ellipse(x + 6, yb + 2, 14, 5, 0, 0, 7); ctx.fill();
      // lattice legs
      ctx.strokeStyle = '#77808a'; ctx.lineWidth = 1.6;
      for (const off of [-9, 9]) {
        ctx.beginPath(); ctx.moveTo(x + off, yb); ctx.lineTo(x + off / 2.2, yb - 35); ctx.stroke();
      }
      ctx.lineWidth = 0.8;
      for (const zz of [10, 20, 28]) {
        const w0 = 9 * (1 - zz / 46);
        ctx.beginPath(); ctx.moveTo(x - 9 + zz * 0.09, yb - zz); ctx.lineTo(x + 9 - zz * 0.09, yb - zz); ctx.stroke();
      }
      // tank with sheen
      const tg2 = ctx.createLinearGradient(x - 14, 0, x + 14, 0);
      tg2.addColorStop(0, '#39699c'); tg2.addColorStop(0.4, '#7db2e0'); tg2.addColorStop(1, '#2d567f');
      ctx.fillStyle = tg2;
      ctx.beginPath(); ctx.ellipse(x, yb - 40, 14, 8.4, 0, 0, 7); ctx.fill();
      ctx.fillRect(x - 14, yb - 40, 28, 6);
      ctx.beginPath(); ctx.ellipse(x, yb - 34, 14, 8.4, 0, 0, Math.PI); ctx.fill();
      ctx.fillStyle = '#8fbce4';
      ctx.beginPath(); ctx.ellipse(x, yb - 40, 14, 8.4, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath(); ctx.ellipse(x - 4, yb - 42, 4, 2, 0, 0, 7); ctx.fill();
      break;
    }
    case B_AIRPORT: {
      pavedBase(ctx, o, n, [138, 144, 150]);
      // runway
      quad(ctx, [
        [o.sx(0.3, 0.5), o.sy(0.3, 0.5, 0)], [o.sx(3.7, 0.5), o.sy(3.7, 0.5, 0)],
        [o.sx(3.7, 1.3), o.sy(3.7, 1.3, 0)], [o.sx(0.3, 1.3), o.sy(0.3, 1.3, 0)],
      ], '#33353b');
      // threshold stripes
      ctx.strokeStyle = 'rgba(240,240,240,0.85)'; ctx.lineWidth = 1;
      for (const uu of [0.45, 3.55]) {
        for (let vv = 0.6; vv <= 1.2; vv += 0.15) {
          ctx.beginPath();
          ctx.moveTo(o.sx(uu - 0.08, vv), o.sy(uu - 0.08, vv, 0));
          ctx.lineTo(o.sx(uu + 0.08, vv), o.sy(uu + 0.08, vv, 0));
          ctx.stroke();
        }
      }
      ctx.strokeStyle = '#e8e8e8'; ctx.lineWidth = 1.2; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(o.sx(0.6, 0.9), o.sy(0.6, 0.9, 0)); ctx.lineTo(o.sx(3.4, 0.9), o.sy(3.4, 0.9, 0)); ctx.stroke();
      ctx.setLineDash([]);
      // terminal with glass front
      castShadow(ctx, o, 0.6, 2.0, 2.7, 3.05, 0.3);
      box(ctx, o, 0.6, 2.0, 2.6, 3.0, 0, 17, [186, 196, 206]);
      { const t0 = [o.sx(2.6, 2.15), o.sy(2.6, 2.15, 13)], t1 = [o.sx(2.6, 2.9), o.sy(2.6, 2.9, 13)];
        quad(ctx, [[t0[0], t0[1]], [t1[0], t1[1]], [t1[0], t1[1] + 10], [t0[0], t0[1] + 10]], 'rgba(120,180,215,0.85)'); }
      // control tower
      box(ctx, o, 3.0, 2.4, 3.4, 2.8, 0, 35, [152, 160, 170]);
      box(ctx, o, 2.88, 2.28, 3.52, 2.92, 35, 44, [70, 140, 185]);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(o.sx(3.2, 2.6) - 6, o.sy(3.2, 2.6, 42) - 1, 12, 2);
      // parked jet
      const px2 = o.sx(1.5, 1.75), py2 = o.sy(1.5, 1.75, 0);
      ctx.fillStyle = '#eef1f4';
      ctx.beginPath(); ctx.ellipse(px2, py2, 10, 2.4, -0.25, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.moveTo(px2 - 2, py2); ctx.lineTo(px2 - 9, py2 + 5); ctx.lineTo(px2 - 5, py2 + 0.5); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(px2 - 1, py2); ctx.lineTo(px2 + 4, py2 - 5); ctx.lineTo(px2 + 4.5, py2 - 0.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3a6ea8';
      ctx.beginPath(); ctx.ellipse(px2 + 8, py2 - 2, 2.4, 1, -0.25, 0, 7); ctx.fill();
      break;
    }
    case B_SEAPORT: {
      pavedBase(ctx, o, n, [126, 132, 140]);
      castShadow(ctx, o, 0.3, 0.4, 1.7, 1.5, 0.28);
      box(ctx, o, 0.3, 0.4, 1.6, 1.4, 0, 15, [148, 126, 102]);
      roof(ctx, o, 0.25, 0.35, 1.65, 1.45, 15, 20, [100, 104, 112]);
      // container stacks
      const cols = [[196, 84, 62], [66, 132, 186], [86, 162, 88], [206, 158, 62], [150, 96, 168]];
      for (let k = 0; k < 8; k++) {
        const u = 1.75 + (k % 3) * 0.38, v = 1.6 + ((k / 3) | 0) * 0.45;
        const hh = 7 + (k % 3) * 6;
        box(ctx, o, u, v, u + 0.33, v + 0.4, 0, hh, cols[k % 5]);
        // ribbing
        ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 0.4;
        const r0 = [o.sx(u + 0.33, v), o.sy(u + 0.33, v, hh)], r1 = [o.sx(u + 0.33, v + 0.4), o.sy(u + 0.33, v + 0.4, hh)];
        for (let t = 0.2; t < 1; t += 0.2) {
          ctx.beginPath();
          ctx.moveTo(r0[0] + (r1[0] - r0[0]) * t, r0[1] + (r1[1] - r0[1]) * t);
          ctx.lineTo(r0[0] + (r1[0] - r0[0]) * t, r0[1] + (r1[1] - r0[1]) * t + hh);
          ctx.stroke();
        }
      }
      // gantry crane
      ctx.strokeStyle = '#d8b23a'; ctx.lineWidth = 2;
      const cx2 = o.sx(0.8, 2.4), cy2 = o.sy(0.8, 2.4, 0);
      ctx.beginPath();
      ctx.moveTo(cx2, cy2); ctx.lineTo(cx2, cy2 - 42); ctx.lineTo(cx2 + 30, cy2 - 42);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx2 + 20, cy2 - 42); ctx.lineTo(cx2 + 20, cy2 - 26); ctx.stroke();
      ctx.fillStyle = '#c8443a';
      ctx.fillRect(cx2 + 17, cy2 - 26, 6, 4);
      break;
    }
  }
}

// water fill used by marina
function paintWaterBase(ctx, o, n) {
  const top = o.sy(0, 0, 0), bot = o.sy(n, n, 0);
  const g = ctx.createLinearGradient(0, top, 0, bot);
  g.addColorStop(0, '#2461a1'); g.addColorStop(1, '#1e5089');
  diamondPath(ctx, o, 0, 0, n, n, 0);
  ctx.fillStyle = g; ctx.fill();
}

/* ---------------- wire-over-road overlay ---------------- */
function wireOverlaySprite(S, i) {
  const x = i % W, y = (i / W) | 0;
  let mask = 0;
  const conn = (j) => S.wireOn[j] || S.type[j] === B_WIRE || (BLD[S.type[j]] && S.type[j] !== B_ROAD && S.type[j] !== B_RAIL && S.type[j] !== B_NONE);
  if (y > 0 && conn(i - W)) mask |= 1;
  if (x < W - 1 && conn(i + 1)) mask |= 2;
  if (y < H - 1 && conn(i + W)) mask |= 4;
  if (x > 0 && conn(i - 1)) mask |= 8;
  return getSprite('wo' + mask, 1, (c, o) => paintWire(c, o, mask, true));
}

/* ---------------- fire / effects ---------------- */
function paintFire(ctx, o, frame) {
  const x = o.sx(0.5, 0.5), y = o.sy(0.5, 0.5, 0);
  const grd = ctx.createRadialGradient(x, y - 10, 2, x, y - 10, 20);
  grd.addColorStop(0, 'rgba(255,240,150,0.95)');
  grd.addColorStop(0.45, 'rgba(255,130,30,0.8)');
  grd.addColorStop(1, 'rgba(255,60,0,0)');
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.arc(x, y - 10, 20, 0, 7); ctx.fill();
  for (let k = 0; k < 5; k++) {
    const fx = x + (hash2(k, frame, 51) - 0.5) * 20;
    const fh = 11 + hash2(frame, k, 53) * 16;
    const fg = ctx.createLinearGradient(fx, y, fx, y - fh);
    fg.addColorStop(0, frame ? '#ff9b3d' : '#ff7a20');
    fg.addColorStop(0.7, '#ffd76b');
    fg.addColorStop(1, 'rgba(255,240,180,0.2)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(fx - 3.2, y);
    ctx.quadraticCurveTo(fx - 2.5, y - fh * 0.5, fx, y - fh);
    ctx.quadraticCurveTo(fx + 2.5, y - fh * 0.5, fx + 3.2, y);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = 'rgba(70,70,74,0.55)';
  ctx.beginPath(); ctx.arc(x + 5, y - 28 - (frame ? 4 : 0), 6.5, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 9, y - 36 - (frame ? 2 : 0), 4.5, 0, 7); ctx.fill();
}

/* ---------------- cache API ---------------- */
function getSprite(key, n, painter) {
  let s = SpriteCache.get(key);
  if (!s) { s = makeSprite(n, painter); SpriteCache.set(key, s); }
  return s;
}

function spriteForTile(S, i, animFrame) {
  const x = i % W, y = (i / W) | 0;
  const t = S.type[i];
  const variant = (hash2(x, y, S.seed) * 97) | 0;
  if (t === B_NONE || S.anch[i] !== i && t !== B_ROAD && t !== B_WIRE && t !== B_RAIL) {
    if (t !== B_NONE) return null; // covered by a multi-tile building's anchor
    const terr = S.terr[i];
    if (terr === T_WATER) {
      let m = 0;
      if (y > 0 && S.terr[i - W] !== T_WATER) m |= 1;
      if (x < W - 1 && S.terr[i + 1] !== T_WATER) m |= 2;
      if (y < H - 1 && S.terr[i + W] !== T_WATER) m |= 4;
      if (x > 0 && S.terr[i - 1] !== T_WATER) m |= 8;
      const f = animFrame & 1;
      return getSprite('w' + m + ':' + f, 1, (c, o) => paintWater(c, o, m, f));
    }
    if (terr === T_TREE) return getSprite('t' + (variant % 6), 1, (c, o) => paintTrees(c, o, variant % 6));
    if (terr === T_RUBBLE) return getSprite('rb' + (variant % 4), 1, (c, o) => paintRubble(c, o, variant % 4));
    if (terr === T_SAND) return getSprite('sand' + (variant % 3), 1, (c, o) => paintSand(c, o, variant % 3));
    return getSprite('g' + (variant % 6), 1, (c, o) => paintGrass(c, o, variant % 6));
  }
  if (t === B_ROAD || t === B_RAIL || t === B_WIRE) {
    let mask = 0;
    const conn = (j) => S.type[j] === t || (t === B_WIRE && (S.wireOn[j] || (BLD[S.type[j]] && S.type[j] !== B_ROAD && S.type[j] !== B_RAIL && S.type[j] !== B_NONE))) || ((t === B_ROAD || t === B_RAIL) && (S.type[j] === B_ROAD || S.type[j] === B_RAIL) && S.type[j] !== t);
    if (y > 0 && conn(i - W)) mask |= 1;
    if (x < W - 1 && conn(i + 1)) mask |= 2;
    if (y < H - 1 && conn(i + W)) mask |= 4;
    if (x > 0 && conn(i - 1)) mask |= 8;
    const painter = t === B_ROAD ? paintRoad : (t === B_RAIL ? paintRail : paintWire);
    return getSprite((t === B_ROAD ? 'rd' : t === B_RAIL ? 'rl' : 'wr') + mask, 1, (c, o) => painter(c, o, mask));
  }
  if (t === B_RES || t === B_COM || t === B_IND) {
    const lvl = S.lvl[i];
    if (lvl === 0) return getSprite('z' + t, 1, (c, o) => paintZoneEmpty(c, o, t));
    const painter = t === B_RES ? paintRes : (t === B_COM ? paintCom : paintInd);
    return getSprite('z' + t + ':' + lvl + ':' + (variant % 5), 1, (c, o) => painter(c, o, lvl, variant % 5));
  }
  // multi-tile civic building (only anchor draws)
  const b = BLD[t];
  if (!b) return null;
  return getSprite('b' + t, b.size, (c, o) => paintCivic(c, o, t));
}

/* Smoke stack positions (tile-space u, v, z) per building code — the
 * renderer draws animated smoke plumes at these points. */
const SMOKE_SPOTS = {
  [B_COAL]: [[0.64, 0.675, 78], [1.24, 0.675, 78]],
  [B_GAS]: [[0.55, 0.65, 49]],
};
function indSmokeSpots(lvl) {
  if (lvl >= 6) return [[0.73, 0.315, 56], [0.89, 0.315, 56]];
  if (lvl >= 3) return [[0.875, 0.43, 38]];
  return null;
}
