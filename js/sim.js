/* ============================================================
 * Micropolis 2000 — sim.js
 * The city simulation: power grid, water, services coverage,
 * pollution / crime / land value, zone growth, RCI demand,
 * budget, fire spread and disasters.
 * Runs on the host only; guests receive state snapshots.
 * ============================================================ */
'use strict';

let powerDirty = true;
function markPowerDirty() { powerDirty = true; }

const NEWS = []; // {msg, cls} consumed by UI ticker
function news(msg, cls) {
  NEWS.push({ msg, cls: cls || '' });
  if (NEWS.length > 60) NEWS.shift();
}

// ---------------- power network ----------------
function isConductor(S, i) {
  if (S.wireOn[i]) return true; // wire crossing a road
  const t = S.type[i];
  return t !== B_NONE && t !== B_ROAD && t !== B_RAIL;
}

function recomputePower(S) {
  S.pwr.fill(0);
  const seen = new Uint8Array(NT);
  const stack = [];
  let shortage = false;
  for (let i = 0; i < NT; i++) {
    if (seen[i] || !isConductor(S, i)) continue;
    // flood one component
    const comp = [];
    let cap = 0, need = 0;
    stack.length = 0; stack.push(i); seen[i] = 1;
    while (stack.length) {
      const j = stack.pop();
      comp.push(j);
      const t = S.type[j];
      const b = BLD[t];
      if (b && S.anch[j] === j) { // count anchors once
        if (b.plant) cap += b.plant;
        else if (b.zone) need += SIM.ZONE_POWER(S.lvl[j]);
        else if (b.power) need += b.power;
      } else if (b && b.zone) {
        need += SIM.ZONE_POWER(S.lvl[j]); // zones are 1x1, anchor==self, kept for clarity
      }
      const x = j % W, y = (j / W) | 0;
      if (x > 0 && !seen[j - 1] && isConductor(S, j - 1)) { seen[j - 1] = 1; stack.push(j - 1); }
      if (x < W - 1 && !seen[j + 1] && isConductor(S, j + 1)) { seen[j + 1] = 1; stack.push(j + 1); }
      if (y > 0 && !seen[j - W] && isConductor(S, j - W)) { seen[j - W] = 1; stack.push(j - W); }
      if (y < H - 1 && !seen[j + W] && isConductor(S, j + W)) { seen[j + W] = 1; stack.push(j + W); }
    }
    const ok = cap > 0 && cap >= need;
    if (cap > 0 && cap < need) shortage = true;
    if (ok) for (const j of comp) S.pwr[j] = 1;
  }
  if (shortage && !S._shortageFlag) news('⚡ Power shortage! Build more power plants.', 'bad');
  S._shortageFlag = shortage;
  powerDirty = false;
}

// ---------------- road reach (dilation) ----------------
function recomputeRoads(S) {
  const cur = S.roadOk;
  cur.fill(0);
  for (let i = 0; i < NT; i++) if (S.type[i] === B_ROAD || S.type[i] === B_RAIL) cur[i] = 1;
  // Chebyshev dilation ROAD_REACH steps
  const tmp = new Uint8Array(NT);
  for (let s = 0; s < SIM.ROAD_REACH; s++) {
    tmp.set(cur);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (tmp[i]) continue;
        if ((x > 0 && tmp[i - 1]) || (x < W - 1 && tmp[i + 1]) ||
            (y > 0 && tmp[i - W]) || (y < H - 1 && tmp[i + W]) ||
            (x > 0 && y > 0 && tmp[i - W - 1]) || (x < W - 1 && y > 0 && tmp[i - W + 1]) ||
            (x > 0 && y < H - 1 && tmp[i + W - 1]) || (x < W - 1 && y < H - 1 && tmp[i + W + 1]))
          cur[i] = 1;
      }
    }
  }
}

