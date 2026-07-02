// Orquestrador: cena, partida, dano, streaks, granadas, efeitos e rede.
import * as THREE from 'three';
import { G, me, clamp } from './state.js';
import { buildMap } from './map.js';
import { LocalPlayer } from './player.js';
import { Soldier, Bot, BOT_NAMES } from './soldier.js';
import { WEAPONS, CLASSES, STREAKS } from './weapons.js';
import { Net, randomCode } from './net.js';
import { initAudio, sfx } from './audio.js';
import * as UI from './ui.js';

// ---------------- setup básico ----------------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 400);
scene.add(camera);
G.scene = scene; G.camera = camera; G.renderer = renderer;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

UI.initUI();
buildMap();
const player = new LocalPlayer(camera);
G.localPos = player.pos;

let bots = new Map();        // id -> Bot (somente host)
let grenades = [];
let effects = [];
let selectedClass = 'assault';
let myName = 'Soldado';
let streakScore = 0;
let streakUsed = {};
let respawnT = 0;
let sendT = 0, syncT = 0, botNetT = 0, hostSyncT = 0;
let botCounter = 0;

// ---------------- jogadores ----------------
function addPlayer(id, name, team, isBot = false) {
  if (G.players.has(id)) return G.players.get(id);
  const rec = {
    id, name, team, isBot,
    hp: 100, kills: 0, deaths: 0, score: 0,
    alive: false, lastDamageAt: -99, lastShotAt: -99,
    soldier: null,
  };
  if (id !== G.myId) rec.soldier = new Soldier(id, name, team);
  G.players.set(id, rec);
  return rec;
}

function removePlayer(id) {
  const rec = G.players.get(id);
  if (!rec) return;
  rec.soldier?.destroy();
  G.players.delete(id);
  bots.delete(id);
}

function clearAllPlayers() {
  for (const id of [...G.players.keys()]) removePlayer(id);
}

function humanCount(team) {
  let n = 0;
  for (const p of G.players.values()) if (!p.isBot && p.team === team) n++;
  return n;
}

function teamCount(team) {
  let n = 0;
  for (const p of G.players.values()) if (p.team === team) n++;
  return n;
}

function addBot(team) {
  const id = 'bot-' + (++botCounter);
  const name = BOT_NAMES[botCounter % BOT_NAMES.length];
  const rec = addPlayer(id, name, team, true);
  const bot = new Bot(id, team);
  bots.set(id, bot);
  spawnRecord(rec, bot);
  return rec;
}

function fillBots(perTeam = 4) {
  while (teamCount('alpha') < perTeam) addBot('alpha');
  while (teamCount('bravo') < perTeam) addBot('bravo');
}

// ---------------- spawn ----------------
function pickSpawn(team) {
  const list = G.mode === 'tdm' ? G.spawns[team] : G.spawns.ffa;
  let best = list[0], bestScore = -1;
  for (const sp of list) {
    let nearest = 1e9;
    for (const p of G.players.values()) {
      if (!p.alive) continue;
      if (G.mode === 'tdm' && p.team === team) continue;
      const pp = p.id === G.myId ? player.pos : p.soldier?.pos;
      if (!pp) continue;
      const d = (pp.x - sp.x) ** 2 + (pp.z - sp.z) ** 2;
      if (d < nearest) nearest = d;
    }
    const s = nearest + Math.random() * 40;
    if (s > bestScore) { bestScore = s; best = sp; }
  }
  return best;
}

function spawnRecord(rec, bot = null) {
  const sp = pickSpawn(rec.team);
  rec.alive = true; rec.hp = 100;
  if (bot) bot.spawnAt(sp);
  return sp;
}

function spawnLocal() {
  const rec = me();
  const sp = pickSpawn(rec.team);
  rec.alive = true; rec.hp = 100; rec.lastDamageAt = -99;
  streakUsed = {}; streakScore = 0;
  player.respawnAt(sp);
  G.state = 'playing';
  UI.showScreen(null);
  UI.centerMsg('');
  if (G.online) {
    if (G.isHost) G.net.broadcast({ t: 'respawned', id: G.myId, hp: 100 });
    else G.net.send({ t: 'respawn' });
  }
}

