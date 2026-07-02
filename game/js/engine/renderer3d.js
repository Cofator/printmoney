// Renderizador 3D (WebGL/Three.js): terreno texturizado, edifícios e unidades
// em malhas 3D com iluminação e sombras reais. Mantém a mesma interface do
// renderizador 2D (fallback automático quando WebGL não está disponível).
import * as THREE from '../../lib/three.module.min.js';
import { TILE, UNITS, BUILDINGS, PLAYER_COLORS, defOf } from '../game/config.js';
import { TERRAIN } from '../game/world.js';
import { clamp } from './utils.js';
import { bakeTerrainCanvas } from './terrainTexture.js';

const SKIN = 0xe0ac7e, IRON = 0xc7c9cc, DARKWOOD = 0x5e4128;

// ==================== CÂMERA RTS EM PERSPECTIVA ====================
export class Camera3D {
  constructor(model) {
    this.model = model;
    this.cx = model.W * TILE / 2; this.cz = model.H * TILE / 2;
    this.zoom = 1; this.minZoom = 0.45; this.maxZoom = 3;
    this.vw = 2; this.vh = 2;
    this.cam = new THREE.PerspectiveCamera(46, 1, 8, 6000);
    this._ray = new THREE.Raycaster();
    this._v3 = new THREE.Vector3();
    this.update();
  }
  worldW() { return this.model.W * TILE; }
  worldH() { return this.model.H * TILE; }
  // compat aproximada (minimapa antigo / código legado)
  get x() { return this.cx - (this.vw / this.zoom) / 2; }
  get y() { return this.cz - (this.vh / this.zoom) / 2; }
  update() {
    const d = 560 / this.zoom;
    this.cam.position.set(this.cx, d * 0.85, this.cz + d * 0.75);
    this.cam.lookAt(this.cx, 0, this.cz);
    this.cam.updateMatrixWorld();
  }
  resize(w, h) {
    this.vw = w; this.vh = h;
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
    this.update();
  }
  clampPos() {
    this.cx = clamp(this.cx, 0, this.worldW());
    this.cz = clamp(this.cz, 0, this.worldH());
  }
  pan(dx, dy) { this.cx += dx / this.zoom; this.cz += dy / this.zoom; this.clampPos(); this.update(); }
  centerOn(wx, wy) { this.cx = wx; this.cz = wy; this.clampPos(); this.update(); }
  toWorld(sx, sy) {
    this._ray.setFromCamera({ x: (sx / this.vw) * 2 - 1, y: -(sy / this.vh) * 2 + 1 }, this.cam);
    const o = this._ray.ray.origin, d = this._ray.ray.direction;
    const t = -o.y / (d.y || -1e-6);
    return { x: o.x + d.x * t, y: o.z + d.z * t };
  }
  toScreen(wx, wy, wh = 0) {
    const v = this._v3.set(wx, wh, wy).project(this.cam);
    return { x: (v.x + 1) / 2 * this.vw, y: (-v.y + 1) / 2 * this.vh };
  }
  zoomAt(sx, sy, f) {
    const before = this.toWorld(sx, sy);
    this.zoom = clamp(this.zoom * f, this.minZoom, this.maxZoom);
    this.update();
    const after = this.toWorld(sx, sy);
    this.cx += before.x - after.x; this.cz += before.y - after.y;
    this.clampPos(); this.update();
  }
  viewRect() {
    const pts = [this.toWorld(0, 0), this.toWorld(this.vw, 0), this.toWorld(0, this.vh), this.toWorld(this.vw, this.vh)];
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
}

// ==================== RENDERIZADOR ====================
export class Renderer3D {
  constructor(canvas, model, camera) {
    this.canvas = canvas; this.model = model; this.camera = camera;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;

    this.explored = new Uint8Array(model.W * model.H);
    this.visible = new Uint8Array(model.W * model.H);
    this.knownBuildings = new Map();
    this.selection = new Set();
    this.placement = null;
    this.dragBox = null;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e120b);
    this.scene.fog = new THREE.Fog(0x10140c, 1500, 3200);