// ---------------- coverage stamping ----------------
function stampRadial(map, cx, cy, radius, amount) {
  const r2 = radius * radius;
  const x0 = Math.max(0, cx - radius), x1 = Math.min(W - 1, cx + radius);
  const y0 = Math.max(0, cy - radius), y1 = Math.min(H - 1, cy + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d2 > r2) continue;
      const i = y * W + x;
      const v = map[i] + amount * (1 - Math.sqrt(d2 / r2));
      map[i] = v > 255 ? 255 : v;
    }
  }
}

function recomputeCoverage(S) {
  S.pcov.fill(0); S.fcov.fill(0); S.hcov.fill(0); S.ecov.fill(0); S.wtr.fill(0);
  for (let i = 0; i < NT; i++) {
    if (S.anch[i] !== i) continue;
    const t = S.type[i], b = BLD[t];
    if (!b) continue;
    const x = i % W, y = (i / W) | 0;
    const powered = S.pwr[i] === 1;
    if (b.cov && powered) {
      let f = 100;
      if (b.cov.map === 'pcov') f = S.fund.police;
      else if (b.cov.map === 'fcov') f = S.fund.fire;
      else if (b.cov.map === 'hcov') f = S.fund.health;
      else if (b.cov.map === 'ecov') f = S.fund.edu;
      stampRadial(S[b.cov.map], x + (b.size >> 1), y + (b.size >> 1), Math.round(b.cov.radius * (0.4 + 0.6 * f / 100)), 200 * (0.3 + 0.7 * f / 100));
    }
    if (b.watCov && powered) {
      stampRadial(S.wtr, x + (b.size >> 1), y + (b.size >> 1), b.watCov, 255);
    }
  }
}

// ---------------- diffusion helper ----------------
function boxBlur(src, dst) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let sum = src[i] * 2, n = 2;
      if (x > 0) { sum += src[i - 1]; n++; }
      if (x < W - 1) { sum += src[i + 1]; n++; }
      if (y > 0) { sum += src[i - W]; n++; }
      if (y < H - 1) { sum += src[i + W]; n++; }
      dst[i] = (sum / n) | 0;
    }
  }
}

const _tmpMap = new Uint8Array(NT);

function recomputePollution(S) {
  const p = _tmpMap; p.fill(0);
  for (let i = 0; i < NT; i++) {
    const t = S.type[i];
    if (t === B_NONE) continue;
    const b = BLD[t];
    let add = 0;
    if (t === B_IND) add = 14 + S.lvl[i] * 8;
    else if (b && b.poll && S.anch[i] === i) add = b.poll;
    if (S.fire[i]) add += 60;
    add += S.traffic[i] >> 2;
    if (add) { const v = p[i] + add; p[i] = v > 255 ? 255 : v; }
  }
  boxBlur(p, S.poll); boxBlur(S.poll, p); boxBlur(p, S.poll);
}

function recomputeTraffic(S) {
  // each developed zone pushes trips onto nearby road tiles
  const tr = _tmpMap; tr.fill(0);
  for (let i = 0; i < NT; i++) {
    const t = S.type[i];
    if ((t !== B_RES && t !== B_COM && t !== B_IND) || S.lvl[i] === 0) continue;
    const x = i % W, y = (i / W) | 0;
    const load = S.lvl[i] * 3;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const px = x + dx, py = y + dy;
        if (!inBounds(px, py)) continue;
        const j = py * W + px;
        if (S.type[j] === B_ROAD) {
          const v = tr[j] + load;
          tr[j] = v > 255 ? 255 : v;
        }
      }
    }
  }
  // decay + copy
  for (let i = 0; i < NT; i++) S.traffic[i] = (S.traffic[i] * 0.5 + tr[i] * 0.5) | 0;
}

