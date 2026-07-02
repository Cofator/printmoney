/* ============================================================
 * Micropolis 2000 — sprites.js
 * Procedural isometric sprite painter. No external assets:
 * every tile & building is drawn onto cached offscreen canvases.
 * ============================================================ */
'use strict';

const TILE_W = 64, TILE_H = 32, HALF_W = 32, HALF_H = 16;
const SPRITE_PAD_TOP = 110; // headroom above footprint for tall buildings

const SpriteCache = new Map();

function shade(c, f) {
  return `rgb(${clamp(c[0] * f, 0, 255) | 0},${clamp(c[1] * f, 0, 255) | 0},${clamp(c[2] * f, 0, 255) | 0})`;
}

function makeSprite(n, painter) {
  const w = n * TILE_W, h = n * TILE_H + SPRITE_PAD_TOP;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  // tile-space -> sprite-space transform for this canvas
  const o = {
    n,
    sx: (u, v) => (u - v) * HALF_W + w / 2,
    sy: (u, v, z) => (u + v) * HALF_H + SPRITE_PAD_TOP - (z || 0),
  };
  painter(ctx, o);
  return cv;
}

// filled quad
function quad(ctx, pts, fill) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

// iso box: footprint (u0,v0)-(u1,v1) in tile units, from height z0 to z1 (px)
function box(ctx, o, u0, v0, u1, v1, z0, z1, c) {
  const A = [o.sx(u0, v0), o.sy(u0, v0, z1)];
  const B = [o.sx(u1, v0), o.sy(u1, v0, z1)];
  const C = [o.sx(u1, v1), o.sy(u1, v1, z1)];
  const D = [o.sx(u0, v1), o.sy(u0, v1, z1)];
  const Bb = [o.sx(u1, v0), o.sy(u1, v0, z0)];
  const Cb = [o.sx(u1, v1), o.sy(u1, v1, z0)];
  const Db = [o.sx(u0, v1), o.sy(u0, v1, z0)];
  quad(ctx, [B, C, Cb, Bb], shade(c, 0.85));  // right face (SE)
  quad(ctx, [D, C, Cb, Db], shade(c, 0.62));  // left face (SW)
  quad(ctx, [A, B, C, D], shade(c, 1.08));    // top
}

// pitched roof over footprint
function roof(ctx, o, u0, v0, u1, v1, zBase, zPeak, c) {
  const um = (u0 + u1) / 2;
  const A = [o.sx(u0, v0), o.sy(u0, v0, zBase)], B = [o.sx(u1, v0), o.sy(u1, v0, zBase)];
  const C = [o.sx(u1, v1), o.sy(u1, v1, zBase)], D = [o.sx(u0, v1), o.sy(u0, v1, zBase)];
  const P0 = [o.sx(um, v0), o.sy(um, v0, zPeak)], P1 = [o.sx(um, v1), o.sy(um, v1, zPeak)];
  quad(ctx, [B, C, P1, P0], shade(c, 0.9));
  quad(ctx, [D, C, P1], shade(c, 0.6));
  quad(ctx, [A, B, P0], shade(c, 1.05));
  quad(ctx, [A, D, P1, P0], shade(c, 0.75));
}