// ---------------- dano / kills (host = autoridade) ----------------
function applyDamage(victimId, dmg, byId, weaponName, head) {
  if (!G.isHost) return;
  const v = G.players.get(victimId);
  if (!v || !v.alive) return;
  v.hp -= dmg;
  v.lastDamageAt = G.now;
  if (victimId === G.myId) { UI.damageFlash(); sfx.hurt(); }
  if (G.online) {
    G.net.broadcast({ t: 'hp', id: victimId, hp: v.hp, by: byId });
  }
  if (v.hp <= 0) doKill(victimId, byId, weaponName, head);
}

function doKill(victimId, byId, weaponName, head) {
  const v = G.players.get(victimId), k = G.players.get(byId);
  if (!v) return;
  v.alive = false; v.hp = 0; v.deaths++;
  if (k && byId !== victimId) {
    k.kills++;
    k.score += head ? 150 : 100;
    if (G.mode === 'tdm') G.scores[k.team]++;
  }
  if (G.online) G.net.broadcast({ t: 'kill', victim: victimId, by: byId, wn: weaponName, head: !!head });
  onKillLocal(victimId, byId, weaponName, head);
  checkWin();
}

// efeitos locais de uma kill (roda em todos os clientes)
function onKillLocal(victimId, byId, weaponName, head) {
  const v = G.players.get(victimId), k = G.players.get(byId);
  const kn = k ? k.name : '?', vn = v ? v.name : '?';
  UI.killfeedAdd(`<b class="${byId === G.myId ? 'me' : ''}">${kn}</b> [${weaponName}${head ? ' ☠' : ''}] ${vn}`);
  if (byId === G.myId) {
    sfx.kill();
    streakScore += head ? 150 : 100;
    UI.streakMsg(head ? 'TIRO NA CABEÇA! +150' : 'INIMIGO ELIMINADO +100');
    for (const s of STREAKS) if (streakScore >= s.cost && !streakUsed[s.key]) { sfx.streakReady(); break; }
  }
  if (victimId === G.myId) {
    sfx.death();
    G.state = 'dead';
    respawnT = 5;
    UI.E('killedBy').textContent = `eliminado por ${kn} [${weaponName}]`;
    UI.showScreen('deathScreen');
  }
  UI.updateTopbar();
}

// atirador registra o acerto (qualquer cliente)
function registerHit(pid, dmg, head, weaponKey) {
  UI.hitmarker(head);
  head ? sfx.headshot() : sfx.hit();
  const wn = WEAPONS[weaponKey]?.name || weaponKey;
  if (G.isHost) applyDamage(pid, dmg, G.myId, wn, head);
  else G.net.send({ t: 'hit', target: pid, dmg, head, wn });
}

function checkWin() {
  if (!G.isHost || G.state === 'ended') return;
  let winner = null;
  if (G.mode === 'tdm') {
    if (G.scores.alpha >= G.scoreLimit) winner = 'alpha';
    else if (G.scores.bravo >= G.scoreLimit) winner = 'bravo';
  }
  if (G.timeLeft <= 0 && !winner) {
    winner = G.scores.alpha === G.scores.bravo ? 'draw' : (G.scores.alpha > G.scores.bravo ? 'alpha' : 'bravo');
  }
  if (winner) {
    if (G.online) G.net.broadcast({ t: 'end', winner });
    endMatch(winner);
  }
}