function recomputeCrimeAndValue(S) {
  for (let i = 0; i < NT; i++) {
    const t = S.type[i];
    // crime rises with density, falls with police coverage and land value
    let c = 0;
    if (t === B_RES || t === B_COM || t === B_IND) c = 10 + S.lvl[i] * 12;
    c -= S.pcov[i] >> 1;
    c -= S.ecov[i] >> 3;
    S.crime[i] = clamp(c, 0, 255);
  }
  // land value: parks, water, services boost; pollution & crime hurt
  const lv = _tmpMap;
  for (let i = 0; i < NT; i++) {
    const x = i % W, y = (i / W) | 0;
    let v = 40;
    const t = S.type[i];
    if (BLD[t] && BLD[t].lval) v += BLD[t].lval * 3;
    // water & tree adjacency
    if (x > 0 && S.terr[i - 1] === T_WATER) v += 25;
    if (x < W - 1 && S.terr[i + 1] === T_WATER) v += 25;
    if (y > 0 && S.terr[i - W] === T_WATER) v += 25;
    if (y < H - 1 && S.terr[i + W] === T_WATER) v += 25;
    if (S.terr[i] === T_TREE) v += 15;
    v += (S.ecov[i] >> 3) + (S.hcov[i] >> 3);
    v -= S.poll[i] >> 1;
    v -= S.crime[i] >> 2;
    lv[i] = clamp(v, 0, 255);
  }
  boxBlur(lv, S.lval); boxBlur(S.lval, S.lval === lv ? _tmpMap : lv); // two passes
  boxBlur(lv, S.lval);
}

// ---------------- population / demand ----------------
function tallyCity(S) {
  let pop = 0, cJobs = 0, iJobs = 0;
  let hasAirport = false, hasSeaport = false, hasStadium = false;
  for (let i = 0; i < NT; i++) {
    const t = S.type[i];
    if (t === B_RES) pop += S.lvl[i] * SIM.POP_PER_LVL[B_RES];
    else if (t === B_COM) cJobs += S.lvl[i] * SIM.POP_PER_LVL[B_COM];
    else if (t === B_IND) iJobs += S.lvl[i] * SIM.POP_PER_LVL[B_IND];
    else if (S.anch[i] === i && S.pwr[i]) {
      if (t === B_AIRPORT) hasAirport = true;
      else if (t === B_SEAPORT) hasSeaport = true;
      else if (t === B_STADIUM) hasStadium = true;
    }
  }
  S.pop = pop; S.jobs = cJobs + iJobs;
  const workers = pop * 0.6;
  const ext = 1 + (S.year - SIM.START_YEAR) * 0.01; // external market grows
  let r = (S.jobs * 1.25 - workers) * 0.6 + (pop < 800 ? 60 : 0) + (hasStadium ? 15 : 0);
  let c = (workers * 0.35 - cJobs) * 1.1 + (hasAirport ? 40 : 0);
  let ind = (workers * 0.65 * ext - iJobs) * 0.9 + (hasSeaport ? 40 : 0) + (pop < 500 ? 40 : 0);
  // taxes dampen demand
  r -= (S.tax.r - 7) * 8;
  c -= (S.tax.c - 7) * 8;
  ind -= (S.tax.i - 7) * 8;
  S.demand.r = clamp(Math.round(r), -100, 100);
  S.demand.c = clamp(Math.round(c), -100, 100);
  S.demand.i = clamp(Math.round(ind), -100, 100);
}

// ---------------- zone growth ----------------
function growZones(S, rng) {
  // process a random slice of tiles each call for organic growth
  const tries = 900;
  for (let k = 0; k < tries; k++) {
    const i = rng.int(NT);
    const t = S.type[i];
    if (t !== B_RES && t !== B_COM && t !== B_IND) continue;
    const powered = S.pwr[i] === 1;
    const road = S.roadOk[i] === 1;
    const lvl = S.lvl[i];
    if (!powered || !road) {
      if (lvl > 0 && rng.chance(0.35)) S.lvl[i] = lvl - 1;
      continue;
    }
    const demand = t === B_RES ? S.demand.r : (t === B_COM ? S.demand.c : S.demand.i);
    let score = demand;
    score += (S.lval[i] - 80) * 0.35;
    if (t === B_RES) { score -= S.poll[i] * 0.4; score -= S.crime[i] * 0.25; }
    if (t === B_COM) { score -= S.crime[i] * 0.3; score += S.traffic[i] * 0.05; }
    if (t === B_IND) { score += 10; }
    // water coverage gates high density
    const maxLvl = S.wtr[i] ? SIM.MAX_LVL : 3;
    if (score > 15 && lvl < maxLvl && rng.chance(0.30)) S.lvl[i] = lvl + 1;
    else if (score < -35 && lvl > 0 && rng.chance(0.22)) S.lvl[i] = lvl - 1;
  }
}