// windows on the SE (right) face of a box
function winsRight(ctx, o, u1, v0, v1, zLo, zHi, rows, cols, lit) {
  ctx.fillStyle = lit ? '#ffd76b' : '#20303f';
  for (let r = 0; r < rows; r++) {
    const z = zLo + (zHi - zLo) * (r + 0.5) / rows;
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const v = v0 + (v1 - v0) * (cIdx + 0.5) / cols;
      const x = o.sx(u1, v), y = o.sy(u1, v, z);
      ctx.fillRect(x - 1.6, y - 2.5, 3.2, 5);
    }
  }
}
function winsLeft(ctx, o, u0, u1, v1, zLo, zHi, rows, cols, lit) {
  ctx.fillStyle = lit ? '#f7c948' : '#182633';
  for (let r = 0; r < rows; r++) {
    const z = zLo + (zHi - zLo) * (r + 0.5) / rows;
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const u = u0 + (u1 - u0) * (cIdx + 0.5) / cols;
      const x = o.sx(u, v1), y = o.sy(u, v1, z);
      ctx.fillRect(x - 1.6, y - 2.5, 3.2, 5);
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

function drawTreeAt(ctx, x, y, s, tone) {
  ctx.fillStyle = '#5b4325';
  ctx.fillRect(x - 1, y - 4 * s, 2, 4 * s);
  const g = ['#2f7a33', '#39913d', '#2a6e2e'][tone % 3];
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(x, y - 16 * s); ctx.lineTo(x + 6 * s, y - 4 * s); ctx.lineTo(x - 6 * s, y - 4 * s); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x, y - 22 * s); ctx.lineTo(x + 4.5 * s, y - 10 * s); ctx.lineTo(x - 4.5 * s, y - 10 * s); ctx.closePath(); ctx.fill();
}

/* ---------------- terrain sprites ---------------- */
function paintGrass(ctx, o, variant) {
  groundDiamond(ctx, o, 1, variant % 2 ? '#63a83e' : '#5da039');
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  for (let k = 0; k < 5; k++) {
    const u = 0.15 + hash2(k, variant, 3) * 0.7, v = 0.15 + hash2(variant, k, 7) * 0.7;
    ctx.fillRect(o.sx(u, v), o.sy(u, v, 0), 2, 1);
  }
}
function paintWater(ctx, o, frame) {
  groundDiamond(ctx, o, 1, frame ? '#2b6cb0' : '#2c72ba');
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  for (let k = 0; k < 3; k++) {
    const u = 0.2 + hash2(k, frame, 11) * 0.5, v = 0.2 + hash2(frame + 3, k, 13) * 0.5;
    const x = o.sx(u, v), y = o.sy(u, v, 0);
    ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.quadraticCurveTo(x, y - 2, x + 5, y); ctx.stroke();
  }
}
function paintSand(ctx, o) { groundDiamond(ctx, o, 1, '#cfc07a'); }
function paintRubble(ctx, o, variant) {
  groundDiamond(ctx, o, 1, '#6f6a5f');
  ctx.fillStyle = '#57534b';
  for (let k = 0; k < 6; k++) {
    const u = 0.15 + hash2(k, variant, 21) * 0.7, v = 0.15 + hash2(variant, k, 23) * 0.7;
    const x = o.sx(u, v), y = o.sy(u, v, 0);
    ctx.fillRect(x - 2, y - 2, 4 + (k % 3), 3);
  }
}
function paintTrees(ctx, o, variant) {
  paintGrass(ctx, o, variant);
  const cnt = 1 + variant % 3;
  for (let k = 0; k < cnt; k++) {
    const u = 0.3 + hash2(k, variant, 31) * 0.4, v = 0.3 + hash2(variant, k, 37) * 0.4;
    drawTreeAt(ctx, o.sx(u, v), o.sy(u, v, 0), 0.8 + hash2(k, variant, 41) * 0.5, variant + k);
  }
}

/* ---------------- roads / rails / wires (16 connection masks) ---- */
function paintRoad(ctx, o, mask) {
  groundDiamond(ctx, o, 1, '#4a4a4f');
  ctx.strokeStyle = '#5c5c62'; ctx.lineWidth = 1;
  diamondPath(ctx, o, 0.02, 0.02, 0.98, 0.98, 0); ctx.stroke();
  // lane stripes toward each connected edge. N=1(u-),E=2(v-... define: bit0 N(x,y-1)-> v-1 dir, bit1 E(x+1)-> u+1, bit2 S(y+1)-> v+1, bit3 W(x-1)-> u-1
  ctx.strokeStyle = '#d9d95f'; ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  const cx = o.sx(0.5, 0.5), cy = o.sy(0.5, 0.5, 0);
  const ends = [];
  if (mask & 1) ends.push([o.sx(0.5, 0), o.sy(0.5, 0, 0)]);
  if (mask & 2) ends.push([o.sx(1, 0.5), o.sy(1, 0.5, 0)]);
  if (mask & 4) ends.push([o.sx(0.5, 1), o.sy(0.5, 1, 0)]);
  if (mask & 8) ends.push([o.sx(0, 0.5), o.sy(0, 0.5, 0)]);
  if (ends.length === 0) ends.push([o.sx(0.5, 0), o.sy(0.5, 0, 0)], [o.sx(0.5, 1), o.sy(0.5, 1, 0)]);
  for (const e of ends) {
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(e[0], e[1]); ctx.stroke();
  }
  ctx.setLineDash([]);
}
function paintRail(ctx, o, mask) {
  groundDiamond(ctx, o, 1, '#6b5f4e');
  const cx = o.sx(0.5, 0.5), cy = o.sy(0.5, 0.5, 0);
  const ends = [];
  if (mask & 1) ends.push([o.sx(0.5, 0), o.sy(0.5, 0, 0)]);
  if (mask & 2) ends.push([o.sx(1, 0.5), o.sy(1, 0.5, 0)]);
  if (mask & 4) ends.push([o.sx(0.5, 1), o.sy(0.5, 1, 0)]);
  if (mask & 8) ends.push([o.sx(0, 0.5), o.sy(0, 0.5, 0)]);
  if (ends.length === 0) ends.push([o.sx(0.5, 0), o.sy(0.5, 0, 0)], [o.sx(0.5, 1), o.sy(0.5, 1, 0)]);
  ctx.strokeStyle = '#3a352d'; ctx.lineWidth = 5;
  for (const e of ends) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(e[0], e[1]); ctx.stroke(); }
  ctx.strokeStyle = '#b8b8c0'; ctx.lineWidth = 1;
  for (const e of ends) {
    for (const off of [-2, 2]) {
      ctx.beginPath(); ctx.moveTo(cx + off, cy); ctx.lineTo(e[0] + off, e[1]); ctx.stroke();
    }
  }
}
function paintWire(ctx, o, mask, noGround) {
  if (!noGround) groundDiamond(ctx, o, 1, '#5da039');
  const cx = o.sx(0.5, 0.5);
  const cy = o.sy(0.5, 0.5, 0);
  const topZ = 26;
  // pole
  ctx.strokeStyle = '#6e5334'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - topZ); ctx.stroke();
  ctx.strokeStyle = '#6e5334'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx - 6, cy - topZ + 4); ctx.lineTo(cx + 6, cy - topZ + 4); ctx.stroke();
  // wires to connected edges
  ctx.strokeStyle = '#222'; ctx.lineWidth = 1;
  const ends = [];
  if (mask & 1) ends.push([o.sx(0.5, 0), o.sy(0.5, 0, topZ)]);
  if (mask & 2) ends.push([o.sx(1, 0.5), o.sy(1, 0.5, topZ)]);
  if (mask & 4) ends.push([o.sx(0.5, 1), o.sy(0.5, 1, topZ)]);
  if (mask & 8) ends.push([o.sx(0, 0.5), o.sy(0, 0.5, topZ)]);
  for (const e of ends) {
    ctx.beginPath(); ctx.moveTo(cx, cy - topZ + 3);
    ctx.quadraticCurveTo((cx + e[0]) / 2, (cy - topZ + e[1]) / 2 + 5, e[0], e[1]);
    ctx.stroke();
  }
}

