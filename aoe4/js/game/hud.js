import { TILE, UNITS, BUILDINGS, RES, AGES, PLAYER_COLORS, defOf } from './config.js';
import { TERRAIN } from './world.js';

const RES_ICON = { food:'🍖', wood:'🪵', gold:'🪙', stone:'🪨' };

export class HUD {
  constructor(ctx) {
    // ctx: { model, camera, renderer, input, dispatch, localPlayerId }
    Object.assign(this, ctx);
    this.el = {
      food: document.getElementById('res-food'),
      wood: document.getElementById('res-wood'),
      gold: document.getElementById('res-gold'),
      stone: document.getElementById('res-stone'),
      pop: document.getElementById('res-pop'),
      age: document.getElementById('res-age'),
      clock: document.getElementById('game-clock'),
      portrait: document.getElementById('portrait'),
      selDetails: document.getElementById('sel-details'),
      card: document.getElementById('command-card'),
      toast: document.getElementById('toast'),
      minimap: document.getElementById('minimap'),
    };
    this.mmCtx = this.el.minimap.getContext('2d');
    this.tip = null;
    this.pings = [];
    this.bindMinimap();
  }

  update(now) {
    const p = this.model.localPlayer;
    const r = p.r || p.res;
    this.el.food.textContent = Math.floor(r.food);
    this.el.wood.textContent = Math.floor(r.wood);
    this.el.gold.textContent = Math.floor(r.gold);
    this.el.stone.textContent = Math.floor(r.stone);
    const pc = p.pc ?? p.popCap, pu = p.pu ?? p.popUsed;
    this.el.pop.textContent = `${pu}/${pc}`;
    const age = p.a ?? p.age;
    const ar = p.ar ?? (p.ageResearch ? Math.round(p.ageResearch.progress/p.ageResearch.total*100) : null);
    this.el.age.textContent = AGES[age].name + (ar != null ? ` (${ar}%)` : '');
    const secs = Math.floor(this.model.tick / 20);
    this.el.clock.textContent = `${String(Math.floor(secs/60)).padStart(2,'0')}:${String(secs%60).padStart(2,'0')}`;
    this.drawMinimap();
    this.updatePings(now);
  }

  // ---------- painel de seleção + cartão de comandos ----------
  refreshSelection() {
    const sel = [...this.input.selectedOwn()];
    const card = this.el.card;
    card.innerHTML = '';
    if (!sel.length) {
      this.el.portrait.textContent = '';
      this.el.selDetails.innerHTML = '<span style="color:#8a7454">Nada selecionado.<br>Clique numa unidade ou edifício.</span>';
      return;
    }
    // agrupa por tipo
    const byType = {};
    for (const e of sel) (byType[e.type] = byType[e.type] || []).push(e);
    const lead = sel[0];
    const def = defOf(lead.type);
    this.el.portrait.textContent = def.icon;
    // detalhes
    if (sel.length === 1) {
      const maxHp = def.hp;
      const hpPct = Math.max(0, Math.min(100, lead.hp / maxHp * 100));
      let extra = '';
      if (lead.unit && UNITS[lead.type].attack) {
        const a = UNITS[lead.type].attack;
        extra = `<div>⚔️ Dano ${a.damage} • Alcance ${a.range}</div>`;
      }
      if (lead.building && !lead.constructed)
        extra += `<div>🚧 Construção: ${Math.floor(lead.buildProgress*100)}%</div>`;
      if (lead.building && lead.queue && lead.queue.length)
        extra += `<div>⏳ Fila: ${lead.queue.length}</div>`;
      this.el.selDetails.innerHTML =
        `<div class="sel-name">${def.name}</div>
         <div>❤️ ${Math.ceil(lead.hp)}/${maxHp}</div>
         <div class="hpbar"><div style="width:${hpPct}%"></div></div>${extra}`;
    } else {
      const parts = Object.entries(byType).map(([t, arr]) => `${defOf(t).icon}×${arr.length}`);
      this.el.selDetails.innerHTML =
        `<div class="sel-name">${sel.length} selecionados</div><div>${parts.join('  ')}</div>`;
    }
    this.buildCommandCard(sel, byType);
  }

