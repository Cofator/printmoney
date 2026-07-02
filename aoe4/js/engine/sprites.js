// Sprites procedurais: todos os gráficos são desenhados via Canvas 2D e
// pré-renderizados com supersampling 3x — nenhum asset externo é necessário.
import { TILE, BUILDINGS, PLAYER_COLORS } from '../game/config.js';

export const SS = 3;

function cv(w, h) { const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h); return c; }

export function adjust(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  return `rgb(${f(n >> 16 & 255)},${f(n >> 8 & 255)},${f(n & 255)})`;
}

const STONE = '#8d8577', WOOD = '#8a6440', THATCH = '#c9a15c', ROOF = '#96453c', IRON = '#c7c9cc';

function vGrad(g, y0, y1, c1, c2) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, c1); gr.addColorStop(1, c2);
  return gr;
}

// ---------- elementos arquitetônicos ----------
function stoneWall(g, x, y, w, h) {
  g.fillStyle = vGrad(g, y, y + h, adjust(STONE, .07), adjust(STONE, -.11));
  g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(0,0,0,0.15)'; g.lineWidth = SS * 0.7;
  const row = 7 * SS;
  for (let yy = y + row; yy < y + h; yy += row) {
    g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy); g.stroke();
  }
  let off = 0;
  for (let yy = y; yy < y + h; yy += row) {
    for (let xx = x + (off % 2 ? 7 * SS : 0) + 7 * SS; xx < x + w; xx += 14 * SS) {
      g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx, Math.min(yy + row, y + h)); g.stroke();
    }
    off++;
  }
  g.strokeStyle = 'rgba(15,10,5,0.5)'; g.lineWidth = SS; g.strokeRect(x, y, w, h);
}

function woodWall(g, x, y, w, h) {
  g.fillStyle = vGrad(g, y, y + h, adjust(WOOD, .06), adjust(WOOD, -.11));
  g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(0,0,0,0.17)'; g.lineWidth = SS * 0.7;
  for (let xx = x + 6 * SS; xx < x + w; xx += 6 * SS) {
    g.beginPath(); g.moveTo(xx, y); g.lineTo(xx, y + h); g.stroke();
  }
  // travessas horizontais
  g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = SS;
  g.beginPath(); g.moveTo(x, y + 2 * SS); g.lineTo(x + w, y + 2 * SS); g.stroke();
  g.strokeStyle = 'rgba(15,10,5,0.5)'; g.lineWidth = SS; g.strokeRect(x, y, w, h);
}

function gable(g, x, yEave, w, peakY, color) {
  const cx = x + w / 2;
  g.fillStyle = vGrad(g, peakY, yEave, adjust(color, .10), adjust(color, -.13));
  g.beginPath(); g.moveTo(x, yEave); g.lineTo(cx, peakY); g.lineTo(x + w, yEave); g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(15,10,5,0.45)'; g.lineWidth = SS; g.stroke();
  // linhas do telhado (palha/telha)
  g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = SS * 0.7;
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    const yl = peakY + (yEave - peakY) * t;
    g.beginPath();
    g.moveTo(cx + (x - cx) * t, yl); g.lineTo(cx + (x + w - cx) * t, yl);
    g.stroke();
  }
  // brilho na cumeeira
  g.strokeStyle = 'rgba(255,246,220,0.25)'; g.lineWidth = SS * 1.1;
  g.beginPath(); g.moveTo(cx - w * 0.05, peakY + SS * 1.5); g.lineTo(cx + w * 0.05, peakY + SS * 1.5); g.stroke();
}

function door(g, cx, yb, w, h) {
  g.fillStyle = '#33230f';
  g.beginPath();
  g.moveTo(cx - w / 2, yb); g.lineTo(cx - w / 2, yb - h + w / 2);
  g.arc(cx, yb - h + w / 2, w / 2, Math.PI, 0);
  g.lineTo(cx + w / 2, yb); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = SS * 0.8; g.stroke();
  g.strokeStyle = 'rgba(255,235,200,0.10)';
  g.beginPath(); g.moveTo(cx, yb); g.lineTo(cx, yb - h + 2 * SS); g.stroke();
}

