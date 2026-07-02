/* ============================================================
 * Micropolis 2000 — net.js
 * Peer-to-peer multiplayer over WebRTC using PeerJS's free
 * public broker (no dedicated game server needed).
 *
 * Model: the HOST runs the simulation and is authoritative.
 * Everyone can build; actions are validated & applied by the
 * host and echoed to all guests. Guests apply actions locally
 * for responsiveness and receive a full state sync every few
 * seconds to correct any drift.
 * ============================================================ */
'use strict';

/* ---------- state (de)serialization — also used by save/load ---------- */
function serializeState(S) {
  return {
    v: S.v, seed: S.seed, cityName: S.cityName,
    terr: rleEncode(S.terr), type: rleEncode(S.type),
    anch: rleEncode(S.anch), lvl: rleEncode(S.lvl),
    pwr: rleEncode(S.pwr), wtr: rleEncode(S.wtr), fire: rleEncode(S.fire),
    roadOk: rleEncode(S.roadOk), wireOn: rleEncode(S.wireOn), traffic: rleEncode(S.traffic),
    poll: rleEncode(S.poll), crime: rleEncode(S.crime), lval: rleEncode(S.lval),
    pcov: rleEncode(S.pcov), fcov: rleEncode(S.fcov),
    hcov: rleEncode(S.hcov), ecov: rleEncode(S.ecov),
    funds: S.funds, year: S.year, month: S.month, step: S.step, tickCount: S.tickCount,
    tax: S.tax, fund: S.fund, bonds: S.bonds, demand: S.demand,
    pop: S.pop, jobs: S.jobs, disasters: S.disasters,
    autoDisasters: S.autoDisasters, history: S.history.slice(-240),
    lastCash: S.lastCash, rngState: S.rngState,
  };
}

function deserializeState(d) {
  const S = newState(d.seed, d.cityName);
  rleDecode(d.terr, S.terr); rleDecode(d.type, S.type);
  rleDecode(d.anch, S.anch); rleDecode(d.lvl, S.lvl);
  rleDecode(d.pwr, S.pwr); rleDecode(d.wtr, S.wtr); rleDecode(d.fire, S.fire);
  if (d.roadOk) rleDecode(d.roadOk, S.roadOk);
  if (d.wireOn) rleDecode(d.wireOn, S.wireOn);
  if (d.traffic) rleDecode(d.traffic, S.traffic);
  if (d.poll) rleDecode(d.poll, S.poll);
  if (d.crime) rleDecode(d.crime, S.crime);
  if (d.lval) rleDecode(d.lval, S.lval);
  if (d.pcov) rleDecode(d.pcov, S.pcov);
  if (d.fcov) rleDecode(d.fcov, S.fcov);
  if (d.hcov) rleDecode(d.hcov, S.hcov);
  if (d.ecov) rleDecode(d.ecov, S.ecov);
  S.funds = d.funds; S.year = d.year; S.month = d.month; S.step = d.step || 0;
  S.tickCount = d.tickCount || 0;
  S.tax = d.tax; S.fund = d.fund; S.bonds = d.bonds || 0; S.demand = d.demand;
  S.pop = d.pop || 0; S.jobs = d.jobs || 0;
  S.disasters = d.disasters || [];
  S.autoDisasters = d.autoDisasters !== false;
  S.history = d.history || [];
  S.lastCash = d.lastCash || { tax: 0, maint: 0, bond: 0 };
  S.rngState = d.rngState >>> 0;
  return S;
}

/* ---------- networking ---------- */
const PLAYER_COLORS = ['#ff5d5d', '#4dc3ff', '#ffd23f', '#7dff8a', '#ff8af1', '#ffa04d', '#a48aff', '#6affd8'];

const Net = {
  mode: 'solo',            // 'solo' | 'host' | 'guest'
  peer: null,
  conns: [],               // host: guest connections; guest: [hostConn]
  players: [],             // {id, name, color}
  myId: 'me', myName: 'Mayor',
  room: '',
  status: '',
  cursors: new Map(),      // id -> {x, y, name, color, t}
  onStateReplaced: null,   // cb(newS) — guest got a sync
  onChat: null,            // cb(from, msg, color)
  onStatus: null,          // cb(text)
  onPlayers: null,         // cb(players)
  _cursorTimer: 0,
};