    // luzes
    this.scene.add(new THREE.HemisphereLight(0xbcd0e4, 0x3a3524, 0.75));
    this.sun = new THREE.DirectionalLight(0xffedc9, 1.75);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -560; sc.right = 560; sc.top = 560; sc.bottom = -560; sc.near = 60; sc.far = 2400;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 2.2;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // chão
    const terrainTex = new THREE.CanvasTexture(bakeTerrainCanvas(model));
    terrainTex.colorSpace = THREE.SRGBColorSpace;
    terrainTex.anisotropy = this.gl.capabilities.getMaxAnisotropy();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(camera.worldW(), camera.worldH()),
      new THREE.MeshStandardMaterial({ map: terrainTex, roughness: 0.96, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(camera.worldW() / 2, 0, camera.worldH() / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);
    const outer = new THREE.Mesh(
      new THREE.PlaneGeometry(camera.worldW() * 7, camera.worldH() * 7),
      new THREE.MeshStandardMaterial({ color: 0x151a10, roughness: 1 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(camera.worldW() / 2, -0.4, camera.worldH() / 2);
    outer.receiveShadow = true;
    this.scene.add(outer);

    // névoa de guerra (plano com textura por tile, bordas suaves via bilinear)
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = model.W; this.fogCanvas.height = model.H;
    this.fogCtx = this.fogCanvas.getContext('2d');
    this.fogImg = this.fogCtx.createImageData(model.W, model.H);
    this.fogTex = new THREE.CanvasTexture(this.fogCanvas);
    this.fogTex.magFilter = THREE.LinearFilter; this.fogTex.minFilter = THREE.LinearFilter;
    const fogPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(camera.worldW(), camera.worldH()),
      new THREE.MeshBasicMaterial({ map: this.fogTex, transparent: true, depthWrite: false }));
    fogPlane.rotation.x = -Math.PI / 2;
    fogPlane.position.set(camera.worldW() / 2, 2.2, camera.worldH() / 2);
    fogPlane.renderOrder = 500;
    this.scene.add(fogPlane);

    this.initMaterials();
    this.initNodes();

    this.bObjs = new Map();      // edifícios vivos
    this.gObjs = new Map();      // fantasmas de edifícios no fog
    this.uObjs = new Map();      // unidades
    this.protoB = new Map();
    this.protoU = new Map();
    this.protoGhost = new Map();
    this.scaffolds = new Map();
    this.rings = [];
    this.arrows = [];
    this.decoCache = new Map();
    this.ghost = null;

    // overlay 2D para barras de vida / caixa de seleção
    const old = document.getElementById('overlay3d');
    if (old) old.remove();
    this.overlay = document.createElement('canvas');
    this.overlay.id = 'overlay3d';
    Object.assign(this.overlay.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: '5',
    });
    canvas.parentElement.insertBefore(this.overlay, canvas.nextSibling);
    this.octx = this.overlay.getContext('2d');
    this._lastW = 0; this._lastH = 0;
  }

  dispose() {
    try { this.overlay.remove(); } catch (e) {}
    try { this.gl.dispose(); } catch (e) {}
  }

  // ---------------- materiais e texturas ----------------
  pattern(draw, size = 128) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  initMaterials() {
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0.02, ...o });
    const stoneTex = this.pattern((g, s) => {
      g.fillStyle = '#8d8577'; g.fillRect(0, 0, s, s);
      g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 2;
      for (let y = 0; y < s; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke(); }
      for (let y = 0, r = 0; y < s; y += 16, r++)
        for (let x = (r % 2) * 16; x < s; x += 32) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 16); g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,0.05)';
      for (let i = 0; i < 30; i++) g.fillRect(Math.random() * s, Math.random() * s, 6, 3);
    });
    const woodTex = this.pattern((g, s) => {
      g.fillStyle = '#8a6440'; g.fillRect(0, 0, s, s);
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2;
      for (let x = 0; x < s; x += 14) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, s); g.stroke(); }
      g.strokeStyle = 'rgba(0,0,0,0.10)';
      for (let i = 0; i < 22; i++) { const y = Math.random() * s; g.beginPath(); g.moveTo(0, y); g.lineTo(s, y + 8); g.stroke(); }
    });
    const thatchTex = this.pattern((g, s) => {
      g.fillStyle = '#c9a15c'; g.fillRect(0, 0, s, s);
      g.strokeStyle = 'rgba(90,60,20,0.30)'; g.lineWidth = 1.6;
      for (let i = 0; i < 90; i++) {
        const x = Math.random() * s, y = Math.random() * s;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + 3, y + 12); g.stroke();
      }
    });
    const roofTex = this.pattern((g, s) => {
      g.fillStyle = '#96453c'; g.fillRect(0, 0, s, s);
      g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 2;
      for (let y = 0; y < s; y += 12) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke(); }
      for (let y = 0, r = 0; y < s; y += 12, r++)
        for (let x = (r % 2) * 10; x < s; x += 20) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 12); g.stroke(); }
    });
    this.m = {
      stone: std({ map: stoneTex }),
      wood: std({ map: woodTex }),
      thatch: std({ map: thatchTex }),
      roof: std({ map: roofTex }),
      darkWood: std({ color: DARKWOOD }),
      iron: std({ color: IRON, roughness: 0.4, metalness: 0.65 }),
      skin: std({ color: SKIN }),
      dark: std({ color: 0x33230f }),
      white: std({ color: 0xf0ead8 }),
      red: std({ color: 0xb8453a }),
      gold: std({ color: 0xd9a92f, roughness: 0.35, metalness: 0.5 }),
      leafW: std({ color: 0xffffff, roughness: 0.95 }),
      player: PLAYER_COLORS.map(c => std({ color: new THREE.Color(c.hex) })),
      playerD: PLAYER_COLORS.map(c => std({ color: new THREE.Color(c.dark) })),
    };
    this.ghostMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false, color: 0x55dd66 });
    this.fogGhostMat = new THREE.MeshStandardMaterial({ color: 0x5a5a52, transparent: true, opacity: 0.55, roughness: 1 });
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x8cff96, transparent: true, opacity: 0.9, depthWrite: false });
    this.padOk = new THREE.MeshBasicMaterial({ color: 0x3adb5a, transparent: true, opacity: 0.3, depthWrite: false });
    this.padBad = new THREE.MeshBasicMaterial({ color: 0xdb4a3a, transparent: true, opacity: 0.35, depthWrite: false });
  }

  // ---------------- helpers de malha ----------------
  box(w, h, d, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 12) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  cone(r, h, mat, x = 0, y = 0, z = 0, seg = 12) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  sph(r, mat, x = 0, y = 0, z = 0, w = 10, h = 8) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, w, h), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  prism(w, h, d, mat, x = 0, y = 0, z = 0) {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
    g.translate(0, 0, -d / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  bannerMesh(pIdx, w = 5, h = 14) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({
      color: new THREE.Color(PLAYER_COLORS[pIdx % PLAYER_COLORS.length].hex),
      side: THREE.DoubleSide, roughness: 0.85,
    }));
    m.castShadow = true;
    return m;
  }

  // ---------------- protótipos de edifícios ----------------
  protoBuilding(type, pIdx) {
    const key = type + ':' + pIdx;
    if (this.protoB.has(key)) return this.protoB.get(key);
    const g = new THREE.Group();
    const m = this.m;
    const pm = m.player[pIdx % m.player.length];
    switch (type) {
      case 'town_center': {
        g.add(this.box(86, 28, 86, m.stone, 0, 14, 0));
        g.add(this.prism(96, 24, 94, m.roof, 0, 28, 0));
        g.add(this.box(38, 16, 38, m.stone, 0, 46, 0));
        g.add(this.prism(46, 14, 44, m.roof, 0, 62, 0));
        g.add(this.box(14, 19, 3, m.dark, 0, 9.5, 43.4));
        const b1 = this.bannerMesh(pIdx, 6, 16); b1.position.set(-30, 20, 43.6); g.add(b1);
        const b2 = this.bannerMesh(pIdx, 6, 16); b2.position.set(30, 20, 43.6); g.add(b2);
        g.add(this.cyl(0.8, 0.8, 26, m.darkWood, 0, 88, 0));
        const fl = this.bannerMesh(pIdx, 16, 9); fl.position.set(8.4, 96, 0); g.add(fl);
        break;
      }
      case 'house': {
        g.add(this.box(25, 14, 21, m.wood, 0, 7, 0));
        g.add(this.prism(29, 12, 25, m.thatch, 0, 14, 0));
        g.add(this.box(7, 10, 2, m.dark, -4, 5, 10.6));
        g.add(this.box(5, 9, 5, m.stone, 7, 22, -4));
        break;
      }
      case 'barracks': {
        g.add(this.box(86, 24, 70, m.stone, 0, 12, 0));
        g.add(this.prism(94, 20, 78, m.roof, 0, 24, 0));
        g.add(this.box(14, 17, 3, m.dark, 0, 8.5, 35.4));
        const sh = this.cyl(8, 8, 1.6, pm, 0, 32, 36); sh.rotation.x = Math.PI / 2; g.add(sh);
        const b1 = this.bannerMesh(pIdx, 6, 15); b1.position.set(-28, 16, 35.6); g.add(b1);
        const b2 = this.bannerMesh(pIdx, 6, 15); b2.position.set(28, 16, 35.6); g.add(b2);
        break;
      }
      case 'archery': {
        g.add(this.box(86, 22, 70, m.wood, 0, 11, 0));
        g.add(this.prism(94, 18, 78, m.thatch, 0, 22, 0));
        g.add(this.box(13, 16, 3, m.dark, 0, 8, 35.4));
        const t1 = this.cyl(8, 8, 1.4, m.white, 0, 31, 36); t1.rotation.x = Math.PI / 2; g.add(t1);
        const t2 = this.cyl(5.4, 5.4, 1.8, m.red, 0, 31, 36.2); t2.rotation.x = Math.PI / 2; g.add(t2);
        const t3 = this.cyl(2.6, 2.6, 2.2, m.white, 0, 31, 36.4); t3.rotation.x = Math.PI / 2; g.add(t3);
        const b1 = this.bannerMesh(pIdx, 6, 14); b1.position.set(-30, 15, 35.6); g.add(b1);
        break;
      }
      case 'stable': {
        g.add(this.box(88, 20, 74, m.wood, 0, 10, 0));
        g.add(this.prism(96, 18, 82, m.thatch, 0, 20, 0));
        g.add(this.box(24, 16, 3, m.dark, 0, 8, 37.4));
        const hay = this.sph(9, m.thatch, 32, 5, 30); hay.scale.set(1.2, 0.75, 1); g.add(hay);
        const b1 = this.bannerMesh(pIdx, 6, 14); b1.position.set(-32, 14, 37.6); g.add(b1);
        break;
      }
      case 'mill': {
        g.add(this.cyl(15, 17, 34, m.stone, 0, 17, 0));
        g.add(this.cone(18, 15, m.thatch, 0, 41.5, 0));
        g.add(this.box(10, 13, 2, m.dark, 0, 6.5, 16));
        const blades = new THREE.Group();
        blades.name = 'blades';
        for (let k = 0; k < 4; k++) {
          const arm = this.box(1.6, 26, 0.8, m.darkWood, 0, 13, 0);
          const sail = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 20), new THREE.MeshStandardMaterial({
            color: 0xeee4cd, side: THREE.DoubleSide, roughness: 0.9 }));
          sail.position.set(0, 15, 0.8); sail.castShadow = true;
          const wing = new THREE.Group();
          wing.add(arm); wing.add(sail);
          wing.rotation.z = k * Math.PI / 2;
          blades.add(wing);
        }
        blades.position.set(0, 34, 18.5);
        g.add(blades);
        g.add(this.sph(2, m.darkWood, 0, 34, 18.5));
        break;
      }
      case 'lumber_camp': {
        g.add(this.box(38, 16, 34, m.wood, -12, 8, -6));
        g.add(this.prism(44, 13, 40, m.thatch, -12, 16, -6));
        const mk = (x, y, z) => { const c = this.cyl(4, 4, 26, m.wood, x, y, z, 8); c.rotation.z = Math.PI / 2; g.add(c); };
        mk(18, 4, 16); mk(18, 4, 8); mk(18, 11, 12);
        break;
      }
      case 'mining_camp': {
        g.add(this.box(38, 16, 34, m.wood, -12, 8, -6));
        g.add(this.prism(44, 13, 40, m.thatch, -12, 16, -6));
        const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(10), this.m.stone);
        rk.position.set(18, 6, 14); rk.castShadow = rk.receiveShadow = true; g.add(rk);
        const au = new THREE.Mesh(new THREE.IcosahedronGeometry(3.4), this.m.gold);
        au.position.set(13, 3, 20); au.castShadow = true; g.add(au);
        break;
      }
      case 'tower': {
        g.add(this.cyl(13.5, 15.5, 8, m.stone, 0, 4, 0));
        g.add(this.cyl(11.5, 12.5, 54, m.stone, 0, 34, 0));
        g.add(this.cyl(13.5, 13.5, 5, m.stone, 0, 63, 0));
        for (let k = 0; k < 6; k++) {
          const a = k / 6 * Math.PI * 2;
          g.add(this.box(4.5, 5, 3, m.stone, Math.cos(a) * 12, 68, Math.sin(a) * 12));
        }
        g.add(this.box(7, 12, 2, m.dark, 0, 6, 14.6));
        g.add(this.cyl(0.6, 0.6, 14, m.darkWood, 0, 76, 0));
        const fl = this.bannerMesh(pIdx, 11, 6); fl.position.set(6, 80, 0); g.add(fl);
        break;
      }
    }
    this.protoB.set(key, g);
    return g;
  }

  makeScaffold(sizeTiles) {
    const key = sizeTiles;
    const S = sizeTiles * TILE;
    const g = new THREE.Group();
    const h = S * 0.5;
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      g.add(this.cyl(1.2, 1.2, h, this.m.wood, px * S * 0.38, h / 2, pz * S * 0.38, 6));
    }
    g.add(this.box(S * 0.8, 2, 2.4, this.m.wood, 0, h, -S * 0.38));
    g.add(this.box(S * 0.8, 2, 2.4, this.m.wood, 0, h, S * 0.38));
    g.add(this.box(S * 0.42, 4, S * 0.3, this.m.wood, 0, 2, 0));
    return g;
  }

  // ---------------- protótipos de unidades ----------------
  limb(w, h, d, mat, px, py, pz) {
    const pivot = new THREE.Group();
    pivot.position.set(px, py, pz);
    const m = this.box(w, h, d, mat, 0, -h / 2, 0);
    pivot.add(m);
    return pivot;
  }

  protoUnit(type, pIdx) {
    const key = type + ':' + pIdx;
    if (this.protoU.has(key)) return this.protoU.get(key);
    const m = this.m;
    const pm = m.player[pIdx % m.player.length];
    const pmD = m.playerD[pIdx % m.playerD.length];
    const g = new THREE.Group();
    const cav = UNITS[type].class === 'cavalry';
    if (cav) {
      const knight = type === 'knight';
      const horseMat = knight ? new THREE.MeshStandardMaterial({ color: 0x45454e, roughness: .8 })
        : new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: .85 });
      // corpo do cavalo
      const body = this.box(21, 8.5, 7.5, horseMat, 0, 14, 0); body.name = 'hbody'; g.add(body);
      if (knight) g.add(this.box(22, 5, 8.5, pm, 0, 12.6, 0)); // caparazão
      // pescoço + cabeça
      const neck = this.box(4.5, 10, 4, horseMat, 9.5, 19, 0); neck.rotation.z = -0.5; g.add(neck);
      g.add(this.box(6.5, 3.4, 3.2, horseMat, 13.6, 23.4, 0));
      g.add(this.box(1.2, 2.4, 1, horseMat, 12.2, 26, 0));
      // cauda
      const tail = this.box(1.6, 7, 1.6, m.darkWood, -11, 12.5, 0); tail.rotation.z = 0.5; g.add(tail);
      // patas
      const names = ['legFL', 'legFR', 'legBL', 'legBR'];
      const pos = [[7, 2.6], [7, -2.6], [-7, 2.6], [-7, -2.6]];
      for (let i = 0; i < 4; i++) {
        const l = this.limb(2, 10.5, 2, horseMat, pos[i][0], 11, pos[i][1]);
        l.name = names[i]; g.add(l);
      }
      // cavaleiro
      g.add(this.box(6, 8, 4.2, pm, 0, 24, 0));
      const head = this.sph(2.8, knight ? m.iron : m.skin, 0, 30.5, 0); g.add(head);
      if (knight) {
        g.add(this.cone(1.4, 4, pm, 0, 34, 0));
        const arm = this.limb(2, 6, 2, pm, 2.5, 27, 2.8); arm.name = 'armR';
        const lance = this.cyl(0.55, 0.55, 30, m.wood, 0, -6, 1, 6);
        lance.rotation.x = Math.PI / 2 - 0.35;
        arm.add(lance);
        const tip = this.cone(1, 3.4, m.iron, 0, -6, 15.6); tip.rotation.x = Math.PI / 2 - 0.35; arm.add(tip);
        g.add(arm);
      } else {
        const capMat = new THREE.MeshStandardMaterial({ color: 0x6e5636, roughness: .9 });
        g.add(this.sph(2.2, capMat, 0, 32.2, 0));
        const arm = this.limb(2, 6, 2, m.skin, 2.5, 27, 2.8); arm.name = 'armR';
        const sw = this.box(1, 9, 0.5, m.iron, 0, -8, 1); arm.add(sw);
        g.add(arm);
      }
    } else {
      const dark = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: .9 });
      const legL = this.limb(2.8, 9.5, 2.8, dark, -2.1, 9.5, 0); legL.name = 'legL'; g.add(legL);
      const legR = this.limb(2.8, 9.5, 2.8, dark, 2.1, 9.5, 0); legR.name = 'legR'; g.add(legR);
      g.add(this.box(7.4, 10, 5, pm, 0, 14.5, 0));
      g.add(this.box(7.6, 1.6, 5.2, m.dark, 0, 11, 0));
      g.add(this.sph(3.3, m.skin, 0, 22.6, 0));
      // capacete / chapéu
      switch (type) {
        case 'villager': {
          const hat = this.cyl(5.2, 5.2, 0.8, m.thatch, 0, 24.6, 0); g.add(hat);
          g.add(this.cone(2.8, 2.6, m.thatch, 0, 25.8, 0));
          break;
        }
        case 'spearman': g.add(this.sph(3.4, m.iron, 0, 23.4, 0, 10, 6)); break;
        case 'swordsman': {
          g.add(this.sph(3.6, m.iron, 0, 22.8, 0));
          g.add(this.box(3, 1, 3.7, m.dark, 1.2, 22.4, 0));
          break;
        }
        case 'archer': {
          const hood = new THREE.MeshStandardMaterial({ color: 0x6e5636, roughness: .95 });
          g.add(this.sph(3.7, hood, -0.4, 23, 0));
          g.add(this.sph(2.2, m.skin, 1.8, 22.4, 0));
          break;
        }
        case 'crossbow': {
          g.add(this.cyl(4.8, 4.8, 1, m.iron, 0, 24.2, 0));
          g.add(this.sph(2.8, m.iron, 0, 24.6, 0, 10, 6));
          break;
        }
      }
      // braço direito + arma
      const armR = this.limb(2.3, 7.5, 2.3, m.skin, 1.5, 20, 3.6);
      armR.name = 'armR';
      switch (type) {
        case 'villager': {
          armR.add(this.cyl(0.6, 0.6, 11, m.wood, 0, -7, 1, 6));
          armR.add(this.box(4, 2.6, 1, m.iron, 1.8, -11.5, 1));
          break;
        }
        case 'spearman': {
          const sp = this.cyl(0.5, 0.5, 24, m.wood, 0, -4, 1, 6); armR.add(sp);
          armR.add(this.cone(1.1, 3.4, m.iron, 0, 9.5, 1));
          const shield = this.cyl(3.6, 3.6, 0.9, pmD, 0, 0, 0, 12);
          shield.rotation.x = Math.PI / 2; shield.position.set(-1, 16 - 20, -7.2);
          armR.add(shield); // encostado no lado oposto via posição relativa
          break;
        }
        case 'swordsman': {
          armR.add(this.box(1.1, 11, 0.5, m.iron, 0, -11, 1));
          armR.add(this.box(3.4, 0.9, 1, m.darkWood, 0, -6.4, 1));
          const sh = this.box(5.5, 7.5, 0.9, pm, -3, -3, -7.4);
          armR.add(sh);
          break;
        }
        case 'archer': {
          const bow = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.45, 6, 14, Math.PI * 1.05), m.darkWood);
          bow.rotation.y = Math.PI / 2; bow.rotation.z = -Math.PI * 0.525;
          bow.position.set(0, -7, 1.4); bow.castShadow = true;
          armR.add(bow);
          break;
        }
        case 'crossbow': {
          armR.add(this.box(9, 1.4, 1.4, m.darkWood, 2, -7, 1));
          armR.add(this.box(1.2, 1.2, 8, m.iron, 5.4, -7, 1));
          break;
        }
      }
      g.add(armR);
      // saco de recursos (aldeão)
      if (type === 'villager') {
        const sack = this.sph(2.6, new THREE.MeshStandardMaterial({ color: 0x9c7a4e, roughness: .95 }), -1, 18.5, -3.8);
        sack.name = 'sack'; sack.visible = false;
        g.add(sack);
      }
    }
    this.protoU.set(key, g);
    return g;
  }

  // ---------------- recursos instanciados ----------------
  initNodes() {
    const counts = { tree: 0, gold: 0, stone: 0, berry: 0, sheep: 0 };
    for (const n of this.model.nodes()) if (counts[n.type] != null) counts[n.type]++;
    const cap = (k) => Math.max(4, counts[k] + 4);
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.02, ...o });
    const inst = (geo, mat, capacity) => {
      const im = new THREE.InstancedMesh(geo, mat, capacity);
      im.castShadow = true; im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.count = 0;
      this.scene.add(im);
      return im;
    };
    const trunkG = new THREE.CylinderGeometry(1.5, 2.4, 13, 6); trunkG.translate(0, 6.5, 0);
    const leafG = new THREE.SphereGeometry(11, 9, 7); leafG.translate(0, 20, 0);
    const pineG = new THREE.ConeGeometry(9.5, 27, 8); pineG.translate(0, 18, 0);
    const goldG = new THREE.DodecahedronGeometry(9); goldG.translate(0, 5.6, 0); goldG.scale(1, 0.75, 1);
    const stoneG = new THREE.DodecahedronGeometry(8.6); stoneG.translate(0, 5.4, 0); stoneG.scale(1, 0.72, 1);
    const berryG = new THREE.SphereGeometry(7.2, 8, 6); berryG.translate(0, 4.6, 0); berryG.scale(1, 0.8, 1);
    const sheepBG = new THREE.SphereGeometry(6.2, 9, 7); sheepBG.translate(0, 7.2, 0); sheepBG.scale(1.28, 1, 0.95);
    const sheepHG = new THREE.SphereGeometry(2.5, 6, 5); sheepHG.translate(8, 8.8, 0);
    this.iTrunk = inst(trunkG, std({ color: 0xffffff }), cap('tree'));
    this.iLeaf = inst(leafG, std({ color: 0xffffff }), cap('tree'));
    this.iPine = inst(pineG, std({ color: 0xffffff }), cap('tree'));
    this.iGold = inst(goldG, std({ color: 0xffffff, roughness: 0.35, metalness: 0.5 }), cap('gold'));
    this.iStone = inst(stoneG, std({ color: 0xffffff }), cap('stone'));
    this.iBerry = inst(berryG, std({ color: 0xffffff }), cap('berry'));
    this.iSheepB = inst(sheepBG, std({ color: 0xffffff }), cap('sheep'));
    this.iSheepH = inst(sheepHG, std({ color: 0xffffff }), cap('sheep'));
    this._mtx = new THREE.Matrix4();
    this._quat = new THREE.Quaternion();
    this._pos = new THREE.Vector3();
    this._scl = new THREE.Vector3();
    this._col = new THREE.Color();
    // aloca instanceColor
    for (const im of [this.iTrunk, this.iLeaf, this.iPine, this.iGold, this.iStone, this.iBerry, this.iSheepB, this.iSheepH])
      im.setColorAt(0, this._col.set(1, 1, 1));
  }

  deco(id) {
    let d = this.decoCache.get(id);
    if (!d) {
      const h = (id * 2654435761) >>> 0;
      d = {
        rot: ((h & 255) / 255) * Math.PI * 2,
        sc: 0.85 + (((h >> 8) & 255) / 255) * 0.4,
        jx: (((h >> 16) & 255) / 255 - 0.5) * 9,
        jz: (((h >> 24) & 255) / 255 - 0.5) * 9,
        pine: h % 3 === 2,
        hue: 0.9 + ((h >> 4) & 15) / 15 * 0.25,
      };
      this.decoCache.set(id, d);
    }
    return d;
  }

  setInst(im, idx, x, z, rot, sc, r, g, b) {
    this._pos.set(x, 0, z);
    this._quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    this._scl.set(sc, sc, sc);
    this._mtx.compose(this._pos, this._quat, this._scl);
    im.setMatrixAt(idx, this._mtx);
    im.setColorAt(idx, this._col.setRGB(r, g, b));
  }

  updateNodes() {
    const W = this.model.W;
    let iT = 0, iL = 0, iP = 0, iG = 0, iS = 0, iB = 0, iSh = 0;
    for (const n of this.model.nodes()) {
      const idx = n.y * W + n.x;
      if (!this.explored[idx]) continue;
      const vis = this.isTileNearVisible(n.x, n.y);
      const dim = vis ? 1 : 0.38;
      const d = this.deco(n.id);
      const x = (n.x + 0.5) * TILE + d.jx, z = (n.y + 0.5) * TILE + d.jz;
      switch (n.type) {
        case 'tree': {
          this.setInst(this.iTrunk, iT++, x, z, d.rot, d.sc, 0.34 * dim, 0.22 * dim, 0.12 * dim);
          if (d.pine) this.setInst(this.iPine, iP++, x, z, d.rot, d.sc, 0.09 * d.hue * dim, 0.30 * d.hue * dim, 0.13 * dim);
          else this.setInst(this.iLeaf, iL++, x, z, d.rot, d.sc, 0.14 * d.hue * dim, 0.38 * d.hue * dim, 0.11 * dim);
          break;
        }
        case 'gold': {
          const sc = d.sc * (0.7 + 0.3 * clamp(n.amount / n.max, 0, 1));
          this.setInst(this.iGold, iG++, (n.x + 0.5) * TILE, (n.y + 0.5) * TILE, d.rot, sc, 0.92 * dim, 0.72 * dim, 0.2 * dim);
          break;
        }
        case 'stone': {
          const sc = d.sc * (0.7 + 0.3 * clamp(n.amount / n.max, 0, 1));
          this.setInst(this.iStone, iS++, (n.x + 0.5) * TILE, (n.y + 0.5) * TILE, d.rot, sc, 0.44 * dim, 0.46 * dim, 0.49 * dim);
          break;
        }
        case 'berry': {
          this.setInst(this.iBerry, iB++, (n.x + 0.5) * TILE, (n.y + 0.5) * TILE, d.rot, d.sc, 0.32 * dim, 0.5 * dim, 0.22 * dim);
          break;
        }
        case 'sheep': {
          this.setInst(this.iSheepB, iSh, (n.x + 0.5) * TILE, (n.y + 0.5) * TILE, d.rot, d.sc, 0.93 * dim, 0.9 * dim, 0.82 * dim);
          this.setInst(this.iSheepH, iSh++, (n.x + 0.5) * TILE, (n.y + 0.5) * TILE, d.rot, d.sc, 0.2 * dim, 0.17 * dim, 0.13 * dim);
          break;
        }
      }
    }
    const apply = (im, count) => {
      im.count = count;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    };
    apply(this.iTrunk, iT); apply(this.iLeaf, iL); apply(this.iPine, iP);
    apply(this.iGold, iG); apply(this.iStone, iS); apply(this.iBerry, iB);
    apply(this.iSheepB, iSh); apply(this.iSheepH, iSh);
  }

  // ---------------- névoa ----------------
  computeFog(now) {
    this.visible.fill(0);
    const W = this.model.W, H = this.model.H;
    const mark = (cx, cy, r) => {
      const r2 = r * r;
      for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++)
        for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) {
          const dx = x - cx, dy = y - cy;
          if (dx * dx + dy * dy <= r2) { this.visible[y * W + x] = 1; this.explored[y * W + x] = 1; }
        }
    };
    for (const e of this.model.entities(now)) {
      if (e.owner !== this.model.localPlayerId) continue;
      const def = defOf(e.type);
      const sight = e.building ? (def.sightRange || 5) : (def.sight || 5);
      mark(Math.floor(e.x / TILE), Math.floor(e.y / TILE), sight);
    }
    for (const e of this.model.entities(now)) {
      if (e.owner === this.model.localPlayerId || !e.building) continue;
      const def = defOf(e.type);
      if (this.isTileNearVisible(Math.floor(e.x / TILE), Math.floor(e.y / TILE)))
        this.knownBuildings.set(e.id, { id: e.id, type: e.type, owner: e.owner, bx: e.bx, by: e.by, size: def.size, constructed: e.constructed, hp: e.hp });
    }
    for (const [id, b] of this.knownBuildings) {
      const tx = Math.floor(b.bx + b.size / 2), ty = Math.floor(b.by + b.size / 2);
      if (this.isVisibleTile(tx, ty) && !this.model.getEntity(id)) this.knownBuildings.delete(id);
    }
    // atualiza textura da névoa
    const d = this.fogImg.data;
    for (let i = 0; i < W * H; i++) {
      d[i * 4] = 7; d[i * 4 + 1] = 9; d[i * 4 + 2] = 5;
      d[i * 4 + 3] = this.visible[i] ? 0 : this.explored[i] ? 120 : 240;
    }
    this.fogCtx.putImageData(this.fogImg, 0, 0);
    this.fogTex.needsUpdate = true;
  }

  isVisibleTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.model.W || ty >= this.model.H) return false;
    return this.visible[ty * this.model.W + tx] === 1;
  }
  isTileNearVisible(tx, ty) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if (this.isVisibleTile(tx + dx, ty + dy)) return true;
    return false;
  }

  // ---------------- loop principal ----------------
  render(now) {
    const canvas = this.canvas;
    if (canvas.width !== this._lastW || canvas.height !== this._lastH) {
      this._lastW = canvas.width; this._lastH = canvas.height;
      this.gl.setSize(canvas.width, canvas.height, false);
      this.overlay.width = canvas.width; this.overlay.height = canvas.height;
    }
    this.computeFog(now);
    this.updateNodes();
    this.bars = [];
    this.updateBuildings(now);
    this.updateUnits(now);
    this.updateGhosts();
    this.updateProjectiles();
    this.updateSelectionRings();
    this.updatePlacement();

    // sol acompanha a câmera; vem do sudoeste para iluminar as fachadas
    const t = this.camera;
    this.sun.position.set(t.cx - 220, 620, t.cz + 300);
    this.sun.target.position.set(t.cx, 0, t.cz);
    this.sun.target.updateMatrixWorld();

    this.gl.render(this.scene, this.camera.cam);
    this.drawOverlay(now);
  }

  updateBuildings(now) {
    const seen = new Set();
    for (const e of this.model.entities(now)) {
      if (!e.building) continue;
      const own = e.owner === this.model.localPlayerId;
      if (!own && !this.isTileNearVisible(Math.floor(e.x / TILE), Math.floor(e.y / TILE))) continue;
      seen.add(e.id);
      let o = this.bObjs.get(e.id);
      const def = BUILDINGS[e.type];
      if (!o) {
        const group = new THREE.Group();
        const shell = this.protoBuilding(e.type, e.owner).clone(true);
        shell.name = 'shell';
        group.add(shell);
        const scaffold = this.makeScaffold(def.size);
        group.add(scaffold);
        group.position.set((e.bx + def.size / 2) * TILE, 0, (e.by + def.size / 2) * TILE);
        this.scene.add(group);
        o = { group, shell, scaffold, blades: shell.getObjectByName('blades') };
        this.bObjs.set(e.id, o);
      }
      const p = e.constructed ? 1 : clamp(e.buildProgress || 0, 0, 1);
      o.shell.scale.y = e.constructed ? 1 : Math.max(0.04, p);
      o.shell.visible = e.constructed || p > 0.03;
      o.scaffold.visible = !e.constructed;
      if (o.blades && e.constructed) o.blades.rotation.z = now * 0.0009 + e.id;
      // barras (overlay)
      const hgt = def.size * TILE * 0.5 + 34;
      const ratio = clamp(e.hp / def.hp, 0, 1);
      if (ratio < 0.999 || this.selection.has(e.id) || !e.constructed) {
        this.bars.push({ x: e.x, z: e.y, h: hgt, w: def.size * TILE * 0.8, ratio, kind: 'hp' });
      }
      if (!e.constructed) this.bars.push({ x: e.x, z: e.y, h: hgt - 8, w: def.size * TILE * 0.8, ratio: p, kind: 'build' });
      if (e.constructed && e.queue && e.queue.length)
        this.bars.push({ x: e.x, z: e.y, h: 6, w: def.size * TILE * 0.7, ratio: e.queue[0].elapsed / e.queue[0].total, kind: 'queue' });
      if (this.selection.has(e.id) && e.rally)
        this.bars.push({ x: e.rally.x, z: e.rally.y, h: 0, kind: 'rally' });
    }
    for (const [id, o] of this.bObjs) {
      if (!seen.has(id)) { this.scene.remove(o.group); this.bObjs.delete(id); }
    }
  }

  updateGhosts() {
    const seen = new Set();
    for (const b of this.knownBuildings.values()) {
      if (this.isTileNearVisible(Math.floor(b.bx + b.size / 2), Math.floor(b.by + b.size / 2))) continue;
      seen.add(b.id);
      let o = this.gObjs.get(b.id);
      if (!o) {
        let proto = this.protoGhost.get(b.type);
        if (!proto) {
          proto = this.protoBuilding(b.type, b.owner).clone(true);
          proto.traverse((c) => { if (c.isMesh) { c.material = this.fogGhostMat; c.castShadow = false; } });
          this.protoGhost.set(b.type, proto);
        }
        const g = proto.clone(true);
        g.position.set((b.bx + b.size / 2) * TILE, 0, (b.by + b.size / 2) * TILE);
        this.scene.add(g);
        o = { group: g };
        this.gObjs.set(b.id, o);
      }
    }
    for (const [id, o] of this.gObjs) {
      if (!seen.has(id)) { this.scene.remove(o.group); this.gObjs.delete(id); }
    }
  }

  updateUnits(now) {
    const seen = new Set();
    for (const e of this.model.entities(now)) {
      if (e.building) continue;
      const own = e.owner === this.model.localPlayerId;
      if (!own && !this.isTileNearVisible(Math.floor(e.x / TILE), Math.floor(e.y / TILE))) continue;
      seen.add(e.id);
      let o = this.uObjs.get(e.id);
      if (!o) {
        const group = this.protoUnit(e.type, e.owner).clone(true);
        this.scene.add(group);
        o = {
          group,
          legL: group.getObjectByName('legL'), legR: group.getObjectByName('legR'),
          armR: group.getObjectByName('armR'), sack: group.getObjectByName('sack'),
          legFL: group.getObjectByName('legFL'), legFR: group.getObjectByName('legFR'),
          legBL: group.getObjectByName('legBL'), legBR: group.getObjectByName('legBR'),
          ph: (e.id % 10) * 0.7, lx: e.x, lz: e.y,
        };
        this.uObjs.set(e.id, o);
      }
      const d = Math.hypot(e.x - o.lx, e.y - o.lz);
      const moving = d > 0.06;
      o.ph += d * 0.30; o.lx = e.x; o.lz = e.y;
      o.group.position.set(e.x, 0, e.y);
      o.group.rotation.y = -(e.facing || 0);
      const swing = moving ? Math.sin(o.ph) * 0.6 : 0;
      if (o.legL) { o.legL.rotation.z = swing; o.legR.rotation.z = -swing; }
      if (o.legFL) {
        o.legFL.rotation.z = swing; o.legBR.rotation.z = swing;
        o.legFR.rotation.z = -swing; o.legBL.rotation.z = -swing;
      }
      if (o.armR) {
        const attacking = e.state === 'attack';
        const working = e.state === 'gather' || e.state === 'build';
        if (attacking) o.armR.rotation.z = -0.9 + Math.sin(now / 75) * 0.75;
        else if (working) o.armR.rotation.z = -0.55 + Math.sin(now / 95) * 0.6;
        else o.armR.rotation.z = moving ? -swing * 0.5 : 0;
      }
      if (o.sack) o.sack.visible = e.state === 'return';
      // barra de vida
      const def = UNITS[e.type];
      const ratio = clamp(e.hp / def.hp, 0, 1);
      if (ratio < 0.999 || this.selection.has(e.id))
        this.bars.push({ x: e.x, z: e.y, h: def.class === 'cavalry' ? 38 : 32, w: 24, ratio, kind: 'hp' });
    }
    for (const [id, o] of this.uObjs) {
      if (!seen.has(id)) { this.scene.remove(o.group); this.uObjs.delete(id); }
    }
  }

  updateSelectionRings() {
    let i = 0;
    for (const id of this.selection) {
      const e = this.model.getEntity(id);
      if (!e) continue;
      if (i >= this.rings.length) {
        const r = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 28), this.ringMat);
        r.rotation.x = -Math.PI / 2; r.renderOrder = 400;
        this.scene.add(r);
        this.rings.push(r);
      }
      const ring = this.rings[i++];
      ring.visible = true;
      const rad = e.building ? BUILDINGS[e.type].size * TILE * 0.62
        : (UNITS[e.type]?.class === 'cavalry' ? 15 : 10);
      ring.scale.set(rad, rad, 1);
      ring.position.set(e.x, 0.6, e.y);
    }
    for (; i < this.rings.length; i++) this.rings[i].visible = false;
  }

  updateProjectiles() {
    const projs = this.model.projectiles();
    while (this.arrows.length < projs.length) {
      const g = new THREE.Group();
      const shaft = this.cyl(0.5, 0.5, 11, this.m.wood, 0, 0, 0, 5);
      shaft.rotation.z = Math.PI / 2;
      g.add(shaft);
      const tip = this.cone(1.1, 3, this.m.iron, 6.5, 0, 0, 6);
      tip.rotation.z = -Math.PI / 2;
      g.add(tip);
      this.scene.add(g);
      this.arrows.push(g);
    }
    for (let i = 0; i < this.arrows.length; i++) {
      const a = this.arrows[i];
      if (i < projs.length) {
        const p = projs[i];
        if (!this.isTileNearVisible(Math.floor(p.x / TILE), Math.floor(p.y / TILE))) { a.visible = false; continue; }
        a.visible = true;
        a.position.set(p.x, 14, p.y);
        a.rotation.y = -(p.angle || 0);
      } else a.visible = false;
    }
  }

  updatePlacement() {
    if (!this.placement) {
      if (this.ghost) this.ghost.visible = false;
      if (this.pad) this.pad.visible = false;
      return;
    }
    const def = BUILDINGS[this.placement.type];
    if (!this.ghost || this.ghostType !== this.placement.type) {
      if (this.ghost) this.scene.remove(this.ghost);
      this.ghost = this.protoBuilding(this.placement.type, this.model.localPlayerId).clone(true);
      this.ghost.traverse((c) => { if (c.isMesh) { c.material = this.ghostMat; c.castShadow = false; } });
      this.ghostType = this.placement.type;
      this.scene.add(this.ghost);
    }
    if (!this.pad) {
      this.pad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.padOk);
      this.pad.rotation.x = -Math.PI / 2;
      this.pad.renderOrder = 300;
      this.scene.add(this.pad);
    }
    const S = def.size * TILE;
    const cx = (this.placement.tx + def.size / 2) * TILE;
    const cz = (this.placement.ty + def.size / 2) * TILE;
    this.ghost.visible = true;
    this.ghost.position.set(cx, 0, cz);
    this.ghostMat.color.set(this.placement.valid ? 0x55dd66 : 0xdd5544);
    this.pad.visible = true;
    this.pad.material = this.placement.valid ? this.padOk : this.padBad;
    this.pad.scale.set(S, S, 1);
    this.pad.position.set(cx, 0.5, cz);
  }

  // ---------------- overlay 2D (barras, drag box) ----------------
  drawOverlay(now) {
    const ctx = this.octx, cam = this.camera;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    for (const b of this.bars) {
      const p = cam.toScreen(b.x, b.z, b.h);
      if (p.x < -50 || p.y < -50 || p.x > cam.vw + 50 || p.y > cam.vh + 50) continue;
      if (b.kind === 'rally') {
        ctx.strokeStyle = '#4a3a28'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 16); ctx.stroke();
        ctx.fillStyle = '#e6c469';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 16); ctx.lineTo(p.x + 11, p.y - 12.5); ctx.lineTo(p.x, p.y - 9);
        ctx.closePath(); ctx.fill();
        continue;
      }
      const w = Math.max(18, b.w * cam.zoom * 0.55), h = 4;
      const x = p.x - w / 2, y = p.y;
      ctx.fillStyle = 'rgba(8,6,3,0.78)';
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      const color = b.kind === 'build' ? '#e6c469' : b.kind === 'queue' ? '#5adb6a'
        : b.ratio > 0.5 ? '#57c24f' : b.ratio > 0.25 ? '#e0b020' : '#d0463a';
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w * clamp(b.ratio, 0, 1), h);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(x, y, w * clamp(b.ratio, 0, 1), 1);
    }
    if (this.dragBox) {
      const { x0, y0, x1, y1 } = this.dragBox;
      ctx.strokeStyle = '#7dff88'; ctx.lineWidth = 1.5;
      ctx.fillStyle = 'rgba(125,255,136,0.12)';
      const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
      ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
    }
  }
}