function win(g, x, y, w, h) {
  g.fillStyle = '#241c10'; g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = SS * 0.7; g.strokeRect(x, y, w, h);
  g.fillStyle = 'rgba(255,224,140,0.35)'; g.fillRect(x + SS * 0.6, y + SS * 0.6, w - SS * 1.2, (h - SS * 1.2) * 0.45);
}

function banner(g, x, y, w, h, color) {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w, y + h - w * 0.6);
  g.lineTo(x + w / 2, y + h); g.lineTo(x, y + h - w * 0.6); g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = SS * 0.6; g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x, y, w, SS * 1.2);
}

function flagPole(g, px, py, len, color) {
  g.strokeStyle = '#4a3a28'; g.lineWidth = SS * 1.2;
  g.beginPath(); g.moveTo(px, py); g.lineTo(px, py - len); g.stroke();
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(px, py - len);
  g.quadraticCurveTo(px + 8 * SS, py - len - 3 * SS, px + 15 * SS, py - len + 1 * SS);
  g.quadraticCurveTo(px + 8 * SS, py - len + 2.5 * SS, px, py - len + 6 * SS);
  g.closePath(); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = SS * 0.6; g.stroke();
}

function groundPad(g, S) {
  g.fillStyle = 'rgba(56,42,26,0.5)';
  g.beginPath(); g.ellipse(S / 2, S * 0.66, S * 0.52, S * 0.30, 0, 0, Math.PI * 2); g.fill();
}

// ============================================================
export class Sprites {
  constructor() { this.cache = new Map(); }

