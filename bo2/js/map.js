// Mapa inspirado em Nuketown: duas casas frente a frente, rua central com ônibus e carros.
// Visual: texturas procedurais em canvas, sombras dinâmicas, céu com sol e nuvens.
import * as THREE from 'three';
import { G, aabb } from './state.js';

const MAP_W = 64, MAP_D = 40; // limites jogáveis

// ---------------- texturas procedurais ----------------
function tex(draw, w = 256, h = 256, rx = 1, ry = 1) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function speckle(c, w, h, colors, n, sizeMin = 1, sizeMax = 3) {
  for (let i = 0; i < n; i++) {
    c.fillStyle = colors[Math.floor(Math.random() * colors.length)];
    c.globalAlpha = 0.12 + Math.random() * 0.25;
    const s = sizeMin + Math.random() * (sizeMax - sizeMin);
    c.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
  c.globalAlpha = 1;
}

function grassTex() {
  return tex((c, w, h) => {
    c.fillStyle = '#5d7f3e'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, ['#4a6a30', '#6f9448', '#7ba050', '#3f5c28'], 2600, 1, 3);
    c.strokeStyle = '#6f9448'; c.globalAlpha = 0.35;
    for (let i = 0; i < 300; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + (Math.random() - 0.5) * 3, y - 3 - Math.random() * 3); c.stroke();
    }
    c.globalAlpha = 1;
  }, 256, 256, 40, 40);
}

function asphaltTex() {
  return tex((c, w, h) => {
    c.fillStyle = '#3c3c40'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, ['#2e2e32', '#4a4a4e', '#565658', '#28282c'], 3200, 1, 2);
    c.strokeStyle = '#28282a'; c.globalAlpha = 0.5; c.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      let x = Math.random() * w, y = Math.random() * h;
      c.beginPath(); c.moveTo(x, y);
      for (let j = 0; j < 6; j++) { x += (Math.random() - 0.5) * 26; y += (Math.random() - 0.5) * 26; c.lineTo(x, y); }
      c.stroke();
    }
    c.globalAlpha = 1;
  }, 256, 256, 12, 3);
}

function sidingTex(base, shade) {
  return tex((c, w, h) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 22) {
      c.fillStyle = shade; c.globalAlpha = 0.5;
      c.fillRect(0, y + 19, w, 3);
      c.globalAlpha = 0.14;
      c.fillStyle = '#ffffff';
      c.fillRect(0, y, w, 2);
      c.globalAlpha = 1;
    }
    speckle(c, w, h, [shade], 500, 1, 2);
  }, 256, 256, 2.5, 1.6);
}

function roofTex() {
  return tex((c, w, h) => {
    c.fillStyle = '#4a4440'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 18) {
      for (let x = 0; x < w; x += 26) {
        const off = (y / 18) % 2 ? 13 : 0;
        c.fillStyle = ['#403a36', '#524a44', '#463f3a'][Math.floor(Math.random() * 3)];
        c.fillRect(x + off, y, 24, 16);
      }
    }
    speckle(c, w, h, ['#2e2a26', '#5a524a'], 700, 1, 2);
  }, 256, 256, 3, 3);
}

function woodTex() {
  return tex((c, w, h) => {
    c.fillStyle = '#8a6a3f'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) {
      c.fillStyle = '#6d5230'; c.fillRect(x + 29, 0, 3, h);
      c.strokeStyle = '#7a5c36'; c.globalAlpha = 0.6;
      for (let i = 0; i < 5; i++) {
        c.beginPath();
        c.moveTo(x + Math.random() * 28, 0);
        c.bezierCurveTo(x + Math.random() * 28, h / 3, x + Math.random() * 28, h * 2 / 3, x + Math.random() * 28, h);
        c.stroke();
      }
      c.globalAlpha = 1;
    }
  }, 256, 256, 1.2, 1.2);
}

function concreteTex() {
  return tex((c, w, h) => {
    c.fillStyle = '#8d867c'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, ['#7a746b', '#9b948a', '#6e6860'], 2200, 1, 2);
    c.strokeStyle = '#6e6860'; c.lineWidth = 2; c.globalAlpha = 0.7;
    c.strokeRect(2, 2, w / 2 - 4, h - 4);
    c.strokeRect(w / 2 + 2, 2, w / 2 - 4, h - 4);
    c.globalAlpha = 1;
  }, 256, 256, 4, 1);
}