function endMatch(winner) {
  G.state = 'ended';
  document.exitPointerLock?.();
  const my = me();
  let txt, win;
  if (winner === 'draw') { txt = 'EMPATE'; win = null; }
  else { win = winner === my?.team; txt = win ? 'VITÓRIA' : 'DERROTA'; }
  UI.E('winnerTxt').textContent = txt;
  UI.E('winnerTxt').style.color = win == null ? '#ccc' : win ? '#57e389' : '#f66151';
  UI.E('endStats').textContent = `Você: ${my?.kills ?? 0} vítimas / ${my?.deaths ?? 0} mortes — Placar ${G.scores.alpha} x ${G.scores.bravo}`;
  UI.showScreen('endScreen');
  win == null ? null : win ? sfx.win() : sfx.lose();
}

// ---------------- scorestreaks ----------------
function tryStreak(key) {
  const s = STREAKS.find(x => x.key === key);
  const my = me();
  if (!s || !my || !my.alive || streakUsed[key] || streakScore < s.cost) return;
  streakUsed[key] = true;
  if (G.isHost) execStreak(key, G.myId);
  else G.net.send({ t: 'streak', kind: key });
  UI.streakMsg(s.name + ' ATIVADO!');
}

function execStreak(kind, byId) {
  if (!G.isHost) return;
  const by = G.players.get(byId);
  if (!by) return;
  if (kind === 'uav') {
    G.uavUntil[by.team] = G.now + 30;
    if (G.online) G.net.broadcast({ t: 'uav', team: by.team, until: G.uavUntil[by.team] });
    sfx.uav();
  } else if (kind === 'strike') {
    announce(`⚠ MÍSSIL HELLSTORM (${by.name})`);
    setTimeout(() => {
      sfx.explosion();
      if (G.online) G.net.broadcast({ t: 'fx', kind: 'boom' });
      for (const p of [...G.players.values()]) {
        if (!p.alive || p.id === byId || (G.mode === 'tdm' && p.team === by.team)) continue;
        const pp = p.id === G.myId ? player.pos : p.soldier?.pos;
        if (!pp) continue;
        // só atinge quem está a céu aberto
        const ray = new THREE.Raycaster(new THREE.Vector3(pp.x, pp.y + 1.7, pp.z), new THREE.Vector3(0, 1, 0), 0, 60);
        const roof = ray.intersectObjects(G.worldMeshes, false);
        if (roof.length === 0) applyDamage(p.id, 130, byId, 'HELLSTORM', false);
        spawnExplosionFx(new THREE.Vector3(pp.x, pp.y + 1, pp.z));
      }
    }, 2500);
  } else if (kind === 'dogs') {
    announce(`⚠ CÃES DE GUERRA (${by.name})`);
    let i = 0;
    for (const p of [...G.players.values()]) {
      if (!p.alive || p.id === byId || (G.mode === 'tdm' && p.team === by.team)) continue;
      i++;
      setTimeout(() => applyDamage(p.id, 105, byId, 'CÃES DE GUERRA', false), 800 * i);
    }
  }
}

function announce(text) {
  UI.streakMsg(text);
  if (G.online && G.isHost) G.net.broadcast({ t: 'announce', text });
}

// ---------------- granadas ----------------
function throwNade(origin, vel, byId, dealDamage = true) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), new THREE.MeshLambertMaterial({ color: 0x30452a }));
  mesh.position.copy(origin);
  scene.add(mesh);
  grenades.push({ pos: origin.clone(), vel: vel.clone(), fuse: 2.6, byId, mesh, dealDamage });
  if (dealDamage && G.online && byId === G.myId) {
    const m = { t: 'fx', kind: 'nade', p: origin.toArray(), v: vel.toArray(), id: G.myId };
    G.isHost ? G.net.broadcast(m) : G.net.send(m);
  }
}

function nadeOverlap(p) {
  const h = 0.12;
  for (const b of G.colliders) {
    if (p.x + h > b.min.x && p.x - h < b.max.x && p.y + h > b.min.y && p.y - h < b.max.y && p.z + h > b.min.z && p.z - h < b.max.z) return true;
  }
  return false;
}

function updateGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.vel.y -= 18 * dt;
    for (const ax of ['x', 'z', 'y']) {
      const old = g.pos[ax];
      g.pos[ax] += g.vel[ax] * dt;
      if (nadeOverlap(g.pos)) {
        g.pos[ax] = old;
        g.vel[ax] *= -0.42;
        if (Math.abs(g.vel[ax]) > 1.5) sfx.nadeBounce();
      }
    }
    if (g.pos.y < 0.11) {
      g.pos.y = 0.11;
      if (g.vel.y < -1.5) sfx.nadeBounce();
      g.vel.y *= -0.42;
      g.vel.x *= 0.72; g.vel.z *= 0.72;
    }
    g.mesh.position.copy(g.pos);
    g.fuse -= dt;
    if (g.fuse <= 0) {
      scene.remove(g.mesh);
      grenades.splice(i, 1);
      explodeNade(g);
    }
  }
}

function explodeNade(g) {
  const far = g.pos.distanceTo(player.pos) > 25;
  sfx.explosion(far);
  spawnExplosionFx(g.pos);
  if (!g.dealDamage || g.byId !== G.myId) return;
  // dono da granada calcula o dano e reporta
  const myTeam = me()?.team;
  for (const p of G.players.values()) {
    if (!p.alive) continue;
    if (G.mode === 'tdm' && p.team === myTeam && p.id !== G.myId) continue;
    const pp = p.id === G.myId ? player.pos : p.soldier?.pos;
    if (!pp) continue;
    const d = g.pos.distanceTo(new THREE.Vector3(pp.x, pp.y + 0.9, pp.z));
    if (d > 6.5) continue;
    const dmg = Math.round(115 * (1 - d / 6.5) + 15);
    if (p.id === G.myId) {
      if (G.isHost) applyDamage(G.myId, dmg, G.myId, 'GRANADA', false);
      else G.net.send({ t: 'hit', target: G.myId, dmg, head: false, wn: 'GRANADA' });
    } else {
      registerHit(p.id, dmg, false, 'GRANADA');
    }
  }
}

// ---------------- efeitos visuais ----------------
function spawnTracer(from, to, hitPlayer) {
  const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
  const mat = new THREE.LineBasicMaterial({ color: hitPlayer ? 0xffb060 : 0xffe9a0, transparent: true, opacity: 0.65 });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  effects.push({ obj: line, ttl: 0.06, max: 0.06 });
}

function spawnImpact(point, normal) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true }));
  m.position.copy(point);
  if (normal) m.position.addScaledVector(normal, 0.03);
  scene.add(m);
  effects.push({ obj: m, ttl: 0.25, max: 0.25 });
}

function spawnExplosionFx(pos) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.9 }));
  m.position.copy(pos);
  scene.add(m);
  effects.push({ obj: m, ttl: 0.45, max: 0.45, grow: 9 });
}

function spawnMuzzle(soldier) {
  const p = soldier.gun.getWorldPosition(new THREE.Vector3());
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true }));
  m.position.copy(p);
  scene.add(m);
  effects.push({ obj: m, ttl: 0.05, max: 0.05 });
}

function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.ttl -= dt;
    if (e.obj.material) e.obj.material.opacity = Math.max(0, e.ttl / e.max);
    if (e.grow) { const s = 1 + (1 - e.ttl / e.max) * e.grow; e.obj.scale.set(s, s, s); }
    if (e.ttl <= 0) {
      scene.remove(e.obj);
      e.obj.geometry?.dispose();
      e.obj.material?.dispose();
      effects.splice(i, 1);
    }
  }
}

// ---------------- hooks ----------------
G.hooks.applyDamage = applyDamage;
G.hooks.registerHit = registerHit;
G.hooks.spawnTracer = spawnTracer;
G.hooks.spawnImpact = spawnImpact;
G.hooks.throwNade = throwNade;
G.hooks.setScope = UI.setScope;
G.hooks.shotFired = (wkey) => {
  const my = me();
  if (my) my.lastShotAt = G.now;
  if (G.online) {
    const m = { t: 'fx', kind: 'shot', id: G.myId, w: wkey };
    G.isHost ? G.net.broadcast(m) : G.net.send(m);
  }
};
G.hooks.botShot = (botId) => {
  const rec = G.players.get(botId);
  if (rec) {
    rec.lastShotAt = G.now;
    if (rec.soldier) spawnMuzzle(rec.soldier);
    const d = rec.soldier ? rec.soldier.pos.distanceTo(player.pos) : 99;
    sfx.shot('ar', d > 20);
  }
  if (G.online) G.net.broadcast({ t: 'fx', kind: 'shot', id: botId, w: 'm8a1' });
};