  // ---------------- edifícios ----------------
  building(type, pIdx) {
    const key = `b:${type}:${pIdx}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const def = BUILDINGS[type];
    const S = def.size * TILE * SS;
    const OV = type === 'tower' ? TILE * SS * 1.35 : type === 'town_center' ? TILE * SS * 1.0 : TILE * SS * 0.4;
    const c = cv(S, S + OV);
    const g = c.getContext('2d');
    g.translate(0, OV);
    const col = PLAYER_COLORS[pIdx % PLAYER_COLORS.length];
    groundPad(g, S);
    const meta = { canvas: c, ov: OV / SS };

    switch (type) {
      case 'town_center': {
        const wy = S * 0.44, wh = S * 0.46;
        stoneWall(g, S * 0.06, wy, S * 0.88, wh);
        gable(g, S * 0.02, wy + SS, S * 0.96, S * 0.13, ROOF);
        // segundo pavimento
        stoneWall(g, S * 0.30, S * 0.20, S * 0.40, S * 0.16);
        gable(g, S * 0.26, S * 0.21, S * 0.48, -S * 0.02, ROOF);
        win(g, S * 0.15, wy + wh * 0.28, S * 0.09, S * 0.11);
        win(g, S * 0.76, wy + wh * 0.28, S * 0.09, S * 0.11);
        win(g, S * 0.455, S * 0.245, S * 0.09, S * 0.09);
        door(g, S * 0.5, wy + wh, S * 0.15, S * 0.24);
        banner(g, S * 0.095, wy + S * 0.05, S * 0.065, S * 0.22, col.hex);
        banner(g, S * 0.84, wy + S * 0.05, S * 0.065, S * 0.22, col.hex);
        flagPole(g, S * 0.5, -S * 0.02, S * 0.20, col.hex);
        break;
      }
      case 'house': {
        const wy = S * 0.46, wh = S * 0.44;
        woodWall(g, S * 0.10, wy, S * 0.80, wh);
        gable(g, S * 0.04, wy + SS, S * 0.92, S * 0.16, THATCH);
        door(g, S * 0.40, wy + wh, S * 0.20, S * 0.26);
        win(g, S * 0.66, wy + wh * 0.3, S * 0.13, S * 0.14);
        // chaminé
        g.fillStyle = adjust(STONE, -.05);
        g.fillRect(S * 0.66, S * 0.14, S * 0.11, S * 0.20);
        g.strokeStyle = 'rgba(15,10,5,0.5)'; g.lineWidth = SS; g.strokeRect(S * 0.66, S * 0.14, S * 0.11, S * 0.20);
        break;
      }
      case 'mill': {
        // corpo de moinho (torre) + pás animadas em runtime
        const bx = S * 0.30, bw = S * 0.40, by = S * 0.34, bh = S * 0.56;
        stoneWall(g, bx, by, bw, bh);
        // telhado cônico
        g.fillStyle = vGrad(g, S * 0.10, by, adjust(THATCH, .08), adjust(THATCH, -.12));
        g.beginPath(); g.moveTo(bx - S * 0.03, by + SS); g.lineTo(S * 0.5, S * 0.10); g.lineTo(bx + bw + S * 0.03, by + SS); g.closePath();
        g.fill(); g.strokeStyle = 'rgba(15,10,5,0.45)'; g.lineWidth = SS; g.stroke();
        door(g, S * 0.5, by + bh, S * 0.14, S * 0.2);
        win(g, S * 0.44, by + bh * 0.3, S * 0.12, S * 0.10);
        // cubo do eixo
        g.fillStyle = '#4a3a28';
        g.beginPath(); g.arc(S * 0.5, S * 0.30, S * 0.045, 0, Math.PI * 2); g.fill();
        banner(g, bx + SS, by + S * 0.03, S * 0.05, S * 0.15, col.hex);
        meta.axle = { x: (S * 0.5) / SS, y: (S * 0.30) / SS };
        break;
      }
      case 'lumber_camp': {
        const wy = S * 0.46, wh = S * 0.42;
        woodWall(g, S * 0.06, wy, S * 0.52, wh);
        gable(g, S * 0.02, wy + SS, S * 0.60, S * 0.20, THATCH);
        door(g, S * 0.30, wy + wh, S * 0.16, S * 0.22);
        // pilha de troncos
        const logs = [[0.74, 0.82], [0.86, 0.82], [0.80, 0.72]];
        for (const [lx, ly] of logs) {
          g.fillStyle = '#a57a4a';
          g.beginPath(); g.arc(S * lx, S * ly, S * 0.065, 0, Math.PI * 2); g.fill();
          g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = SS * 0.8; g.stroke();
          g.strokeStyle = 'rgba(0,0,0,0.25)';
          g.beginPath(); g.arc(S * lx, S * ly, S * 0.032, 0, Math.PI * 2); g.stroke();
        }
        banner(g, S * 0.08, wy + S * 0.04, S * 0.05, S * 0.16, col.hex);
        break;
      }
      case 'mining_camp': {
        const wy = S * 0.46, wh = S * 0.42;
        woodWall(g, S * 0.06, wy, S * 0.52, wh);
        gable(g, S * 0.02, wy + SS, S * 0.60, S * 0.20, THATCH);
        door(g, S * 0.30, wy + wh, S * 0.16, S * 0.22);
        // pilha de minério
        g.fillStyle = '#7d838c';
        g.beginPath();
        g.moveTo(S * 0.66, S * 0.88); g.lineTo(S * 0.76, S * 0.68); g.lineTo(S * 0.86, S * 0.76);
        g.lineTo(S * 0.94, S * 0.88); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = SS * 0.8; g.stroke();
        g.fillStyle = '#e8c04f';
        g.beginPath(); g.arc(S * 0.78, S * 0.79, S * 0.02, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(S * 0.85, S * 0.83, S * 0.016, 0, Math.PI * 2); g.fill();
        // picareta na parede
        g.strokeStyle = '#6e4f2e'; g.lineWidth = SS * 1.2;
        g.beginPath(); g.moveTo(S * 0.14, wy + S * 0.05); g.lineTo(S * 0.24, wy + S * 0.17); g.stroke();
        g.strokeStyle = IRON; g.lineWidth = SS * 1.4;
        g.beginPath(); g.arc(S * 0.13, wy + S * 0.09, S * 0.05, -0.8, 1.4); g.stroke();
        break;
      }
      case 'barracks': {
        const wy = S * 0.42, wh = S * 0.48;
        stoneWall(g, S * 0.04, wy, S * 0.92, wh);
        gable(g, S * 0.00, wy + SS, S, S * 0.10, ROOF);
        door(g, S * 0.5, wy + wh, S * 0.16, S * 0.24);
        win(g, S * 0.14, wy + wh * 0.3, S * 0.09, S * 0.11);
        win(g, S * 0.77, wy + wh * 0.3, S * 0.09, S * 0.11);
        // emblema: escudo com espadas cruzadas
        const ex = S * 0.5, ey = S * 0.27;
        g.fillStyle = col.hex;
        g.beginPath();
        g.moveTo(ex - S * 0.07, ey - S * 0.07); g.lineTo(ex + S * 0.07, ey - S * 0.07);
        g.lineTo(ex + S * 0.07, ey + S * 0.02); g.quadraticCurveTo(ex + S * 0.06, ey + S * 0.09, ex, ey + S * 0.115);
        g.quadraticCurveTo(ex - S * 0.06, ey + S * 0.09, ex - S * 0.07, ey + S * 0.02);
        g.closePath(); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = SS; g.stroke();
        g.strokeStyle = '#f0f2f4'; g.lineWidth = SS * 1.1;
        g.beginPath(); g.moveTo(ex - S * 0.045, ey - S * 0.04); g.lineTo(ex + S * 0.045, ey + S * 0.06); g.stroke();
        g.beginPath(); g.moveTo(ex + S * 0.045, ey - S * 0.04); g.lineTo(ex - S * 0.045, ey + S * 0.06); g.stroke();
        banner(g, S * 0.32, wy + S * 0.03, S * 0.06, S * 0.18, col.hex);
        banner(g, S * 0.62, wy + S * 0.03, S * 0.06, S * 0.18, col.hex);
        break;
      }
      case 'archery': {
        const wy = S * 0.44, wh = S * 0.46;
        woodWall(g, S * 0.05, wy, S * 0.90, wh);
        gable(g, S * 0.01, wy + SS, S * 0.98, S * 0.12, THATCH);
        door(g, S * 0.5, wy + wh, S * 0.15, S * 0.22);
        win(g, S * 0.15, wy + wh * 0.3, S * 0.09, S * 0.11);
        win(g, S * 0.76, wy + wh * 0.3, S * 0.09, S * 0.11);
        // emblema alvo
        const tx2 = S * 0.5, ty = S * 0.28;
        for (const [r, cc] of [[0.075, '#f0ead8'], [0.052, '#b8453a'], [0.028, '#f0ead8'], [0.012, '#b8453a']]) {
          g.fillStyle = cc;
          g.beginPath(); g.arc(tx2, ty, S * r, 0, Math.PI * 2); g.fill();
        }
        g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = SS * 0.8;
        g.beginPath(); g.arc(tx2, ty, S * 0.075, 0, Math.PI * 2); g.stroke();
        banner(g, S * 0.08, wy + S * 0.04, S * 0.06, S * 0.18, col.hex);
        break;
      }
      case 'stable': {
        const wy = S * 0.44, wh = S * 0.46;
        woodWall(g, S * 0.04, wy, S * 0.92, wh);
        gable(g, S * 0.00, wy + SS, S, S * 0.12, THATCH);
        // porta dupla grande
        g.fillStyle = '#33230f';
        g.fillRect(S * 0.36, wy + wh - S * 0.30, S * 0.28, S * 0.30);
        g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = SS;
        g.strokeRect(S * 0.36, wy + wh - S * 0.30, S * 0.28, S * 0.30);
        g.beginPath(); g.moveTo(S * 0.5, wy + wh - S * 0.30); g.lineTo(S * 0.5, wy + wh); g.stroke();
        // ferradura
        g.strokeStyle = IRON; g.lineWidth = SS * 1.8;
        g.beginPath(); g.arc(S * 0.5, S * 0.30, S * 0.05, Math.PI * 0.85, Math.PI * 2.15); g.stroke();
        // feno
        g.fillStyle = '#d3b25e';
        g.beginPath(); g.ellipse(S * 0.84, wy + wh - S * 0.06, S * 0.09, S * 0.06, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(120,90,30,0.6)'; g.lineWidth = SS * 0.6;
        for (let i = 0; i < 4; i++) {
          g.beginPath(); g.moveTo(S * (0.78 + i * 0.03), wy + wh - S * 0.10); g.lineTo(S * (0.80 + i * 0.03), wy + wh - S * 0.02); g.stroke();
        }
        banner(g, S * 0.07, wy + S * 0.04, S * 0.06, S * 0.18, col.hex);
        break;
      }
      case 'tower': {
        const topY = -OV * 0.72, baseY = S * 0.92;
        const x0 = S * 0.20, x1 = S * 0.80;
        // coluna com sombreamento cilíndrico
        const gr = g.createLinearGradient(x0, 0, x1, 0);
        gr.addColorStop(0, adjust(STONE, -.14)); gr.addColorStop(0.35, adjust(STONE, .09));
        gr.addColorStop(0.7, adjust(STONE, -.02)); gr.addColorStop(1, adjust(STONE, -.18));
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(x0 - S * 0.05, baseY); g.lineTo(x0, topY); g.lineTo(x1, topY); g.lineTo(x1 + S * 0.05, baseY);
        g.closePath(); g.fill();
        g.strokeStyle = 'rgba(15,10,5,0.5)'; g.lineWidth = SS; g.stroke();
        // fiadas de pedra
        g.strokeStyle = 'rgba(0,0,0,0.14)'; g.lineWidth = SS * 0.7;
        for (let yy = topY + 8 * SS; yy < baseY; yy += 8 * SS) {
          g.beginPath(); g.moveTo(x0 - S * 0.02, yy); g.lineTo(x1 + S * 0.02, yy); g.stroke();
        }
        // ameias
        g.fillStyle = adjust(STONE, .04);
        for (let i = 0; i < 4; i++) {
          const mx = x0 - S * 0.04 + i * ((x1 - x0 + S * 0.08) / 3.2);
          g.fillRect(mx, topY - 7 * SS, 7 * SS, 8 * SS);
          g.strokeStyle = 'rgba(15,10,5,0.5)'; g.lineWidth = SS * 0.8;
          g.strokeRect(mx, topY - 7 * SS, 7 * SS, 8 * SS);
        }
        // seteira e porta
        g.fillStyle = '#241c10';
        g.fillRect(S * 0.47, topY + S * 0.28, S * 0.06, S * 0.20);
        door(g, S * 0.5, baseY, S * 0.18, S * 0.24);
        flagPole(g, S * 0.5, topY - 7 * SS, S * 0.22, col.hex);
        break;
      }
    }
    this.cache.set(key, meta);
    return meta;
  }

  // ---------------- canteiro de obras ----------------
  scaffold(size) {
    const key = `s:${size}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const S = size * TILE * SS, OV = TILE * SS * 0.3;
    const c = cv(S, S + OV);
    const g = c.getContext('2d');
    g.translate(0, OV);
    groundPad(g, S);
    g.strokeStyle = '#8a6440'; g.lineCap = 'round';
    g.lineWidth = SS * 2;
    const posts = [[0.14, 0.14], [0.86, 0.14], [0.14, 0.86], [0.86, 0.86]];
    for (const [px, py] of posts) {
      g.beginPath(); g.moveTo(S * px, S * py); g.lineTo(S * px, S * py - S * 0.34); g.stroke();
    }
    g.lineWidth = SS * 1.4;
    g.beginPath(); g.moveTo(S * 0.14, S * 0.14 - S * 0.34); g.lineTo(S * 0.86, S * 0.14 - S * 0.34); g.stroke();
    g.beginPath(); g.moveTo(S * 0.14, S * 0.86 - S * 0.34); g.lineTo(S * 0.86, S * 0.86 - S * 0.34); g.stroke();
    g.beginPath(); g.moveTo(S * 0.14, S * 0.60); g.lineTo(S * 0.50, S * 0.30); g.stroke();
    // pilha de tábuas
    g.fillStyle = '#b08b57';
    g.fillRect(S * 0.32, S * 0.62, S * 0.36, S * 0.06);
    g.fillRect(S * 0.36, S * 0.55, S * 0.28, S * 0.06);
    g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = SS * 0.7;
    g.strokeRect(S * 0.32, S * 0.62, S * 0.36, S * 0.06);
    g.strokeRect(S * 0.36, S * 0.55, S * 0.28, S * 0.06);
    const meta = { canvas: c, ov: OV / SS };
    this.cache.set(key, meta);
    return meta;
  }