function fenceTex() {
  return tex((c, w, h) => {
    c.fillStyle = '#a8894f'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 24) {
      c.fillStyle = '#8f7340'; c.fillRect(x + 21, 0, 3, h);
      c.fillStyle = '#b8975c'; c.globalAlpha = 0.4; c.fillRect(x, 0, 2, h); c.globalAlpha = 1;
    }
    speckle(c, w, h, ['#8f7340', '#c2a066'], 500, 1, 2);
  }, 256, 256, 3, 1);
}

function metalTex(base, shade) {
  return tex((c, w, h) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) {
      c.fillStyle = shade; c.globalAlpha = Math.random() * 0.12; c.fillRect(0, y, w, 2); c.globalAlpha = 1;
    }
    speckle(c, w, h, [shade, '#ffffff'], 300, 1, 2);
  }, 128, 128, 2, 1);
}

function skyTex() {
  return tex((c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2f6fc4');
    g.addColorStop(0.45, '#6aa8dd');
    g.addColorStop(0.72, '#a8cfe8');
    g.addColorStop(1, '#d8e8ef');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }, 64, 512);
}

function cloudTex() {
  return tex((c, w, h) => {
    c.clearRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) {
      const x = w * 0.2 + Math.random() * w * 0.6, y = h * 0.35 + Math.random() * h * 0.3;
      const r = 18 + Math.random() * 30;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    }
  }, 256, 128);
}

// ---------------- materiais ----------------
let MATS = null;
function buildMats() {
  const std = (opt) => new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.0, ...opt });
  MATS = {
    grass: std({ map: grassTex() }),
    asphalt: std({ map: asphaltTex(), roughness: 0.98 }),
    sideYellow: std({ map: sidingTex('#c9b45c', '#a8933f') }),
    sideGreen: std({ map: sidingTex('#76b5a0', '#578f7c') }),
    roof: std({ map: roofTex() }),
    wood: std({ map: woodTex() }),
    concrete: std({ map: concreteTex() }),
    fence: std({ map: fenceTex() }),
    busYellow: std({ map: metalTex('#d8a02a', '#a87818'), roughness: 0.5, metalness: 0.35 }),
    carRed: std({ map: metalTex('#9c3b3b', '#702828'), roughness: 0.45, metalness: 0.4 }),
    carBlue: std({ map: metalTex('#3b5e9c', '#283f70'), roughness: 0.45, metalness: 0.4 }),
    truckWhite: std({ map: metalTex('#c8c8c4', '#9a9a96'), roughness: 0.55, metalness: 0.3 }),
    trailer: std({ map: metalTex('#9fb8a0', '#7a927b'), roughness: 0.6, metalness: 0.25 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fd0e8, roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.45 }),
    darkGlass: new THREE.MeshStandardMaterial({ color: 0x223a4a, roughness: 0.15, metalness: 0.7 }),
    tire: std({ color: 0x1c1c1e, roughness: 0.95 }),
    interior: std({ color: 0xbbb2a2 }),
    floor: std({ map: woodTex(), color: 0xb8a888 }),
    pole: std({ color: 0x4a4a4c, roughness: 0.5, metalness: 0.6 }),
    trunk: std({ color: 0x6a4a2c }),
    leaf1: std({ color: 0x4a7a34 }),
    leaf2: std({ color: 0x5c8c3c }),
    furniture: std({ map: woodTex(), color: 0x9a7a58 }),
  };
}

let _geoCache = new Map();
function boxGeo(w, h, d) {
  const k = w + ',' + h + ',' + d;
  if (!_geoCache.has(k)) _geoCache.set(k, new THREE.BoxGeometry(w, h, d));
  return _geoCache.get(k);
}

const _colorMats = new Map();
function matFor(m) {
  if (m && m.isMaterial) return m;
  if (!_colorMats.has(m)) _colorMats.set(m, new THREE.MeshStandardMaterial({ color: m, roughness: 0.9 }));
  return _colorMats.get(m);
}