// ---------------- rede: protocolo ----------------
function serializePlayers() {
  return [...G.players.values()].map(p => ({
    id: p.id, name: p.name, team: p.team, isBot: p.isBot,
    hp: p.hp, kills: p.kills, deaths: p.deaths, score: p.score, alive: p.alive,
  }));
}

function setupHostNet() {
  G.net.onPeerJoin = () => {}; // espera o hello
  G.net.onPeerLeave = (id) => {
    if (G.players.has(id)) {
      UI.toast(G.players.get(id).name + ' saiu da partida');
      removePlayer(id);
      G.net.broadcast({ t: 'pleave', id });
    }
  };
  G.net.onMessage = (fromId, m) => {
    switch (m.t) {
      case 'hello': {
        const team = humanCount('alpha') <= humanCount('bravo') ? 'alpha' : 'bravo';
        // remove um bot do time para dar lugar ao humano
        for (const [bid, b] of bots) {
          if (b.team === team) { removePlayer(bid); G.net.broadcast({ t: 'pleave', id: bid }); break; }
        }
        const rec = addPlayer(fromId, (m.name || 'Recruta').slice(0, 14), team);
        G.net.sendTo(fromId, {
          t: 'welcome', id: fromId, mode: G.mode, timeLeft: G.timeLeft,
          scoreLimit: G.scoreLimit, scores: G.scores, players: serializePlayers(),
        });
        G.net.broadcast({ t: 'pjoin', player: serializePlayers().find(p => p.id === fromId) }, fromId);
        UI.toast(rec.name + ' entrou na partida');
        break;
      }
      case 's': {
        const rec = G.players.get(fromId);
        if (rec?.soldier) rec.soldier.setNetTarget(m);
        G.net.broadcast({ ...m, id: fromId }, fromId);
        break;
      }
      case 'hit': applyDamage(m.target, clamp(m.dmg, 0, 160), fromId, m.wn, m.head); break;
      case 'respawn': {
        const rec = G.players.get(fromId);
        if (rec) { rec.alive = true; rec.hp = 100; G.net.broadcast({ t: 'respawned', id: fromId, hp: 100 }); }
        break;
      }
      case 'streak': execStreak(m.kind, fromId); break;
      case 'fx': handleFx({ ...m, id: fromId }); G.net.broadcast({ ...m, id: fromId }, fromId); break;
    }
  };
}