// ---------------- fire ----------------
function stepFire(S, rng) {
  let burning = false;
  for (let i = 0; i < NT; i++) {
    if (!S.fire[i]) continue;
    burning = true;
    const x = i % W, y = (i / W) | 0;
    // firefighting: coverage extinguishes
    const putOut = S.fcov[i] / 255 * 0.55 + 0.06;
    if (rng.chance(putOut)) { S.fire[i] = 0; continue; }
    S.fire[i]++;
    if (S.fire[i] > 6) { // burned down
      S.fire[i] = 0;
      if (S.type[i] !== B_NONE) doBurnDown(S, i);
      else if (S.terr[i] === T_TREE) S.terr[i] = T_RUBBLE;
    }
    // spread
    for (const d of [-1, 1, -W, W]) {
      const j = i + d;
      if (j < 0 || j >= NT) continue;
      if (Math.abs(d) === 1 && ((d === -1 && x === 0) || (d === 1 && x === W - 1))) continue;
      if (S.fire[j]) continue;
      const b = BLD[S.type[j]];
      const flam = b ? (b.flam || 0) : (S.terr[j] === T_TREE ? 0.8 : 0);
      if (flam && rng.chance(flam * 0.3 * (1 - S.fcov[j] / 300))) S.fire[j] = 1;
    }
  }
  return burning;
}

function doBurnDown(S, i) {
  const a = S.anch[i];
  if (a < 0) return;
  const t = S.type[a];
  const sz = BLD[t] ? BLD[t].size : 1;
  const ax = a % W, ay = (a / W) | 0;
  for (let dy = 0; dy < sz; dy++) for (let dx = 0; dx < sz; dx++) {
    const j = idx(ax + dx, ay + dy);
    if (S.anch[j] === a) {
      S.type[j] = B_NONE; S.anch[j] = -1; S.lvl[j] = 0;
      S.terr[j] = T_RUBBLE;
    }
  }
  markPowerDirty();
}

// ---------------- disasters ----------------
function startDisaster(S, kind) {
  const rng = RNG(S.rngState ^ 0xABCD);
  const spot = findBuiltSpot(S, rng) || { x: rng.int(W), y: rng.int(H) };
  switch (kind) {
    case DIS_FIRE: {
      const i = idx(spot.x, spot.y);
      if (S.type[i] !== B_NONE || S.terr[i] === T_TREE) S.fire[i] = 1;
      news('🔥 Fire has broken out in ' + S.cityName + '!', 'bad');
      break;
    }
    case DIS_TORNADO:
      S.disasters.push({ kind, x: spot.x, y: spot.y, life: 70, dx: 0, dy: 0 });
      news('🌪️ Tornado warning! Take cover!', 'bad');
      break;
    case DIS_MONSTER:
      S.disasters.push({ kind, x: rng.chance(0.5) ? 0 : W - 1, y: rng.int(H), life: 110 });
      news('👾 A giant monster is attacking the city!', 'bad');
      break;
    case DIS_METEOR: {
      const r = 3;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = spot.x + dx, y = spot.y + dy;
        if (!inBounds(x, y)) continue;
        destroyTile(S, idx(x, y), dx * dx + dy * dy <= 2);
      }
      news('☄️ A meteor has struck the city!', 'bad');
      break;
    }
    case DIS_QUAKE: {
      const rng2 = RNG(S.rngState ^ 0x1234);
      for (let k = 0; k < 140; k++) {
        const i = rng2.int(NT);
        if (S.type[i] !== B_NONE && rng2.chance(0.7)) destroyTile(S, i, rng2.chance(0.35));
      }
      news('🌎 Earthquake!! Major damage across the city!', 'bad');
      if (typeof UI !== 'undefined') UI.shake = 24;
      break;
    }
  }
}

