// Simulação autoritativa do jogo. Roda no host (ou localmente em 1 jogador).
// Processa comandos e avança o estado a cada tick fixo.
import {
  TILE, TICK_RATE, UNITS, BUILDINGS, RESOURCE_NODES, START_RESOURCES,
  AGES, GATHER_CAP, PLAYER_COLORS, POP_HARD_CAP, defOf, isUnit, isBuilding,
} from './config.js';
import { generateWorld, TERRAIN } from './world.js';
import { findPath, nearestFree } from './pathfinding.js';
import { dist, dist2, clamp } from '../engine/utils.js';

const DT = 1 / TICK_RATE;

export class Simulation {
  constructor({ mapSize, numPlayers, seed, aiPlayers = [] }) {
    this.world = generateWorld(mapSize, numPlayers, seed);
    this.W = this.world.W; this.H = this.world.H;
    this.terrain = this.world.terrain;
    this.tick = 0;
    this.nextId = 1000;
    this.entities = new Map();
    this.nodes = new Map();
    this.projectiles = [];
    this.events = [];      // eventos p/ o jogador local (toasts)
    this.winner = null;
    this.gameOver = false;

    // grade de bloqueio p/ pathfinding
    this.grid = new Uint8Array(this.W * this.H);
    for (let i = 0; i < this.terrain.length; i++)
      if (this.terrain[i] === TERRAIN.WATER) this.grid[i] = 1;

    // recursos no mapa
    for (const n of this.world.nodes) {
      this.nodes.set(n.id, n);
      if (RESOURCE_NODES[n.type].blocking) this.grid[n.y * this.W + n.x] = 1;
      if (n.id >= this.nextId) this.nextId = n.id + 1;
    }

    // jogadores
    this.players = [];
    for (let i = 0; i < numPlayers; i++) {
      this.players.push({
        id: i, color: PLAYER_COLORS[i % PLAYER_COLORS.length],
        res: { ...START_RESOURCES }, popCap: 0, popUsed: 0,
        age: 0, ageResearch: null, // {progress,total,target}
        isAI: aiPlayers.includes(i), defeated: false,
        stats: { kills: 0, built: 0, trained: 0 },
      });
    }

    // estado inicial de cada jogador
    for (let i = 0; i < numPlayers; i++) this.spawnStart(i);
    this.recomputePop();
  }

  // ---------------- criação de entidades ----------------
  spawnStart(playerId) {
    const s = this.world.starts[playerId];
    const tc = this.addBuilding('town_center', playerId, s.tx - 1, s.ty - 1, true);
    tc.rally = { x: (s.tx + 2.5) * TILE, y: (s.ty + 2.5) * TILE };
    // 3 aldeões + 1 batedor (na verdade só aldeões p/ era feudal)
    const around = [[3,0],[3,1],[3,2],[2,3]];
    for (const [dx, dy] of around) {
      const t = this.freeTileNear(s.tx + dx, s.ty + dy, s.tx, s.ty);
      this.addUnit('villager', playerId, t.x, t.y);
    }
  }

  addBuilding(type, owner, bx, by, constructed = false) {
    const def = BUILDINGS[type];
    const e = {
      id: this.nextId++, type, owner, building: true,
      bx, by, size: def.size,
      x: (bx + def.size / 2) * TILE, y: (by + def.size / 2) * TILE,
      maxHp: def.hp, hp: constructed ? def.hp : Math.max(1, def.hp * 0.05),
      constructed, buildProgress: constructed ? 1 : 0,
      queue: [], rally: null, atkCd: 0,
    };
    this.entities.set(e.id, e);
    this.setBuildingBlock(e, 1);
    return e;
  }

  addUnit(type, owner, tx, ty) {
    const def = UNITS[type];
    const e = {
      id: this.nextId++, type, owner, unit: true,
      x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE,
      maxHp: def.hp, hp: def.hp,
      state: 'idle', path: null, pathIdx: 0,
      moveGoal: null, targetId: null, atkCd: 0, facing: 0,
      gather: null, buildTargetId: null, hold: false,
    };
    this.entities.set(e.id, e);
    return e;
  }