function setupClientNet() {
  G.net.onHostLost = () => {
    UI.toast('O anfitrião encerrou a partida.');
    quitToMenu();
  };
  G.net.onMessage = (_from, m) => {
    switch (m.t) {
      case 'welcome': {
        G.mode = m.mode; G.timeLeft = m.timeLeft; G.scoreLimit = m.scoreLimit;
        G.scores = m.scores;
        for (const p of m.players) {
          if (p.id === G.myId) { addPlayer(p.id, p.name, p.team); Object.assign(G.players.get(p.id), p, { soldier: null }); }
          else { const rec = addPlayer(p.id, p.name, p.team, p.isBot); Object.assign(rec, { hp: p.hp, kills: p.kills, deaths: p.deaths, score: p.score, alive: p.alive }); }
        }
        UI.E('menuErr').textContent = '';
        UI.showScreen('classSelect');
        break;
      }
      case 'pjoin': { const p = m.player; const rec = addPlayer(p.id, p.name, p.team, p.isBot); Object.assign(rec, { alive: p.alive, hp: p.hp }); UI.toast(p.name + ' entrou na partida'); break; }
      case 'pleave': removePlayer(m.id); break;
      case 's': { const rec = G.players.get(m.id); if (rec?.soldier) rec.soldier.setNetTarget(m); break; }
      case 'bots': for (const b of m.list) { const rec = G.players.get(b.id); if (rec?.soldier) rec.soldier.setNetTarget(b); } break;
      case 'hp': {
        const rec = G.players.get(m.id);
        if (rec) { rec.hp = m.hp; rec.lastDamageAt = G.now; }
        if (m.id === G.myId) { UI.damageFlash(); sfx.hurt(); }
        break;
      }
      case 'kill': {
        const v = G.players.get(m.victim), k = G.players.get(m.by);
        if (v) { v.alive = false; v.hp = 0; v.deaths++; }
        if (k && m.by !== m.victim) { k.kills++; k.score += m.head ? 150 : 100; if (G.mode === 'tdm') G.scores[k.team]++; }
        onKillLocal(m.victim, m.by, m.wn, m.head);
        break;
      }
      case 'respawned': { const rec = G.players.get(m.id); if (rec) { rec.alive = true; rec.hp = m.hp; } break; }
      case 'uav': G.uavUntil[m.team] = m.until; if (me()?.team === m.team) sfx.uav(); break;
      case 'announce': UI.streakMsg(m.text); break;
      case 'sync': {
        G.timeLeft = m.timeLeft; G.scores = m.scores;
        G.now = m.now;
        for (const p of m.players) {
          const rec = G.players.get(p.id);
          if (rec) { rec.kills = p.kills; rec.deaths = p.deaths; rec.score = p.score; rec.hp = p.hp; if (p.alive !== rec.alive && rec.id !== G.myId) rec.alive = p.alive; }
        }
        UI.updateTopbar();
        break;
      }
      case 'fx': handleFx(m); break;
      case 'end': endMatch(m.winner); break;
    }
  };
}

function handleFx(m) {
  if (m.id === G.myId) return;
  if (m.kind === 'shot') {
    const rec = G.players.get(m.id);
    if (rec) {
      rec.lastShotAt = G.now;
      if (rec.soldier) spawnMuzzle(rec.soldier);
      const w = WEAPONS[m.w];
      const kind = w?.sniper ? 'sniper' : w?.pellets > 1 ? 'shotgun' : m.w === 'pdw57' ? 'smg' : m.w === 'fiveseven' ? 'pistol' : 'ar';
      const d = rec.soldier ? rec.soldier.pos.distanceTo(player.pos) : 99;
      sfx.shot(kind, d > 20);
    }
  } else if (m.kind === 'nade') {
    throwNade(new THREE.Vector3(...m.p), new THREE.Vector3(...m.v), m.id, false);
  } else if (m.kind === 'boom') {
    sfx.explosion();
  }
}

// ---------------- fluxo de menu ----------------
function buildClassCards() {
  const wrap = document.getElementById('classCards');
  wrap.innerHTML = '';
  for (const c of CLASSES) {
    const w = WEAPONS[c.primary];
    const d = document.createElement('div');
    d.className = 'classCard' + (c.key === selectedClass ? ' sel' : '');
    d.innerHTML = `<div class="icon">${c.icon}</div><div class="wname">${c.name}</div>
      <div style="font-size:12px;color:#cde;margin-top:4px">${w.name} + FIVE-SEVEN</div>
      <div class="wdesc">${w.desc}</div>`;
    d.onclick = () => {
      selectedClass = c.key;
      [...wrap.children].forEach(x => x.classList.remove('sel'));
      d.classList.add('sel');
    };
    wrap.appendChild(d);
  }
}

function resetMatch(mode = 'tdm') {
  clearAllPlayers();
  grenades.forEach(g => scene.remove(g.mesh));
  grenades = [];
  G.mode = mode;
  G.timeLeft = 600;
  G.scores = { alpha: 0, bravo: 0 };
  G.uavUntil = { alpha: 0, bravo: 0 };
  G.now = 0;
  streakScore = 0; streakUsed = {};
  UI.updateTopbar();
}