function findBuiltSpot(S, rng) {
  for (let k = 0; k < 60; k++) {
    const i = rng.int(NT);
    if (S.type[i] !== B_NONE) return { x: i % W, y: (i / W) | 0 };
  }
  return null;
}

function destroyTile(S, i, setFire) {
  if (S.type[i] !== B_NONE) {
    const a = S.anch[i];
    const t = S.type[a >= 0 ? a : i];
    const sz = BLD[t] ? BLD[t].size : 1;
    const ax = (a >= 0 ? a : i) % W, ay = ((a >= 0 ? a : i) / W) | 0;
    for (let dy = 0; dy < sz; dy++) for (let dx = 0; dx < sz; dx++) {
      const j = idx(ax + dx, ay + dy);
      if (S.anch[j] === a) { S.type[j] = B_NONE; S.anch[j] = -1; S.lvl[j] = 0; S.terr[j] = T_RUBBLE; }
    }
    markPowerDirty();
  } else if (S.terr[i] === T_TREE) S.terr[i] = T_RUBBLE;
  if (setFire) S.fire[i] = 1;
}

function stepDisasters(S, rng) {
  for (let d = S.disasters.length - 1; d >= 0; d--) {
    const e = S.disasters[d];
    e.life--;
    if (e.kind === DIS_TORNADO) {
      e.dx = clamp(e.dx + (rng() - 0.5), -1.5, 1.5);
      e.dy = clamp(e.dy + (rng() - 0.5), -1.5, 1.5);
      e.x = clamp(e.x + e.dx, 0, W - 1);
      e.y = clamp(e.y + e.dy, 0, H - 1);
      const i = idx(Math.round(e.x), Math.round(e.y));
      if (S.type[i] !== B_NONE && rng.chance(0.8)) destroyTile(S, i, false);
    } else if (e.kind === DIS_MONSTER) {
      // walk toward densest area (city center of mass approx: middle)
      const tx = W / 2, ty = H / 2;
      e.x += clamp(tx - e.x, -1, 1) * (0.4 + rng() * 0.6) + (rng() - 0.5) * 2;
      e.y += clamp(ty - e.y, -1, 1) * (0.4 + rng() * 0.6) + (rng() - 0.5) * 2;
      e.x = clamp(e.x, 0, W - 1); e.y = clamp(e.y, 0, H - 1);
      const cx = Math.round(e.x), cy = Math.round(e.y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy;
        if (inBounds(x, y) && S.type[idx(x, y)] !== B_NONE && rng.chance(0.5)) destroyTile(S, idx(x, y), rng.chance(0.2));
      }
    }
    if (e.life <= 0) S.disasters.splice(d, 1);
  }
}