  // ---------------- recursos ----------------
  node(type, variant = 0) {
    const key = `n:${type}:${variant}`;
    if (this.cache.has(key)) return this.cache.get(key);
    let meta;
    switch (type) {
      case 'tree': meta = this.bakeTree(variant); break;
      case 'gold': meta = this.bakeOre('#c9982f', '#e8c04f', '#8f6a1c', true); break;
      case 'stone': meta = this.bakeOre('#9aa0a6', '#c2c6cb', '#6f757c', false); break;
      case 'berry': meta = this.bakeBerry(); break;
      case 'sheep': meta = this.bakeSheep(); break;
      case 'farm': meta = this.bakeFarm(); break;
      default: meta = this.bakeBerry();
    }
    this.cache.set(key, meta);
    return meta;
  }

  bakeTree(variant) {
    const W = TILE * SS * 1.7, H = TILE * SS * 2.2;
    const c = cv(W, H);
    const g = c.getContext('2d');
    const cx = W / 2, base = H - TILE * SS * 0.18;
    // sombra
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.beginPath(); g.ellipse(cx, base, W * 0.30, W * 0.10, 0, 0, Math.PI * 2); g.fill();
    if (variant === 2) {
      // pinheiro
      g.fillStyle = '#5e4128';
      g.fillRect(cx - SS * 1.6, base - SS * 8, SS * 3.2, SS * 8);
      const tiers = [[0.86, 0.34], [0.62, 0.28], [0.40, 0.21]];
      for (const [ty, tw] of tiers) {
        const yy = H * ty, ww = W * tw;
        const gr = g.createLinearGradient(cx - ww, 0, cx + ww, 0);
        gr.addColorStop(0, '#1e4a26'); gr.addColorStop(0.45, '#3a7a3c'); gr.addColorStop(1, '#255230');
        g.fillStyle = gr;
        g.beginPath(); g.moveTo(cx - ww, yy); g.lineTo(cx, yy - H * 0.30); g.lineTo(cx + ww, yy); g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(10,25,12,0.5)'; g.lineWidth = SS * 0.8; g.stroke();
      }
    } else {
      // frondosa
      g.fillStyle = '#6b4a2c';
      g.beginPath();
      g.moveTo(cx - SS * 2.2, base); g.lineTo(cx - SS * 1.1, base - SS * 12);
      g.lineTo(cx + SS * 1.1, base - SS * 12); g.lineTo(cx + SS * 2.2, base);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(30,18,8,0.6)'; g.lineWidth = SS * 0.7; g.stroke();
      const tone = variant === 1 ? 0.05 : 0;
      const blobs = [[0, -0.52, 0.32], [-0.22, -0.40, 0.24], [0.22, -0.42, 0.25], [0, -0.30, 0.26]];
      for (const [bx, by, br] of blobs) {
        const px = cx + W * bx, py = H * (1 + by) - TILE * SS * 0.2, pr = W * br;
        const gr = g.createRadialGradient(px - pr * 0.35, py - pr * 0.45, pr * 0.15, px, py, pr);
        gr.addColorStop(0, adjust('#57944a', tone + 0.04));
        gr.addColorStop(0.7, adjust('#33702c', tone));
        gr.addColorStop(1, adjust('#1f4d1c', tone));
        g.fillStyle = gr;
        g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
      }
      // brilhos
      g.fillStyle = 'rgba(200,255,170,0.14)';
      g.beginPath(); g.arc(cx - W * 0.12, H * 0.36, W * 0.09, 0, Math.PI * 2); g.fill();
    }
    return { canvas: c, ov: 0 };
  }