function getName() {
  const v = document.getElementById('playerName').value.trim();
  myName = v || 'Soldado-' + Math.floor(Math.random() * 99);
  try { localStorage.setItem('bows2name', myName); } catch (_) {}
  return myName;
}

function startSolo() {
  initAudio();
  getName();
  G.online = false; G.isHost = true; G.myId = 'local'; G.net = null;
  resetMatch();
  addPlayer('local', myName, 'alpha');
  fillBots(4);
  UI.E('roomInfo').classList.add('hidden');
  UI.showScreen('classSelect');
}

function startHost() {
  initAudio();
  getName();
  const err = UI.E('menuErr');
  err.textContent = 'Criando sala…';
  const code = randomCode();
  const net = new Net();
  net.host(code, (e) => {
    if (e) { err.textContent = 'Erro ao criar sala: ' + (e.type || e.message || e); return; }
    err.textContent = '';
    G.net = net; G.online = true; G.isHost = true; G.myId = net.myId;
    resetMatch();
    addPlayer(G.myId, myName, 'alpha');
    fillBots(3);
    setupHostNet();
    UI.E('roomCode').textContent = code;
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    UI.E('shareLink').textContent = url.href;
    UI.E('shareLink').onclick = () => { navigator.clipboard?.writeText(url.href); UI.toast('Link copiado!'); };
    UI.E('roomInfo').classList.remove('hidden');
    UI.showScreen('classSelect');
  });
}

function startJoin() {
  initAudio();
  getName();
  const code = document.getElementById('joinCode').value.trim().toUpperCase();
  const err = UI.E('menuErr');
  if (code.length !== 5) { err.textContent = 'Código deve ter 5 caracteres.'; return; }
  err.textContent = 'Conectando…';
  const net = new Net();
  net.join(code, (e) => {
    if (e) { err.textContent = e.message || 'Erro de conexão.'; return; }
    G.net = net; G.online = true; G.isHost = false; G.myId = net.myId;
    resetMatch();
    setupClientNet();
    UI.E('roomCode').textContent = code;
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    UI.E('shareLink').textContent = url.href;
    UI.E('shareLink').onclick = () => { navigator.clipboard?.writeText(url.href); UI.toast('Link copiado!'); };
    UI.E('roomInfo').classList.remove('hidden');
    net.send({ t: 'hello', name: myName });
    // a tela de classe abre quando chegar o 'welcome'
  });
}

function deploy() {
  const cls = CLASSES.find(c => c.key === selectedClass);
  player.setLoadout(cls.primary);
  document.body.requestPointerLock?.();
  spawnLocal();
  UI.updateScoreboard();
}

function quitToMenu() {
  G.net?.close();
  G.net = null; G.online = false; G.isHost = true;
  clearAllPlayers();
  G.myId = 'local';
  G.state = 'menu';
  document.exitPointerLock?.();
  UI.showScreen('menu');
}

document.getElementById('btnSolo').onclick = startSolo;
document.getElementById('btnHost').onclick = startHost;
document.getElementById('btnJoin').onclick = startJoin;
document.getElementById('btnDeploy').onclick = deploy;
document.getElementById('btnBackMenu').onclick = quitToMenu;
document.getElementById('btnResume').onclick = () => {
  document.body.requestPointerLock?.();
  UI.showScreen(null);
};
document.getElementById('btnQuit').onclick = quitToMenu;
buildClassCards();

// nome salvo + código na URL
try {
  const saved = localStorage.getItem('bows2name');
  if (saved) document.getElementById('playerName').value = saved;
} catch (_) {}
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) document.getElementById('joinCode').value = roomParam.toUpperCase();

