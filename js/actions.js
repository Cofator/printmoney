/* ============================================================
 * Micropolis 2000 — actions.js
 * Build / bulldoze / terrain actions. Applied identically on
 * host and guests (host is authoritative, guests mirror).
 * ============================================================ */
'use strict';

function toolCost(tool) {
  if (tool === TOOL_DOZE) return DOZE_COST;
  if (tool === TOOL_TERRA_TREE) return TREE_COST;
  if (tool === TOOL_TERRA_WATER) return WATER_COST;
  if (tool === TOOL_TERRA_LAND) return LAND_COST;
  const b = BLD[tool];
  return b ? b.cost : 0;
}

// Can building `code` be placed at (x,y)? Returns null if ok, else reason.
function placeError(S, code, x, y) {
  const b = BLD[code];
  if (!b) return 'Unknown building';
  const sz = b.size;
  if (x < 0 || y < 0 || x + sz > W || y + sz > H) return 'Out of bounds';
  for (let dy = 0; dy < sz; dy++) {
    for (let dx = 0; dx < sz; dx++) {
      const i = idx(x + dx, y + dy);
      if (S.type[i] !== B_NONE) {
        // power lines may cross roads/rails
        if (code === B_WIRE && (S.type[i] === B_ROAD || S.type[i] === B_RAIL) && !S.wireOn[i]) continue;
        return 'Occupied';
      }
      const t = S.terr[i];
      if (t === T_WATER) {
        if (!(code === B_ROAD || code === B_WIRE || code === B_RAIL)) return 'Cannot build on water';
      }
      if (t === T_RUBBLE) return 'Clear rubble first (bulldoze)';
    }
  }
  if (b.nearWater && !nearWater(S, x, y, sz, 2)) return 'Must be built next to water';
  return null;
}

// Apply a build. Assumes validation done. Deducts funds.
function doBuild(S, code, x, y) {
  const b = BLD[code];
  const sz = b.size;
  const a = idx(x, y);
  for (let dy = 0; dy < sz; dy++) {
    for (let dx = 0; dx < sz; dx++) {
      const i = idx(x + dx, y + dy);
      if (code === B_WIRE && (S.type[i] === B_ROAD || S.type[i] === B_RAIL)) {
        S.wireOn[i] = 1; // wire crossing a road
        continue;
      }
      if (S.terr[i] === T_TREE) S.terr[i] = T_GRASS;
      S.type[i] = code;
      S.anch[i] = a;
      S.lvl[i] = 0;
      S.fire[i] = 0;
    }
  }
  S.funds -= b.cost;
  markPowerDirty();
}

function doBulldoze(S, x, y) {
  const i = idx(x, y);
  if (S.wireOn[i]) { // remove the wire crossing first, keep the road
    S.wireOn[i] = 0;
    S.funds -= DOZE_COST;
    markPowerDirty();
    return;
  }
  if (S.type[i] !== B_NONE) {
    const a = S.anch[i];
    const ax = a % W, ay = (a / W) | 0;
    const sz = BLD[S.type[i]] ? BLD[S.type[i]].size : 1;
    for (let dy = 0; dy < sz; dy++) {
      for (let dx = 0; dx < sz; dx++) {
        const j = idx(ax + dx, ay + dy);
        if (S.anch[j] === a) {
          S.type[j] = B_NONE; S.anch[j] = -1; S.lvl[j] = 0; S.fire[j] = 0;
          if (S.terr[j] === T_RUBBLE) S.terr[j] = T_GRASS;
        }
      }
    }
    S.funds -= DOZE_COST;
    markPowerDirty();
  } else if (S.terr[i] === T_TREE || S.terr[i] === T_RUBBLE) {
    S.terr[i] = T_GRASS;
    S.funds -= DOZE_COST;
  }
}

// Master entry: apply an action object. Returns true if applied.
// act = {t:'build', code, x, y} | {t:'doze', x, y} | {t:'terr', kind, x, y}
//     | {t:'tax', r,c,i} | {t:'fund', police,fire,roads,health,edu}
//     | {t:'bond', take:bool} | {t:'disaster', kind} | {t:'setopt', key, val}
function applyAction(S, act) {
  switch (act.t) {
    case 'build': {
      if (placeError(S, act.code, act.x, act.y)) return false;
      if (S.funds < BLD[act.code].cost) return false;
      doBuild(S, act.code, act.x, act.y);
      return true;
    }
    case 'doze': {
      if (!inBounds(act.x, act.y)) return false;
      if (S.funds < DOZE_COST) return false;
      const i = idx(act.x, act.y);
      if (S.type[i] === B_NONE && S.terr[i] !== T_TREE && S.terr[i] !== T_RUBBLE) return false;
      doBulldoze(S, act.x, act.y);
      return true;
    }
    case 'terr': {
      if (!inBounds(act.x, act.y)) return false;
      const i = idx(act.x, act.y);
      if (S.type[i] !== B_NONE) return false;
      if (act.kind === 'tree') {
        if (S.terr[i] !== T_GRASS || S.funds < TREE_COST) return false;
        S.terr[i] = T_TREE; S.funds -= TREE_COST;
      } else if (act.kind === 'water') {
        if (S.terr[i] === T_WATER || S.funds < WATER_COST) return false;
        S.terr[i] = T_WATER; S.funds -= WATER_COST;
      } else if (act.kind === 'land') {
        if (S.terr[i] !== T_WATER || S.funds < LAND_COST) return false;
        S.terr[i] = T_GRASS; S.funds -= LAND_COST;
      } else return false;
      markPowerDirty();
      return true;
    }
    case 'tax':
      S.tax.r = clamp(act.r | 0, 0, 20);
      S.tax.c = clamp(act.c | 0, 0, 20);
      S.tax.i = clamp(act.i | 0, 0, 20);
      return true;
    case 'fund':
      for (const k of ['police', 'fire', 'roads', 'health', 'edu'])
        if (act[k] != null) S.fund[k] = clamp(act[k] | 0, 0, 100);
      return true;
    case 'bond':
      if (act.take) {
        if (S.bonds >= 5) return false;
        S.bonds++; S.funds += SIM.BOND_AMOUNT;
      } else {
        if (S.bonds <= 0 || S.funds < SIM.BOND_AMOUNT) return false;
        S.bonds--; S.funds -= SIM.BOND_AMOUNT;
      }
      return true;
    case 'disaster':
      startDisaster(S, act.kind);
      return true;
    case 'setopt':
      if (act.key === 'autoDisasters') S.autoDisasters = !!act.val;
      return true;
  }
  return false;
}
