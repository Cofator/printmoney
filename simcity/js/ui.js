/* ============================================================
 * Micropolis 2000 — ui.js
 * Toolbar, top bar, modals (budget / charts / disasters /
 * save / multiplayer / help), news ticker, chat, minimap.
 * ============================================================ */
'use strict';

const UI = {
  tool: TOOL_INSPECT,
  overlay: null,
  shake: 0,
  minimapMode: 'none',
  _tickerTimer: null,
};

function $(id) { return document.getElementById(id); }

/* ---------------- toolbar ---------------- */
function buildToolbar(onPick) {
  const bar = $('toolbar');
  bar.innerHTML = '';
  const ICONS = {
    [TOOL_INSPECT]: '🔍', [TOOL_DOZE]: '🚜', [TOOL_TERRA_TREE]: '🌲', [TOOL_TERRA_WATER]: '🌊', [TOOL_TERRA_LAND]: '⛰️',
    [B_ROAD]: '🛣️', [B_RAIL]: '🛤️', [B_WIRE]: '⚡', [B_RES]: '🏠', [B_COM]: '🏬', [B_IND]: '🏭',
    [B_COAL]: '🏭', [B_GAS]: '🔥', [B_NUKE]: '☢️', [B_WIND]: '🌬️', [B_SOLAR]: '☀️',
    [B_POLICE]: '🚓', [B_FIRE]: '🚒', [B_HOSP]: '🏥', [B_SCHOOL]: '🏫', [B_COLLEGE]: '🎓', [B_LIBRARY]: '📚',
    [B_PARK]: '🌳', [B_ZOO]: '🦁', [B_STADIUM]: '🏟️', [B_MARINA]: '⛵',
    [B_PUMP]: '💧', [B_WTOWER]: '🗼', [B_AIRPORT]: '✈️', [B_SEAPORT]: '🚢',
  };
  for (const grp of TOOL_GROUPS) {
    const h = document.createElement('div');
    h.className = 'tb-group';
    h.textContent = grp.name;
    bar.appendChild(h);
    for (const [tool, label, key] of grp.items) {
      const btn = document.createElement('button');
      btn.className = 'tb-btn';
      btn.dataset.tool = tool;
      const cost = toolCost(tool);
      btn.innerHTML = `<span class="tb-ico">${ICONS[tool] || '▪'}</span><span class="tb-lbl">${label}</span>` +
        (cost ? `<span class="tb-cost">$${cost}</span>` : '') +
        (key ? `<span class="tb-key">${key}</span>` : '');
      btn.title = label + (cost ? ` — $${cost}` : '');
      btn.onclick = () => onPick(tool);
      bar.appendChild(btn);
    }
  }
}

function setTool(tool) {
  UI.tool = tool;
  document.querySelectorAll('.tb-btn').forEach(b => {
    b.classList.toggle('active', String(b.dataset.tool) === String(tool));
  });
  const b = BLD[tool];
  let name;
  if (tool === TOOL_INSPECT) name = 'Inspect';
  else if (tool === TOOL_DOZE) name = 'Bulldoze ($' + DOZE_COST + ')';
  else if (tool === TOOL_TERRA_TREE) name = 'Plant Trees ($' + TREE_COST + ')';
  else if (tool === TOOL_TERRA_WATER) name = 'Dig Water ($' + WATER_COST + ')';
  else if (tool === TOOL_TERRA_LAND) name = 'Fill Land ($' + LAND_COST + ')';
  else name = b ? `${b.name} ($${b.cost})` : '?';
  $('toolname').textContent = name;
}

/* ---------------- top bar ---------------- */
function updateTopbar(S, speed) {
  $('funds').textContent = fmtMoney(S.funds);
  $('funds').classList.toggle('neg', S.funds < 0);
  $('pop').textContent = fmtNum(S.pop);
  $('date').textContent = MONTHS[S.month] + ' ' + S.year;
  for (const [k, id] of [['r', 'demR'], ['c', 'demC'], ['i', 'demI']]) {
    const v = S.demand[k];
    const el = $(id);
    el.style.height = Math.abs(v) / 2 + 'px';
    el.classList.toggle('neg', v < 0);
  }
  document.querySelectorAll('.spd').forEach(b => b.classList.toggle('active', +b.dataset.v === speed));
}

/* ---------------- news ticker ---------------- */
function pumpNews() {
  while (NEWS.length) {
    const item = NEWS.shift();
    netRelayNews(item);
    addTicker(item.msg, item.cls);
  }
}
function addTicker(msg, cls) {
  const t = $('ticker');
  const span = document.createElement('span');
  span.className = 'tick-item ' + (cls || '');
  span.textContent = msg;
  t.appendChild(span);
  while (t.children.length > 8) t.removeChild(t.firstChild);
  t.scrollLeft = t.scrollWidth;
}

