// Modelos de visão usados pela renderização/HUD.
// HostModel: lê direto da simulação. ClientModel: lê snapshots recebidos pela rede.
import { generateWorld } from './world.js';
import { RESOURCE_NODES, AGES } from './config.js';
import { lerp } from '../engine/utils.js';

export class HostModel {
  constructor(sim, localPlayerId) {
    this.sim = sim; this.localPlayerId = localPlayerId;
    this.W = sim.W; this.H = sim.H; this.terrain = sim.terrain;
  }
  get players() { return this.sim.players; }
  get localPlayer() { return this.sim.players[this.localPlayerId]; }
  get gameOver() { return this.sim.gameOver; }
  get winner() { return this.sim.winner; }
  get tick() { return this.sim.tick; }
  entities() { return this.sim.entities.values(); }
  getEntity(id) { return this.sim.entities.get(id); }
  nodes() { return this.sim.nodes.values(); }
  projectiles() { return this.sim.projectiles; }
  drainEvents() { const e = this.sim.events.filter(ev => ev.playerId === this.localPlayerId);
    this.sim.events = []; return e; }
}

export class ClientModel {
  constructor(mapSize, numPlayers, seed, localPlayerId) {
    const w = generateWorld(mapSize, numPlayers, seed);
    this.W = w.W; this.H = w.H; this.terrain = w.terrain;
    this.localPlayerId = localPlayerId;
    this.prev = null; this.curr = null;
    this.prevTime = 0; this.currTime = 0;
    this._players = [];
    this._nodes = new Map();
    this._entCache = new Map();
    this.gameOver = false; this.winner = null; this.tick = 0;
    this.pendingEvents = [];
  }
  applySnapshot(snap, now) {
    this.prev = this.curr; this.prevTime = this.currTime;
    this.curr = snap; this.currTime = now;
    this._players = snap.players;
    this.gameOver = !!snap.over; this.winner = snap.win; this.tick = snap.tick;
    if (snap.nodes) {
      this._nodes = new Map();
      for (const [id, type, x, y, amount, max] of snap.nodes)
        this._nodes.set(id, { id, type, x, y, amount, max });
    }
  }
  get players() { return this._players; }
  get localPlayer() { return this._players[this.localPlayerId] || { r:{food:0,wood:0,gold:0,stone:0}, pc:0, pu:0, a:0 }; }
  _alpha(now) {
    if (!this.prev) return 1;
    const span = this.currTime - this.prevTime;
    if (span <= 0) return 1;
    return Math.min(1.3, (now - this.currTime) / span + 0);
  }
  _expand(raw, prevRaw, alpha) {
    let x = raw.x, y = raw.y;
    if (prevRaw && !raw.b) { x = lerp(prevRaw.x, raw.x, alpha); y = lerp(prevRaw.y, raw.y, alpha); }
    return {
      id: raw.i, type: raw.t, owner: raw.o, x, y, hp: raw.h,
      building: !!raw.b, constructed: !!raw.c, buildProgress: raw.p/100,
      bx: raw.bx, by: raw.by,
      queue: raw.q ? raw.q.map(([type, elapsed, total]) => ({ type, elapsed, total })) : [],
      rally: raw.ry ? { x: raw.ry[0], y: raw.ry[1] } : null,
      state: raw.st, facing: raw.f,
    };
  }
  entities(now = this.currTime) {
    if (!this.curr) return [];
    const alpha = this._alpha(now);
    const prevMap = new Map();
    if (this.prev) for (const r of this.prev.ents) prevMap.set(r.i, r);
    const out = [];
    for (const raw of this.curr.ents) out.push(this._expand(raw, prevMap.get(raw.i), alpha));
    return out;
  }
  getEntity(id) {
    if (!this.curr) return null;
    const raw = this.curr.ents.find(r => r.i === id);
    return raw ? this._expand(raw, null, 1) : null;
  }
  nodes() { return this._nodes.values(); }
  projectiles() { return this.curr ? this.curr.proj.map(([x, y]) => ({ x, y })) : []; }
  drainEvents() { const e = this.pendingEvents; this.pendingEvents = []; return e; }
}
