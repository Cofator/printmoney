// Soldado visível (jogadores remotos e bots) + IA de bot (roda apenas no host).
import * as THREE from 'three';
import { G, me, lerp, clamp } from './state.js';
import { collideMove } from './player.js';

export const TEAM_COLORS = { alpha: 0x2f7fd0, bravo: 0xd08a2f };
export const BOT_NAMES = ['Mason', 'Harper', 'Section', 'Salazar', 'Farid', 'Menendez', 'DeFalco', 'Briggs', 'Zhao', 'Karma'];

function nameSprite(text, color) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  c.font = 'bold 34px sans-serif';
  c.textAlign = 'center';
  c.fillStyle = color;
  c.strokeStyle = 'rgba(0,0,0,0.9)'; c.lineWidth = 6;
  c.strokeText(text, 128, 42);
  c.fillText(text, 128, 42);
  const tex = new THREE.CanvasTexture(cv);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(1.6, 0.4, 1);
  sp.position.y = 2.0;
  return sp;
}

export class Soldier {
  constructor(id, name, team) {
    this.id = id;
    this.group = new THREE.Group();
    const color = TEAM_COLORS[team] || 0xd08a2f;
    const uniform = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc9a07a, roughness: 0.75 });
    const vestM = new THREE.MeshStandardMaterial({ color: 0x3a4034, roughness: 0.95 });
    const boot = new THREE.MeshStandardMaterial({ color: 0x1d1d20, roughness: 0.9 });

    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.62, 0.3), uniform);
    this.torso.position.y = 1.06;
    this.vest = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.42, 0.34), vestM);
    this.vest.position.y = 1.12;
    this.belt = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.08, 0.32), dark);
    this.belt.position.y = 0.78;
    this.head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), skin);
    this.head.position.y = 1.56;
    this.visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.05), new THREE.MeshStandardMaterial({ color: 0x18242c, roughness: 0.2, metalness: 0.6 }));
    this.visor.position.set(0, 1.58, -0.15);
    this.helmet = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.34), dark);
    this.helmet.position.y = 1.72;
    this.legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.75, 0.22), dark);
    this.legR = this.legL.clone();
    this.legL.position.set(-0.14, 0.375, 0);
    this.legR.position.set(0.14, 0.375, 0);
    this.bootL = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.12, 0.3), boot);
    this.bootR = this.bootL.clone();
    this.bootL.position.set(-0.14, 0.06, -0.03);
    this.bootR.position.set(0.14, 0.06, -0.03);
    this.armL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.55, 0.13), uniform);
    this.armR = this.armL.clone();
    this.armL.position.set(-0.36, 1.05, 0);
    this.armR.position.set(0.36, 1.05, 0);
    this.gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.6), new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.5, metalness: 0.5 }));
    this.gun.position.set(0.2, 1.15, -0.35);
    this.tag = nameSprite(name, '#' + color.toString(16).padStart(6, '0'));

    this.group.add(this.torso, this.vest, this.belt, this.head, this.visor, this.helmet,
      this.legL, this.legR, this.bootL, this.bootR, this.armL, this.armR, this.gun, this.tag);
    this.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
    // partes atingíveis por tiros
    for (const part of [this.torso, this.legL, this.legR, this.armL, this.armR]) {
      part.userData = { pid: id, head: false };
      G.rayTargets.push(part);
    }
    this.head.userData = { pid: id, head: true };
    G.rayTargets.push(this.head);

    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.net = null;       // último estado de rede
    this.animT = 0;
    this.moving = false; this.crouch = false;
    this.deadT = 0;
    G.scene.add(this.group);
  }

  setNetTarget(s) { this.net = s; }

  update(dt) {
    if (this.net) {
      const k = Math.min(1, dt * 12);
      // teleporte/respawn: encaixa direto em vez de interpolar pelo mapa
      const dx = this.pos.x - this.net.p[0], dz = this.pos.z - this.net.p[2];
      if (dx * dx + dz * dz > 64) {
        this.pos.set(this.net.p[0], this.net.p[1], this.net.p[2]);
      }
      this.pos.x = lerp(this.pos.x, this.net.p[0], k);
      this.pos.y = lerp(this.pos.y, this.net.p[1], k);
      this.pos.z = lerp(this.pos.z, this.net.p[2], k);
      let dy = this.net.ry - this.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.yaw += dy * k;
      this.moving = !!this.net.m;
      this.crouch = !!this.net.c;
    }
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    // animação de pernas
    this.animT += dt * (this.moving ? 10 : 0);
    const sw = this.moving ? Math.sin(this.animT) * 0.5 : 0;
    this.legL.rotation.x = sw;
    this.legR.rotation.x = -sw;
    this.armL.rotation.x = -sw * 0.6;
    // agachar
    const squash = this.crouch ? 0.72 : 1;
    this.group.scale.y = lerp(this.group.scale.y, squash, Math.min(1, dt * 8));
    // morte: tomba e some (também esconde quem ainda não entrou em campo)
    const p = G.players.get(this.id);
    if (p && !p.alive) {
      this.deadT += dt;
      this.group.rotation.x = Math.min(Math.PI / 2, this.deadT * 5);
      this.tag.visible = false;
      this.group.visible = this.deadT < 2 && this.net !== null;
      // corpos e soldados fora de campo não podem absorver tiros nem bloquear visão
      if (!this.group.visible) this.group.position.y = -100;
    } else {
      this.deadT = 0;
      this.group.rotation.x = 0;
      this.tag.visible = true;
      this.group.visible = true;
      // nome de inimigo não atravessa paredes (só aliados têm tag em raio-x)
      const my = me();
      const friendly = G.mode === 'tdm' && my && p && p.team === my.team;
      this.tag.material.depthTest = !friendly;
    }
  }

  setVisible(v) { this.group.visible = v; }

  destroy() {
    G.scene.remove(this.group);
    G.rayTargets = G.rayTargets.filter(o => o.userData?.pid !== this.id);
  }
}