/* ---------------- modals ---------------- */
function openModal(id) { closeModals(); $(id).classList.add('open'); }
function closeModals() { document.querySelectorAll('.modal').forEach(m => m.classList.remove('open')); }

/* budget */
function refreshBudget(S) {
  $('taxR').value = S.tax.r; $('taxRv').textContent = S.tax.r + '%';
  $('taxC').value = S.tax.c; $('taxCv').textContent = S.tax.c + '%';
  $('taxI').value = S.tax.i; $('taxIv').textContent = S.tax.i + '%';
  for (const k of ['police', 'fire', 'roads', 'health', 'edu']) {
    $('fund_' + k).value = S.fund[k];
    $('fund_' + k + 'v').textContent = S.fund[k] + '%';
  }
  $('cashTax').textContent = fmtMoney(S.lastCash.tax * 12) + '/yr';
  $('cashMaint').textContent = fmtMoney(-S.lastCash.maint * 12) + '/yr';
  $('cashBond').textContent = fmtMoney(-S.lastCash.bond * 12) + '/yr';
  const net = (S.lastCash.tax - S.lastCash.maint - S.lastCash.bond) * 12;
  const el = $('cashNet');
  el.textContent = fmtMoney(net) + '/yr';
  el.className = net >= 0 ? 'good' : 'bad';
  $('bondCount').textContent = `${S.bonds} bond(s) — owing ${fmtMoney(S.bonds * SIM.BOND_AMOUNT)}`;
}

function wireBudget(G) {
  const send = () => {
    netAction({ t: 'tax', r: +$('taxR').value, c: +$('taxC').value, i: +$('taxI').value });
    refreshBudget(G.S);
  };
  for (const id of ['taxR', 'taxC', 'taxI']) $(id).oninput = send;
  const sendFund = () => {
    netAction({
      t: 'fund',
      police: +$('fund_police').value, fire: +$('fund_fire').value,
      roads: +$('fund_roads').value, health: +$('fund_health').value, edu: +$('fund_edu').value,
    });
    refreshBudget(G.S);
  };
  for (const k of ['police', 'fire', 'roads', 'health', 'edu']) $('fund_' + k).oninput = sendFund;
  $('bondTake').onclick = () => { netAction({ t: 'bond', take: true }); refreshBudget(G.S); };
  $('bondRepay').onclick = () => { netAction({ t: 'bond', take: false }); refreshBudget(G.S); };
}