function netSetStatus(s) { Net.status = s; if (Net.onStatus) Net.onStatus(s); }

function makeRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

const PEER_PREFIX = 'micropolis2k-v1-';

function netHost(name, onReady, onFail) {
  Net.myName = name || 'Mayor';
  Net.room = makeRoomCode();
  netSetStatus('Creating room…');
  const peer = new Peer(PEER_PREFIX + Net.room, { debug: 1 });
  Net.peer = peer;
  peer.on('open', (id) => {
    Net.mode = 'host';
    Net.myId = id;
    Net.players = [{ id, name: Net.myName, color: PLAYER_COLORS[0] }];
    netSetStatus('Hosting room ' + Net.room);
    if (Net.onPlayers) Net.onPlayers(Net.players);
    onReady(Net.room);
  });
  peer.on('connection', (conn) => {
    conn.on('open', () => {
      Net.conns.push(conn);
    });
    conn.on('data', (m) => hostHandle(conn, m));
    conn.on('close', () => {
      Net.conns = Net.conns.filter(c => c !== conn);
      const p = Net.players.find(p => p.id === conn.peer);
      Net.players = Net.players.filter(p => p.id !== conn.peer);
      Net.cursors.delete(conn.peer);
      hostBroadcast({ t: 'players', players: Net.players });
      if (Net.onPlayers) Net.onPlayers(Net.players);
      if (p && Net.onChat) Net.onChat('', p.name + ' left the city.', '#aaa');
    });
  });
  peer.on('error', (e) => {
    if (Net.mode !== 'host') { if (onFail) onFail(e.type || String(e)); }
    netSetStatus('Network error: ' + (e.type || e));
  });
}

function netJoin(room, name, onFail) {
  Net.myName = name || 'Visitor';
  Net.room = room.toUpperCase().trim();
  netSetStatus('Connecting to room ' + Net.room + '…');
  const peer = new Peer({ debug: 1 });
  Net.peer = peer;
  peer.on('open', (id) => {
    Net.myId = id;
    const conn = peer.connect(PEER_PREFIX + Net.room, { reliable: true });
    Net.conns = [conn];
    let opened = false;
    conn.on('open', () => {
      opened = true;
      Net.mode = 'guest';
      conn.send({ t: 'hello', name: Net.myName });
      netSetStatus('Connected! Waiting for city data…');
    });
    conn.on('data', (m) => guestHandle(m));
    conn.on('close', () => {
      netSetStatus('Disconnected from host.');
      if (Net.onChat) Net.onChat('', 'Connection to the host was lost.', '#f66');
      Net.mode = 'solo';
    });
    setTimeout(() => { if (!opened && Net.mode !== 'guest') { if (onFail) onFail('timeout'); } }, 12000);
  });
  peer.on('error', (e) => {
    if (e.type === 'peer-unavailable') { if (onFail) onFail('Room not found. Check the code.'); }
    else if (Net.mode !== 'guest' && onFail) onFail(e.type || String(e));
    netSetStatus('Network error: ' + (e.type || e));
  });
}

function hostBroadcast(m, except) {
  for (const c of Net.conns) if (c !== except && c.open) c.send(m);
}

function hostHandle(conn, m) {
  const G = window.GAME;
  switch (m.t) {
    case 'hello': {
      const color = PLAYER_COLORS[Net.players.length % PLAYER_COLORS.length];
      Net.players.push({ id: conn.peer, name: m.name, color });
      conn.send({ t: 'welcome', you: conn.peer, state: serializeState(G.S), players: Net.players, room: Net.room, speed: G.speed });
      hostBroadcast({ t: 'players', players: Net.players }, conn);
      if (Net.onPlayers) Net.onPlayers(Net.players);
      if (Net.onChat) Net.onChat('', m.name + ' joined the city!', '#8f8');
      hostBroadcast({ t: 'news', msg: '👋 ' + m.name + ' joined the city!', cls: 'good' });
      news('👋 ' + m.name + ' joined the city!', 'good');
      break;
    }
    case 'act': {
      if (applyAction(G.S, m.act)) {
        hostBroadcast({ t: 'act', act: m.act }, null); // echo to everyone incl. sender for order consistency
      }
      break;
    }
    case 'cursor': {
      const p = Net.players.find(p => p.id === conn.peer);
      if (p) {
        Net.cursors.set(conn.peer, { x: m.x, y: m.y, name: p.name, color: p.color, t: Date.now() });
        hostBroadcast({ t: 'cursor', id: conn.peer, x: m.x, y: m.y, name: p.name, color: p.color }, conn);
      }
      break;
    }
    case 'chat': {
      const p = Net.players.find(p => p.id === conn.peer);
      const nm = p ? p.name : '???', col = p ? p.color : '#fff';
      if (Net.onChat) Net.onChat(nm, m.msg, col);
      hostBroadcast({ t: 'chat', from: nm, msg: m.msg, color: col });
      break;
    }
  }
}

