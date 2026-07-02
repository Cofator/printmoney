import { TILE, UNITS, BUILDINGS, defOf, isBuilding } from '../game/config.js';

export class Input {
  constructor(ctx) {
    // ctx: { canvas, camera, model, renderer, hud, dispatch, localPlayerId, controllable }
    Object.assign(this, ctx);
    this.keys = new Set();
    this.mouse = { x: -1, y: -1, down: false, dragStart: null, moved: false };
    this.edgePan = true;
    this.bind();
  }

  sel() { return this.renderer.selection; }

  bind() {
    const c = this.canvas;
    c.addEventListener('mousedown', e => this.onDown(e));
    window.addEventListener('mouseup', e => this.onUp(e));
    window.addEventListener('mousemove', e => this.onMove(e));
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    c.addEventListener('dblclick', e => this.onDblClick(e));
    window.addEventListener('keydown', e => this.onKey(e, true));
    window.addEventListener('keyup', e => this.onKey(e, false));
    // touch básico (arrastar move a câmera)
    c.addEventListener('touchstart', e => this.onTouch(e), { passive: false });
    c.addEventListener('touchmove', e => this.onTouch(e), { passive: false });
  }

  screenPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onDown(e) {
    const p = this.screenPos(e);
    this.mouse.moved = false;
    if (e.button === 0) {
      if (this.renderer.placement) { this.tryPlace(p); return; }
      this.mouse.down = true;
      this.mouse.dragStart = p;
      this.renderer.dragBox = null;
    } else if (e.button === 2) {
      this.rightCommand(p, e.shiftKey);
    }
  }

  onMove(e) {
    const p = this.screenPos(e);
    this.mouse.x = p.x; this.mouse.y = p.y;
    if (this.renderer.placement) {
      const w = this.camera.toWorld(p.x, p.y);
      const def = BUILDINGS[this.renderer.placement.type];
      let tx = Math.floor(w.x / TILE) - (def.size >> 1);
      let ty = Math.floor(w.y / TILE) - (def.size >> 1);
      this.renderer.placement.tx = tx; this.renderer.placement.ty = ty;
      this.renderer.placement.valid = this.model.sim
        ? this.model.sim.canPlace(tx, ty, def.size)
        : this.localCanPlace(tx, ty, def.size);
    }
    if (this.mouse.down && this.mouse.dragStart) {
      const dx = p.x - this.mouse.dragStart.x, dy = p.y - this.mouse.dragStart.y;
      if (Math.hypot(dx, dy) > 5) {
        this.mouse.moved = true;
        this.renderer.dragBox = { x0: this.mouse.dragStart.x, y0: this.mouse.dragStart.y, x1: p.x, y1: p.y };
      }
    }
  }

  onUp(e) {
    if (e.button !== 0 || !this.mouse.down) { this.mouse.down = false; return; }
    this.mouse.down = false;
    const p = this.screenPos(e);
    if (this.mouse.moved && this.renderer.dragBox) {
      this.boxSelect(this.renderer.dragBox, e.shiftKey);
      this.renderer.dragBox = null;
    } else {
      this.clickSelect(p, e.shiftKey);
    }
    this.hud.refreshSelection();
  }

  onDblClick(e) {
    const p = this.screenPos(e);
    const w = this.camera.toWorld(p.x, p.y);
    const hit = this.pick(w.x, w.y);
    if (hit && hit.owner === this.localPlayerId && !hit.building) {
      // seleciona todas do mesmo tipo na tela
      this.sel().clear();
      const cam = this.camera;
      for (const en of this.model.entities()) {
        if (en.owner !== this.localPlayerId || en.type !== hit.type || en.building) continue;
        const s = cam.toScreen(en.x, en.y);
        if (s.x >= 0 && s.y >= 0 && s.x <= cam.vw && s.y <= cam.vh) this.sel().add(en.id);
      }
      this.hud.refreshSelection();
    }
  }

  onWheel(e) {
    e.preventDefault();
    const p = this.screenPos(e);
    this.camera.zoomAt(p.x, p.y, e.deltaY < 0 ? 1.12 : 0.89);
  }

  onKey(e, down) {
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (!down) return;
    if (k === 'escape') { this.renderer.placement = null; this.sel().clear(); this.hud.refreshSelection(); }
    if (k === 'h') this.centerOnTC();
    if (k === 'delete' || k === 'backspace') {
      if (this.sel().size) { this.dispatch({ type: 'delete', owner: this.localPlayerId, ids: [...this.sel()] });
        this.sel().clear(); this.hud.refreshSelection(); }
    }
    if (k === '+' || k === '=') this.camera.zoomAt(this.camera.vw/2, this.camera.vh/2, 1.15);
    if (k === '-') this.camera.zoomAt(this.camera.vw/2, this.camera.vh/2, 0.87);
    // grupos de controle 1-9
    if (/^[1-9]$/.test(k)) {
      if (e.ctrlKey) { this.groups = this.groups || {}; this.groups[k] = [...this.sel()]; }
      else if (this.groups && this.groups[k]) {
        this.sel().clear();
        for (const id of this.groups[k]) if (this.model.getEntity(id)) this.sel().add(id);
        this.hud.refreshSelection();
      }
    }
  }