/* charts */
function drawCharts(S) {
  const cv = $('chartCv');
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#141c26';
  ctx.fillRect(0, 0, cv.width, cv.height);
  const hist = S.history;
  if (hist.length < 2) {
    ctx.fillStyle = '#89a';
    ctx.font = '13px sans-serif';
    ctx.fillText('Not enough data yet — let the city run for a while.', 20, 40);
    return;
  }
  const series = [
    { key: 'pop', color: '#5be07a', label: 'Population' },
    { key: 'funds', color: '#ffd23f', label: 'Funds' },
    { key: 'r', color: '#4dff88', label: 'R demand', dim: true },
    { key: 'c', color: '#4dc3ff', label: 'C demand', dim: true },
    { key: 'i', color: '#ffb84d', label: 'I demand', dim: true },
  ];
  const wpx = cv.width - 60, hpx = cv.height - 40;
  let yLeg = 18;
  for (const s of series) {
    let mn = Infinity, mx = -Infinity;
    for (const p of hist) { mn = Math.min(mn, p[s.key]); mx = Math.max(mx, p[s.key]); }
    if (mx === mn) mx = mn + 1;
    ctx.strokeStyle = s.color;
    ctx.globalAlpha = s.dim ? 0.45 : 1;
    ctx.lineWidth = s.dim ? 1 : 2;
    ctx.beginPath();
    hist.forEach((p, k) => {
      const x = 40 + k / (hist.length - 1) * wpx;
      const y = 20 + (1 - (p[s.key] - mn) / (mx - mn)) * hpx;
      k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = s.color;
    ctx.font = '11px sans-serif';
    ctx.fillText(`${s.label}: ${fmtNum(hist[hist.length - 1][s.key])}`, 44, yLeg);
    yLeg += 14;
  }
  ctx.fillStyle = '#89a';
  ctx.font = '10px sans-serif';
  ctx.fillText(`${MONTHS[hist[0].m]} ${hist[0].y}`, 40, cv.height - 6);
  const last = hist[hist.length - 1];
  ctx.fillText(`${MONTHS[last.m]} ${last.y}`, cv.width - 70, cv.height - 6);
}

/* inspect */
function showInspect(S, x, y) {
  const i = idx(x, y);
  const t = S.type[i];
  const b = BLD[t];
  const lines = [];
  let title = 'Empty land';
  if (S.terr[i] === T_WATER) title = 'Water';
  else if (S.terr[i] === T_TREE) title = 'Forest';
  else if (S.terr[i] === T_RUBBLE) title = 'Rubble';
  if (b) {
    title = b.name;
    if (b.zone) {
      lines.push('Development level: ' + S.lvl[i] + ' / ' + SIM.MAX_LVL);
      if (t === B_RES) lines.push('Residents: ' + S.lvl[i] * SIM.POP_PER_LVL[B_RES]);
      else lines.push('Jobs: ' + S.lvl[i] * SIM.POP_PER_LVL[t]);
      lines.push('Road access: ' + (S.roadOk[i] ? 'yes ✅' : 'NO ❌'));
      lines.push('Water service: ' + (S.wtr[i] ? 'yes ✅' : 'no (density capped)'));
    }
    if (b.plant) lines.push('Generates: ' + b.plant + ' MW');
    if (b.power) lines.push('Uses: ' + (b.zone ? SIM.ZONE_POWER(S.lvl[i]) : b.power) + ' MW');
    lines.push('Powered: ' + (S.pwr[i] ? 'yes ✅' : 'NO ❌'));
    if (b.maint) lines.push('Maintenance: $' + b.maint + '/yr');
  }
  if (S.fire[i]) lines.push('🔥 ON FIRE!');
  lines.push('Land value: ' + S.lval[i] + '  ·  Pollution: ' + S.poll[i]);
  lines.push('Crime: ' + S.crime[i] + '  ·  Traffic: ' + S.traffic[i]);
  $('inspTitle').textContent = title + '  (' + x + ', ' + y + ')';
  $('inspBody').innerHTML = lines.map(l => '<div>' + l + '</div>').join('');
  openModal('modal-inspect');
}

/* save / load */
const SAVE_PREFIX = 'micropolis2k.save.';
function refreshSaveSlots(S) {
  for (let k = 1; k <= 3; k++) {
    const raw = localStorage.getItem(SAVE_PREFIX + k);
    let label = 'Empty slot';
    if (raw) {
      try {
        const d = JSON.parse(raw);
        label = `${d.cityName} — ${MONTHS[d.month]} ${d.year}, pop ${fmtNum(d.pop || 0)}`;
      } catch (e) { label = 'Corrupted save'; }
    }
    $('slot' + k + 'lbl').textContent = label;
  }
}
function wireSaveLoad(G) {
  for (let k = 1; k <= 3; k++) {
    $('slot' + k + 'save').onclick = () => {
      localStorage.setItem(SAVE_PREFIX + k, JSON.stringify(serializeState(G.S)));
      refreshSaveSlots(G.S);
      addTicker('💾 City saved to slot ' + k + '.', 'good');
    };
    $('slot' + k + 'load').onclick = () => {
      const raw = localStorage.getItem(SAVE_PREFIX + k);
      if (!raw) return;
      G.replaceState(deserializeState(JSON.parse(raw)));
      closeModals();
      addTicker('📂 City loaded from slot ' + k + '.', 'good');
    };
  }
  $('exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(serializeState(G.S))], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (G.S.cityName || 'city').replace(/\W+/g, '_') + '.micropolis2k.json';
    a.click();
  };
  $('importFile').onchange = (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        G.replaceState(deserializeState(JSON.parse(rd.result)));
        closeModals();
        addTicker('📂 City imported.', 'good');
      } catch (e) { alert('Could not read that save file.'); }
    };
    rd.readAsText(f);
  };
}