// ---------------- BOT AI (somente host) ----------------
const BOT_EYE = 1.55;

export class Bot {
  constructor(id, team) {
    this.id = id;
    this.team = team;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.wp = null;          // waypoint atual
    this.targetId = null;
    this.acquireT = 0;       // tempo com alvo na mira
    this.fireT = 0; this.burst = 0;
    this.repathT = 0;
    this.stuckT = 0;
    this.ray = new THREE.Raycaster();
    this.moving = false;
  }

  spawnAt(sp) {
    this.pos.set(sp.x, sp.y, sp.z);
    this.vel.set(0, 0, 0);
    this.wp = null; this.targetId = null; this.acquireT = 0;
  }

  eye() { return new THREE.Vector3(this.pos.x, this.pos.y + BOT_EYE, this.pos.z); }

  // primeiro objeto atingido a partir do olho na direção dada (ignora as próprias partes)
  firstHit(dir, far) {
    this.ray.set(this.eye(), dir);
    this.ray.far = far;
    const hits = this.ray.intersectObjects(G.rayTargets, false);
    for (const h of hits) {
      if (h.object.userData?.pid === this.id) continue;
      return h;
    }
    return null;
  }

  canSee(victim) {
    const vs = victim.soldier ? victim.soldier.pos : null;
    const vpos = victim.id === G.myId ? G.localPos : vs;
    if (!vpos) return null;
    const to = new THREE.Vector3(vpos.x, vpos.y + 1.2, vpos.z).sub(this.eye());
    const d = to.length();
    if (d > 48) return null;
    to.normalize();
    const h = this.firstHit(to, d + 1);
    if (h && h.object.userData?.pid === victim.id) return { dir: to, dist: d };
    return null;
  }