// ---------------- budget ----------------
function monthlyBudget(S) {
  // assessed value: sum of developed zone levels weighted
  let rVal = 0, cVal = 0, iVal = 0;
  for (let i = 0; i < NT; i++) {
    const t = S.type[i];
    if (t === B_RES) rVal += S.lvl[i];
    else if (t === B_COM) cVal += S.lvl[i];
    else if (t === B_IND) iVal += S.lvl[i];
  }
  const tax = (rVal * 2.2 * S.tax.r + cVal * 3.0 * S.tax.c + iVal * 2.6 * S.tax.i) / 12;
  let maint = 0;
  for (let i = 0; i < NT; i++) {
    if (S.anch[i] !== i && S.type[i] !== B_ROAD && S.type[i] !== B_WIRE && S.type[i] !== B_RAIL) continue;
    const b = BLD[S.type[i]];
    if (!b || !b.maint) continue;
    let f = 100;
    if (S.type[i] === B_ROAD || S.type[i] === B_RAIL) f = S.fund.roads;
    else if (S.type[i] === B_POLICE) f = S.fund.police;
    else if (S.type[i] === B_FIRE) f = S.fund.fire;
    else if (S.type[i] === B_HOSP) f = S.fund.health;
    else if (S.type[i] === B_SCHOOL || S.type[i] === B_COLLEGE || S.type[i] === B_LIBRARY) f = S.fund.edu;
    maint += b.maint * f / 100 / 12;
  }
  const bondCost = S.bonds * SIM.BOND_AMOUNT * SIM.BOND_RATE / 12;
  S.funds += tax - maint - bondCost;
  S.lastCash = { tax: Math.round(tax), maint: Math.round(maint), bond: Math.round(bondCost) };
  if (S.funds < 0 && !S._brokeFlag) { news('💸 The city is out of money! Raise taxes or take a bond.', 'bad'); S._brokeFlag = true; }
  if (S.funds >= 0) S._brokeFlag = false;
}

// ---------------- milestones ----------------
const MILESTONES = [
  [500, '🏘️ Your settlement is now a Village!'],
  [2000, '🏙️ Your village has grown into a Town!'],
  [10000, '🌆 Congratulations — your town is now a City!'],
  [30000, '🌃 Amazing! You lead a full Metropolis!'],
  [80000, '🌍 Incredible — a true Megalopolis!'],
];

// ---------------- main step ----------------
function simStep(S) {
  const rng = RNG(S.rngState);
  S.tickCount++;
  if (powerDirty || (S.tickCount % 8) === 0) recomputePower(S);
  const anyFire = stepFire(S, rng);
  stepDisasters(S, rng);
  growZones(S, rng);
  // demand reacts continuously so growth converges instead of oscillating
  if ((S.tickCount % 3) === 0) tallyCity(S);

  S.step++;
  if (S.step >= SIM.STEPS_PER_MONTH) {
    S.step = 0;
    // month rollover: heavy recomputes + budget
    recomputeRoads(S);
    recomputeCoverage(S);
    recomputeTraffic(S);
    recomputePollution(S);
    recomputeCrimeAndValue(S);
    tallyCity(S);
    monthlyBudget(S);
    S.month++;
    if (S.month >= 12) { S.month = 0; S.year++; }
    // random disasters
    if (S.autoDisasters && rng.chance(0.012) && S.pop > 300) {
      startDisaster(S, rng.pick([DIS_FIRE, DIS_FIRE, DIS_TORNADO, DIS_METEOR, DIS_QUAKE, DIS_MONSTER]));
    }
    // random building fire from low fire coverage
    if (S.autoDisasters && rng.chance(0.05)) {
      const spot = findBuiltSpot(S, rng);
      if (spot) {
        const i = idx(spot.x, spot.y);
        const b = BLD[S.type[i]];
        if (b && b.flam && rng.chance(b.flam * (1 - S.fcov[i] / 255) * 0.4)) {
          S.fire[i] = 1;
          news('🔥 A fire has started at a ' + b.name + '!', 'bad');
        }
      }
    }
    // milestones (announce each city size once)
    if (S._milestone == null) S._milestone = 0;
    while (S._milestone < MILESTONES.length && S.pop >= MILESTONES[S._milestone][0]) {
      news(MILESTONES[S._milestone][1], 'good');
      S._milestone++;
    }
    // history
    S.history.push({ y: S.year, m: S.month, pop: S.pop, funds: Math.round(S.funds), r: S.demand.r, c: S.demand.c, i: S.demand.i });
    if (S.history.length > 600) S.history.shift();
  }
  S.rngState = rng.state();
  return anyFire;
}