/* chat */
function addChat(from, msg, color) {
  const log = $('chatlog');
  const div = document.createElement('div');
  div.className = 'chat-msg';
  if (from) {
    const nm = document.createElement('b');
    nm.style.color = color || '#fff';
    nm.textContent = from + ': ';
    div.appendChild(nm);
  } else div.style.color = color || '#aaa';
  div.appendChild(document.createTextNode(msg));
  log.appendChild(div);
  while (log.children.length > 80) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

function refreshPlayers() {
  const el = $('players');
  if (Net.mode === 'solo') { el.innerHTML = ''; $('playersBox').style.display = 'none'; return; }
  $('playersBox').style.display = '';
  el.innerHTML = Net.players.map(p =>
    `<div class="player"><span class="dot" style="background:${p.color}"></span>${p.name}${p.id === Net.myId ? ' (you)' : ''}</div>`
  ).join('');
}

/* multiplayer modal */
function wireMultiplayer(G) {
  $('mpHostBtn').onclick = () => {
    const name = $('mpName').value.trim() || 'Mayor';
    localStorage.setItem('micropolis2k.name', name);
    $('mpHostBtn').disabled = true;
    netHost(name, (room) => {
      $('mpStatus').textContent = 'Room created! Share this code or link:';
      $('mpRoomBox').style.display = '';
      $('mpRoomCode').textContent = room;
      const link = location.origin + location.pathname + '?room=' + room;
      $('mpLink').value = link;
      refreshPlayers();
      addChat('', 'You are hosting room ' + room + '. Friends can join with the code or link.', '#8f8');
      $('chatBox').style.display = '';
    }, (err) => {
      $('mpStatus').textContent = 'Could not create room: ' + err + '. Try again.';
      $('mpHostBtn').disabled = false;
    });
  };
  $('mpJoinBtn').onclick = () => {
    const code = $('mpCode').value.trim().toUpperCase();
    if (code.length < 4) { $('mpStatus').textContent = 'Enter the 5-letter room code.'; return; }
    const name = $('mpName').value.trim() || 'Visitor';
    localStorage.setItem('micropolis2k.name', name);
    $('mpStatus').textContent = 'Connecting…';
    $('mpJoinBtn').disabled = true;
    netJoin(code, name, (err) => {
      $('mpStatus').textContent = 'Could not join: ' + err;
      $('mpJoinBtn').disabled = false;
    });
  };
  $('mpCopy').onclick = () => {
    navigator.clipboard.writeText($('mpLink').value).then(() => {
      $('mpCopy').textContent = 'Copied!';
      setTimeout(() => $('mpCopy').textContent = 'Copy', 1500);
    });
  };
  Net.onChat = addChat;
  Net.onPlayers = () => refreshPlayers();
  Net.onStatus = (s) => { $('mpStatus').textContent = s; $('netStatus').textContent = Net.mode !== 'solo' ? '🌐 ' + s : ''; };
  $('chatin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const v = $('chatin').value.trim();
      if (v) netSendChat(v);
      $('chatin').value = '';
    }
    e.stopPropagation();
  });
}

/* generic wiring */
function initUI(G) {
  buildToolbar((tool) => setTool(tool));
  setTool(B_ROAD);
  wireBudget(G);
  wireSaveLoad(G);
  wireMultiplayer(G);

  document.querySelectorAll('.modal .close').forEach(b => b.onclick = closeModals);
  document.querySelectorAll('.modal').forEach(m => m.addEventListener('mousedown', (e) => { if (e.target === m) closeModals(); }));

  $('btnView').onclick = () => setViewMode(!G.mode3d);
  $('btnCycle').onclick = () => {
    R3D.cycleOn = !R3D.cycleOn;
    if (!R3D.cycleOn) R3D.dayT = 0.42; // fixed pleasant daylight
    $('btnCycle').classList.toggle('active', R3D.cycleOn);
    addTicker(R3D.cycleOn ? '🌗 Day/night cycle on.' : '☀️ Day/night cycle off (always day).', '');
  };
  $('btnCycle').classList.add('active');
  $('btnBudget').onclick = () => { refreshBudget(G.S); openModal('modal-budget'); };
  $('btnCharts').onclick = () => { drawCharts(G.S); openModal('modal-charts'); };
  $('btnDisasters').onclick = () => openModal('modal-disasters');
  $('btnSave').onclick = () => { refreshSaveSlots(G.S); openModal('modal-save'); };
  $('btnMp').onclick = () => openModal('modal-mp');
  $('btnHelp').onclick = () => openModal('modal-help');

  document.querySelectorAll('[data-disaster]').forEach(b => {
    b.onclick = () => { netAction({ t: 'disaster', kind: b.dataset.disaster }); closeModals(); };
  });
  $('autoDis').onchange = (e) => netAction({ t: 'setopt', key: 'autoDisasters', val: e.target.checked });

  document.querySelectorAll('.spd').forEach(b => {
    b.onclick = () => G.setSpeed(+b.dataset.v);
  });

  $('overlaySel').onchange = (e) => {
    UI.overlay = e.target.value === 'none' ? null : e.target.value;
    UI.minimapMode = e.target.value;
  };

  // minimap click to move camera
  const mm = $('minimap');
  const mmMove = (e) => {
    const r = mm.getBoundingClientRect();
    const wx = (e.clientX - r.left) / r.width * W;
    const wy = (e.clientY - r.top) / r.height * H;
    centerOnTile(wx, wy);
  };
  mm.addEventListener('mousedown', (e) => {
    mmMove(e);
    const mv = (ev) => mmMove(ev);
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  });

  const savedName = localStorage.getItem('micropolis2k.name');
  if (savedName) $('mpName').value = savedName;
}