// Cria um bloco sólido: mesh + colisor + alvo de raycast.
function solid(w, h, d, x, y, z, m, opts = {}) {
  const mesh = new THREE.Mesh(boxGeo(w, h, d), matFor(m));
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  G.scene.add(mesh);
  if (opts.collide !== false) G.colliders.push(aabb(x, y + h / 2, z, w, h, d));
  if (opts.ray !== false) { G.worldMeshes.push(mesh); G.rayTargets.push(mesh); }
  return mesh;
}

// decoração sem colisão nem raycast (nem sombra própria)
function deco(w, h, d, x, y, z, m) {
  const mesh = solid(w, h, d, x, y, z, m, { collide: false, ray: false });
  mesh.castShadow = false;
  return mesh;
}

// Parede com abertura de porta — composta por segmentos.
function wallWithDoor(cx, cz, len, axis, m, doorAt = 0, doorW = 1.7, h = 3.4) {
  const t = 0.35;
  const half = len / 2;
  const segs = [
    { from: -half, to: doorAt - doorW / 2 },
    { from: doorAt + doorW / 2, to: half },
  ];
  for (const s of segs) {
    const L = s.to - s.from;
    if (L <= 0.05) continue;
    const mid = (s.from + s.to) / 2;
    if (axis === 'x') solid(L, h, t, cx + mid, 0, cz, m);
    else solid(t, h, L, cx, 0, cz + mid, m);
  }
  if (axis === 'x') solid(doorW, h - 2.2, t, cx + doorAt, 2.2, cz, m);
  else solid(t, h - 2.2, doorW, cx, 2.2, cz + doorAt, m);
}

// Constrói casa completa (frente/trás/lados com vãos de porta e janela).
function fullHouse(cx, cz, faceDir, sideMat) {
  const W = 11, D = 8.5, H = 3.4, t = 0.35;
  const front = cz + faceDir * D / 2, back = cz - faceDir * D / 2;
  solid(W, 0.2, D, cx, 0, cz, MATS.floor);                 // piso
  solid(W + 1.1, 0.35, D + 1.1, cx, H, cz, MATS.roof);     // telhado com beiral
  // frente: porta à esquerda (-2.6, larg 1.7) e janela à direita (2.9, larg 2.4)
  solid(2.05, H, t, cx - 4.475, 0, front, sideMat);
  solid(3.45, H, t, cx - 0.025, 0, front, sideMat);
  solid(1.4, H, t, cx + 4.8, 0, front, sideMat);
  solid(1.7, H - 2.2, t, cx - 2.6, 2.2, front, sideMat);   // verga da porta
  solid(2.4, 1.0, t, cx + 2.9, 0, front, sideMat);         // parapeito da janela
  solid(2.4, H - 2.3, t, cx + 2.9, 2.3, front, sideMat);   // acima da janela
  deco(2.3, 1.25, 0.06, cx + 2.9, 1.02, front, MATS.glass); // vidro da janela frontal
  wallWithDoor(cx, back, W, 'x', sideMat, 2.6);            // trás: porta à direita
  // laterais com janela central
  for (const sx of [-1, 1]) {
    const wx = cx + sx * W / 2;
    solid(t, H, 2.6, wx, 0, cz - D / 2 + 1.3, sideMat);
    solid(t, H, 2.6, wx, 0, cz + D / 2 - 1.3, sideMat);
    solid(t, 1.0, D - 5.2, wx, 0, cz, sideMat);            // parapeito
    solid(t, H - 2.3, D - 5.2, wx, 2.3, cz, sideMat);      // acima da janela
    deco(0.06, 1.25, D - 5.3, wx, 1.02, cz, MATS.glass);   // vidro lateral
  }
  // divisória interna com vão
  solid(4.5, H, 0.25, cx - W / 2 + 2.25, 0, cz, MATS.interior);
  // móveis (cobertura interna)
  solid(1.8, 0.9, 0.9, cx + 3, 0.2, cz - 2.5, MATS.furniture);
  solid(0.9, 1.6, 0.9, cx - 4.2, 0.2, cz + 2.6, MATS.furniture);
  // chaminé decorativa
  deco(0.8, 1.2, 0.8, cx - 3.4, H, cz - 1.5, MATS.concrete);
}