  setBuildingBlock(e, val) {
    for (let y = e.by; y < e.by + e.size; y++)
      for (let x = e.bx; x < e.bx + e.size; x++)
        if (x >= 0 && y >= 0 && x < this.W && y < this.H) this.grid[y * this.W + x] = val;
  }

  freeTileNear(tx, ty, towardX, towardY) {
    tx = clamp(tx | 0, 0, this.W - 1); ty = clamp(ty | 0, 0, this.H - 1);
    if (!this.grid[ty * this.W + tx]) return { x: tx, y: ty };
    const f = nearestFree(this.grid, this.W, this.H, tx, ty, towardX ?? tx, towardY ?? ty);
    return f || { x: tx, y: ty };
  }

  recomputePop() {
    for (const p of this.players) { p.popUsed = 0; p.popCap = 0; }
    for (const e of this.entities.values()) {
      const p = this.players[e.owner]; if (!p) continue;
      if (e.unit) p.popUsed += UNITS[e.type].pop || 1;
      else if (e.constructed && BUILDINGS[e.type].pop) p.popCap += BUILDINGS[e.type].pop;
    }
    for (const p of this.players) p.popCap = Math.min(p.popCap, POP_HARD_CAP);
  }

  // ---------------- comandos ----------------
  applyCommand(cmd) {
    const p = this.players[cmd.owner];
    if (!p || p.defeated || this.gameOver) return;
    switch (cmd.type) {
      case 'move':        return this.cmdMove(cmd);
      case 'attack':      return this.cmdAttack(cmd);
      case 'gather':      return this.cmdGather(cmd);
      case 'build':       return this.cmdBuild(cmd);
      case 'train':       return this.cmdTrain(cmd);
      case 'cancelTrain': return this.cmdCancelTrain(cmd);
      case 'rally':       return this.cmdRally(cmd);
      case 'age':         return this.cmdAge(cmd);
      case 'stop':        return this.cmdStop(cmd);
      case 'delete':      return this.cmdDelete(cmd);
    }
  }

  ownedUnits(cmd) {
    const out = [];
    for (const id of cmd.ids || []) {
      const e = this.entities.get(id);
      if (e && e.unit && e.owner === cmd.owner) out.push(e);
    }
    return out;
  }

  cmdMove(cmd) {
    const units = this.ownedUnits(cmd);
    const formation = this.spread(cmd.x, cmd.y, units.length);
    units.forEach((e, i) => {
      e.gather = null; e.buildTargetId = null; e.targetId = null;
      e.hold = false;
      e.state = cmd.attackMove ? 'attackmove' : 'move';
      this.setMoveGoal(e, formation[i].x, formation[i].y);
    });
  }

  cmdStop(cmd) {
    for (const e of this.ownedUnits(cmd)) {
      e.state = 'idle'; e.path = null; e.moveGoal = null;
      e.gather = null; e.buildTargetId = null; e.targetId = null;
    }
  }

  cmdAttack(cmd) {
    const target = this.entities.get(cmd.targetId);
    if (!target) return;
    for (const e of this.ownedUnits(cmd)) {
      if (!UNITS[e.type].attack) continue;
      e.gather = null; e.buildTargetId = null;
      e.state = 'attack'; e.targetId = cmd.targetId; e.hold = false;
    }
  }

  cmdGather(cmd) {
    const node = this.nodes.get(cmd.nodeId);
    if (!node) return;
    for (const e of this.ownedUnits(cmd)) {
      if (e.type !== 'villager') { // militar clicando em recurso apenas move
        this.setMoveGoal(e, (node.x+0.5)*TILE, (node.y+0.5)*TILE); e.state='move'; continue;
      }
      e.targetId = null; e.buildTargetId = null;
      e.state = 'gather';
      e.gather = { res: RESOURCE_NODES[node.type].gives, carrying: e.gather?.carrying || 0,
                   nodeId: node.id, homeId: null };
      this.routeToNode(e, node);
    }
  }

