/* ============================================================
 * Micropolis 2000 — map.js
 * World state container + procedural terrain generation.
 * ============================================================ */
'use strict';

const W = 100, H = 100, NT = W * H;

function newState(seed, cityName) {
  const S = {
    v: 3,
    seed: seed >>> 0,
    cityName: cityName || 'New City',
    W, H,
    terr: new Uint8Array(NT),   // terrain
    type: new Uint8Array(NT),   // building/zone code (every covered tile)
    anch: new Int32Array(NT),   // anchor index for multi-tile buildings (-1 none)
    lvl:  new Uint8Array(NT),   // zone development level 0..8 (at anchor)
    pwr:  new Uint8Array(NT),   // powered flag
    wtr:  new Uint8Array(NT),   // water coverage
    fire: new Uint8Array(NT),   // burning intensity (0 = not burning)
    roadOk: new Uint8Array(NT), // road within reach
    wireOn: new Uint8Array(NT), // power line crossing a road/rail tile
    traffic: new Uint8Array(NT),
    poll: new Uint8Array(NT),
    crime: new Uint8Array(NT),
    lval: new Uint8Array(NT),   // land value
    pcov: new Uint8Array(NT), fcov: new Uint8Array(NT),
    hcov: new Uint8Array(NT), ecov: new Uint8Array(NT),

    funds: SIM.START_FUNDS,
    year: SIM.START_YEAR, month: 0, step: 0, tickCount: 0,
    tax: { r: SIM.TAX_DEFAULT, c: SIM.TAX_DEFAULT, i: SIM.TAX_DEFAULT },
    fund: { police: 100, fire: 100, roads: 100, health: 100, edu: 100 },
    bonds: 0,
    demand: { r: 40, c: 10, i: 40 },
    pop: 0, jobs: 0,
    powerOk: true, waterPct: 0,
    disasters: [],              // active disaster entities
    autoDisasters: true,
    history: [],                // {y,m,pop,funds,r,c,i}
    lastCash: { tax: 0, maint: 0, bond: 0 },
    rngState: (seed ^ 0x9E3779B9) >>> 0,
  };
  S.anch.fill(-1);
  return S;
}

// value noise, bilinear-interpolated coarse lattice
function makeNoise(seed, cells) {
  const g = [];
  for (let y = 0; y <= cells; y++) {
    g.push([]);
    for (let x = 0; x <= cells; x++) g[y].push(hash2(x, y, seed));
  }
  return (fx, fy) => { // fx, fy in 0..1
    const gx = fx * cells, gy = fy * cells;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const tx = gx - x0, ty = gy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = lerp(g[y0][x0], g[y0][x0 + 1], sx);
    const b = lerp(g[y0 + 1][x0], g[y0 + 1][x0 + 1], sx);
    return lerp(a, b, sy);
  };
}

function generateTerrain(S) {
  const n1 = makeNoise(S.seed, 8), n2 = makeNoise(S.seed + 77, 20);
  const rng = RNG(S.seed + 5);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const e = n1(x / W, y / H) * 0.7 + n2(x / W, y / H) * 0.3;
      if (e < 0.30) S.terr[i] = T_WATER;
      else if (e < 0.335) S.terr[i] = T_SAND;
      else if (e > 0.64 && rng.chance(0.7)) S.terr[i] = T_TREE;
      else S.terr[i] = T_GRASS;
    }
  }
  // carve a river with a sine wander so pumps/seaports always have water
  let rx = rng.int(W);
  const amp = 8 + rng.int(10), ph = rng() * 6.28;
  for (let y = 0; y < H; y++) {
    const cx = clamp(Math.round(rx + Math.sin(y / 14 + ph) * amp), 2, W - 3);
    for (let dx = -2; dx <= 2; dx++) {
      const i = y * W + clamp(cx + dx, 0, W - 1);
      S.terr[i] = Math.abs(dx) === 2 ? (S.terr[i] === T_WATER ? T_WATER : T_SAND) : T_WATER;
    }
  }
  // scattered tree clumps
  for (let k = 0; k < 40; k++) {
    const cx = rng.int(W), cy = rng.int(H), r = 2 + rng.int(4);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      if (S.terr[i] === T_GRASS && rng.chance(0.6)) S.terr[i] = T_TREE;
    }
  }
}

const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const idx = (x, y) => y * W + x;

function nearWater(S, x, y, size, dist) {
  for (let dy = -dist; dy < size + dist; dy++) {
    for (let dx = -dist; dx < size + dist; dx++) {
      const px = x + dx, py = y + dy;
      if (inBounds(px, py) && S.terr[idx(px, py)] === T_WATER) return true;
    }
  }
  return false;
}