/* ---------------- zones ---------------- */
const ZONE_TINT = { [B_RES]: '#3fae4a', [B_COM]: '#3f7bd6', [B_IND]: '#d6b53f' };
const ZONE_LETTER = { [B_RES]: 'R', [B_COM]: 'C', [B_IND]: 'I' };

function paintZoneEmpty(ctx, o, ztype) {
  groundDiamond(ctx, o, 1, '#7d6d4f');
  ctx.strokeStyle = ZONE_TINT[ztype]; ctx.lineWidth = 2;
  diamondPath(ctx, o, 0.08, 0.08, 0.92, 0.92, 0); ctx.stroke();
  ctx.fillStyle = ZONE_TINT[ztype];
  ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(ZONE_LETTER[ztype], o.sx(0.5, 0.5), o.sy(0.5, 0.5, 0) + 4);
}

function paintRes(ctx, o, lvl, variant) {
  groundDiamond(ctx, o, 1, '#69a352');
  const hueSets = [[176, 138, 96], [190, 160, 120], [160, 120, 88], [150, 150, 158], [172, 146, 118]];
  const c = hueSets[variant % hueSets.length];
  if (lvl <= 2) { // small house
    box(ctx, o, 0.25, 0.3, 0.75, 0.8, 0, 10, c);
    roof(ctx, o, 0.2, 0.25, 0.8, 0.85, 10, 20, [140, 60, 50]);
    drawTreeAt(ctx, o.sx(0.12, 0.7), o.sy(0.12, 0.7, 0), 0.5, variant);
  } else if (lvl <= 4) { // duplex
    box(ctx, o, 0.1, 0.15, 0.55, 0.85, 0, 14, c);
    roof(ctx, o, 0.06, 0.1, 0.6, 0.9, 14, 24, [120, 55, 48]);
    box(ctx, o, 0.62, 0.35, 0.95, 0.85, 0, 10, hueSets[(variant + 1) % hueSets.length]);
    roof(ctx, o, 0.58, 0.3, 0.98, 0.9, 10, 17, [100, 70, 55]);
  } else if (lvl <= 6) { // apartment block
    const hgt = 30 + lvl * 3;
    box(ctx, o, 0.12, 0.12, 0.88, 0.88, 0, hgt, [168, 140, 110]);
    winsRight(ctx, o, 0.88, 0.2, 0.8, 5, hgt - 6, 3, 3, variant % 2 === 0);
    winsLeft(ctx, o, 0.2, 0.8, 0.88, 5, hgt - 6, 3, 3, variant % 2 === 1);
  } else { // tower
    const hgt = 52 + lvl * 4 + (variant % 3) * 6;
    box(ctx, o, 0.15, 0.15, 0.85, 0.85, 0, hgt, [150, 148, 158]);
    winsRight(ctx, o, 0.85, 0.22, 0.78, 6, hgt - 8, 6, 3, true);
    winsLeft(ctx, o, 0.22, 0.78, 0.85, 6, hgt - 8, 6, 3, variant % 2 === 0);
    box(ctx, o, 0.4, 0.4, 0.6, 0.6, hgt, hgt + 6, [120, 118, 126]);
  }
}