function wheel(x, y, z, r = 0.42, w = 0.28) {
  const geo = new THREE.CylinderGeometry(r, r, w, 14);
  const m = new THREE.Mesh(geo, MATS.tire);
  m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  m.castShadow = true;
  G.scene.add(m);
}

function car(cx, cz, bodyMat) {
  solid(4.2, 1.1, 2, cx, 0.35, cz, bodyMat);                  // carroceria
  solid(2.1, 0.75, 1.8, cx - 0.2, 1.45, cz, bodyMat);         // cabine
  deco(1.9, 0.55, 1.84, cx - 0.2, 1.5, cz, MATS.darkGlass);   // vidros
  wheel(cx - 1.4, 0.42, cz - 1.0); wheel(cx + 1.4, 0.42, cz - 1.0);
  wheel(cx - 1.4, 0.42, cz + 1.0); wheel(cx + 1.4, 0.42, cz + 1.0);
  // colisor baixo extra sob a carroceria
  G.colliders.push(aabb(cx, 0.25, cz, 4.2, 0.5, 2));
}

function bus(cx, cz) {
  solid(9, 2.6, 2.6, cx, 0.55, cz, MATS.busYellow);
  deco(9.04, 0.7, 2.5, cx, 1.9, cz, MATS.darkGlass);          // faixa de janelas
  deco(9.04, 0.12, 2.64, cx, 1.55, cz, MATS.tire);            // friso
  solid(1.5, 0.9, 2.2, cx - 5.6, 0, cz, MATS.tire);           // degrau/motor
  wheel(cx - 3, 0.5, cz - 1.32, 0.5, 0.3); wheel(cx + 3, 0.5, cz - 1.32, 0.5, 0.3);
  wheel(cx - 3, 0.5, cz + 1.32, 0.5, 0.3); wheel(cx + 3, 0.5, cz + 1.32, 0.5, 0.3);
  G.colliders.push(aabb(cx, 0.3, cz, 9, 0.6, 2.6));
}

function tree(x, z, s = 1) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.3 * s, 2.4 * s, 8), MATS.trunk);
  trunk.position.set(x, 1.2 * s, z);
  trunk.castShadow = true;
  G.scene.add(trunk);
  for (let i = 0; i < 3; i++) {
    const r = (1.7 - i * 0.35) * s;
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), i % 2 ? MATS.leaf1 : MATS.leaf2);
    leaf.position.set(x + (Math.random() - 0.5) * 0.8 * s, (2.4 + i * 1.0) * s, z + (Math.random() - 0.5) * 0.8 * s);
    leaf.castShadow = true;
    G.scene.add(leaf);
  }
}

function bush(x, z, s = 1) {
  const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.65 * s, 0), MATS.leaf2);
  b.position.set(x, 0.45 * s, z);
  b.scale.y = 0.75;
  b.castShadow = true;
  G.scene.add(b);
}

function lampPost(px, pz, armDir) {
  solid(0.22, 5, 0.22, px, 0, pz, MATS.pole);
  deco(1.6, 0.14, 0.18, px + armDir * 0.8, 4.9, pz, MATS.pole);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xfff2c8, emissiveIntensity: 0.35, roughness: 0.4 }));
  lamp.position.set(px + armDir * 1.5, 4.85, pz);
  G.scene.add(lamp);
}

// casinhas de fundo (fora do muro, só silhueta)
function bgHouse(x, z, mat, ry = 0) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(boxGeo(8, 4, 6), mat);
  body.position.y = 2;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(6, 2.4, 4), MATS.roof);
  roof.position.y = 5.2; roof.rotation.y = Math.PI / 4;
  body.castShadow = roof.castShadow = true;
  g.add(body, roof);
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  G.scene.add(g);
}