  cmdBuild(cmd) {
    const { buildingType, tx, ty, owner } = cmd;
    const def = BUILDINGS[buildingType];
    const p = this.players[owner];
    if (!def) return;
    if (def.age > p.age) { this.event(owner, 'Requer era superior', true); return; }
    if (!this.canPlace(tx, ty, def.size)) { this.event(owner, 'Local inválido', true); return; }
    if (!this.canAfford(p, def.cost)) { this.event(owner, 'Recursos insuficientes', true); return; }
    this.pay(p, def.cost);
    const b = this.addBuilding(buildingType, owner, tx, ty, false);
    p.stats.built++;
    // atribui construtores
    const builders = this.ownedUnits(cmd).filter(e => e.type === 'villager');
    if (builders.length === 0) { // sem construtor: cancela e devolve
      // mantém edifício em construção mesmo assim (pode designar depois)
    }
    builders.forEach(e => {
      e.gather = null; e.targetId = null;
      e.state = 'build'; e.buildTargetId = b.id;
      this.routeToBuilding(e, b);
    });
  }

  cmdTrain(cmd) {
    const b = this.entities.get(cmd.buildingId);
    if (!b || b.owner !== cmd.owner || !b.constructed) return;
    const def = BUILDINGS[b.type];
    if (!def.trains || !def.trains.includes(cmd.unitType)) return;
    const u = UNITS[cmd.unitType];
    const p = this.players[cmd.owner];
    if (u.age > p.age) { this.event(cmd.owner, 'Requer era superior', true); return; }
    if (p.popUsed + this.queuedPop(p) + 1 > p.popCap) { this.event(cmd.owner,'Sem população (construa Casas)',true); return; }
    if (!this.canAfford(p, u.cost)) { this.event(cmd.owner, 'Recursos insuficientes', true); return; }
    this.pay(p, u.cost);
    b.queue.push({ type: cmd.unitType, elapsed: 0, total: u.trainTime });
  }

  cmdCancelTrain(cmd) {
    const b = this.entities.get(cmd.buildingId);
    if (!b || b.owner !== cmd.owner || !b.queue.length) return;
    const idx = cmd.index != null ? cmd.index : b.queue.length - 1;
    const item = b.queue[idx];
    if (!item) return;
    const u = UNITS[item.type];
    this.refund(this.players[cmd.owner], u.cost);
    b.queue.splice(idx, 1);
  }

  cmdRally(cmd) {
    const b = this.entities.get(cmd.buildingId);
    if (!b || b.owner !== cmd.owner) return;
    b.rally = { x: cmd.x, y: cmd.y };
  }

  cmdAge(cmd) {
    const b = this.entities.get(cmd.buildingId);
    const p = this.players[cmd.owner];
    if (!b || b.type !== 'town_center' || !b.constructed) return;
    if (p.ageResearch) return;
    if (p.age + 1 >= AGES.length) { this.event(cmd.owner, 'Era máxima atingida', true); return; }
    const cost = AGES[p.age + 1].cost;
    if (!this.canAfford(p, cost)) { this.event(cmd.owner, 'Recursos insuficientes', true); return; }
    this.pay(p, cost);
    p.ageResearch = { progress: 0, total: 45, target: p.age + 1, buildingId: b.id };
  }

  cmdDelete(cmd) {
    for (const id of cmd.ids || []) {
      const e = this.entities.get(id);
      if (e && e.owner === cmd.owner) this.destroy(e);
    }
    this.recomputePop();
  }

  queuedPop(p) {
    let n = 0;
    for (const e of this.entities.values())
      if (e.owner === p.id && e.building) n += e.queue.length;
    return n;
  }

  // ---------------- economia ----------------
  canAfford(p, cost) { return Object.entries(cost || {}).every(([r, v]) => p.res[r] >= v); }
  pay(p, cost) { for (const [r, v] of Object.entries(cost || {})) p.res[r] -= v; }
  refund(p, cost) { for (const [r, v] of Object.entries(cost || {})) p.res[r] += v; }

