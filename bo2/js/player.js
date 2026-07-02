// Controlador do jogador local: física FPS, armas, viewmodel, tiro.
import * as THREE from 'three';
import { G, me, clamp, lerp } from './state.js';
import { WEAPONS } from './weapons.js';
import { sfx } from './audio.js';

const GRAV = 22, JUMP = 7.2, SPEED = 5.6, SPRINT = 1.42, CROUCH_MULT = 0.5;
const EYE = 1.62, EYE_CROUCH = 1.05, HALF = 0.38;

function overlaps(min1, max1, b) {
  return min1.x < b.max.x && max1.x > b.min.x &&
         min1.y < b.max.y && max1.y > b.min.y &&
         min1.z < b.max.z && max1.z > b.min.z;
}

// Move um AABB (pés em pos) eixo a eixo contra os colisores. Retorna flags.
export function collideMove(pos, vel, dt, half, height) {
  const res = { grounded: false, hitWall: false };
  const tryAxis = (axis, delta) => {
    pos[axis] += delta;
    const min = { x: pos.x - half, y: pos.y, z: pos.z - half };
    const max = { x: pos.x + half, y: pos.y + height, z: pos.z + half };
    for (const b of G.colliders) {
      if (!overlaps(min, max, b)) continue;
      if (delta > 0) pos[axis] = (axis === 'y' ? b.min.y - height : b.min[axis] - half) - 0.001;
      else pos[axis] = (axis === 'y' ? b.max.y : b.max[axis] + half) + 0.001;
      if (axis === 'y') { if (delta < 0) res.grounded = true; vel.y = 0; }
      else res.hitWall = true;
      min.x = pos.x - half; min.y = pos.y; min.z = pos.z - half;
      max.x = pos.x + half; max.y = pos.y + height; max.z = pos.z + half;
    }
  };
  tryAxis('x', vel.x * dt);
  tryAxis('z', vel.z * dt);
  tryAxis('y', vel.y * dt);
  if (pos.y <= 0) { pos.y = 0; if (vel.y < 0) vel.y = 0; res.grounded = true; }
  return res;
}

export class LocalPlayer {
  constructor(camera) {
    this.cam = camera;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.keys = {};
    this.mouseDown = false;
    this.crouch = false; this.ads = false; this.sprinting = false;
    this.grounded = true;
    this.slot = 'primary';
    this.inv = null;
    this.nades = 2;
    this.cooldown = 0; this.reloading = 0;
    this.recoilP = 0; this.recoilK = 0;
    this.bobT = 0; this.stepT = 0;
    this.adsLerp = 0;
    this.raycaster = new THREE.Raycaster();
    this.moving = false;
    this.buildViewmodel();
    this.bindInput();
  }

  setLoadout(primaryKey) {
    const p = WEAPONS[primaryKey], s = WEAPONS.fiveseven;
    this.inv = {
      primary:   { key: primaryKey, mag: p.mag, res: p.reserve },
      secondary: { key: 'fiveseven', mag: s.mag, res: s.reserve },
    };
    this.slot = 'primary';
    this.nades = 2;
    this.reloading = 0; this.cooldown = 0;
    this.refreshViewmodel();
  }

  get cur() { return this.inv[this.slot]; }
  get w()   { return WEAPONS[this.cur.key]; }

