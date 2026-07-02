// HUD, telas e minimapa.
import { G, me } from './state.js';
import { WEAPONS, STREAKS } from './weapons.js';

const $ = (id) => document.getElementById(id);
let el = {};
let mapCache = null;
const MM_SCALE = 160 / 72; // px por metro (mapa 64x40 com folga)

export function initUI() {
  el = {
    hud: $('hud'), menu: $('menu'), classSelect: $('classSelect'),
    deathScreen: $('deathScreen'), endScreen: $('endScreen'), pauseScreen: $('pauseScreen'),
    scoreboard: $('scoreboard'), sbBody: $('sbBody'), sbTitle: $('sbTitle'),
    ammoMag: $('ammoMag'), ammoRes: $('ammoRes'), weaponName: $('weaponName'), nades: $('nades'),
    healthFill: $('healthFill'), healthTxt: $('healthTxt'),
    scoreAlpha: $('scoreAlpha'), scoreBravo: $('scoreBravo'), matchTimer: $('matchTimer'),
    minimap: $('minimap'), uavTag: $('uavTag'),
    killfeed: $('killfeed'), streakMsg: $('streakMsg'), streakHud: $('streakHud'), centerMsg: $('centerMsg'),
    hitmarker: $('hitmarker'), dmgVignette: $('dmgVignette'), scope: $('scope'), crosshair: $('crosshair'),
    killedBy: $('killedBy'), respawnIn: $('respawnIn'),
    winnerTxt: $('winnerTxt'), endStats: $('endStats'),
    roomInfo: $('roomInfo'), roomCode: $('roomCode'), shareLink: $('shareLink'),
    menuErr: $('menuErr'),
  };
}

export function E(id) { return el[id]; }

const SCREENS = ['menu', 'classSelect', 'deathScreen', 'endScreen', 'pauseScreen'];
export function showScreen(name) {
  for (const s of SCREENS) el[s].classList.toggle('hidden', s !== name);
  el.hud.classList.toggle('hidden', !!name && name !== 'deathScreen');
}

// ---------- HUD ----------
export function updateHUD(lp) {
  const p = me();
  if (!p || !lp || !lp.inv) return;
  const c = lp.cur, w = lp.w;
  el.ammoMag.textContent = lp.reloading > 0 ? '--' : c.mag;
  el.ammoRes.textContent = '/ ' + c.res;
  el.weaponName.textContent = w.name;
  el.nades.textContent = '🧨 x' + lp.nades;
  const hp = Math.max(0, Math.round(p.hp));
  el.healthFill.style.width = hp + '%';
  el.healthFill.style.background = hp > 50 ? 'linear-gradient(90deg,#57e389,#8ff0a4)'
    : hp > 25 ? 'linear-gradient(90deg,#e5a50a,#f8c33c)' : 'linear-gradient(90deg,#c01c28,#f66151)';
  el.healthTxt.textContent = hp;
  el.dmgVignette.style.opacity = hp < 40 ? (1 - hp / 40) * 0.8 : 0;
  el.crosshair.style.display = (lp.adsLerp > 0.5) ? 'none' : 'block';
}

export function updateTopbar() {
  if (G.mode === 'tdm') {
    el.scoreAlpha.textContent = G.scores.alpha;
    el.scoreBravo.textContent = G.scores.bravo;
  } else {
    const p = me();
    let best = 0;
    for (const q of G.players.values()) if (q.id !== G.myId) best = Math.max(best, q.kills);
    el.scoreAlpha.textContent = p ? p.kills : 0;
    el.scoreBravo.textContent = best;
  }
  const t = Math.max(0, Math.ceil(G.timeLeft));
  el.matchTimer.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
}

export function setScope(on) { el.scope.style.display = on ? 'block' : 'none'; }

let hmT = null;
export function hitmarker(head) {
  el.hitmarker.classList.toggle('head', !!head);
  el.hitmarker.style.opacity = 1;
  clearTimeout(hmT);
  hmT = setTimeout(() => { el.hitmarker.style.opacity = 0; }, 90);
}

export function damageFlash() {
  el.dmgVignette.style.opacity = 0.9;
  setTimeout(() => { el.dmgVignette.style.opacity = 0; }, 250);
}

export function killfeedAdd(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  el.killfeed.prepend(d);
  while (el.killfeed.children.length > 5) el.killfeed.lastChild.remove();
  setTimeout(() => d.remove(), 6000);
}

