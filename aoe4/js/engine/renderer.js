import { TILE, UNITS, BUILDINGS, RESOURCE_NODES, PLAYER_COLORS, defOf } from '../game/config.js';
import { TERRAIN } from '../game/world.js';
import { clamp } from './utils.js';

const TERRAIN_COLORS = {
  [TERRAIN.GRASS]: '#3f6b34', [TERRAIN.DIRT]: '#6b5836',
  [TERRAIN.WATER]: '#2b4d78', [TERRAIN.SAND]: '#b6a06a',
};

export class Renderer {
  constructor(canvas, model, camera) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.model = model; this.camera = camera;
    // memória de névoa (explorado) por tile
    this.explored = new Uint8Array(model.W * model.H);
    this.visible = new Uint8Array(model.W * model.H);
    // memória de edifícios já vistos (fog): id -> {type,owner,x,y,bx,by,size}
    this.knownBuildings = new Map();
    // cache do terreno em canvas offscreen
    this.terrainCanvas = this.bakeTerrain();
    this.selection = new Set();
    this.placement = null; // {type, tx, ty, valid}
    this.dragBox = null;
  }

  bakeTerrain() {
    const { W, H, terrain } = this.model;
    const c = document.createElement('canvas');
    c.width = W * TILE; c.height = H * TILE;
    const g = c.getContext('2d');
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = terrain[y * W + x];
      g.fillStyle = TERRAIN_COLORS[t];
      g.fillRect(x * TILE, y * TILE, TILE, TILE);
      // leve textura/variação
      if ((x * 7 + y * 13) % 5 === 0 && t !== TERRAIN.WATER) {
        g.fillStyle = 'rgba(0,0,0,0.06)';
        g.fillRect(x * TILE + 4, y * TILE + 6, TILE - 8, TILE - 12);
      }
    }
    // grade sutil
    g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 1;
    for (let x = 0; x <= W; x++) { g.beginPath(); g.moveTo(x*TILE,0); g.lineTo(x*TILE,H*TILE); g.stroke(); }
    for (let y = 0; y <= H; y++) { g.beginPath(); g.moveTo(0,y*TILE); g.lineTo(W*TILE,y*TILE); g.stroke(); }
    return c;
  }

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
      if (e.building) this.knownBuildings.set(e.id, {
        id: e.id, type: e.type, owner: e.owner, x: e.x, y: e.y, bx: e.bx, by: e.by,
        size: def.size, constructed: e.constructed, hp: e.hp,
      });
    }
  }

  isVisibleTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.model.W || ty >= this.model.H) return false;
    return this.visible[ty * this.model.W + tx] === 1;
  }

  render(now) {
    const { ctx, canvas, camera } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.computeFog(now);

    ctx.save();
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    // terreno (só região visível na tela)
    const vw = camera.vw / camera.zoom, vh = camera.vh / camera.zoom;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrainCanvas, camera.x, camera.y, vw, vh, camera.x, camera.y, vw, vh);
    ctx.imageSmoothingEnabled = true;

    this.drawNodes(now);
    this.drawKnownBuildingsInFog();
    this.drawEntities(now);
    this.drawProjectiles(now);
    this.drawPlacement();
    this.drawFogOverlay();

    ctx.restore();
    this.drawDragBox();
  }

  drawNodes(now) {
    const { ctx } = this;
    for (const n of this.model.nodes()) {
      if (!this.isTileNearVisible(n.x, n.y)) {
        if (!this.explored[n.y * this.model.W + n.x]) continue;
      }
      const def = RESOURCE_NODES[n.type];
      const cx = (n.x + 0.5) * TILE, cy = (n.y + 0.5) * TILE;
      ctx.fillStyle = def.color;
      if (n.type === 'tree') {
        ctx.fillStyle = '#3a2a15'; ctx.fillRect(cx - 2, cy, 4, TILE * 0.35);
        ctx.fillStyle = def.color;
        ctx.beginPath(); ctx.arc(cx, cy - 2, TILE * 0.42, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath(); ctx.arc(cx - 3, cy - 5, TILE * 0.2, 0, Math.PI * 2); ctx.fill();
      } else if (n.type === 'sheep') {
        ctx.font = `${TILE * 0.8}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🐑', cx, cy);
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, TILE * 0.4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
        // "pepitas"
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath(); ctx.arc(cx - 4, cy - 3, 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  isTileNearVisible(tx, ty) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if (this.isVisibleTile(tx + dx, ty + dy)) return true;
    return false;
  }

  drawKnownBuildingsInFog() {
    const { ctx } = this;
    for (const b of this.knownBuildings.values()) {
      const tx = Math.floor(b.x / TILE), ty = Math.floor(b.y / TILE);
      if (this.isVisibleTile(tx, ty)) continue; // será desenhado normalmente
      // se ainda existe na visão atual do modelo, pula
      ctx.globalAlpha = 0.55;
      this.drawBuildingShape(b, true);
      ctx.globalAlpha = 1;
    }
  }

  drawEntities(now) {
    const list = [];
    for (const e of this.model.entities(now)) list.push(e);
    // ordena por Y para leve sensação de profundidade
    list.sort((a, b) => a.y - b.y);
    const localVisible = (e) => {
      if (e.owner === this.model.localPlayerId) return true;
      return this.isTileNearVisible(Math.floor(e.x / TILE), Math.floor(e.y / TILE));
    };
    for (const e of list) {
      if (!localVisible(e)) continue;
      if (e.building) this.drawBuildingShape(e, false);
      else this.drawUnit(e);
    }
  }

  drawBuildingShape(e, ghost) {
    const { ctx } = this;
    const def = BUILDINGS[e.type];
    const size = def.size * TILE;
    const px = e.bx * TILE, py = e.by * TILE;
    const col = PLAYER_COLORS[e.owner % PLAYER_COLORS.length];
    const built = e.constructed;
    // sombra
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(px + 3, py + size - 6, size - 6, 8);
    // corpo
    ctx.fillStyle = built ? col.dark : 'rgba(90,80,60,0.7)';
    ctx.fillRect(px + 3, py + 3, size - 6, size - 6);
    ctx.fillStyle = built ? col.hex : 'rgba(140,125,95,0.7)';
    ctx.fillRect(px + 5, py + 5, size - 10, size - 12);
    // ícone
    ctx.font = `${size * 0.5}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha *= built ? 1 : 0.6;
    ctx.fillText(def.icon, px + size / 2, py + size / 2);
    ctx.globalAlpha = ghost ? 0.55 : 1;
    // borda de dono
    ctx.strokeStyle = col.hex; ctx.lineWidth = 2;
    ctx.strokeRect(px + 3, py + 3, size - 6, size - 6);

    if (!ghost) {
      if (!built) {
        // barra de progresso de construção
        const w = size - 10, prog = e.buildProgress;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(px + 5, py - 8, w, 5);
        ctx.fillStyle = '#e6c469'; ctx.fillRect(px + 5, py - 8, w * prog, 5);
      }
      this.drawHealthBar(e, px + size / 2, py - 3, size - 8);
      if (this.selection.has(e.id)) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, py + 1, size - 2, size - 2);
      }
      // fila de treino
      if (built && e.queue && e.queue.length) {
        const item = e.queue[0];
        const p = item.elapsed / item.total;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(px + 5, py + size, size - 10, 4);
        ctx.fillStyle = '#5adb6a'; ctx.fillRect(px + 5, py + size, (size - 10) * p, 4);
      }
    }
  }

  drawUnit(e) {
    const { ctx } = this;
    const def = UNITS[e.type];
    const r = TILE * 0.32;
    const col = PLAYER_COLORS[e.owner % PLAYER_COLORS.length];
    // sombra
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(e.x, e.y + r * 0.7, r, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    // círculo do dono
    ctx.fillStyle = col.hex;
    ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = col.dark; ctx.lineWidth = 2; ctx.stroke();
    // ícone
    ctx.font = `${r * 1.5}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(def.icon, e.x, e.y);
    // indicador de carga (aldeão)
    if (e.type === 'villager' && e.state === 'return') {
      ctx.fillStyle = '#e6c469';
      ctx.beginPath(); ctx.arc(e.x + r, e.y - r, 3, 0, Math.PI * 2); ctx.fill();
    }
    this.drawHealthBar(e, e.x, e.y - r - 6, TILE * 0.7);
    if (this.selection.has(e.id)) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(e.x, e.y, r + 3, 0, Math.PI * 2); ctx.stroke();
    }
  }

  drawHealthBar(e, cx, topY, width) {
    const def = defOf(e.type);
    const maxHp = def.hp;
    const ratio = clamp(e.hp / maxHp, 0, 1);
    if (ratio >= 1 && !this.selection.has(e.id) && !e.building) return; // esconde barra cheia de unidade
    const w = width, h = 4, x = cx - w / 2, y = topY;
    this.ctx.fillStyle = 'rgba(0,0,0,0.65)';
    this.ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    this.ctx.fillStyle = ratio > 0.5 ? '#4caf50' : ratio > 0.25 ? '#e0b020' : '#c0392b';
    this.ctx.fillRect(x, y, w * ratio, h);
  }

  drawProjectiles(now) {
    const { ctx } = this;
    ctx.fillStyle = '#f0e0b0';
    for (const p of this.model.projectiles()) {
      if (!this.isTileNearVisible(Math.floor(p.x / TILE), Math.floor(p.y / TILE))) continue;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawPlacement() {
    if (!this.placement) return;
    const { ctx } = this;
    const def = BUILDINGS[this.placement.type];
    const size = def.size * TILE;
    const px = this.placement.tx * TILE, py = this.placement.ty * TILE;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = this.placement.valid ? '#4caf50' : '#c0392b';
    ctx.fillRect(px, py, size, size);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = this.placement.valid ? '#7dff88' : '#ff6b5f'; ctx.lineWidth = 2;
    ctx.strokeRect(px, py, size, size);
    ctx.font = `${size * 0.5}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(def.icon, px + size / 2, py + size / 2);
    ctx.globalAlpha = 1;
  }

  drawFogOverlay() {
    const { ctx, model } = this;
    const W = model.W, H = model.H;
    // desenha névoa como retângulos escuros; explorado = semi, não visto = opaco
    // otimização: apenas na área da câmera
    const cam = this.camera;
    const x0 = Math.max(0, Math.floor(cam.x / TILE) - 1);
    const y0 = Math.max(0, Math.floor(cam.y / TILE) - 1);
    const x1 = Math.min(W, Math.ceil((cam.x + cam.vw / cam.zoom) / TILE) + 1);
    const y1 = Math.min(H, Math.ceil((cam.y + cam.vh / cam.zoom) / TILE) + 1);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * W + x;
      if (this.visible[i]) continue;
      ctx.fillStyle = this.explored[i] ? 'rgba(0,0,0,0.42)' : 'rgba(0,0,0,0.82)';
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
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