  onTouch(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const p = { x: t.clientX, y: t.clientY };
      if (this._lastTouch) this.camera.pan(this._lastTouch.x - p.x, this._lastTouch.y - p.y);
      this._lastTouch = p;
    }
    if (e.type === 'touchend' || e.touches.length === 0) this._lastTouch = null;
  }

  updateCamera(dt) {
    const speed = 620 * dt;
    let dx = 0, dy = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= speed;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += speed;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= speed;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy += speed;
    // borda da tela
    if (this.edgePan && this.mouse.x >= 0) {
      const m = 18;
      if (this.mouse.x < m) dx -= speed;
      else if (this.mouse.x > this.camera.vw - m) dx += speed;
      if (this.mouse.y < m + 44) { if (this.mouse.y < m) dy -= speed; }
      else if (this.mouse.y > this.camera.vh - m) dy += speed;
    }
    if (dx || dy) this.camera.pan(dx, dy);
  }

  centerOnTC() {
    for (const e of this.model.entities()) {
      if (e.owner === this.localPlayerId && e.type === 'town_center') {
        this.camera.centerOn(e.x, e.y); return;
      }
    }
  }

  // ---------- seleção ----------
  pick(wx, wy) {
    let best = null, bestD = Infinity;
    for (const e of this.model.entities()) {
      if (e.building) {
        if (wx >= e.bx*TILE && wx <= (e.bx+defOf(e.type).size)*TILE &&
            wy >= e.by*TILE && wy <= (e.by+defOf(e.type).size)*TILE) {
          // prioriza edifício sob o cursor
          return e;
        }
      } else {
        // tolerância maior em perspectiva 3D: o corpo visível fica "acima"
        // do ponto no chão, então aceita cliques um pouco ao sul da base
        const d = Math.min(
          (e.x-wx)**2 + (e.y-wy)**2,
          (e.x-wx)**2 + (e.y-(wy-10))**2);
        if (d < (TILE*0.8)**2 && d < bestD) { bestD = d; best = e; }
      }
    }
    return best;
  }

  clickSelect(p, additive) {
    const w = this.camera.toWorld(p.x, p.y);
    const hit = this.pick(w.x, w.y);
    if (!additive) this.sel().clear();
    if (hit) {
      if (additive && this.sel().has(hit.id)) this.sel().delete(hit.id);
      else this.sel().add(hit.id);
    }
  }

  boxSelect(box, additive) {
    if (!additive) this.sel().clear();
    const x0 = Math.min(box.x0, box.x1), y0 = Math.min(box.y0, box.y1);
    const x1 = Math.max(box.x0, box.x1), y1 = Math.max(box.y0, box.y1);
    let anyUnit = false;
    const picked = [];
    for (const e of this.model.entities()) {
      if (e.building) continue;
      const s = this.camera.toScreen(e.x, e.y);
      if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) {
        picked.push(e); if (e.owner === this.localPlayerId) anyUnit = true;
      }
    }
    // se houver unidades próprias na caixa, seleciona só as próprias
    for (const e of picked) {
      if (anyUnit && e.owner !== this.localPlayerId) continue;
      this.sel().add(e.id);
    }
    // se nada selecionado por caixa, tenta edifício
    if (this.sel().size === 0) {
      const w0 = this.camera.toWorld(x0, y0);
      const hit = this.pick(w0.x, w0.y);
      if (hit) this.sel().add(hit.id);
    }
  }

  selectedOwn() {
    const out = [];
    for (const id of this.sel()) {
      const e = this.model.getEntity(id);
      if (e && e.owner === this.localPlayerId) out.push(e);
    }
    return out;
  }

  // ---------- comandos com botão direito ----------
  rightCommand(p, shift) {
    if (this.renderer.placement) { this.renderer.placement = null; return; }
    const own = this.selectedOwn();
    if (!own.length) return;
    const w = this.camera.toWorld(p.x, p.y);
    const units = own.filter(e => e.unit);
    // se apenas edifícios selecionados → definir ponto de encontro
    if (!units.length) {
      for (const b of own) if (b.building) this.dispatch({ type:'rally', owner:this.localPlayerId, buildingId:b.id, x:w.x, y:w.y });
      return;
    }
    const ids = units.map(e => e.id);
    const target = this.pick(w.x, w.y);
    // inimigo → atacar
    if (target && target.owner !== this.localPlayerId && target.owner != null) {
      this.dispatch({ type: 'attack', owner: this.localPlayerId, ids, targetId: target.id });
      this.hud.flashPing(p, 'attack'); return;
    }
    // recurso → coletar (nó sob o cursor)
    const node = this.pickNode(w.x, w.y);
    if (node && units.some(u => u.type === 'villager')) {
      this.dispatch({ type: 'gather', owner: this.localPlayerId, ids, nodeId: node.id });
      this.hud.flashPing(p, 'gather'); return;
    }
    // caso contrário → mover
    this.dispatch({ type: 'move', owner: this.localPlayerId, ids, x: w.x, y: w.y, attackMove: shift });
    this.hud.flashPing(p, 'move');
  }

  pickNode(wx, wy) {
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    let best = null, bestD = Infinity;
    for (const n of this.model.nodes()) {
      const d = (n.x-tx)**2 + (n.y-ty)**2;
      if (d <= 2 && d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  // ---------- colocação de edifício ----------
  startPlacement(type) { this.renderer.placement = { type, tx: 0, ty: 0, valid: false }; }
  localCanPlace(tx, ty, size) {
    // versão cliente: usa terreno + nós conhecidos (aproximação; host valida de verdade)
    for (let y=ty;y<ty+size;y++) for (let x=tx;x<tx+size;x++){
      if (x<0||y<0||x>=this.model.W||y>=this.model.H) return false;
      if (this.model.terrain[y*this.model.W+x] === 1) return false;
    }
    return true;
  }
  tryPlace(p) {
    const pl = this.renderer.placement;
    if (!pl) return;
    if (pl.valid) {
      const builders = this.selectedOwn().filter(e => e.type === 'villager').map(e => e.id);
      this.dispatch({ type: 'build', owner: this.localPlayerId, buildingType: pl.type,
        tx: pl.tx, ty: pl.ty, ids: builders });
      if (!this.keys.has('shift')) this.renderer.placement = null;
    }
  }
}