function paintCom(ctx, o, lvl, variant) {
  groundDiamond(ctx, o, 1, '#8b8f96');
  if (lvl <= 2) { // corner shop
    box(ctx, o, 0.15, 0.2, 0.85, 0.85, 0, 12, [188, 172, 150]);
    box(ctx, o, 0.15, 0.2, 0.85, 0.35, 12, 16, [200, 60, 60]); // signage strip
  } else if (lvl <= 4) {
    box(ctx, o, 0.1, 0.15, 0.9, 0.9, 0, 22, [120, 150, 176]);
    winsRight(ctx, o, 0.9, 0.2, 0.85, 4, 18, 2, 4, true);
    box(ctx, o, 0.1, 0.15, 0.9, 0.3, 22, 27, [220, 170, 60]);
  } else if (lvl <= 6) { // office block
    const hgt = 40 + lvl * 4;
    box(ctx, o, 0.12, 0.12, 0.88, 0.88, 0, hgt, [90, 130, 170]);
    winsRight(ctx, o, 0.88, 0.18, 0.82, 5, hgt - 5, 5, 4, true);
    winsLeft(ctx, o, 0.18, 0.82, 0.88, 5, hgt - 5, 5, 4, true);
  } else { // glass tower
    const hgt = 66 + lvl * 5 + (variant % 3) * 8;
    box(ctx, o, 0.18, 0.18, 0.82, 0.82, 0, hgt, [70, 140, 190]);
    ctx.fillStyle = 'rgba(210,240,255,0.35)';
    for (let z = 8; z < hgt - 4; z += 9) {
      const x0 = o.sx(0.82, 0.18), y0 = o.sy(0.82, 0.18, z);
      const x1 = o.sx(0.82, 0.82), y1 = o.sy(0.82, 0.82, z);
      quad(ctx, [[x0, y0], [x1, y1], [x1, y1 + 3], [x0, y0 + 3]], 'rgba(220,245,255,0.45)');
      const x2 = o.sx(0.18, 0.82), y2 = o.sy(0.18, 0.82, z);
      quad(ctx, [[x1, y1], [x2, y2], [x2, y2 + 3], [x1, y1 + 3]], 'rgba(200,230,250,0.28)');
    }
    box(ctx, o, 0.4, 0.4, 0.6, 0.6, hgt, hgt + 8, [60, 120, 165]);
  }
}