  canPlace(tx, ty, size) {
    for (let y = ty; y < ty + size; y++)
      for (let x = tx; x < tx + size; x++) {
        if (x < 0 || y < 0 || x >= this.W || y >= this.H) return false;
        if (this.grid[y * this.W + x]) return false;
        if (this.terrain[y * this.W + x] === TERRAIN.WATER) return false;
      }
    return true;
  }

  // ---------------- movimento ----------------
  setMoveGoal(e, wx, wy) {
    e.moveGoal = { x: wx, y: wy };
    const tx = clamp(Math.floor(e.x / TILE), 0, this.W - 1);
    const ty = clamp(Math.floor(e.y / TILE), 0, this.H - 1);
    const gx = clamp(Math.floor(wx / TILE), 0, this.W - 1);
    const gy = clamp(Math.floor(wy / TILE), 0, this.H - 1);
    const path = findPath(this.grid, this.W, this.H, tx, ty, gx, gy);
    e.path = path && path.length ? path : null;
    e.pathIdx = 0;
  }

  routeToNode(e, node) {
    const t = this.freeTileNear(node.x, node.y, Math.floor(e.x/TILE), Math.floor(e.y/TILE));
    this.setMoveGoal(e, (t.x + 0.5) * TILE, (t.y + 0.5) * TILE);
    e.gather.approach = { x: node.x, y: node.y };
  }

  routeToBuilding(e, b) {
    const t = this.freeTileNear(b.bx - 1, b.by + (b.size>>1), Math.floor(e.x/TILE), Math.floor(e.y/TILE));
    this.setMoveGoal(e, (t.x + 0.5) * TILE, (t.y + 0.5) * TILE);
  }

