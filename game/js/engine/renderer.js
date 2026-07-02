import { TILE, UNITS, BUILDINGS, RESOURCE_NODES, PLAYER_COLORS, defOf } from '../game/config.js';
import { TERRAIN } from '../game/world.js';
import { clamp, makeRNG } from './utils.js';
import { Sprites, SS, adjust } from './sprites.js';

const SKIN = '#e0ac7e', IRON = '#c7c9cc', IRON_D = '#8e9094', LEATHER = '#6e5636';

export class Renderer {
  constructor(canvas, model, camera) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.model = model; this.camera = camera;
    // memória de névoa (explorado) por tile
    this.explored = new Uint8Array(model.W * model.H);
    this.visible = new Uint8Array(model.W * model.H);
    // memória de edifícios já vistos no fog
    this.knownBuildings = new Map();
    this.sprites = new Sprites();
    this.anim = new Map(); // id -> fase de caminhada
    this.terrainCanvas = this.bakeTerrain();
    // névoa suave: 1px por tile, ampliada com filtro bilinear
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = model.W; this.fogCanvas.height = model.H;
    this.fogCtx = this.fogCanvas.getContext('2d');
    this.fogData = this.fogCtx.createImageData(model.W, model.H);
    this.selection = new Set();
    this.placement = null;
    this.dragBox = null;
  }

  // ---------------- terreno orgânico (bake único) ----------------
  bakeTerrain() {
    const { W, H, terrain } = this.model;
    const c = document.createElement('canvas');
    c.width = W * TILE; c.height = H * TILE;
    const g = c.getContext('2d');
    const rng = makeRNG(1337);
    g.fillStyle = '#2c4a22'; g.fillRect(0, 0, c.width, c.height);
    const GRASS = ['#4a7c3a', '#457436', '#508242', '#3f6f31', '#487a38'];
    const DIRT = ['#7a6544', '#6f5b3d', '#83704e'];
    const SAND = ['#cbb476', '#c0a96b'];
    const blob = (x, y, r, color) => {
      const gr = g.createRadialGradient(x, y, r * 0.2, x, y, r);
      gr.addColorStop(0, color); gr.addColorStop(1, color + '00');
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    };
    const center = (x, y) => [(x + 0.5) * TILE + (rng() - 0.5) * 10, (y + 0.5) * TILE + (rng() - 0.5) * 10];
    // grama: base + manchas tonais grandes e suaves (sem padrão de grade)
    g.fillStyle = '#4a7a39'; g.fillRect(0, 0, c.width, c.height);
    g.globalAlpha = 0.4;
    const patches = Math.floor(W * H / 14);
    for (let k = 0; k < patches; k++) {
      blob(rng() * c.width, rng() * c.height, TILE * (2 + rng() * 3), GRASS[(rng() * GRASS.length) | 0]);
    }
    g.globalAlpha = 1;
    // terra e areia: blobs por tile com raio irregular (bordas orgânicas)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = terrain[y * W + x];
      if (t !== TERRAIN.DIRT && t !== TERRAIN.SAND) continue;
      const [px, py] = center(x, y);
      const r = TILE * (0.85 + rng() * 0.45);
      if (t === TERRAIN.DIRT) blob(px, py, r, DIRT[(rng() * DIRT.length) | 0]);
      else blob(px, py, r, SAND[(rng() * SAND.length) | 0]);
    }
    // segunda passada de terra para reforçar o núcleo das manchas
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      if (terrain[y * W + x] !== TERRAIN.DIRT) continue;
      const solid = terrain[y * W + x - 1] === TERRAIN.DIRT && terrain[y * W + x + 1] === TERRAIN.DIRT &&
        terrain[(y - 1) * W + x] === TERRAIN.DIRT && terrain[(y + 1) * W + x] === TERRAIN.DIRT;
      if (solid) blob((x + 0.5) * TILE, (y + 0.5) * TILE, TILE * 1.1, DIRT[(rng() * DIRT.length) | 0]);
    }
    // água: cobertura opaca com contorno orgânico + profundidade
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (terrain[y * W + x] !== TERRAIN.WATER) continue;
      const [px, py] = center(x, y);
      g.fillStyle = '#2a5580';
      g.beginPath(); g.arc(px, py, TILE * 0.64, 0, Math.PI * 2); g.fill();
    }
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      if (terrain[y * W + x] !== TERRAIN.WATER) continue;
      const deep = terrain[y * W + x - 1] === TERRAIN.WATER && terrain[y * W + x + 1] === TERRAIN.WATER &&
        terrain[(y - 1) * W + x] === TERRAIN.WATER && terrain[(y + 1) * W + x] === TERRAIN.WATER;
      if (deep) blob((x + 0.5) * TILE, (y + 0.5) * TILE, TILE * 0.8, '#1d3d61');
    }
    // decoração: tufos de grama, flores, pedrinhas
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = terrain[y * W + x];
      const px = x * TILE, py = y * TILE;
      if (t === TERRAIN.GRASS) {
        if (rng() < 0.11) {
          g.strokeStyle = '#5d9147'; g.lineWidth = 1.2; g.lineCap = 'round';
          const bx = px + 4 + rng() * 24, by = py + 6 + rng() * 22;
          for (let k = -1; k <= 1; k++) {
            g.beginPath(); g.moveTo(bx + k * 2, by); g.lineTo(bx + k * 3.2, by - 4 - rng() * 3); g.stroke();
          }
        }
        if (rng() < 0.028) {
          g.fillStyle = rng() < 0.5 ? '#e8e39a' : '#d98fb0';
          g.beginPath(); g.arc(px + 6 + rng() * 20, py + 6 + rng() * 20, 1.6, 0, Math.PI * 2); g.fill();
        }
      } else if (t === TERRAIN.DIRT && rng() < 0.06) {
        g.fillStyle = '#8d8577';
        g.beginPath(); g.arc(px + 6 + rng() * 20, py + 8 + rng() * 18, 1.8 + rng() * 1.4, 0, Math.PI * 2); g.fill();
      }
    }
    return c;
  }

  // ---------------- névoa de guerra ----------------
  computeFog(now) {
    this.visible.fill(0);
    const W = this.model.W, H = this.model.H;
    const mark = (cx, cy, r) => {
      const r2 = r * r;
      for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++)
        for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) {
          const dx = x - cx, dy = y - cy;
          if (dx * dx + dy * dy <= r2) { this.visible[y * W + x] = 1; this.explored[y * W + x] = 1; }
        }
    };
    for (const e of this.model.entities(now)) {
      if (e.owner !== this.model.localPlayerId) continue;
      const def = defOf(e.type);
      const sight = e.building ? (def.sightRange || 5) : (def.sight || 5);
      mark(Math.floor(e.x / TILE), Math.floor(e.y / TILE), sight);
      if (e.building) this.knownBuildings.delete(e.id); // próprio nunca é fantasma
    }
    // memoriza edifícios inimigos vistos; remove fantasmas se tile revisitado e sumiu
    for (const e of this.model.entities(now)) {
      if (e.owner === this.model.localPlayerId || !e.building) continue;
      const def = defOf(e.type);
      if (this.isTileNearVisible(Math.floor(e.x / TILE), Math.floor(e.y / TILE)))
        this.knownBuildings.set(e.id, { id: e.id, type: e.type, owner: e.owner, bx: e.bx, by: e.by, size: def.size, constructed: e.constructed, buildProgress: 1, hp: e.hp });
    }
    for (const [id, b] of this.knownBuildings) {
      const tx = Math.floor((b.bx + b.size / 2)), ty = Math.floor((b.by + b.size / 2));
      if (this.isVisibleTile(tx, ty) && !this.model.getEntity(id)) this.knownBuildings.delete(id);
    }
  }

  isVisibleTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.model.W || ty >= this.model.H) return false;
    return this.visible[ty * this.model.W + tx] === 1;
  }

  isTileNearVisible(tx, ty) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if (this.isVisibleTile(tx + dx, ty + dy)) return true;
    return false;
  }

  // ---------------- loop principal ----------------
  render(now) {
    const { ctx, canvas, camera } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d100a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.computeFog(now);

    ctx.save();
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    const vw = camera.vw / camera.zoom, vh = camera.vh / camera.zoom;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrainCanvas, camera.x, camera.y, vw, vh, camera.x, camera.y, vw, vh);
    ctx.imageSmoothingEnabled = true;
    this.drawWaterFX(now);

    // fantasmas de edifícios no fog
    for (const b of this.knownBuildings.values()) {
      if (this.isTileNearVisible(Math.floor(b.bx + b.size / 2), Math.floor(b.by + b.size / 2))) continue;
      if (!this.explored[Math.floor(b.by + b.size / 2) * this.model.W + Math.floor(b.bx + b.size / 2)]) continue;
      ctx.globalAlpha = 0.55;
      this.drawBuilding(b, now, true);
      ctx.globalAlpha = 1;
    }

    // lista única ordenada por profundidade (recursos + entidades)
    const items = [];
    for (const n of this.model.nodes()) {
      const near = this.isTileNearVisible(n.x, n.y);
      if (!near && !this.explored[n.y * this.model.W + n.x]) continue;
      const flat = n.type === 'farm';
      items.push({ y: flat ? n.y * TILE - 900 : (n.y + 0.92) * TILE, f: () => this.drawNode(n) });
    }
    for (const e of this.model.entities(now)) {
      if (e.owner !== this.model.localPlayerId &&
          !this.isTileNearVisible(Math.floor(e.x / TILE), Math.floor(e.y / TILE))) continue;
      if (e.building) items.push({ y: (e.by + defOf(e.type).size) * TILE, f: () => this.drawBuilding(e, now, false) });
      else items.push({ y: e.y + 8, f: () => this.drawUnit(e, now) });
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.f();

    this.drawProjectiles(now);
    this.drawPlacement();
    this.drawFog();

    ctx.restore();
    this.drawDragBox();
  }

  drawWaterFX(now) {
    const { ctx, camera, model } = this;
    const x0 = Math.max(0, Math.floor(camera.x / TILE));
    const y0 = Math.max(0, Math.floor(camera.y / TILE));
    const x1 = Math.min(model.W, Math.ceil((camera.x + camera.vw / camera.zoom) / TILE));
    const y1 = Math.min(model.H, Math.ceil((camera.y + camera.vh / camera.zoom) / TILE));
    ctx.lineCap = 'round';
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (model.terrain[y * model.W + x] !== TERRAIN.WATER) continue;
      if ((x * 13 + y * 7) % 5 !== 0) continue;
      const t = now * 0.0016 + x * 1.7 + y * 2.3;
      const a = 0.05 + 0.05 * Math.sin(t * 1.3);
      const dx = Math.sin(t) * 4;
      ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x * TILE + 8 + dx, y * TILE + 17);
      ctx.lineTo(x * TILE + 20 + dx, y * TILE + 17);
      ctx.stroke();
    }
  }

  // ---------------- recursos ----------------
  drawNode(n) {
    const { ctx } = this;
    const spr = (() => {
      if (n.type === 'tree') return this.sprites.node('tree', (n.id * 2654435761 >>> 0) % 3);
      return this.sprites.node(n.type);
    })();
    const h = (n.id * 2654435761) >>> 0;
    const jx = ((h & 255) / 255 - 0.5) * 8;
    const jy = (((h >> 8) & 255) / 255 - 0.5) * 5;
    let sc = 0.92 + (((h >> 16) & 255) / 255) * 0.22;
    if (n.type === 'gold' || n.type === 'stone' || n.type === 'berry')
      sc *= 0.72 + 0.28 * clamp(n.amount / n.max, 0, 1);
    const w = spr.canvas.width / SS * sc, hh = spr.canvas.height / SS * sc;
    const dx = (n.x + 0.5) * TILE - w / 2 + (n.type === 'sheep' ? 0 : jx);
    const dy = (n.y + 1) * TILE - hh + (n.type === 'sheep' ? 0 : jy);
    if (n.type === 'sheep' && (h & 1)) {
      ctx.save();
      ctx.translate((n.x + 0.5) * TILE, 0); ctx.scale(-1, 1); ctx.translate(-(n.x + 0.5) * TILE, 0);
      ctx.drawImage(spr.canvas, dx, dy, w, hh);
      ctx.restore();
    } else {
      ctx.drawImage(spr.canvas, dx, dy, w, hh);
    }
  }

  // ---------------- edifícios ----------------
  drawBuilding(e, now, ghost) {
    const { ctx } = this;
    const def = BUILDINGS[e.type];
    const spr = this.sprites.building(e.type, e.owner);
    const px = e.bx * TILE, py = e.by * TILE;
    const dw = spr.canvas.width / SS, dh = spr.canvas.height / SS;
    const dy0 = py - spr.ov;

    if (!e.constructed && !ghost) {
      const p = clamp(e.buildProgress || 0, 0, 1);
      const sc = this.sprites.scaffold(def.size);
      ctx.drawImage(sc.canvas, px, py - sc.ov, sc.canvas.width / SS, sc.canvas.height / SS);
      if (p > 0.04) {
        // edifício "sobe" do chão conforme o progresso
        const sh = spr.canvas.height * p;
        ctx.drawImage(spr.canvas, 0, spr.canvas.height - sh, spr.canvas.width, sh,
          px, dy0 + dh * (1 - p), dw, dh * p);
      }
      // barra de progresso
      this.roundBar(px + 3, py - spr.ov - 8, def.size * TILE - 6, 5, p, '#e6c469');
    } else {
      ctx.drawImage(spr.canvas, px, dy0, dw, dh);
    }

    if (ghost) return;

    // pás do moinho (animadas)
    if (e.type === 'mill' && e.constructed && spr.axle) {
      const cx = px + spr.axle.x, cy = py - spr.ov + spr.axle.y;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(now * 0.0009 + (e.id % 7));
      for (let k = 0; k < 4; k++) {
        ctx.rotate(Math.PI / 2);
        ctx.strokeStyle = '#5e4128'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(TILE * 0.85, 0); ctx.stroke();
        ctx.fillStyle = 'rgba(238,228,205,0.92)';
        ctx.fillRect(TILE * 0.16, -4.4, TILE * 0.62, 8.8);
        ctx.strokeStyle = 'rgba(90,65,40,0.6)'; ctx.lineWidth = 1;
        ctx.strokeRect(TILE * 0.16, -4.4, TILE * 0.62, 8.8);
        ctx.beginPath(); ctx.moveTo(TILE * 0.37, -4.4); ctx.lineTo(TILE * 0.37, 4.4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(TILE * 0.58, -4.4); ctx.lineTo(TILE * 0.58, 4.4); ctx.stroke();
      }
      ctx.fillStyle = '#3a2c1a';
      ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    const sel = this.selection.has(e.id);
    if (sel) {
      ctx.strokeStyle = 'rgba(240,255,220,0.95)'; ctx.lineWidth = 2;
      ctx.strokeRect(px + 1.5, py + 1.5, def.size * TILE - 3, def.size * TILE - 3);
      ctx.strokeStyle = 'rgba(240,255,220,0.35)';
      ctx.strokeRect(px - 1.5, py - 1.5, def.size * TILE + 3, def.size * TILE + 3);
      // ponto de encontro
      if (e.rally) this.drawRally(e.rally, now);
    }

    this.drawHealthBar(e, px + def.size * TILE / 2, py - spr.ov - (e.constructed ? 4 : 16), def.size * TILE - 8);

    // fila de treino
    if (e.constructed && e.queue && e.queue.length) {
      const item = e.queue[0];
      this.roundBar(px + 3, py + def.size * TILE + 2, def.size * TILE - 6, 4, item.elapsed / item.total, '#5adb6a');
    }
  }

  drawRally(r, now) {
    const { ctx } = this;
    const sway = Math.sin(now * 0.004) * 1.5;
    ctx.strokeStyle = '#4a3a28'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x, r.y - 16); ctx.stroke();
    ctx.fillStyle = '#e6c469';
    ctx.beginPath();
    ctx.moveTo(r.x, r.y - 16);
    ctx.lineTo(r.x + 11 + sway, r.y - 12.5);
    ctx.lineTo(r.x, r.y - 9);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
  }

  roundBar(x, y, w, h, p, color) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(10,8,4,0.75)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, Math.max(0, w * clamp(p, 0, 1)), h);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x, y, Math.max(0, w * clamp(p, 0, 1)), 1);
  }

  // ---------------- unidades ----------------
  drawUnit(e, now) {
    const ctx = this.ctx;
    const def = UNITS[e.type];
    if (!def) return;
    const col = PLAYER_COLORS[e.owner % PLAYER_COLORS.length];
    const s = TILE / 32;
    let a = this.anim.get(e.id);
    if (!a) { a = { x: e.x, y: e.y, ph: (e.id % 10) * 0.7 }; this.anim.set(e.id, a); }
    const d = Math.hypot(e.x - a.x, e.y - a.y);
    const moving = d > 0.06;
    a.ph += d * 0.30; a.x = e.x; a.y = e.y;
    if (this.anim.size > 3000) this.anim.clear();
    const attacking = e.state === 'attack';
    const working = e.state === 'gather' || e.state === 'build';
    const dir = Math.cos(e.facing || 0) >= 0 ? 1 : -1;
    const sel = this.selection.has(e.id);
    const cav = def.class === 'cavalry';

    ctx.save();
    ctx.translate(e.x, e.y + 8 * s);
    // sombra + anel de seleção
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(0, 0, (cav ? 11 : 7) * s, (cav ? 3.6 : 2.6) * s, 0, 0, Math.PI * 2); ctx.fill();
    if (sel) {
      ctx.strokeStyle = 'rgba(140,255,150,0.95)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(0, 0.5 * s, (cav ? 13 : 9) * s, (cav ? 4.6 : 3.4) * s, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(140,255,150,0.30)';
      ctx.beginPath(); ctx.ellipse(0, 0.5 * s, (cav ? 15 : 11) * s, (cav ? 5.4 : 4.2) * s, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.scale(dir, 1);
    if (cav) this.drawHorseman(e, col, s, a.ph, moving, attacking, now);
    else this.drawFootman(e, col, s, a.ph, moving, attacking, working, now);
    ctx.restore();

    this.drawHealthBar(e, e.x, e.y - (cav ? 24 : 21) * s, TILE * 0.72);
  }

  drawFootman(e, col, s, ph, moving, attacking, working, now) {
    const ctx = this.ctx;
    const bob = moving ? Math.sin(ph * 2) * 0.7 * s : 0;
    const swing = moving ? Math.sin(ph) * 3 * s : 0;
    ctx.lineCap = 'round';

    // pernas
    ctx.strokeStyle = '#4a3626'; ctx.lineWidth = 2.4 * s;
    ctx.beginPath(); ctx.moveTo(-2 * s, -6 * s); ctx.lineTo(-2 * s - swing, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2 * s, -6 * s); ctx.lineTo(2 * s + swing, 0); ctx.stroke();

    // itens às costas
    if (e.type === 'archer' || e.type === 'crossbow') {
      ctx.fillStyle = LEATHER;
      ctx.save(); ctx.translate(-4 * s, -12 * s + bob); ctx.rotate(0.35);
      ctx.fillRect(-1.4 * s, -3.4 * s, 2.8 * s, 6.4 * s);
      ctx.strokeStyle = '#caa66a'; ctx.lineWidth = 0.9 * s;
      for (const ax of [-0.7, 0.4]) {
        ctx.beginPath(); ctx.moveTo(ax * s, -3.2 * s); ctx.lineTo(ax * s, -5.2 * s); ctx.stroke();
      }
      ctx.restore();
    }
    if (e.type === 'villager' && e.state === 'return') {
      ctx.fillStyle = '#9c7a4e';
      ctx.beginPath(); ctx.arc(-4.6 * s, -13.5 * s + bob, 3.2 * s, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(40,25,10,0.55)'; ctx.lineWidth = 0.9 * s; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-4.6 * s, -16.4 * s + bob); ctx.lineTo(-3.4 * s, -17.6 * s + bob); ctx.stroke();
    }

    // corpo (túnica com cor do jogador)
    const grad = ctx.createLinearGradient(0, -14.5 * s + bob, 0, -5 * s);
    grad.addColorStop(0, col.hex); grad.addColorStop(1, col.dark);
    ctx.fillStyle = grad;
    ctx.strokeStyle = 'rgba(18,10,5,0.55)'; ctx.lineWidth = 1 * s;
    ctx.beginPath();
    ctx.moveTo(-4.4 * s, -14 * s + bob); ctx.lineTo(4.4 * s, -14 * s + bob);
    ctx.lineTo(3.4 * s, -5 * s); ctx.lineTo(-3.4 * s, -5 * s);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3a2a18';
    ctx.fillRect(-3.6 * s, -8.4 * s, 7.2 * s, 1.5 * s);

    // escudos (frente do corpo, lado esquerdo)
    if (e.type === 'spearman') {
      ctx.fillStyle = col.dark;
      ctx.beginPath(); ctx.arc(-4.2 * s, -9.5 * s + bob, 3.4 * s, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#2c2018'; ctx.lineWidth = 1 * s; ctx.stroke();
      ctx.fillStyle = IRON;
      ctx.beginPath(); ctx.arc(-4.2 * s, -9.5 * s + bob, 1.1 * s, 0, Math.PI * 2); ctx.fill();
    } else if (e.type === 'swordsman') {
      ctx.fillStyle = col.hex;
      ctx.beginPath();
      ctx.moveTo(-6.6 * s, -13 * s + bob); ctx.lineTo(-2 * s, -13 * s + bob);
      ctx.lineTo(-2 * s, -9 * s + bob); ctx.lineTo(-4.3 * s, -5.6 * s + bob);
      ctx.lineTo(-6.6 * s, -9 * s + bob);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(18,10,5,0.55)'; ctx.lineWidth = 1 * s; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1 * s;
      ctx.beginPath(); ctx.moveTo(-4.3 * s, -12.2 * s + bob); ctx.lineTo(-4.3 * s, -7 * s + bob); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6 * s, -10.6 * s + bob); ctx.lineTo(-2.6 * s, -10.6 * s + bob); ctx.stroke();
    }

    // cabeça
    const hy = -17.6 * s + bob;
    ctx.fillStyle = SKIN;
    ctx.beginPath(); ctx.arc(0, hy, 3.5 * s, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(120,75,40,0.6)'; ctx.lineWidth = 0.8 * s; ctx.stroke();

    // elmo / chapéu
    switch (e.type) {
      case 'villager': {
        ctx.fillStyle = '#d2ab5e';
        ctx.beginPath(); ctx.ellipse(0, hy - 1.4 * s, 5.2 * s, 1.7 * s, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(0, hy - 1.4 * s, 2.9 * s, Math.PI, 0); ctx.fill();
        ctx.strokeStyle = 'rgba(90,65,25,0.6)'; ctx.lineWidth = 0.8 * s; ctx.stroke();
        break;
      }
      case 'spearman': {
        ctx.fillStyle = IRON;
        ctx.beginPath(); ctx.arc(0, hy - 0.4 * s, 3.6 * s, Math.PI, 0); ctx.fill();
        ctx.strokeStyle = IRON_D; ctx.lineWidth = 0.8 * s; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, hy - 3.8 * s); ctx.lineTo(0, hy + 1.6 * s); ctx.stroke();
        break;
      }
      case 'swordsman': {
        ctx.fillStyle = IRON;
        ctx.beginPath(); ctx.arc(0, hy, 3.8 * s, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = IRON_D; ctx.lineWidth = 0.9 * s; ctx.stroke();
        ctx.fillStyle = '#1c1712';
        ctx.fillRect(0.4 * s, hy - 1 * s, 3 * s, 1.2 * s);
        break;
      }
      case 'archer': {
        ctx.fillStyle = LEATHER;
        ctx.beginPath(); ctx.arc(0, hy, 3.9 * s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = SKIN;
        ctx.beginPath(); ctx.arc(1.1 * s, hy + 0.4 * s, 2.3 * s, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'crossbow': {
        ctx.fillStyle = IRON;
        ctx.beginPath(); ctx.ellipse(0, hy - 1.2 * s, 4.6 * s, 1.3 * s, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(0, hy - 1.2 * s, 2.6 * s, Math.PI, 0); ctx.fill();
        ctx.strokeStyle = IRON_D; ctx.lineWidth = 0.8 * s; ctx.stroke();
        break;
      }
    }

    // braço da frente + arma
    ctx.strokeStyle = SKIN; ctx.lineWidth = 1.8 * s;
    const hand = { x: 4.6 * s, y: -10 * s + bob };
    ctx.beginPath(); ctx.moveTo(2.8 * s, -12.5 * s + bob); ctx.lineTo(hand.x, hand.y); ctx.stroke();

    switch (e.type) {
      case 'villager': {
        const wAng = (working || attacking) ? Math.sin(now / 90) * 0.55 : 0;
        ctx.save(); ctx.translate(hand.x, hand.y); ctx.rotate(-0.65 + wAng);
        ctx.strokeStyle = '#8a6440'; ctx.lineWidth = 1.5 * s;
        ctx.beginPath(); ctx.moveTo(0, 2.5 * s); ctx.lineTo(0, -7.5 * s); ctx.stroke();
        ctx.fillStyle = IRON;
        ctx.beginPath();
        ctx.moveTo(-0.6 * s, -7.5 * s); ctx.lineTo(3.6 * s, -6.4 * s); ctx.lineTo(0.6 * s, -4.4 * s);
        ctx.closePath(); ctx.fill();
        ctx.restore();
        break;
      }
      case 'spearman': {
        const wAng = attacking ? Math.sin(now / 80) * 0.28 : 0;
        ctx.save(); ctx.translate(hand.x, hand.y); ctx.rotate(-0.32 + wAng);
        ctx.strokeStyle = '#8a6440'; ctx.lineWidth = 1.3 * s;
        ctx.beginPath(); ctx.moveTo(0, 6 * s); ctx.lineTo(0, -13 * s); ctx.stroke();
        ctx.fillStyle = IRON;
        ctx.beginPath();
        ctx.moveTo(0, -16.5 * s); ctx.lineTo(-1.3 * s, -12.8 * s); ctx.lineTo(1.3 * s, -12.8 * s);
        ctx.closePath(); ctx.fill();
        ctx.restore();
        break;
      }
      case 'swordsman': {
        const wAng = attacking ? -0.4 + Math.sin(now / 70) * 0.95 : -0.30;
        ctx.save(); ctx.translate(hand.x, hand.y); ctx.rotate(wAng);
        ctx.strokeStyle = '#e3e6ea'; ctx.lineWidth = 1.7 * s;
        ctx.beginPath(); ctx.moveTo(0, -1 * s); ctx.lineTo(0, -10.5 * s); ctx.stroke();
        ctx.strokeStyle = 'rgba(120,125,132,0.8)'; ctx.lineWidth = 0.6 * s;
        ctx.beginPath(); ctx.moveTo(0, -1.4 * s); ctx.lineTo(0, -10 * s); ctx.stroke();
        ctx.strokeStyle = '#8a6440'; ctx.lineWidth = 1.4 * s;
        ctx.beginPath(); ctx.moveTo(-1.8 * s, -1 * s); ctx.lineTo(1.8 * s, -1 * s); ctx.stroke();
        ctx.fillStyle = '#caa66a';
        ctx.beginPath(); ctx.arc(0, 0.6 * s, 0.9 * s, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      }
      case 'archer': {
        ctx.save(); ctx.translate(5.4 * s, -10.5 * s + bob);
        ctx.strokeStyle = '#7a4f2a'; ctx.lineWidth = 1.4 * s;
        ctx.beginPath(); ctx.arc(0, 0, 6 * s, -1.05, 1.05); ctx.stroke();
        const tipTop = { x: Math.cos(-1.05) * 6 * s, y: Math.sin(-1.05) * 6 * s };
        const tipBot = { x: Math.cos(1.05) * 6 * s, y: Math.sin(1.05) * 6 * s };
        ctx.strokeStyle = 'rgba(235,230,215,0.85)'; ctx.lineWidth = 0.7 * s;
        if (attacking) {
          const pull = 2.2 * s + Math.sin(now / 110) * 0.8 * s;
          ctx.beginPath(); ctx.moveTo(tipTop.x, tipTop.y); ctx.lineTo(-pull, 0); ctx.lineTo(tipBot.x, tipBot.y); ctx.stroke();
          ctx.strokeStyle = '#caa66a'; ctx.lineWidth = 0.9 * s;
          ctx.beginPath(); ctx.moveTo(-pull, 0); ctx.lineTo(7 * s, 0); ctx.stroke();
        } else {
          ctx.beginPath(); ctx.moveTo(tipTop.x, tipTop.y); ctx.lineTo(tipBot.x, tipBot.y); ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case 'crossbow': {
        ctx.save(); ctx.translate(hand.x, hand.y);
        ctx.strokeStyle = '#6e4f2e'; ctx.lineWidth = 2.2 * s;
        ctx.beginPath(); ctx.moveTo(-0.5 * s, 0); ctx.lineTo(7 * s, -1 * s); ctx.stroke();
        ctx.strokeStyle = '#4c3a22'; ctx.lineWidth = 1.6 * s;
        ctx.beginPath(); ctx.moveTo(6 * s, -5 * s); ctx.lineTo(6 * s, 3.2 * s); ctx.stroke();
        ctx.strokeStyle = 'rgba(235,230,215,0.85)'; ctx.lineWidth = 0.7 * s;
        ctx.beginPath(); ctx.moveTo(6 * s, -5 * s); ctx.lineTo(1.8 * s, -0.4 * s); ctx.lineTo(6 * s, 3.2 * s); ctx.stroke();
        ctx.restore();
        break;
      }
    }
  }

  drawHorseman(e, col, s, ph, moving, attacking, now) {
    const ctx = this.ctx;
    const knight = e.type === 'knight';
    const bodyC = knight ? '#45454e' : '#8a6a45';
    const darkC = knight ? '#2c2c33' : '#5e4128';
    const g = moving ? Math.sin(ph) * 3.4 * s : 0;
    ctx.lineCap = 'round';

    // patas
    ctx.strokeStyle = darkC; ctx.lineWidth = 2 * s;
    const legs = [[-7, 1], [-3.5, -1], [4, 1], [7.5, -1]];
    for (let i = 0; i < 4; i++) {
      const [lx, sgn] = legs[i];
      ctx.beginPath(); ctx.moveTo(lx * s, -7 * s); ctx.lineTo(lx * s + sgn * g, 0); ctx.stroke();
    }
    // cauda
    ctx.strokeStyle = darkC; ctx.lineWidth = 1.8 * s;
    ctx.beginPath(); ctx.moveTo(-10 * s, -11 * s); ctx.quadraticCurveTo(-13 * s, -8 * s, -12 * s, -4 * s); ctx.stroke();
    // corpo
    ctx.fillStyle = bodyC;
    ctx.beginPath(); ctx.ellipse(0, -9.5 * s, 10.5 * s, 4.8 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(15,10,6,0.5)'; ctx.lineWidth = 1 * s; ctx.stroke();
    // caparazão do cavaleiro (cor do jogador)
    if (knight) {
      ctx.fillStyle = col.hex;
      ctx.beginPath();
      ctx.moveTo(-8.5 * s, -12 * s); ctx.lineTo(6.5 * s, -12 * s);
      ctx.lineTo(7.5 * s, -6.5 * s); ctx.lineTo(-9.5 * s, -6.5 * s);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(15,10,6,0.5)'; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 0.8 * s;
      ctx.beginPath(); ctx.moveTo(-9 * s, -7.6 * s); ctx.lineTo(7 * s, -7.6 * s); ctx.stroke();
    }
    // pescoço + cabeça
    ctx.fillStyle = bodyC;
    ctx.beginPath();
    ctx.moveTo(7 * s, -12.5 * s);
    ctx.quadraticCurveTo(10.5 * s, -16 * s, 11.5 * s, -17.5 * s);
    ctx.lineTo(13.5 * s, -15.5 * s);
    ctx.quadraticCurveTo(11 * s, -12 * s, 9 * s, -9.5 * s);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(15,10,6,0.5)'; ctx.lineWidth = 0.9 * s; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(13.2 * s, -16.6 * s, 2.8 * s, 1.7 * s, 0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // orelha + crina
    ctx.strokeStyle = darkC; ctx.lineWidth = 1.4 * s;
    ctx.beginPath(); ctx.moveTo(11.6 * s, -18.4 * s); ctx.lineTo(12.2 * s, -20 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8 * s, -13.5 * s); ctx.quadraticCurveTo(10 * s, -15.5 * s, 11 * s, -17.5 * s); ctx.stroke();

    // cavaleiro
    const ry = -14 * s;
    ctx.fillStyle = '#4a3626';
    ctx.beginPath(); ctx.moveTo(2.5 * s, ry + 1 * s); ctx.lineTo(3.5 * s, ry + 5 * s); ctx.stroke();
    const grad = ctx.createLinearGradient(0, ry - 6 * s, 0, ry);
    grad.addColorStop(0, col.hex); grad.addColorStop(1, col.dark);
    ctx.fillStyle = grad;
    ctx.strokeStyle = 'rgba(18,10,5,0.55)'; ctx.lineWidth = 0.9 * s;
    ctx.beginPath();
    ctx.moveTo(-3.4 * s, ry - 6 * s); ctx.lineTo(3.4 * s, ry - 6 * s);
    ctx.lineTo(2.6 * s, ry + 1 * s); ctx.lineTo(-2.6 * s, ry + 1 * s);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // cabeça do cavaleiro
    const hy = ry - 8.6 * s;
    if (knight) {
      ctx.fillStyle = IRON;
      ctx.beginPath(); ctx.arc(0, hy, 2.9 * s, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = IRON_D; ctx.lineWidth = 0.8 * s; ctx.stroke();
      ctx.fillStyle = '#1c1712'; ctx.fillRect(0.3 * s, hy - 0.8 * s, 2.4 * s, 1 * s);
      ctx.strokeStyle = col.hex; ctx.lineWidth = 1.3 * s;
      ctx.beginPath(); ctx.moveTo(-0.5 * s, hy - 2.8 * s); ctx.quadraticCurveTo(-3 * s, hy - 4.5 * s, -4.5 * s, hy - 3 * s); ctx.stroke();
    } else {
      ctx.fillStyle = SKIN;
      ctx.beginPath(); ctx.arc(0, hy, 2.7 * s, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(120,75,40,0.6)'; ctx.lineWidth = 0.7 * s; ctx.stroke();
      ctx.fillStyle = LEATHER;
      ctx.beginPath(); ctx.arc(0, hy - 0.6 * s, 2.8 * s, Math.PI, 0); ctx.fill();
    }
    // arma
    if (knight) {
      const wAng = attacking ? Math.sin(now / 85) * 0.22 : 0;
      ctx.save(); ctx.translate(3 * s, ry - 3 * s); ctx.rotate(-0.42 + wAng);
      ctx.strokeStyle = '#8a6440'; ctx.lineWidth = 1.4 * s;
      ctx.beginPath(); ctx.moveTo(0, 4 * s); ctx.lineTo(0, -14 * s); ctx.stroke();
      ctx.fillStyle = IRON;
      ctx.beginPath(); ctx.moveTo(0, -16.5 * s); ctx.lineTo(-1.1 * s, -13.6 * s); ctx.lineTo(1.1 * s, -13.6 * s); ctx.closePath(); ctx.fill();
      ctx.fillStyle = col.hex;
      ctx.beginPath(); ctx.moveTo(0, -13 * s); ctx.lineTo(3.4 * s, -11.8 * s); ctx.lineTo(0, -10.6 * s); ctx.closePath(); ctx.fill();
      ctx.restore();
    } else {
      const wAng = attacking ? -0.3 + Math.sin(now / 75) * 0.8 : -0.2;
      ctx.save(); ctx.translate(3.4 * s, ry - 2 * s); ctx.rotate(wAng);
      ctx.strokeStyle = '#e3e6ea'; ctx.lineWidth = 1.4 * s;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(2.5 * s, -7 * s); ctx.stroke();
      ctx.strokeStyle = '#8a6440'; ctx.lineWidth = 1.2 * s;
      ctx.beginPath(); ctx.moveTo(-1.2 * s, -0.4 * s); ctx.lineTo(1.6 * s, 0.6 * s); ctx.stroke();
      ctx.restore();
    }
  }

  // ---------------- barras de vida ----------------
  drawHealthBar(e, cx, y, w) {
    const def = defOf(e.type);
    if (!def) return;
    const ratio = clamp(e.hp / def.hp, 0, 1);
    const sel = this.selection.has(e.id);
    if (ratio >= 0.999 && !sel) return;
    const { ctx } = this;
    const h = 3.5, x = cx - w / 2;
    ctx.fillStyle = 'rgba(8,6,3,0.78)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    const color = ratio > 0.5 ? '#57c24f' : ratio > 0.25 ? '#e0b020' : '#d0463a';
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * ratio, h);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(x, y, w * ratio, 1);
  }

  // ---------------- projéteis (flechas) ----------------
  drawProjectiles(now) {
    const { ctx } = this;
    for (const p of this.model.projectiles()) {
      if (!this.isTileNearVisible(Math.floor(p.x / TILE), Math.floor(p.y / TILE))) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle || 0);
      ctx.strokeStyle = '#caa66a'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(5, 0); ctx.stroke();
      ctx.fillStyle = IRON;
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(4.5, -1.8); ctx.lineTo(4.5, 1.8); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#e8e2d0'; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-8, -2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-8, 2); ctx.stroke();
      ctx.restore();
    }
  }

  // ---------------- colocação de edifício ----------------
  drawPlacement() {
    if (!this.placement) return;
    const { ctx } = this;
    const def = BUILDINGS[this.placement.type];
    const size = def.size * TILE;
    const px = this.placement.tx * TILE, py = this.placement.ty * TILE;
    const spr = this.sprites.building(this.placement.type, this.model.localPlayerId);
    ctx.globalAlpha = 0.6;
    ctx.drawImage(spr.canvas, px, py - spr.ov, spr.canvas.width / SS, spr.canvas.height / SS);
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = this.placement.valid ? '#4caf50' : '#c0392b';
    ctx.fillRect(px, py, size, size);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = this.placement.valid ? '#7dff88' : '#ff6b5f'; ctx.lineWidth = 2;
    ctx.strokeRect(px, py, size, size);
  }

  // ---------------- névoa suave ----------------
  drawFog() {
    const { ctx, model } = this;
    const W = model.W, H = model.H;
    const d = this.fogData.data;
    for (let i = 0; i < W * H; i++) {
      d[i * 4] = 6; d[i * 4 + 1] = 8; d[i * 4 + 2] = 4;
      d[i * 4 + 3] = this.visible[i] ? 0 : this.explored[i] ? 118 : 236;
    }
    this.fogCtx.putImageData(this.fogData, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.fogCanvas, 0, 0, W, H, 0, 0, W * TILE, H * TILE);
  }

  drawDragBox() {
    if (!this.dragBox) return;
    const { ctx } = this;
    const { x0, y0, x1, y1 } = this.dragBox;
    ctx.strokeStyle = '#7dff88'; ctx.lineWidth = 1.5;
    ctx.fillStyle = 'rgba(125,255,136,0.12)';
    const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
    ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
  }
}