  bakeOre(base, light, dark, gold) {
    const W = TILE * SS * 1.35, H = TILE * SS * 1.2;
    const c = cv(W, H);
    const g = c.getContext('2d');
    const ground = H - SS * 4;
    g.fillStyle = 'rgba(0,0,0,0.26)';
    g.beginPath(); g.ellipse(W / 2, ground, W * 0.38, W * 0.10, 0, 0, Math.PI * 2); g.fill();
    const rocks = [
      [0.30, 0.72, 0.26], [0.66, 0.70, 0.30], [0.48, 0.48, 0.24],
    ];
    for (const [rx, ry, rr] of rocks) {
      const px = W * rx, py = H * ry, pr = W * rr;
      g.fillStyle = base;
      g.beginPath();
      g.moveTo(px - pr, py + pr * 0.5);
      g.lineTo(px - pr * 0.55, py - pr * 0.7);
      g.lineTo(px + pr * 0.35, py - pr * 0.85);
      g.lineTo(px + pr, py - pr * 0.05);
      g.lineTo(px + pr * 0.7, py + pr * 0.55);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(20,15,8,0.45)'; g.lineWidth = SS * 0.8; g.stroke();
      // faceta iluminada
      g.fillStyle = light;
      g.beginPath();
      g.moveTo(px - pr * 0.55, py - pr * 0.7);
      g.lineTo(px + pr * 0.35, py - pr * 0.85);
      g.lineTo(px + pr * 0.2, py - pr * 0.15);
      g.lineTo(px - pr * 0.4, py - pr * 0.1);
      g.closePath(); g.fill();
      g.fillStyle = dark;
      g.beginPath();
      g.moveTo(px + pr, py - pr * 0.05);
      g.lineTo(px + pr * 0.7, py + pr * 0.55);
      g.lineTo(px + pr * 0.15, py + pr * 0.35);
      g.lineTo(px + pr * 0.2, py - pr * 0.15);
      g.closePath(); g.fill();
    }
    if (gold) {
      g.fillStyle = '#fff3c0';
      for (const [sx, sy] of [[0.42, 0.42], [0.68, 0.60], [0.30, 0.62]]) {
        g.beginPath(); g.arc(W * sx, H * sy, SS * 1.1, 0, Math.PI * 2); g.fill();
      }
    } else {
      g.fillStyle = 'rgba(110,150,90,0.5)';
      g.beginPath(); g.arc(W * 0.32, H * 0.78, SS * 2, 0, Math.PI * 2); g.fill();
    }
    return { canvas: c, ov: 0 };
  }

