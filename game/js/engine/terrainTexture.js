// Gera a textura do terreno (canvas) usada pelo renderizador 2D e como
// mapa difuso do chão no renderizador 3D.
import { TILE } from '../game/config.js';
import { TERRAIN } from '../game/world.js';
import { makeRNG } from './utils.js';

export function bakeTerrainCanvas(model) {
  const { W, H, terrain } = model;
  const c = document.createElement('canvas');
  c.width = W * TILE; c.height = H * TILE;
  const g = c.getContext('2d');
  const rng = makeRNG(1337);
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