function paintInd(ctx, o, lvl, variant) {
  groundDiamond(ctx, o, 1, '#8f8a76');
  if (lvl <= 2) { // warehouse
    box(ctx, o, 0.1, 0.2, 0.9, 0.85, 0, 12, [150, 140, 128]);
    roof(ctx, o, 0.08, 0.18, 0.92, 0.87, 12, 17, [110, 105, 100]);
  } else if (lvl <= 5) { // factory + stack
    box(ctx, o, 0.08, 0.25, 0.75, 0.9, 0, 16, [140, 132, 122]);
    roof(ctx, o, 0.06, 0.22, 0.77, 0.92, 16, 22, [95, 92, 88]);
    box(ctx, o, 0.8, 0.35, 0.92, 0.5, 0, 34, [110, 100, 96]);
    ctx.fillStyle = 'rgba(200,200,200,0.5)';
    ctx.beginPath(); ctx.arc(o.sx(0.86, 0.42), o.sy(0.86, 0.42, 40), 4, 0, 7); ctx.fill();
  } else { // heavy industry
    box(ctx, o, 0.05, 0.1, 0.95, 0.9, 0, 20, [125, 118, 110]);
    box(ctx, o, 0.15, 0.2, 0.5, 0.55, 20, 32, [105, 98, 92]);
    for (const su of [0.68, 0.84]) {
      box(ctx, o, su, 0.25, su + 0.1, 0.38, 20, 52, [90, 84, 80]);
      ctx.fillStyle = 'rgba(190,190,195,0.5)';
      ctx.beginPath(); ctx.arc(o.sx(su + 0.05, 0.31), o.sy(su + 0.05, 0.31, 58), 5, 0, 7); ctx.fill();
    }
    winsRight(ctx, o, 0.95, 0.2, 0.8, 4, 16, 2, 5, variant % 2 === 0);
  }
}