  update(dt, difficultySpread = 0.045) {
    const rec = G.players.get(this.id);
    if (!rec || !rec.alive) return;

    // --- escolher alvo ---
    this.repathT -= dt;
    let target = this.targetId ? G.players.get(this.targetId) : null;
    if (!target || !target.alive || (G.mode === 'tdm' && target.team === this.team)) {
      this.targetId = null; target = null;
    }
    if (!target && this.repathT <= 0) {
      let best = null, bestD = 1e9;
      for (const p of G.players.values()) {
        if (p.id === this.id || !p.alive) continue;
        if (G.mode === 'tdm' && p.team === this.team) continue;
        const pp = p.id === G.myId ? G.localPos : p.soldier?.pos;
        if (!pp) continue;
        const d = this.pos.distanceToSquared(pp);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best && this.canSee(best)) { this.targetId = best.id; this.acquireT = 0; }
    }

    let moveDir = null;
    if (target) {
      const sight = this.canSee(target);
      if (!sight) {
        this.acquireT = 0;
        if (Math.random() < dt * 0.5) this.targetId = null;
        moveDir = this.dirToWaypoint(dt, target);
      } else {
        this.acquireT += dt;
        // mira no alvo
        this.yaw = Math.atan2(-sight.dir.x, -sight.dir.z);
        // atira em rajadas após tempo de reação
        this.fireT -= dt;
        if (this.acquireT > 0.45 && this.fireT <= 0) {
          if (this.burst <= 0) { this.burst = 3 + Math.floor(Math.random() * 3); }
          this.shoot(sight, difficultySpread);
          this.burst--;
          this.fireT = this.burst > 0 ? 0.12 : 0.7;
        }
        // manter distância: avança se longe
        if (sight.dist > 22) moveDir = sight.dir.clone().setY(0).normalize();
        else if (sight.dist < 6) moveDir = sight.dir.clone().setY(0).normalize().negate();
      }
    } else {
      moveDir = this.dirToWaypoint(dt, null);
    }

    // --- física ---
    const sp = 4.6;
    if (moveDir) {
      this.vel.x = lerp(this.vel.x, moveDir.x * sp, Math.min(1, dt * 8));
      this.vel.z = lerp(this.vel.z, moveDir.z * sp, Math.min(1, dt * 8));
      if (!target) this.yaw = Math.atan2(-moveDir.x, -moveDir.z);
    } else {
      this.vel.x = lerp(this.vel.x, 0, Math.min(1, dt * 8));
      this.vel.z = lerp(this.vel.z, 0, Math.min(1, dt * 8));
    }
    this.vel.y -= 22 * dt;
    const before = this.pos.clone();
    const r = collideMove(this.pos, this.vel, dt, 0.38, 1.8);
    // pula se travou em obstáculo
    const moved = before.distanceToSquared(this.pos);
    if (moveDir && moved < (dt * dt) * 1.2) {
      this.stuckT += dt;
      if (this.stuckT > 0.3 && r.grounded) { this.vel.y = 7.2; this.stuckT = 0; }
      if (this.stuckT > 1.2) { this.wp = null; this.stuckT = 0; }
    } else this.stuckT = 0;
    this.moving = Math.hypot(this.vel.x, this.vel.z) > 0.8;

    // atualiza visual + estado de rede sintético
    if (rec.soldier) {
      rec.soldier.setNetTarget({
        p: [this.pos.x, this.pos.y, this.pos.z],
        ry: this.yaw, m: this.moving ? 1 : 0, c: 0,
      });
    }
  }

  dirToWaypoint(dt, chasing) {
    if (!this.wp || this.pos.distanceTo(new THREE.Vector3(this.wp.x, this.pos.y, this.wp.z)) < 1.6) {
      // persegue o último alvo conhecido ou patrulha aleatório
      if (chasing) {
        const pp = chasing.id === G.myId ? G.localPos : chasing.soldier?.pos;
        if (pp) { this.wp = { x: pp.x + (Math.random() - 0.5) * 4, z: pp.z + (Math.random() - 0.5) * 4 }; }
      }
      if (!this.wp || Math.random() < 0.6) {
        this.wp = G.waypoints[Math.floor(Math.random() * G.waypoints.length)];
      }
    }
    const d = new THREE.Vector3(this.wp.x - this.pos.x, 0, this.wp.z - this.pos.z);
    return d.lengthSq() > 0.01 ? d.normalize() : null;
  }

  shoot(sight, spread) {
    G.hooks.botShot?.(this.id);
    const dir = sight.dir.clone();
    dir.x += (Math.random() - 0.5) * 2 * spread;
    dir.y += (Math.random() - 0.5) * 2 * spread;
    dir.z += (Math.random() - 0.5) * 2 * spread;
    dir.normalize();
    const h = this.firstHit(dir, 120);
    const from = this.eye();
    if (h) {
      const pid = h.object.userData?.pid;
      G.hooks.spawnTracer?.(from, h.point, false);
      if (pid && pid !== this.id) {
        const victim = G.players.get(pid);
        if (victim && victim.alive && !(G.mode === 'tdm' && victim.team === this.team)) {
          const dmg = h.object.userData.head ? 30 : 19;
          G.hooks.applyDamage?.(pid, dmg, this.id, 'M8A1', !!h.object.userData.head);
          G.hooks.spawnBlood?.(h.point);
        }
      } else if (!pid) {
        G.hooks.spawnImpact?.(h.point, h.face?.normal);
      }
    } else {
      G.hooks.spawnTracer?.(from, from.clone().addScaledVector(dir, 80), false);
    }
  }
}