  buildCommandCard(sel, byType) {
    const card = this.el.card;
    const p = this.model.localPlayer;
    const age = p.a ?? p.age;
    const hasVillager = !!byType['villager'];
    const buildings = sel.filter(e => e.building);
    const anyUnit = sel.some(e => e.unit);

    // Aldeões: menu de construção
    if (hasVillager) {
      for (const [type, bd] of Object.entries(BUILDINGS)) {
        if (bd.unique) continue; // TC não é construível manualmente aqui? permitir sim:
      }
      const buildable = ['house','mill','lumber_camp','mining_camp','barracks','archery','stable','tower','town_center'];
      for (const type of buildable) {
        const bd = BUILDINGS[type];
        const locked = bd.age > age;
        this.addCmd(card, bd.icon, bd.name, bd.cost, locked, () => {
          this.input.startPlacement(type);
        }, this.tipBuilding(type));
      }
    }

    // Edifícios: treino, pesquisa de era, ponto de encontro
    for (const b of buildings) {
      const bd = BUILDINGS[b.type];
      if (!b.constructed) continue;
      if (bd.trains) {
        for (const ut of bd.trains) {
          const ud = UNITS[ut];
          const locked = ud.age > age;
          const qCount = b.queue ? b.queue.filter(q => q.type === ut).length : 0;
          this.addCmd(card, ud.icon, ud.name, ud.cost, locked, () => {
            this.dispatch({ type:'train', owner:this.localPlayerId, buildingId:b.id, unitType:ut });
          }, this.tipUnit(ut), qCount);
        }
      }
      if (b.type === 'town_center') {
        const nextAge = age + 1;
        if (nextAge < AGES.length) {
          this.addCmd(card, '⬆️', 'Avançar Era', AGES[nextAge].cost, !!(p.ar ?? p.ageResearch), () => {
            this.dispatch({ type:'age', owner:this.localPlayerId, buildingId:b.id });
          }, `<span class="tip-name">Avançar para ${AGES[nextAge].name}</span>Desbloqueia novas unidades e edifícios.`);
        }
      }
      // cancelar fila
      if (b.queue && b.queue.length) {
        this.addCmd(card, '✖️', 'Cancelar', null, false, () => {
          this.dispatch({ type:'cancelTrain', owner:this.localPlayerId, buildingId:b.id });
          setTimeout(() => this.refreshSelection(), 60);
        }, '<span class="tip-name">Cancelar treino</span>Remove o último da fila e devolve recursos.');
      }
    }

    // Unidades: parar
    if (anyUnit) {
      this.addCmd(card, '🛑', 'Parar', null, false, () => {
        this.dispatch({ type:'stop', owner:this.localPlayerId, ids: sel.filter(e=>e.unit).map(e=>e.id) });
      }, '<span class="tip-name">Parar (S)</span>Interrompe as ordens atuais.');
    }
  }

  addCmd(card, icon, label, cost, locked, onClick, tipHtml, queueCount = 0) {
    const b = document.createElement('button');
    b.className = 'cmd' + (locked ? ' disabled' : '');
    b.innerHTML = `<div>${icon}</div><div class="cmd-label">${label}</div>` +
      (cost ? `<div class="cmd-cost">${Object.entries(cost).map(([r,v])=>`${RES_ICON[r]}${v}`).join(' ')}</div>` : '') +
      (queueCount ? `<div class="cmd-queue">${queueCount}</div>` : '');
    if (!locked) b.onclick = onClick;
    if (tipHtml) {
      b.onmouseenter = (e) => this.showTip(e, tipHtml + (locked ? '<br><span style="color:#c0392b">🔒 Requer era superior</span>' : ''));
      b.onmousemove = (e) => this.moveTip(e);
      b.onmouseleave = () => this.hideTip();
    }
    card.appendChild(b);
  }

  tipUnit(t) {
    const u = UNITS[t];
    let s = `<span class="tip-name">${u.icon} ${u.name}</span>`;
    if (u.attack) s += `Dano ${u.attack.damage} • Alcance ${u.attack.range} • Vida ${u.hp}<br>`;
    if (u.gather) s += `Coleta recursos e constrói.<br>`;
    if (u.bonus) s += `Bônus vs: ${Object.keys(u.bonus).join(', ')}<br>`;
    s += `Tempo: ${u.trainTime}s`;
    return s;
  }
  tipBuilding(t) {
    const b = BUILDINGS[t];
    let s = `<span class="tip-name">${b.icon} ${b.name}</span>`;
    if (b.pop) s += `+${b.pop} de população.<br>`;
    if (b.dropoff) s += `Depósito de: ${b.dropoff.join(', ')}.<br>`;
    if (b.trains) s += `Treina: ${b.trains.map(u=>UNITS[u].name).join(', ')}.<br>`;
    if (b.attack) s += `Ataca inimigos (dano ${b.attack.damage}).<br>`;
    s += `Vida ${b.hp}`;
    return s;
  }