  // distribui pontos-alvo ao redor de um destino (formação em grade)
  spread(cx, cy, n) {
    if (n <= 1) return [{ x: cx, y: cy }];
    const out = [];
    const cols = Math.ceil(Math.sqrt(n));
    const gap = TILE * 1.1;
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      out.push({ x: cx + (c - cols/2 + 0.5) * gap, y: cy + (r - cols/2 + 0.5) * gap });
    }
    return out;
  }

  moveAlong(e, def, dt) {
    if (!e.path || e.pathIdx >= e.path.length) {
      // chegou ao fim do caminho: aproxima do goal exato
      if (e.moveGoal) {
        const d = dist(e.x, e.y, e.moveGoal.x, e.moveGoal.y);
        if (d > 2) this.stepTo(e, e.moveGoal.x, e.moveGoal.y, def.speed * TILE * dt);
        else return true;
      }
      return true;
    }
    const wp = e.path[e.pathIdx];
    const wx = (wp.x + 0.5) * TILE, wy = (wp.y + 0.5) * TILE;
    const d = dist(e.x, e.y, wx, wy);
    if (d < TILE * 0.35) { e.pathIdx++; return e.pathIdx >= e.path.length; }
    this.stepTo(e, wx, wy, def.speed * TILE * dt);
    return false;
  }

  stepTo(e, tx, ty, step) {
    const dx = tx - e.x, dy = ty - e.y;
    const d = Math.hypot(dx, dy) || 1;
    e.x += (dx / d) * Math.min(step, d);
    e.y += (dy / d) * Math.min(step, d);
    e.facing = Math.atan2(dy, dx);
  }

  // separação simples para reduzir empilhamento
  applySeparation() {
    const units = [];
    for (const e of this.entities.values()) if (e.unit) units.push(e);
    // grade espacial
    const cell = TILE, buckets = new Map();
    const key = (x, y) => (Math.floor(x / cell)) + ',' + (Math.floor(y / cell));
    for (const e of units) {
      const k = key(e.x, e.y);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(e);
    }
    for (const e of units) {
      const cx = Math.floor(e.x / cell), cy = Math.floor(e.y / cell);
      let px = 0, py = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const arr = buckets.get((cx + dx) + ',' + (cy + dy));
        if (!arr) continue;
        for (const o of arr) {
          if (o === e) continue;
          const ddx = e.x - o.x, ddy = e.y - o.y;
          const dd = ddx*ddx + ddy*ddy;
          const min = TILE * 0.7;
          if (dd < min*min && dd > 0.01) {
            const f = (min - Math.sqrt(dd)) / min;
            const dl = Math.sqrt(dd);
            px += (ddx/dl) * f; py += (ddy/dl) * f;
          }
        }
      }
      if (px || py) {
        const nx = clamp(e.x + px * 2.2, 0, this.W*TILE-1);
        const ny = clamp(e.y + py * 2.2, 0, this.H*TILE-1);
        if (!this.grid[Math.floor(ny/TILE)*this.W + Math.floor(nx/TILE)]) { e.x = nx; e.y = ny; }
      }
    }
  }

  // ---------------- combate ----------------
  dmgAgainst(attacker, target) {
    const a = UNITS[attacker.type]?.attack || BUILDINGS[attacker.type]?.attack;
    if (!a) return 0;
    let dmg = a.damage;
    const bonus = UNITS[attacker.type]?.bonus;
    if (bonus) {
      const tClass = target.building ? 'building' : UNITS[target.type]?.class;
      if (tClass && bonus[tClass]) dmg *= bonus[tClass];
    }
    return dmg;
  }

  attackRange(e) {
    const a = UNITS[e.type]?.attack || BUILDINGS[e.type]?.attack;
    return a ? a.range : 0;
  }

  findEnemyNear(e, range) {
    const owner = e.owner;
    let best = null, bestD = range * TILE * (range * TILE);
    for (const o of this.entities.values()) {
      if (o.owner === owner || this.players[o.owner]?.defeated) continue;
      if (o.hp <= 0) continue;
      const d = dist2(e.x, e.y, o.x, o.y);
      // prioriza unidades sobre edifícios
      const bias = o.building ? TILE*TILE*4 : 0;
      if (d + bias < bestD) { bestD = d + bias; best = o; }
    }
    return best;
  }

  doAttack(e, target, def, dt) {
    const a = def.attack;
    const reach = (a.range + (target.building ? target.size*0.5 : 0.4)) * TILE;
    const d = dist(e.x, e.y, target.x, target.y);
    if (d > reach) {
      // aproxima
      if (!e.moveGoal || dist(e.moveGoal.x, e.moveGoal.y, target.x, target.y) > TILE*1.5)
        this.setMoveGoal(e, target.x, target.y);
      this.moveAlong(e, def, dt);
      return;
    }
    e.path = null; e.moveGoal = null;
    e.facing = Math.atan2(target.y - e.y, target.x - e.x);
    if (e.atkCd > 0) return;
    e.atkCd = a.cooldown;
    const dmg = this.dmgAgainst(e, target);
    if (a.projectile) {
      this.projectiles.push({ x: e.x, y: e.y, targetId: target.id,
        dmg, speed: 11 * TILE, ownerId: e.owner, attackerType: e.type,
        angle: Math.atan2(target.y - e.y, target.x - e.x) });
    } else {
      this.applyDamage(target, dmg, e.owner);
    }
  }

  applyDamage(target, dmg, byOwner) {
    if (target.hp <= 0) return;
    target.hp -= dmg;
    if (target.hp <= 0) {
      if (this.players[byOwner]) this.players[byOwner].stats.kills++;
      this.destroy(target);
    }
  }

  destroy(e) {
    if (!this.entities.has(e.id)) return;
    if (e.building) this.setBuildingBlock(e, 0);
    this.entities.delete(e.id);
    // limpa referências
    for (const o of this.entities.values()) {
      if (o.targetId === e.id) { o.targetId = null; if (o.state === 'attack') o.state = 'idle'; }
      if (o.buildTargetId === e.id) { o.buildTargetId = null; if (o.state==='build') o.state='idle'; }
      if (o.gather && o.gather.homeId === e.id) o.gather.homeId = null;
    }
  }

  // ---------------- coleta ----------------
  nearestDropoff(e, res) {
    let best = null, bestD = Infinity;
    for (const o of this.entities.values()) {
      if (o.owner !== e.owner || !o.building || !o.constructed) continue;
      const dd = BUILDINGS[o.type].dropoff;
      if (!dd || !dd.includes(res)) continue;
      const d = dist2(e.x, e.y, o.x, o.y);
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  nearestNodeOfRes(e, res) {
    let best = null, bestD = Infinity;
    for (const n of this.nodes.values()) {
      if (RESOURCE_NODES[n.type].gives !== res || n.amount <= 0) continue;
      const d = dist2(e.x, e.y, n.x*TILE, n.y*TILE);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  updateGather(e, def, dt) {
    const g = e.gather;
    const node = this.nodes.get(g.nodeId);
    if (g.carrying >= GATHER_CAP || (!node && g.carrying > 0)) return this.updateReturn(e, def, dt);
    if (!node) { // recurso acabou: procura outro do mesmo tipo
      const nn = this.nearestNodeOfRes(e, g.res);
      if (nn) { g.nodeId = nn.id; this.routeToNode(e, nn); }
      else { e.state = 'idle'; e.gather = null; }
      return;
    }
    const adj = this.adjacentTo(e, node.x, node.y);
    if (!adj) { this.moveAlong(e, def, dt); return; }
    e.path = null; e.moveGoal = null;
    e.facing = Math.atan2(node.y*TILE - e.y, node.x*TILE - e.x);
    const rate = (UNITS.villager.gather || 0.8) * 2.2 * dt;
    const take = Math.min(rate, node.amount, GATHER_CAP - g.carrying);
    node.amount -= take; g.carrying += take;
    if (node.amount <= 0) {
      // remove nó depletado
      if (RESOURCE_NODES[node.type].blocking) this.grid[node.y*this.W+node.x] = 0;
      this.nodes.delete(node.id);
    }
    if (g.carrying >= GATHER_CAP) this.updateReturn(e, def, dt);
  }

  updateReturn(e, def, dt) {
    const g = e.gather;
    let home = g.homeId ? this.entities.get(g.homeId) : null;
    if (!home || !this.entities.has(home.id)) {
      home = this.nearestDropoff(e, g.res);
      if (!home) { e.state = 'idle'; return; }
      g.homeId = home.id;
      this.routeToBuilding(e, home);
    }
    const adj = this.adjacentToBuilding(e, home);
    if (!adj) { if(!e.path && !e.moveGoal) this.routeToBuilding(e,home); this.moveAlong(e, def, dt); return; }
    // deposita
    this.players[e.owner].res[g.res] += Math.floor(g.carrying);
    g.carrying = 0; g.homeId = null;
    // volta ao recurso
    const node = this.nodes.get(g.nodeId) || this.nearestNodeOfRes(e, g.res);
    if (node) { g.nodeId = node.id; e.state = 'gather'; this.routeToNode(e, node); }
    else e.state = 'idle';
  }

  adjacentTo(e, tx, ty) {
    // 1.55 tiles cobre vizinhos ortogonais e diagonais (~1,41 tiles)
    return dist(e.x, e.y, (tx+0.5)*TILE, (ty+0.5)*TILE) < TILE * 1.55;
  }
  adjacentToBuilding(e, b) {
    const hx = clamp(e.x, b.bx*TILE, (b.bx+b.size)*TILE);
    const hy = clamp(e.y, b.by*TILE, (b.by+b.size)*TILE);
    return dist(e.x, e.y, hx, hy) < TILE * 1.3;
  }

  // ---------------- construção ----------------
  updateBuild(e, def, dt) {
    const b = this.entities.get(e.buildTargetId);
    if (!b || b.constructed) { e.state = 'idle'; e.buildTargetId = null; return; }
    if (!this.adjacentToBuilding(e, b)) {
      if (!e.path && !e.moveGoal) this.routeToBuilding(e, b);
      this.moveAlong(e, def, dt);
      return;
    }
    e.path = null; e.moveGoal = null;
    const bdef = BUILDINGS[b.type];
    const inc = dt / bdef.buildTime; // um aldeão constrói em buildTime seg
    b.buildProgress = Math.min(1, b.buildProgress + inc);
    b.hp = Math.min(b.maxHp, bdef.hp * (0.05 + 0.95 * b.buildProgress));
    if (b.buildProgress >= 1) {
      b.constructed = true; b.hp = b.maxHp;
      this.recomputePop();
      this.event(e.owner, bdef.name + ' concluído');
      e.state = 'idle'; e.buildTargetId = null;
    }
  }

  // ---------------- loop principal de tick ----------------
  step(commands) {
    if (this.gameOver) return;
    for (const c of commands) this.applyCommand(c);
    this.tick++;

    // pesquisa de era
    for (const p of this.players) {
      if (p.ageResearch) {
        p.ageResearch.progress += DT;
        if (p.ageResearch.progress >= p.ageResearch.total) {
          p.age = p.ageResearch.target;
          this.event(p.id, 'Avançou para ' + AGES[p.age].name);
          p.ageResearch = null;
        }
      }
    }

    // treino e torres
    for (const e of this.entities.values()) {
      if (e.atkCd > 0) e.atkCd -= DT;
      if (e.building) {
        if (e.constructed) this.updateBuilding(e);
      }
    }

    // unidades
    for (const e of this.entities.values()) {
      if (!e.unit) continue;
      this.updateUnit(e);
    }

    this.applySeparation();
    this.updateProjectiles();
    this.checkWin();
  }

  updateBuilding(b) {
    const def = BUILDINGS[b.type];
    // treino
    if (b.queue.length) {
      const item = b.queue[0];
      item.elapsed += DT;
      if (item.elapsed >= item.total) {
        const p = this.players[b.owner];
        if (p.popUsed + 1 <= p.popCap || true) {
          const spawn = this.freeTileNear(b.bx + def.size, b.by + def.size,
            b.rally ? Math.floor(b.rally.x/TILE) : b.bx, b.rally ? Math.floor(b.rally.y/TILE) : b.by);
          const u = this.addUnit(item.type, b.owner, spawn.x, spawn.y);
          p.stats.trained++;
          if (b.rally) { u.state = 'move'; this.setMoveGoal(u, b.rally.x, b.rally.y); }
          this.recomputePop();
          b.queue.shift();
        }
      }
    }
    // torre ataca
    if (def.attack) {
      if (b.atkCd <= 0) {
        const target = this.findEnemyNear(b, def.attack.range);
        if (target) {
          b.atkCd = def.attack.cooldown;
          if (def.attack.projectile)
            this.projectiles.push({ x: b.x, y: b.y, targetId: target.id,
              dmg: def.attack.damage, speed: 12*TILE, ownerId: b.owner, attackerType: b.type,
              angle: Math.atan2(target.y - b.y, target.x - b.x) });
          else this.applyDamage(target, def.attack.damage, b.owner);
        }
      }
    }
  }

  updateUnit(e) {
    const def = UNITS[e.type];
    switch (e.state) {
      case 'idle': {
        // militares defendem automaticamente
        if (def.attack && e.type !== 'villager') {
          const enemy = this.findEnemyNear(e, def.sight);
          if (enemy) { e.state = 'attack'; e.targetId = enemy.id; }
        }
        break;
      }
      case 'move': {
        if (this.moveAlong(e, def, DT)) { e.state = 'idle'; e.path = null; e.moveGoal = null; }
        break;
      }
      case 'attackmove': {
        const enemy = this.findEnemyNear(e, def.sight);
        if (enemy && def.attack) { e.targetId = enemy.id; this.doAttack(e, enemy, def, DT); }
        else if (this.moveAlong(e, def, DT)) { e.state = 'idle'; e.path = null; e.moveGoal = null; }
        break;
      }
      case 'attack': {
        let target = this.entities.get(e.targetId);
        if (!target || target.hp <= 0 || this.players[target.owner]?.defeated) {
          // procura outro inimigo próximo
          const enemy = def.attack ? this.findEnemyNear(e, def.sight) : null;
          if (enemy) { e.targetId = enemy.id; target = enemy; }
          else { e.state = 'idle'; e.targetId = null; break; }
        }
        if (def.attack) this.doAttack(e, target, def, DT);
        break;
      }
      case 'gather': this.updateGather(e, def, DT); break;
      case 'return': this.updateReturn(e, def, DT); break;
      case 'build':  this.updateBuild(e, def, DT); break;
    }
  }

  updateProjectiles() {
    const dt = DT;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      const t = this.entities.get(pr.targetId);
      if (!t || t.hp <= 0) { this.projectiles.splice(i, 1); continue; }
      const d = dist(pr.x, pr.y, t.x, t.y);
      pr.angle = Math.atan2(t.y - pr.y, t.x - pr.x);
      const step = pr.speed * dt;
      if (d <= step + TILE*0.4) {
        this.applyDamage(t, pr.dmg, pr.ownerId);
        this.projectiles.splice(i, 1);
      } else {
        pr.x += (t.x - pr.x) / d * step;
        pr.y += (t.y - pr.y) / d * step;
      }
    }
  }

  checkWin() {
    let alive = [];
    for (const p of this.players) {
      if (p.defeated) continue;
      let hasTC = false, hasVil = false, hasAny = false;
      for (const e of this.entities.values()) {
        if (e.owner !== p.id) continue;
        hasAny = true;
        if (e.type === 'town_center' && e.constructed) hasTC = true;
        if (e.type === 'villager') hasVil = true;
      }
      if (!hasTC && !hasVil) { p.defeated = true; this.event(p.id, 'Você foi derrotado!', true); }
      else if (!hasAny) p.defeated = true;
      else alive.push(p);
    }
    if (alive.length <= 1 && this.players.length > 1) {
      this.gameOver = true;
      this.winner = alive.length === 1 ? alive[0].id : null;
    }
  }

  event(playerId, text, warn = false) {
    this.events.push({ playerId, text, warn, tick: this.tick });
  }

  // ---------------- snapshot p/ rede ----------------
  snapshot(includeNodes = true) {
    const ents = [];
    for (const e of this.entities.values()) {
      ents.push({
        i: e.id, t: e.type, o: e.owner,
        x: Math.round(e.x), y: Math.round(e.y),
        h: Math.round(e.hp),
        b: e.building ? 1 : 0,
        c: e.constructed ? 1 : 0,
        p: e.building ? Math.round((e.buildProgress||0)*100) : 0,
        q: e.building ? e.queue.map(q => [q.type, Math.round(q.elapsed), q.total]) : null,
        bx: e.bx, by: e.by,
        st: e.state, f: e.facing ? Math.round(e.facing*100)/100 : 0,
        ry: e.rally ? [Math.round(e.rally.x), Math.round(e.rally.y)] : null,
      });
    }
    let nodes = null;
    if (includeNodes) {
      nodes = [];
      for (const n of this.nodes.values())
        nodes.push([n.id, n.type, n.x, n.y, Math.round(n.amount), n.max]);
    }
    return {
      tick: this.tick,
      players: this.players.map(p => ({
        r: p.res, pc: p.popCap, pu: p.popUsed, a: p.age,
        ar: p.ageResearch ? Math.round(p.ageResearch.progress/p.ageResearch.total*100) : null,
        d: p.defeated ? 1 : 0,
      })),
      ents, nodes,
      proj: this.projectiles.map(p => [Math.round(p.x), Math.round(p.y), Math.round((p.angle || 0) * 100) / 100]),
      over: this.gameOver ? 1 : 0, win: this.winner,
    };
  }
}