  // ---------- viewmodel ----------
  buildViewmodel() {
    const g = new THREE.Group();
    const poly = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
    // braços e mãos
    const sleeve = poly(0x4a5240), skin = poly(0xc9a07a);
    this.armR = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.4), sleeve);
    this.armR.position.set(0.05, -0.15, 0.28);
    this.armR.rotation.x = 0.5;
    this.handR = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.09, 0.09), skin);
    this.handR.position.set(0, -0.11, 0.1);
    this.armL = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.34), sleeve);
    this.armL.position.set(-0.09, -0.16, -0.1);
    this.armL.rotation.set(0.35, -0.5, 0);
    this.handL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.1), skin);
    // grupo da arma (reconstruído a cada troca)
    this.gunG = new THREE.Group();
    // textura radial de clarão (estrela suave, não um quadrado)
    const fcv = document.createElement('canvas');
    fcv.width = fcv.height = 64;
    const fc = fcv.getContext('2d');
    const fg = fc.createRadialGradient(32, 32, 0, 32, 32, 32);
    fg.addColorStop(0, 'rgba(255,240,190,1)');
    fg.addColorStop(0.3, 'rgba(255,190,90,0.8)');
    fg.addColorStop(1, 'rgba(255,160,40,0)');
    fc.fillStyle = fg; fc.fillRect(0, 0, 64, 64);
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.3),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(fcv), transparent: true, opacity: 0, depthWrite: false })
    );
    this.flash.position.set(0, 0.02, -0.56);
    g.add(this.gunG, this.armR, this.handR, this.armL, this.handL, this.flash);
    g.position.set(0.24, -0.22, -0.42);
    this.vm = g;
    this.cam.add(g);
  }

  // constrói o modelo da arma atual (origem no punho, cano para -z)
  buildGun(key) {
    const METAL = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.35, metalness: 0.7 });
    const POLY  = new THREE.MeshStandardMaterial({ color: 0x2e3238, roughness: 0.8, metalness: 0.1 });
    const TAN   = new THREE.MeshStandardMaterial({ color: 0x9a8a68, roughness: 0.7, metalness: 0.1 });
    const WOOD  = new THREE.MeshStandardMaterial({ color: 0x6a4a2c, roughness: 0.75 });
    const GLASS = new THREE.MeshStandardMaterial({ color: 0x3a78c8, roughness: 0.1, metalness: 0.6 });
    const G2 = new THREE.Group();
    const b = (w, h, d, x, y, z, m = METAL, rx = 0, rz = 0) => {
      const mm = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mm.position.set(x, y, z); mm.rotation.x = rx; mm.rotation.z = rz;
      G2.add(mm); return mm;
    };
    const cyl = (r, l, x, y, z, m = METAL) => {
      const mm = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 12), m);
      mm.rotation.x = Math.PI / 2;
      mm.position.set(x, y, z);
      G2.add(mm); return mm;
    };
    let muzzleZ = -0.6, handL = { x: 0, y: -0.06, z: -0.26 };
    if (key === 'm8a1') {              // bullpup futurista
      b(0.085, 0.13, 0.5, 0, 0, -0.05, POLY);
      b(0.08, 0.1, 0.2, 0, 0.005, 0.22, POLY);
      b(0.055, 0.17, 0.09, 0, -0.11, 0.17, METAL, 0.15);   // carregador atrás do punho
      cyl(0.02, 0.3, 0, 0.01, -0.42);
      b(0.05, 0.05, 0.07, 0, 0.01, -0.58);                 // quebra-chama
      b(0.075, 0.09, 0.22, 0, -0.005, -0.26, POLY);        // guarda-mão
      b(0.02, 0.035, 0.34, 0, 0.085, -0.08);               // trilho
      b(0.032, 0.05, 0.03, 0, 0.115, 0.04);                // alça de mira
      b(0.012, 0.05, 0.012, 0, 0.115, -0.24);              // maça de mira
      b(0.045, 0.11, 0.055, 0, -0.1, 0.05, POLY, 0.3);     // punho
      muzzleZ = -0.62;
    } else if (key === 'pdw57') {      // estilo P90
      b(0.095, 0.15, 0.42, 0, -0.01, -0.02, POLY);
      b(0.06, 0.05, 0.3, 0, 0.08, -0.02, METAL);           // carregador em cima
      cyl(0.018, 0.12, 0, 0.02, -0.3);
      b(0.02, 0.045, 0.14, 0, 0.125, 0.0);                 // mira
      b(0.05, 0.1, 0.06, 0, -0.115, 0.07, POLY, 0.25);     // punho
      b(0.05, 0.09, 0.05, 0, -0.11, -0.12, POLY);          // apoio frontal
      muzzleZ = -0.38; handL = { x: 0, y: -0.09, z: -0.13 };
    } else if (key === 'dsr50') {      // sniper de ferrolho
      b(0.075, 0.11, 0.45, 0, 0, -0.02, TAN);
      cyl(0.018, 0.5, 0, 0.015, -0.48);
      b(0.052, 0.052, 0.1, 0, 0.015, -0.75);               // quebra-chama
      b(0.07, 0.12, 0.22, 0, -0.01, 0.22, TAN);            // coronha
      b(0.06, 0.045, 0.14, 0, 0.075, 0.2, TAN);            // apoio de face
      cyl(0.034, 0.22, 0, 0.12, -0.03);                    // luneta
      const lens = cyl(0.03, 0.008, 0, 0.12, -0.142, GLASS);
      lens.rotation.x = Math.PI / 2;
      b(0.02, 0.05, 0.03, 0, 0.085, 0.03);                 // suporte da luneta
      b(0.02, 0.05, 0.03, 0, 0.085, -0.09);
      b(0.07, 0.02, 0.02, 0.05, 0.035, 0.08);              // ferrolho
      b(0.012, 0.16, 0.012, -0.04, -0.1, -0.55, METAL, 0, 0.35);  // bipé
      b(0.012, 0.16, 0.012, 0.04, -0.1, -0.55, METAL, 0, -0.35);
      muzzleZ = -0.8; handL = { x: 0, y: -0.05, z: -0.3 };
    } else if (key === 'r870') {       // escopeta de repetição
      b(0.07, 0.11, 0.28, 0, 0, 0.02);
      cyl(0.016, 0.42, 0, 0.03, -0.4);
      cyl(0.014, 0.34, 0, -0.025, -0.36);                  // tubo de munição
      b(0.055, 0.06, 0.15, 0, -0.025, -0.3, WOOD);         // bomba (pump)
      b(0.065, 0.11, 0.24, 0, -0.015, 0.25, WOOD, 0.08);   // coronha
      b(0.012, 0.022, 0.012, 0, 0.075, -0.58);             // massa de mira
      muzzleZ = -0.63; handL = { x: 0, y: -0.03, z: -0.3 };
    } else {                            // five-seven (pistola)
      b(0.045, 0.06, 0.24, 0, 0.03, -0.06, METAL);
      b(0.042, 0.05, 0.2, 0, -0.02, -0.04, POLY);
      b(0.04, 0.12, 0.06, 0, -0.1, 0.05, POLY, 0.25);
      b(0.01, 0.02, 0.02, 0, 0.07, 0.04);
      b(0.01, 0.02, 0.01, 0, 0.07, -0.16);
      muzzleZ = -0.22; handL = null;
    }
    return { group: G2, muzzleZ, handL };
  }

  refreshViewmodel() {
    // remove a arma anterior e monta a nova
    while (this.gunG.children.length) {
      const c = this.gunG.children.pop();
      this.gunG.remove(c);
      c.geometry?.dispose();
    }
    const { group, muzzleZ, handL } = this.buildGun(this.cur.key);
    this.gunG.add(group);
    this.flash.position.z = muzzleZ;
    const two = !!handL;
    this.armL.visible = two;
    this.handL.visible = two;
    if (two) {
      this.handL.position.set(handL.x, handL.y, handL.z);
      this.armL.position.set(handL.x - 0.09, handL.y - 0.1, handL.z + 0.14);
    }
  }

  // ---------- input ----------
  bindInput() {
    addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (G.state !== 'playing') return;
      if (e.code === 'KeyR') this.startReload();
      if (e.code === 'Digit1') this.switchSlot('primary');
      if (e.code === 'Digit2') this.switchSlot('secondary');
      if (e.code === 'KeyG') this.throwNade();
      if (e.code === 'KeyV') this.melee();
      if (e.code === 'KeyC') this.crouch = !this.crouch;
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('mousedown', (e) => {
      if (G.state !== 'playing' || document.pointerLockElement !== document.body) return;
      if (e.button === 0) { this.mouseDown = true; if (!this.w.auto) this.tryFire(); }
      if (e.button === 2) this.ads = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.ads = false;
    });
    addEventListener('mousemove', (e) => {
      if (G.state !== 'playing' || document.pointerLockElement !== document.body) return;
      const sens = 0.0022 * (this.ads ? 0.6 : 1);
      this.yaw -= e.movementX * sens;
      this.pitch = clamp(this.pitch - e.movementY * sens, -1.5, 1.5);
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
  }

  switchSlot(slot) {
    if (slot === this.slot || this.reloading > 0) return;
    this.slot = slot;
    this.cooldown = 0.35;
    this.refreshViewmodel();
    sfx.reload();
  }

  // ---------- combate ----------
  startReload() {
    const c = this.cur, w = this.w;
    if (this.reloading > 0 || c.mag >= w.mag || c.res <= 0) return;
    this.reloading = w.reloadTime;
    sfx.reload();
  }

  tryFire() {
    const p = me();
    if (!p || !p.alive || this.reloading > 0 || this.cooldown > 0 || this.sprinting) return;
    const c = this.cur, w = this.w;
    if (c.mag <= 0) { this.startReload(); return; }
    c.mag--;
    this.cooldown = 60 / w.rpm;
    const kind = w.sniper ? 'sniper' : w.pellets > 1 ? 'shotgun' : this.cur.key === 'pdw57' ? 'smg' : this.slot === 'secondary' ? 'pistol' : 'ar';
    sfx.shot(kind);
    G.hooks.shotFired?.(this.cur.key);
    // recuo
    this.recoilP += w.recoil * (this.ads ? 0.6 : 1);
    this.recoilK = 0.07;
    this.flash.material.opacity = 1;
    // dispara raio(s)
    const spread = this.ads ? w.adsSpread : w.spread * (this.moving ? 1.5 : 1) * (this.crouch ? 0.7 : 1);
    const origin = this.cam.getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < w.pellets; i++) {
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.cam.getWorldQuaternion(new THREE.Quaternion()));
      dir.x += (Math.random() - 0.5) * 2 * spread;
      dir.y += (Math.random() - 0.5) * 2 * spread;
      dir.z += (Math.random() - 0.5) * 2 * spread;
      dir.normalize();
      this.fireRay(origin, dir, w);
    }
  }

  fireRay(origin, dir, w) {
    this.raycaster.set(origin, dir);
    this.raycaster.far = 300;
    const hits = this.raycaster.intersectObjects(G.rayTargets, false);
    const myTeam = me()?.team;
    for (const h of hits) {
      const pid = h.object.userData.pid;
      if (pid === G.myId) continue;
      if (pid) {
        const victim = G.players.get(pid);
        if (!victim || !victim.alive) continue;
        if (G.mode === 'tdm' && victim.team === myTeam) continue; // sem fogo amigo
        const head = !!h.object.userData.head;
        let dmg = w.dmg * (head ? w.headMult : 1);
        if (h.distance > w.range) dmg *= 0.55;
        G.hooks.registerHit?.(pid, Math.round(dmg), head, this.cur.key);
        G.hooks.spawnTracer?.(origin, h.point, true);
        G.hooks.spawnBlood?.(h.point);
        return;
      }
      // cenário bloqueia o tiro
      G.hooks.spawnImpact?.(h.point, h.face?.normal);
      G.hooks.spawnTracer?.(origin, h.point, false);
      return;
    }
    const end = origin.clone().addScaledVector(dir, 120);
    G.hooks.spawnTracer?.(origin, end, false);
  }

  melee() {
    const p = me();
    if (!p || !p.alive || this.cooldown > 0) return;
    this.cooldown = 0.7;
    sfx.knife();
    this.recoilK = 0.15;
    const origin = this.cam.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.cam.getWorldQuaternion(new THREE.Quaternion()));
    this.raycaster.set(origin, dir);
    this.raycaster.far = 2.2;
    const hits = this.raycaster.intersectObjects(G.rayTargets, false);
    for (const h of hits) {
      const pid = h.object.userData.pid;
      if (!pid || pid === G.myId) continue;
      const victim = G.players.get(pid);
      if (!victim || !victim.alive) continue;
      if (G.mode === 'tdm' && victim.team === me().team) continue;
      G.hooks.registerHit?.(pid, 150, false, 'faca');
      G.hooks.spawnBlood?.(h.point);
      return;
    }
  }

  throwNade() {
    const p = me();
    if (!p || !p.alive || this.nades <= 0) return;
    this.nades--;
    sfx.nadeThrow();
    const origin = this.cam.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0.25, -1).applyQuaternion(this.cam.getWorldQuaternion(new THREE.Quaternion())).normalize();
    G.hooks.throwNade?.(origin, dir.multiplyScalar(14), G.myId);
  }

  respawnAt(sp) {
    this.pos.set(sp.x, sp.y, sp.z);
    this.vel.set(0, 0, 0);
    this.yaw = Math.atan2(sp.x, sp.z); // olha para o centro do mapa
    this.pitch = 0;
    const c = this.inv;
    if (c) {
      for (const s of ['primary', 'secondary']) {
        const w = WEAPONS[c[s].key];
        c[s].mag = w.mag; c[s].res = w.reserve;
      }
    }
    this.nades = 2; this.reloading = 0; this.cooldown = 0;
    this.slot = 'primary';
    this.refreshViewmodel();
  }

  // ---------- update ----------
  update(dt) {
    const p = me();
    const alive = p && p.alive && G.state === 'playing';

    // recarga
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const c = this.cur, w = this.w;
        const need = w.mag - c.mag, take = Math.min(need, c.res);
        c.mag += take; c.res -= take;
        this.reloading = 0;
        sfx.reloadEnd();
      }
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (alive && this.mouseDown && this.w.auto) this.tryFire();

    // movimento
    let ix = 0, iz = 0;
    if (alive) {
      if (this.keys.KeyW) iz -= 1;
      if (this.keys.KeyS) iz += 1;
      if (this.keys.KeyA) ix -= 1;
      if (this.keys.KeyD) ix += 1;
    }
    const wantSprint = this.keys.ShiftLeft && iz < 0 && !this.crouch && !this.ads;
    this.sprinting = wantSprint;
    const len = Math.hypot(ix, iz) || 1;
    let sp = SPEED * this.w.moveMult;
    if (wantSprint) sp *= SPRINT;
    if (this.crouch) sp *= CROUCH_MULT;
    if (this.ads) sp *= 0.6;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const vx = (ix * cos + iz * sin) / len * sp;
    const vz = (-ix * sin + iz * cos) / len * sp;
    // aceleração suave
    this.vel.x = lerp(this.vel.x, vx, Math.min(1, dt * 12));
    this.vel.z = lerp(this.vel.z, vz, Math.min(1, dt * 12));
    this.vel.y -= GRAV * dt;
    if (alive && this.keys.Space && this.grounded) {
      this.vel.y = JUMP; this.grounded = false; sfx.jump();
    }
    const height = this.crouch ? 1.2 : 1.8;
    const r = collideMove(this.pos, this.vel, dt, HALF, height);
    this.grounded = r.grounded;
    this.moving = Math.hypot(this.vel.x, this.vel.z) > 0.8;

    // passos
    if (this.moving && this.grounded && alive) {
      this.stepT -= dt * (wantSprint ? 1.5 : 1);
      if (this.stepT <= 0) { this.stepT = 0.38; sfx.step(); }
    }

    // câmera
    const eyeTarget = this.crouch ? EYE_CROUCH : EYE;
    this.eyeY = lerp(this.eyeY ?? eyeTarget, eyeTarget, Math.min(1, dt * 10));
    this.bobT += dt * (this.moving && this.grounded ? 9 : 0);
    const bob = this.moving && this.grounded ? Math.sin(this.bobT) * 0.025 : 0;
    this.cam.position.set(this.pos.x, this.pos.y + this.eyeY + bob, this.pos.z);
    this.recoilP = lerp(this.recoilP, 0, Math.min(1, dt * 8));
    this.cam.rotation.set(this.pitch + this.recoilP, this.yaw, 0, 'YXZ');

    // ADS / FOV / viewmodel
    const adsT = this.ads && alive && !this.sprinting ? 1 : 0;
    this.adsLerp = lerp(this.adsLerp, adsT, Math.min(1, dt * 12));
    const baseFov = 75;
    const zoom = this.w.zoom;
    this.cam.fov = lerp(baseFov, baseFov / zoom, this.adsLerp);
    this.cam.updateProjectionMatrix();
    this.recoilK = lerp(this.recoilK, 0, Math.min(1, dt * 10));
    const sprintTilt = this.sprinting ? 0.5 : 0;
    // recarga: arma mergulha e inclina
    const rl = this.reloading > 0 ? Math.sin(Math.min(1, 1 - this.reloading / this.w.reloadTime) * Math.PI) : 0;
    const vmx = lerp(0.24, 0, this.adsLerp);
    const vmy = lerp(-0.22, -0.166, this.adsLerp) + bob * 0.6 - rl * 0.12;
    const vmz = lerp(-0.42, -0.3, this.adsLerp) + this.recoilK;
    this.vm.position.set(vmx, vmy, vmz);
    this.vm.rotation.set(this.recoilK * 1.4 + sprintTilt * 0.4 - rl * 0.5, sprintTilt, rl * 0.3);
    // sniper: esconde arma no scope
    const scoped = this.w.sniper && this.adsLerp > 0.7;
    this.vm.visible = !scoped;
    this.flash.material.opacity = Math.max(0, this.flash.material.opacity - dt * 10);
    G.hooks.setScope?.(scoped);
  }

  getState() {
    return {
      t: 's', id: G.myId,
      p: [+this.pos.x.toFixed(2), +this.pos.y.toFixed(2), +this.pos.z.toFixed(2)],
      ry: +this.yaw.toFixed(3), rx: +this.pitch.toFixed(3),
      m: this.moving ? 1 : 0, c: this.crouch ? 1 : 0,
      w: this.cur ? this.cur.key : 'm8a1',
    };
  }
}