let smT = null;
export function streakMsg(text) {
  el.streakMsg.textContent = text;
  el.streakMsg.style.opacity = 1;
  clearTimeout(smT);
  smT = setTimeout(() => { el.streakMsg.style.opacity = 0; }, 2500);
}

export function centerMsg(text) { el.centerMsg.textContent = text || ''; }

export function toast(text, dur = 3500) {
  const d = document.createElement('div');
  d.className = 'toast';
  d.textContent = text;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), dur);
}

export function updateStreakHud(streakScore, used) {
  let html = '';
  for (const s of STREAKS) {
    const ready = streakScore >= s.cost && !used[s.key];
    html += `<div class="${ready ? 'ready' : ''}">[${s.keybind}] ${s.name} ${ready ? '— PRONTO!' : `(${Math.min(streakScore, s.cost)}/${s.cost})`}</div>`;
  }
  el.streakHud.innerHTML = html;
}

// ---------- placar ----------
export function updateScoreboard() {
  el.sbTitle.textContent = G.mode === 'tdm' ? 'PLACAR — MATA-MATA EM EQUIPE' : 'PLACAR — TODOS CONTRA TODOS';
  const rows = [...G.players.values()].sort((a, b) => b.score - a.score);
  el.sbBody.innerHTML = rows.map(p => `
    <tr class="${p.id === G.myId ? 'me' : ''}">
      <td>${esc(p.name)}${p.isBot ? ' 🤖' : ''}</td>
      <td class="${p.team === 'alpha' ? 'ta' : 'tb'}">${G.mode === 'tdm' ? (p.team === 'alpha' ? 'AZUL' : 'LARANJA') : '—'}</td>
      <td>${p.score}</td><td>${p.kills}</td><td>${p.deaths}</td>
    </tr>`).join('');
}

function esc(s) { return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }

export function showScoreboard(v) { el.scoreboard.classList.toggle('hidden', !v); }

// ---------- minimapa ----------
function buildMapCache() {
  const cv = document.createElement('canvas');
  cv.width = 160; cv.height = 160;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(10,16,22,0.9)';
  c.fillRect(0, 0, 160, 160);
  c.fillStyle = '#3d4a58';
  for (const b of G.colliders) {
    const h = b.max.y - b.min.y;
    if (h < 1.2 || b.min.y > 1.5) continue; // só obstáculos relevantes
    const x = 80 + b.min.x * MM_SCALE, y = 80 + b.min.z * MM_SCALE;
    const w = (b.max.x - b.min.x) * MM_SCALE, d = (b.max.z - b.min.z) * MM_SCALE;
    c.fillRect(x, y, w, d);
  }
  mapCache = cv;
}

export function drawMinimap(lp) {
  if (!mapCache) buildMapCache();
  const c = el.minimap.getContext('2d');
  c.clearRect(0, 0, 160, 160);
  c.drawImage(mapCache, 0, 0);
  const my = me();
  if (!my) return;
  const myTeam = my.team;
  const uav = G.uavUntil[myTeam] > G.now;
  el.uavTag.style.display = uav ? 'block' : 'none';

  for (const p of G.players.values()) {
    if (p.id === G.myId || !p.alive || !p.soldier) continue;
    const friendly = G.mode === 'tdm' && p.team === myTeam;
    // inimigos aparecem com UAV ativo ou se atiraram há pouco
    const firedRecently = (G.now - (p.lastShotAt || -99)) < 2;
    if (!friendly && !uav && !firedRecently) continue;
    const x = 80 + p.soldier.pos.x * MM_SCALE, y = 80 + p.soldier.pos.z * MM_SCALE;
    c.fillStyle = friendly ? '#38b6ff' : '#ff4545';
    c.beginPath(); c.arc(x, y, 3, 0, 7); c.fill();
  }
  // seta do jogador
  const x = 80 + lp.pos.x * MM_SCALE, y = 80 + lp.pos.z * MM_SCALE;
  c.save();
  c.translate(x, y);
  c.rotate(-lp.yaw);
  c.fillStyle = '#fff';
  c.beginPath(); c.moveTo(0, -6); c.lineTo(4, 5); c.lineTo(-4, 5); c.closePath(); c.fill();
  c.restore();
}