  bakeBerry() {
    const W = TILE * SS * 1.25, H = TILE * SS * 1.1;
    const c = cv(W, H);
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.24)';
    g.beginPath(); g.ellipse(W / 2, H - SS * 3, W * 0.36, W * 0.10, 0, 0, Math.PI * 2); g.fill();
    const blobs = [[0.34, 0.62, 0.26], [0.64, 0.60, 0.27], [0.50, 0.42, 0.26]];
    for (const [bx, by, br] of blobs) {
      const px = W * bx, py = H * by, pr = W * br;
      const gr = g.createRadialGradient(px - pr * 0.3, py - pr * 0.4, pr * 0.15, px, py, pr);
      gr.addColorStop(0, '#4f8c3e'); gr.addColorStop(1, '#27541f');
      g.fillStyle = gr;
      g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
    }
    for (const [dx, dy] of [[0.36, 0.52], [0.5, 0.38], [0.62, 0.55], [0.45, 0.62], [0.58, 0.42], [0.30, 0.66]]) {
      g.fillStyle = '#8b3fa8';
      g.beginPath(); g.arc(W * dx, H * dy, SS * 1.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.beginPath(); g.arc(W * dx - SS * 0.4, H * dy - SS * 0.4, SS * 0.5, 0, Math.PI * 2); g.fill();
    }
    return { canvas: c, ov: 0 };
  }