function guestHandle(m) {
  const G = window.GAME;
  switch (m.t) {
    case 'welcome': {
      G.replaceState(deserializeState(m.state));
      Net.players = m.players;
      if (Net.onPlayers) Net.onPlayers(Net.players);
      netSetStatus('Playing in room ' + Net.room);
      break;
    }
    case 'sync': {
      G.replaceState(deserializeState(m.state));
      break;
    }
    case 'act':
      applyAction(G.S, m.act);
      break;
    case 'players':
      Net.players = m.players;
      if (Net.onPlayers) Net.onPlayers(Net.players);
      break;
    case 'chat':
      if (Net.onChat) Net.onChat(m.from, m.msg, m.color);
      break;
    case 'news':
      news(m.msg, m.cls);
      break;
    case 'cursor':
      Net.cursors.set(m.id, { x: m.x, y: m.y, name: m.name, color: m.color, t: Date.now() });
      break;
  }
}

// Called by the game when the local player performs an action.
// Returns true if it was applied locally (solo/host) or sent (guest).
function netAction(act) {
  const G = window.GAME;
  if (Net.mode === 'guest') {
    // optimistic local apply + send to host (host echo keeps order; sync corrects drift)
    applyAction(G.S, act);
    if (Net.conns[0] && Net.conns[0].open) Net.conns[0].send({ t: 'act', act });
    return true;
  }
  const ok = applyAction(G.S, act);
  if (ok && Net.mode === 'host') hostBroadcast({ t: 'act', act });
  return ok;
}

function netSendChat(msg) {
  if (Net.mode === 'guest') {
    if (Net.conns[0] && Net.conns[0].open) Net.conns[0].send({ t: 'chat', msg });
  } else if (Net.mode === 'host') {
    if (Net.onChat) Net.onChat(Net.myName, msg, PLAYER_COLORS[0]);
    hostBroadcast({ t: 'chat', from: Net.myName, msg, color: PLAYER_COLORS[0] });
  } else {
    if (Net.onChat) Net.onChat(Net.myName, msg, PLAYER_COLORS[0]);
  }
}

function netSendCursor(x, y) {
  const now = Date.now();
  if (now - Net._cursorTimer < 150) return;
  Net._cursorTimer = now;
  if (Net.mode === 'guest') {
    if (Net.conns[0] && Net.conns[0].open) Net.conns[0].send({ t: 'cursor', x, y });
  } else if (Net.mode === 'host') {
    const me = Net.players[0];
    if (me) hostBroadcast({ t: 'cursor', id: Net.myId, x, y, name: me.name, color: me.color });
  }
}

// host: periodic authoritative sync + news relay (call every frame)
let _lastSync = 0;
function netTick(nowMs) {
  if (Net.mode === 'host' && Net.conns.length) {
    if (nowMs - _lastSync > 6000) {
      _lastSync = nowMs;
      hostBroadcast({ t: 'sync', state: serializeState(window.GAME.S), speed: window.GAME.speed });
    }
  }
  // expire stale cursors
  for (const [id, c] of Net.cursors) if (Date.now() - c.t > 6000) Net.cursors.delete(id);
}

// host: relay a news item generated by the simulation
function netRelayNews(item) {
  if (Net.mode === 'host') hostBroadcast({ t: 'news', msg: item.msg, cls: item.cls });
}