// pausa via pointer lock
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== document.body && G.state === 'playing') {
    UI.showScreen('pauseScreen');
  }
});
canvas.addEventListener('click', () => {
  if ((G.state === 'playing' || G.state === 'dead') && document.pointerLockElement !== document.body) {
    document.body.requestPointerLock?.();
  }
});

// teclas globais
addEventListener('keydown', (e) => {
  if (e.code === 'Tab' && (G.state === 'playing' || G.state === 'dead')) {
    e.preventDefault();
    UI.updateScoreboard();
    UI.showScoreboard(true);
  }
  if (G.state === 'playing') {
    if (e.code === 'Digit3') tryStreak('uav');
    if (e.code === 'Digit4') tryStreak('strike');
    if (e.code === 'Digit5') tryStreak('dogs');
  }
});
addEventListener('keyup', (e) => {
  if (e.code === 'Tab') UI.showScoreboard(false);
});

// ---------------- loop principal ----------------
const clock = new THREE.Clock();

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const inGame = G.state === 'playing' || G.state === 'dead' || G.state === 'ended';
  G.now += dt;

  if (inGame) {
    player.update(dt);
    // soldados (remotos e bots)
    for (const p of G.players.values()) p.soldier?.update(dt);
    // bots (host)
    if (G.isHost) {
      for (const b of bots.values()) b.update(dt);
      // respawn de bots
      for (const p of G.players.values()) {
        if (p.isBot && !p.alive) {
          p.respawnT = (p.respawnT ?? 5) - dt;
          if (p.respawnT <= 0) {
            p.respawnT = 5;
            spawnRecord(p, bots.get(p.id));
            if (G.online) G.net.broadcast({ t: 'respawned', id: p.id, hp: 100 });
          }
        }
      }
      // regeneração (host autoritativo)
      for (const p of G.players.values()) {
        if (p.alive && p.hp < 100 && G.now - p.lastDamageAt > 4) {
          p.hp = Math.min(100, p.hp + 35 * dt);
        }
      }
      // cronômetro
      if (G.state !== 'ended' && G.players.size > 0) {
        G.timeLeft -= dt;
        checkWin();
      }
    } else {
      // regen local só para exibição (host é a autoridade)
      const my = me();
      if (my && my.alive && my.hp < 100 && G.now - my.lastDamageAt > 4) {
        my.hp = Math.min(100, my.hp + 35 * dt);
      }
    }

    updateGrenades(dt);
    updateEffects(dt);

    // respawn local
    if (G.state === 'dead') {
      respawnT -= dt;
      UI.E('respawnIn').textContent = Math.max(1, Math.ceil(respawnT));
      if (respawnT <= 0) spawnLocal();
    }

    // HUD
    UI.updateHUD(player);
    UI.drawMinimap(player);
    UI.updateStreakHud(streakScore, streakUsed);
    if ((syncT -= dt) <= 0) { syncT = 1; UI.updateTopbar(); if (!UI.E('scoreboard').classList.contains('hidden')) UI.updateScoreboard(); }

    // rede
    if (G.online && G.net) {
      if ((sendT -= dt) <= 0) {
        sendT = 1 / 15;
        const st = player.getState();
        if (G.isHost) G.net.broadcast(st);
        else G.net.send(st);
      }
      if (G.isHost && (botNetT -= dt) <= 0) {
        botNetT = 1 / 12;
        if (bots.size) {
          G.net.broadcast({
            t: 'bots',
            list: [...bots.values()].map(b => ({
              id: b.id, p: [+b.pos.x.toFixed(2), +b.pos.y.toFixed(2), +b.pos.z.toFixed(2)],
              ry: +b.yaw.toFixed(3), m: b.moving ? 1 : 0, c: 0,
            })),
          });
        }
      }
      if (G.isHost && (hostSyncT -= dt) <= 0) {
        hostSyncT = 1;
        G.net.broadcast({ t: 'sync', timeLeft: G.timeLeft, scores: G.scores, now: G.now, players: serializePlayers() });
      }
    }
  }

  renderer.render(scene, camera);
}

UI.showScreen('menu');
tick();