/* ---------------- civic / special buildings ---------------- */
function paintCivic(ctx, o, code) {
  const b = BLD[code];
  const n = b.size;
  groundDiamond(ctx, o, n, '#9aa1a8');
  diamondPath(ctx, o, 0.04, 0.04, n - 0.04, n - 0.04, 0);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke();
  switch (code) {
    case B_COAL: {
      box(ctx, o, 0.2, 0.3, 2.0, 2.7, 0, 26, [96, 90, 92]);
      box(ctx, o, 2.1, 0.9, 2.8, 2.4, 0, 18, [80, 76, 78]);
      for (const su of [0.5, 1.1]) {
        box(ctx, o, su, 0.5, su + 0.28, 0.85, 26, 74, [70, 66, 68]);
        ctx.fillStyle = 'rgba(120,120,125,0.65)';
        ctx.beginPath(); ctx.arc(o.sx(su + 0.14, 0.67), o.sy(su + 0.14, 0.67, 84), 7, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(o.sx(su + 0.3, 0.6), o.sy(su + 0.3, 0.6, 96), 9, 0, 7); ctx.fill();
      }
      winsRight(ctx, o, 2.0, 0.5, 2.5, 5, 20, 2, 4, true);
      break;
    }
    case B_GAS: {
      box(ctx, o, 0.2, 0.3, 1.5, 1.7, 0, 20, [110, 118, 126]);
      box(ctx, o, 0.4, 0.5, 0.7, 0.8, 20, 46, [90, 96, 104]);
      ctx.fillStyle = '#3aa0ff';
      ctx.beginPath(); ctx.arc(o.sx(1.3, 1.3), o.sy(1.3, 1.3, 30), 8, 0, 7); ctx.fill(); // gas tank
      ctx.fillStyle = 'rgba(150,180,255,0.5)';
      ctx.beginPath(); ctx.arc(o.sx(0.55, 0.65), o.sy(0.55, 0.65, 52), 4, 0, 7); ctx.fill();
      break;
    }
    case B_NUKE: {
      box(ctx, o, 0.2, 0.2, 1.6, 2.6, 0, 22, [190, 195, 200]);
      // cooling towers
      for (const [tu, tv] of [[2.1, 0.8], [2.1, 2.0]]) {
        const x = o.sx(tu, tv), yb = o.sy(tu, tv, 0);
        ctx.fillStyle = '#c8ccd2';
        ctx.beginPath();
        ctx.moveTo(x - 12, yb); ctx.quadraticCurveTo(x - 5, yb - 30, x - 8, yb - 52);
        ctx.lineTo(x + 8, yb - 52); ctx.quadraticCurveTo(x + 5, yb - 30, x + 12, yb);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(230,235,240,0.7)';
        ctx.beginPath(); ctx.arc(x, yb - 58, 8, 0, 7); ctx.fill();
      }
      ctx.fillStyle = '#e8c22a';
      ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('☢', o.sx(0.9, 1.4), o.sy(0.9, 1.4, 30));
      break;
    }
    case B_WIND: {
      groundDiamond(ctx, o, 1, '#6da657');
      const x = o.sx(0.5, 0.5), yb = o.sy(0.5, 0.5, 0);
      ctx.strokeStyle = '#e8eaee'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, yb); ctx.lineTo(x, yb - 42); ctx.stroke();
      ctx.lineWidth = 2.5;
      for (let a = 0; a < 3; a++) {
        const ang = a * 2.09 + 0.5;
        ctx.beginPath(); ctx.moveTo(x, yb - 42);
        ctx.lineTo(x + Math.cos(ang) * 14, yb - 42 + Math.sin(ang) * 14); ctx.stroke();
      }
      break;
    }
    case B_SOLAR: {
      groundDiamond(ctx, o, 2, '#7d9a5a');
      for (let r = 0; r < 3; r++) for (let cIdx = 0; cIdx < 3; cIdx++) {
        const u0 = 0.2 + cIdx * 0.55, v0 = 0.2 + r * 0.55;
        box(ctx, o, u0, v0, u0 + 0.45, v0 + 0.45, 3, 7, [40, 70, 140]);
      }
      break;
    }
    case B_POLICE:
      box(ctx, o, 0.2, 0.2, 1.8, 1.8, 0, 22, [70, 100, 165]);
      winsRight(ctx, o, 1.8, 0.4, 1.6, 5, 18, 2, 3, true);
      box(ctx, o, 0.7, 0.7, 1.3, 1.3, 22, 28, [55, 80, 135]);
      ctx.fillStyle = '#ffd76b'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('POLICE', o.sx(1, 1), o.sy(1, 1, 34));
      break;
    case B_FIRE:
      box(ctx, o, 0.2, 0.2, 1.8, 1.8, 0, 20, [186, 60, 50]);
      box(ctx, o, 0.3, 0.3, 0.9, 0.9, 20, 40, [160, 50, 42]);
      winsRight(ctx, o, 1.8, 0.4, 1.6, 4, 16, 2, 3, true);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('FIRE', o.sx(1.2, 1.2), o.sy(1.2, 1.2, 28));
      break;
    case B_HOSP:
      box(ctx, o, 0.15, 0.15, 1.85, 1.85, 0, 30, [225, 228, 232]);
      winsRight(ctx, o, 1.85, 0.3, 1.7, 5, 26, 3, 4, true);
      ctx.fillStyle = '#d33';
      { const x = o.sx(1, 1), y = o.sy(1, 1, 38);
        ctx.fillRect(x - 2.5, y - 8, 5, 16); ctx.fillRect(x - 8, y - 2.5, 16, 5); }
      break;
    case B_SCHOOL:
      box(ctx, o, 0.2, 0.3, 1.8, 1.7, 0, 16, [200, 150, 100]);
      roof(ctx, o, 0.15, 0.25, 1.85, 1.75, 16, 28, [150, 70, 55]);
      ctx.fillStyle = '#333';
      { const x = o.sx(0.5, 1.6), y = o.sy(0.5, 1.6, 0);
        ctx.fillRect(x - 1, y - 24, 2, 24);
        ctx.fillStyle = '#e33'; ctx.fillRect(x + 1, y - 24, 8, 5); }
      break;
    case B_COLLEGE:
      box(ctx, o, 0.2, 0.2, 2.8, 2.8, 0, 18, [180, 170, 150]);
      box(ctx, o, 1.0, 1.0, 2.0, 2.0, 18, 34, [165, 155, 135]);
      roof(ctx, o, 0.95, 0.95, 2.05, 2.05, 34, 46, [90, 110, 80]);
      winsRight(ctx, o, 2.8, 0.4, 2.6, 4, 15, 2, 6, true);
      break;
    case B_LIBRARY:
      box(ctx, o, 0.2, 0.25, 1.8, 1.75, 0, 18, [195, 185, 165]);
      for (let k = 0; k < 4; k++) {
        const v = 0.4 + k * 0.35;
        const x = o.sx(1.8, v), y = o.sy(1.8, v, 0);
        ctx.fillStyle = '#efe9dc'; ctx.fillRect(x - 1.5, y - 16, 3, 16);
      }
      roof(ctx, o, 0.15, 0.2, 1.85, 1.8, 18, 26, [120, 115, 105]);
      break;
    case B_PARK: {
      groundDiamond(ctx, o, 1, '#4d9a45');
      ctx.fillStyle = '#7fc96e';
      diamondPath(ctx, o, 0.2, 0.2, 0.8, 0.8, 0); ctx.fill();
      drawTreeAt(ctx, o.sx(0.35, 0.4), o.sy(0.35, 0.4, 0), 0.7, 1);
      drawTreeAt(ctx, o.sx(0.7, 0.65), o.sy(0.7, 0.65, 0), 0.55, 2);
      ctx.fillStyle = '#3aa0d8';
      ctx.beginPath(); ctx.ellipse(o.sx(0.6, 0.3), o.sy(0.6, 0.3, 0), 6, 3, 0, 0, 7); ctx.fill();
      break;
    }
    case B_ZOO:
      groundDiamond(ctx, o, 3, '#5aa04c');
      for (const [tu, tv] of [[0.6, 0.6], [2.2, 0.8], [1.5, 2.3], [0.8, 1.8]])
        drawTreeAt(ctx, o.sx(tu, tv), o.sy(tu, tv, 0), 0.9, (tu * 10) | 0);
      box(ctx, o, 1.2, 1.0, 2.0, 1.6, 0, 10, [170, 140, 100]);
      roof(ctx, o, 1.15, 0.95, 2.05, 1.65, 10, 18, [130, 90, 60]);
      ctx.strokeStyle = '#8a6d3f'; ctx.lineWidth = 1.5;
      diamondPath(ctx, o, 0.1, 0.1, 2.9, 2.9, 0); ctx.stroke();
      break;
    case B_STADIUM: {
      groundDiamond(ctx, o, 4, '#7a9d55');
      const cx = o.sx(2, 2), cy = o.sy(2, 2, 0);
      ctx.fillStyle = '#b9bec6';
      ctx.beginPath(); ctx.ellipse(cx, cy - 8, 56, 30, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#5a616c';
      ctx.beginPath(); ctx.ellipse(cx, cy - 8, 46, 23, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#4d9a45';
      ctx.beginPath(); ctx.ellipse(cx, cy - 8, 34, 16, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(cx, cy - 8, 20, 9, 0, 0, 7); ctx.stroke();
      break;
    }
    case B_MARINA: {
      groundDiamond(ctx, o, 2, '#3a79c0');
      box(ctx, o, 0.1, 0.1, 0.9, 0.9, 0, 10, [200, 190, 170]);
      ctx.fillStyle = '#c8b58a';
      const x0 = o.sx(1.0, 0.5), y0 = o.sy(1.0, 0.5, 2);
      ctx.fillRect(x0 - 2, y0 - 2, 30, 4);
      ctx.fillStyle = '#fff';
      for (const bx of [14, 26]) {
        ctx.beginPath(); ctx.moveTo(x0 + bx, y0 - 3); ctx.lineTo(x0 + bx + 6, y0 - 3); ctx.lineTo(x0 + bx + 3, y0 - 14); ctx.closePath(); ctx.fill();
      }
      break;
    }
    case B_PUMP: {
      groundDiamond(ctx, o, 1, '#7d9a8a');
      box(ctx, o, 0.3, 0.3, 0.7, 0.7, 0, 14, [80, 130, 180]);
      ctx.fillStyle = '#a8d8f0';
      ctx.beginPath(); ctx.arc(o.sx(0.5, 0.5), o.sy(0.5, 0.5, 20), 5, 0, 7); ctx.fill();
      break;
    }
    case B_WTOWER: {
      groundDiamond(ctx, o, 2, '#8a9a7d');
      const x = o.sx(1, 1), yb = o.sy(1, 1, 0);
      ctx.strokeStyle = '#7a7f88'; ctx.lineWidth = 2;
      for (const off of [-8, 8]) { ctx.beginPath(); ctx.moveTo(x + off, yb); ctx.lineTo(x + off / 2, yb - 34); ctx.stroke(); }
      ctx.fillStyle = '#4a90c8';
      ctx.beginPath(); ctx.ellipse(x, yb - 42, 14, 9, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#3a7ab0';
      ctx.beginPath(); ctx.ellipse(x, yb - 36, 14, 8, 0, 0, 7); ctx.fill();
      break;
    }
    case B_AIRPORT: {
      groundDiamond(ctx, o, 4, '#8b9299');
      // runway
      quad(ctx, [
        [o.sx(0.3, 0.5), o.sy(0.3, 0.5, 0)], [o.sx(3.7, 0.5), o.sy(3.7, 0.5, 0)],
        [o.sx(3.7, 1.3), o.sy(3.7, 1.3, 0)], [o.sx(0.3, 1.3), o.sy(0.3, 1.3, 0)],
      ], '#3f4147');
      ctx.strokeStyle = '#e8e8e8'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(o.sx(0.4, 0.9), o.sy(0.4, 0.9, 0)); ctx.lineTo(o.sx(3.6, 0.9), o.sy(3.6, 0.9, 0)); ctx.stroke();
      ctx.setLineDash([]);
      box(ctx, o, 0.6, 2.0, 2.6, 3.0, 0, 16, [180, 190, 200]);
      winsRight(ctx, o, 2.6, 2.2, 2.9, 4, 13, 1, 4, true);
      // control tower
      box(ctx, o, 3.0, 2.4, 3.4, 2.8, 0, 34, [150, 158, 168]);
      box(ctx, o, 2.9, 2.3, 3.5, 2.9, 34, 42, [90, 160, 200]);
      break;
    }
    case B_SEAPORT: {
      groundDiamond(ctx, o, 3, '#7b8590');
      box(ctx, o, 0.3, 0.4, 1.6, 1.4, 0, 14, [140, 120, 100]);
      // containers
      const cols = [[200, 80, 60], [70, 140, 190], [90, 170, 90], [210, 160, 60]];
      for (let k = 0; k < 6; k++) {
        const u = 1.8 + (k % 3) * 0.38, v = 1.7 + ((k / 3) | 0) * 0.5;
        box(ctx, o, u, v, u + 0.32, v + 0.42, 0, 8 + (k % 2) * 8, cols[k % 4]);
      }
      // crane
      ctx.strokeStyle = '#c8c8d0'; ctx.lineWidth = 2;
      const cx2 = o.sx(0.8, 2.4), cy2 = o.sy(0.8, 2.4, 0);
      ctx.beginPath(); ctx.moveTo(cx2, cy2); ctx.lineTo(cx2, cy2 - 40); ctx.lineTo(cx2 + 26, cy2 - 40); ctx.stroke();
      break;
    }
  }
}

// transparent wire sprite drawn over roads/rails that carry a crossing line
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
  const grd = ctx.createRadialGradient(x, y - 10, 2, x, y - 10, 18);
  grd.addColorStop(0, 'rgba(255,240,150,0.95)');
  grd.addColorStop(0.5, 'rgba(255,120,30,0.85)');
  grd.addColorStop(1, 'rgba(255,60,0,0)');
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.arc(x, y - 10, 18, 0, 7); ctx.fill();
  ctx.fillStyle = frame ? '#ffd76b' : '#ff9b3d';
  for (let k = 0; k < 4; k++) {
    const fx = x + (hash2(k, frame, 51) - 0.5) * 20;
    const fh = 10 + hash2(frame, k, 53) * 14;
    ctx.beginPath(); ctx.moveTo(fx - 3, y); ctx.quadraticCurveTo(fx, y - fh, fx + 3, y); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = 'rgba(80,80,80,0.5)';
  ctx.beginPath(); ctx.arc(x + 4, y - 26 - (frame ? 4 : 0), 6, 0, 7); ctx.fill();
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
    if (terr === T_WATER) return getSprite('w' + (animFrame & 1), 1, (c, o) => paintWater(c, o, animFrame & 1));
    if (terr === T_TREE) return getSprite('t' + (variant % 6), 1, (c, o) => paintTrees(c, o, variant % 6));
    if (terr === T_RUBBLE) return getSprite('rb' + (variant % 4), 1, (c, o) => paintRubble(c, o, variant % 4));
    if (terr === T_SAND) return getSprite('sand', 1, paintSand);
    return getSprite('g' + (variant % 4), 1, (c, o) => paintGrass(c, o, variant % 4));
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