export function buildMap() {
  const S = G.scene;
  buildMats();

  // céu
  const sky = new THREE.Mesh(new THREE.SphereGeometry(240, 24, 12),
    new THREE.MeshBasicMaterial({ map: skyTex(), side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  S.add(sky);
  S.fog = new THREE.Fog(0xc4dcec, 70, 220);
  // sol visível
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex((c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,250,230,1)');
      g.addColorStop(0.25, 'rgba(255,240,200,0.9)');
      g.addColorStop(1, 'rgba(255,240,200,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    }, 128, 128),
    fog: false, depthWrite: false, transparent: true,
  }));
  sunSprite.position.set(110, 150, 60);
  sunSprite.scale.set(60, 60, 1);
  S.add(sunSprite);
  // nuvens
  const cTex = cloudTex();
  for (const [cx, cy, cz, sc] of [[-90, 70, -120, 90], [60, 82, -140, 110], [140, 75, 30, 100], [-130, 78, 60, 95], [10, 88, 150, 120], [-40, 72, -60, 70]]) {
    const cl = new THREE.Sprite(new THREE.SpriteMaterial({ map: cTex, fog: false, depthWrite: false, transparent: true, opacity: 0.85 }));
    cl.position.set(cx, cy, cz);
    cl.scale.set(sc, sc * 0.45, 1);
    S.add(cl);
  }

  // luzes
  const sun = new THREE.DirectionalLight(0xfff0dc, 3.2);
  sun.position.set(45, 70, 28);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 180;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.4;
  S.add(sun);
  S.add(sun.target);
  S.add(new THREE.AmbientLight(0xbdd0e4, 0.32));
  S.add(new THREE.HemisphereLight(0xcfe4f4, 0x6a7a55, 0.5));

  // chão: grama + rua central
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), MATS.grass);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  S.add(ground); G.worldMeshes.push(ground); G.rayTargets.push(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, 9), MATS.asphalt);
  road.rotation.x = -Math.PI / 2; road.position.y = 0.02;
  road.receiveShadow = true;
  S.add(road); G.worldMeshes.push(road);
  // calçadas
  for (const sz of [-1, 1]) {
    const sw = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, 1.4), MATS.concrete);
    sw.rotation.x = -Math.PI / 2; sw.position.set(0, 0.025, sz * 5.2);
    sw.receiveShadow = true;
    S.add(sw);
  }
  // faixa central da rua
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xd8c840, roughness: 0.9 });
  for (let x = -28; x <= 28; x += 6) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.35), stripeMat);
    stripe.rotation.x = -Math.PI / 2; stripe.position.set(x, 0.03, 0);
    stripe.receiveShadow = true;
    S.add(stripe);
  }
  // faixas de pedestres nas pontas
  const cwMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.9 });
  for (const rx of [-29, 29]) {
    for (let i = -3; i <= 3; i++) {
      const cw = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.0), cwMat);
      cw.rotation.x = -Math.PI / 2; cw.position.set(rx, 0.035, i * 1.3);
      S.add(cw);
    }
  }

  // muros do perímetro
  const HW = 3.2;
  solid(MAP_W + 2, HW, 1, 0, 0, -MAP_D / 2, MATS.concrete);
  solid(MAP_W + 2, HW, 1, 0, 0, MAP_D / 2, MATS.concrete);
  solid(1, HW, MAP_D + 2, -MAP_W / 2, 0, 0, MATS.concrete);
  solid(1, HW, MAP_D + 2, MAP_W / 2, 0, 0, MATS.concrete);

  // casas (uma de cada lado da rua, em diagonal — como em Nuketown)
  fullHouse(-17, -11, 1, MATS.sideYellow);   // casa amarela (lado alpha)
  fullHouse(17, 11, -1, MATS.sideGreen);     // casa verde (lado bravo)

  // veículos
  bus(0, 0.8);
  car(-8, -3.4, MATS.carRed);
  car(9, 3.6, MATS.carBlue);

  // caminhão de mudança no quintal alpha / trailer no quintal bravo
  solid(3, 2.6, 5.5, -24, 0.5, 6, MATS.truckWhite);
  G.colliders.push(aabb(-24, 0.25, 6, 3, 0.5, 5.5));
  wheel(-25.1, 0.45, 4.2, 0.45); wheel(-22.9, 0.45, 4.2, 0.45);
  wheel(-25.1, 0.45, 7.8, 0.45); wheel(-22.9, 0.45, 7.8, 0.45);
  solid(3, 2.6, 5.5, 24, 0.5, -6, MATS.trailer);
  G.colliders.push(aabb(24, 0.25, -6, 3, 0.5, 5.5));
  wheel(25.1, 0.45, -4.2, 0.45); wheel(22.9, 0.45, -4.2, 0.45);
  wheel(25.1, 0.45, -7.8, 0.45); wheel(22.9, 0.45, -7.8, 0.45);

  // cercas dos quintais (criam corredores laterais)
  solid(0.25, 2.2, 12, -10.5, 0, -14, MATS.fence);
  solid(0.25, 2.2, 12, 10.5, 0, 14, MATS.fence);
  solid(9, 2.2, 0.25, -15, 0, -5.5, MATS.fence);
  solid(9, 2.2, 0.25, 15, 0, 5.5, MATS.fence);

  // caixotes espalhados (cobertura)
  solid(1.4, 1.4, 1.4, -3, 0, 7.5, MATS.wood);
  solid(1.4, 1.4, 1.4, -4.5, 0, 7.9, MATS.wood);
  solid(1.4, 1.4, 1.4, -3.7, 1.4, 7.7, MATS.wood);
  solid(1.4, 1.4, 1.4, 4, 0, -7.5, MATS.wood);
  solid(1.4, 1.4, 1.4, 5.5, 0, -7.1, MATS.wood);
  solid(1.4, 1.4, 1.4, 2.5, 0, 12, MATS.wood);
  solid(1.4, 1.4, 1.4, -2.5, 0, -12, MATS.wood);
  solid(2, 1.1, 2, -22, 0, -13, MATS.wood);
  solid(2, 1.1, 2, 22, 0, 13, MATS.wood);

  // postes de luz
  lampPost(-12, 5.5, 1);
  lampPost(12, -5.5, -1);

  // vegetação dentro dos quintais (visual, sem colisão)
  bush(-13.5, -15.5); bush(-21, -16); bush(13.5, 15.5); bush(21, 16);
  bush(-11.5, 8.5); bush(11.5, -8.5);

  // árvores e casario atrás dos muros (cenário)
  tree(-36, -12); tree(-38, 8, 1.2); tree(36, 12); tree(38, -8, 1.15);
  tree(-20, -24); tree(20, 24, 1.1); tree(6, -25, 0.9); tree(-6, 25, 0.95);
  bgHouse(-45, -20, MATS.sideGreen, 0.4);
  bgHouse(-48, 14, MATS.sideYellow, -0.3);
  bgHouse(45, 20, MATS.sideYellow, -0.5);
  bgHouse(48, -14, MATS.sideGreen, 0.2);
  bgHouse(-16, -32, MATS.sideGreen, 0.1);
  bgHouse(16, 32, MATS.sideYellow, 0);

  // pontos de spawn
  G.spawns.alpha = [[-27, 0, -4], [-27, 0, 4], [-23, 0, 12], [-25, 0, -12], [-20, 0, 0]];
  G.spawns.bravo = [[27, 0, 4], [27, 0, -4], [23, 0, -12], [25, 0, 12], [20, 0, 0]];
  G.spawns.ffa = [
    [-27, 0, -4], [27, 0, 4], [-23, 0, 12], [23, 0, -12], [0, 0, 15],
    [0, 0, -15], [-13, 0, 0], [13, 0, 0], [-17, 0, -11], [17, 0, 11],
  ];
  G.spawns.alpha = G.spawns.alpha.map(p => ({ x: p[0], y: p[1], z: p[2] }));
  G.spawns.bravo = G.spawns.bravo.map(p => ({ x: p[0], y: p[1], z: p[2] }));
  G.spawns.ffa = G.spawns.ffa.map(p => ({ x: p[0], y: p[1], z: p[2] }));

  // waypoints para bots
  G.waypoints = [
    { x: -27, z: 0 }, { x: -22, z: -12 }, { x: -22, z: 12 }, { x: -13, z: 0 },
    { x: -17, z: -15 }, { x: -6, z: 7 }, { x: -6, z: -7 }, { x: 0, z: 14 },
    { x: 0, z: -14 }, { x: 6, z: 7 }, { x: 6, z: -7 }, { x: 13, z: 0 },
    { x: 17, z: 15 }, { x: 22, z: -12 }, { x: 22, z: 12 }, { x: 27, z: 0 },
    { x: -17, z: -8 }, { x: 17, z: 8 },
  ];

  return { w: MAP_W, d: MAP_D };
}