  showTip(e, html) {
    if (!this.tip) { this.tip = document.createElement('div'); this.tip.className = 'cmd-tip'; document.body.appendChild(this.tip); }
    this.tip.innerHTML = html; this.tip.style.display = 'block'; this.moveTip(e);
  }
  moveTip(e) { if (this.tip) { this.tip.style.left = (e.clientX + 14) + 'px'; this.tip.style.top = (e.clientY - 10) + 'px'; } }
  hideTip() { if (this.tip) this.tip.style.display = 'none'; }

  // ---------- toasts ----------
  toast(text, warn = false) {
    const d = document.createElement('div');
    d.className = 'toast-msg' + (warn ? ' warn' : '');
    d.textContent = text;
    this.el.toast.appendChild(d);
    setTimeout(() => d.remove(), 3000);
  }

  flashPing(screenPos, kind) {
    const w = this.camera.toWorld(screenPos.x, screenPos.y);
    this.pings.push({ x: w.x, y: w.y, kind, t: 0 });
  }
  updatePings(now) {
    // renderizados no renderer? Simplor: desenhar aqui sobre canvas principal não dá.
    // manter curtos e desenhar via minimap/hud overlay — omitido no canvas principal.
    this.pings = this.pings.filter(p => (p.t += 0.016) < 0.5);
  }

  // ---------- minimapa ----------
  bindMinimap() {
    const mm = this.el.minimap;
    const handle = (e) => {
      const r = mm.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
      this.camera.centerOn(fx * this.model.W * TILE, fy * this.model.H * TILE);
    };
    mm.addEventListener('mousedown', (e) => { this._mmDrag = true; handle(e); });
    window.addEventListener('mousemove', (e) => { if (this._mmDrag) handle(e); });
    window.addEventListener('mouseup', () => { this._mmDrag = false; });
  }

  drawMinimap() {
    const ctx = this.mmCtx, W = this.model.W, H = this.model.H;
    const mw = this.el.minimap.width, mh = this.el.minimap.height;
    const sx = mw / W, sy = mh / H;
    ctx.fillStyle = '#0d0a06'; ctx.fillRect(0, 0, mw, mh);
    // terreno (amostrado) apenas onde explorado
    const rend = this.renderer;
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (!rend.explored[i]) continue;
      const t = this.model.terrain[i];
      ctx.fillStyle = t === TERRAIN.WATER ? '#24466e' : t === TERRAIN.DIRT ? '#5a4a2e' : '#365a2b';
      ctx.fillRect(x * sx, y * sy, Math.ceil(sx), Math.ceil(sy));
    }
    // recursos visíveis
    for (const n of this.model.nodes()) {
      if (!rend.explored[n.y * W + n.x]) continue;
      const c = n.type === 'gold' ? '#d4af37' : n.type === 'stone' ? '#9aa0a6'
        : n.type === 'tree' ? '#2e5e2a' : '#7b3f9e';
      ctx.fillStyle = c; ctx.fillRect(n.x * sx, n.y * sy, Math.ceil(sx), Math.ceil(sy));
    }
    // entidades
    for (const e of this.model.entities()) {
      const isMine = e.owner === this.localPlayerId;
      if (!isMine && !rend.isTileNearVisible(Math.floor(e.x/TILE), Math.floor(e.y/TILE))) {
        // mostra edifícios conhecidos
        if (!(e.building && rend.knownBuildings.has(e.id))) continue;
      }
      const col = PLAYER_COLORS[e.owner % PLAYER_COLORS.length].hex;
      ctx.fillStyle = col;
      const s = e.building ? 4 : 2.5;
      ctx.fillRect((e.x/TILE) * sx - s/2, (e.y/TILE) * sy - s/2, s, s);
    }
    // retângulo da câmera
    const cam = this.camera;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
    ctx.strokeRect((cam.x/TILE)*sx, (cam.y/TILE)*sy,
      (cam.vw/cam.zoom/TILE)*sx, (cam.vh/cam.zoom/TILE)*sy);
  }
}