  bakeSheep() {
    const W = TILE * SS * 1.3, H = TILE * SS * 1.05;
    const c = cv(W, H);
    const g = c.getContext('2d');
    const ground = H - SS * 2.5;
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath(); g.ellipse(W * 0.5, ground, W * 0.32, W * 0.09, 0, 0, Math.PI * 2); g.fill();
    // pernas
    g.strokeStyle = '#3a352d'; g.lineWidth = SS * 1.6; g.lineCap = 'round';
    for (const lx of [0.36, 0.46, 0.58, 0.66]) {
      g.beginPath(); g.moveTo(W * lx, H * 0.62); g.lineTo(W * lx, ground); g.stroke();
    }
    // corpo lanoso
    for (const [bx, by, br] of [[0.42, 0.50, 0.20], [0.58, 0.50, 0.20], [0.50, 0.42, 0.19], [0.36, 0.44, 0.15], [0.64, 0.44, 0.15]]) {
      const gr = g.createRadialGradient(W * bx - SS * 2, H * by - SS * 2, SS, W * bx, H * by, W * br);
      gr.addColorStop(0, '#f4efe1'); gr.addColorStop(1, '#cfc6ae');
      g.fillStyle = gr;
      g.beginPath(); g.arc(W * bx, H * by, W * br, 0, Math.PI * 2); g.fill();
    }
    // cabeça
    g.fillStyle = '#42392e';
    g.beginPath(); g.ellipse(W * 0.76, H * 0.42, W * 0.10, W * 0.08, 0.3, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2c2620';
    g.beginPath(); g.ellipse(W * 0.70, H * 0.36, W * 0.045, W * 0.025, -0.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f4efe1';
    g.beginPath(); g.arc(W * 0.78, H * 0.40, SS * 0.8, 0, Math.PI * 2); g.fill();
    return { canvas: c, ov: 0 };
  }

  bakeFarm() {
    const W = TILE * SS * 1.05, H = TILE * SS * 1.05;
    const c = cv(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#6e5230'; g.fillRect(SS, SS, W - SS * 2, H - SS * 2);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = SS * 0.8;
    g.strokeRect(SS, SS, W - SS * 2, H - SS * 2);
    for (let i = 0; i < 4; i++) {
      const yy = SS * 3 + i * (H - SS * 6) / 3;
      g.strokeStyle = '#8faf4a'; g.lineWidth = SS * 1.6;
      g.beginPath(); g.moveTo(SS * 3, yy); g.lineTo(W - SS * 3, yy); g.stroke();
      g.fillStyle = '#d9c258';
      for (let x = SS * 4; x < W - SS * 3; x += SS * 5) {
        g.beginPath(); g.arc(x, yy - SS, SS * 0.7, 0, Math.PI * 2); g.fill();
      }
    }
    return { canvas: c, ov: 0 };
  }
}
