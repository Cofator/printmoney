// Mapa inspirado em Nuketown: duas casas frente a frente, rua central com ônibus e carros.
import * as THREE from 'three';
import { G, aabb } from './state.js';

const MAP_W = 64, MAP_D = 40; // limites jogáveis

function mat(color, rough = 0.9) {
  return new THREE.MeshLambertMaterial({ color });
}

let _geoCache = new Map();
function boxGeo(w, h, d) {
  const k = w + ',' + h + ',' + d;
  if (!_geoCache.has(k)) _geoCache.set(k, new THREE.BoxGeometry(w, h, d));
  return _geoCache.get(k);
}

// Cria um bloco sólido: mesh + colisor + alvo de raycast.
function solid(w, h, d, x, y, z, color, opts = {}) {
  const m = new THREE.Mesh(boxGeo(w, h, d), mat(color));
  m.position.set(x, y + h / 2, z);
  G.scene.add(m);
  if (opts.collide !== false) G.colliders.push(aabb(x, y + h / 2, z, w, h, d));
  G.worldMeshes.push(m);
  G.rayTargets.push(m);
  return m;
}

// Parede com abertura de porta e/ou janela — composta por segmentos.
function wallWithDoor(cx, cz, len, axis, color, doorAt = 0, doorW = 1.7, h = 3.4) {
  // axis: 'x' (parede corre ao longo de x) ou 'z'
  const t = 0.35; // espessura
  const half = len / 2;
  const segs = [
    { from: -half, to: doorAt - doorW / 2 },
    { from: doorAt + doorW / 2, to: half },
  ];
  for (const s of segs) {
    const L = s.to - s.from;
    if (L <= 0.05) continue;
    const mid = (s.from + s.to) / 2;
    if (axis === 'x') solid(L, h, t, cx + mid, 0, cz, color);
    else solid(t, h, L, cx, 0, cz + mid, color);
  }
  // verga acima da porta
  if (axis === 'x') solid(doorW, h - 2.2, t, cx + doorAt, 2.2, cz, color);
  else solid(t, h - 2.2, doorW, cx, 2.2, cz + doorAt, color);
}

// Constrói casa completa (frente/trás/lados com vãos de porta e janela).
function fullHouse(cx, cz, faceDir, color) {
  // faceDir: +1 casa olha para +z (rua), -1 olha para -z
  const W = 11, D = 8.5, H = 3.4, t = 0.35;
  const front = cz + faceDir * D / 2, back = cz - faceDir * D / 2;
  solid(W, 0.2, D, cx, 0, cz, 0x8a8378);           // piso
  solid(W + 0.7, 0.35, D + 0.7, cx, H, cz, 0x4d4740); // telhado
  // frente: porta à esquerda (-2.6, larg 1.7) e janela à direita (2.9, larg 2.4)
  solid(2.05, H, t, cx - 4.475, 0, front, color);  // [-5.5,-3.45]
  solid(3.45, H, t, cx - 0.025, 0, front, color);  // [-1.75,1.7]
  solid(1.4, H, t, cx + 4.8, 0, front, color);     // [4.1,5.5]
  solid(1.7, H - 2.2, t, cx - 2.6, 2.2, front, color); // verga da porta
  solid(2.4, 1.0, t, cx + 2.9, 0, front, color);   // parapeito da janela
  solid(2.4, H - 2.3, t, cx + 2.9, 2.3, front, color); // acima da janela
  wallWithDoor(cx, back, W, 'x', color, 2.6);      // trás: porta à direita
  // laterais com janela central
  for (const sx of [-1, 1]) {
    const wx = cx + sx * W / 2;
    solid(t, H, 2.6, wx, 0, cz - D / 2 + 1.3, color);
    solid(t, H, 2.6, wx, 0, cz + D / 2 - 1.3, color);
    solid(t, 1.0, D - 5.2, wx, 0, cz, color);        // parapeito
    solid(t, H - 2.3, D - 5.2, wx, 2.3, cz, color);  // acima da janela
  }
  // divisória interna com vão
  solid(4.5, H, 0.25, cx - W / 2 + 2.25, 0, cz, 0xbbb2a2);
  // móveis (cobertura interna)
  solid(1.8, 0.9, 0.9, cx + 3, 0, cz - 2.5, 0x6b4a2f);
  solid(0.9, 1.6, 0.9, cx - 4.2, 0, cz + 2.6, 0x7a6a55);
}

export function buildMap() {
  const S = G.scene;

  // céu / névoa / luz
  S.background = new THREE.Color(0x9fc8e8);
  S.fog = new THREE.Fog(0x9fc8e8, 60, 160);
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.4);
  sun.position.set(30, 60, 20);
  S.add(sun);
  S.add(new THREE.AmbientLight(0x99aabb, 1.5));
  const hemi = new THREE.HemisphereLight(0xbdd8f0, 0x6a7a55, 0.8);
  S.add(hemi);

  // chão: grama + rua central
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), mat(0x6f8f4a));
  ground.rotation.x = -Math.PI / 2;
  S.add(ground); G.worldMeshes.push(ground); G.rayTargets.push(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, 9), mat(0x4a4a4d));
  road.rotation.x = -Math.PI / 2; road.position.y = 0.02;
  S.add(road); G.worldMeshes.push(road);
  // faixa central da rua
  for (let x = -28; x <= 28; x += 6) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.35), mat(0xd8c840));
    stripe.rotation.x = -Math.PI / 2; stripe.position.set(x, 0.03, 0);
    S.add(stripe);
  }

  // muros do perímetro
  const wallC = 0x7d7466, HW = 3.2;
  solid(MAP_W + 2, HW, 1, 0, 0, -MAP_D / 2, wallC);
  solid(MAP_W + 2, HW, 1, 0, 0, MAP_D / 2, wallC);
  solid(1, HW, MAP_D + 2, -MAP_W / 2, 0, 0, wallC);
  solid(1, HW, MAP_D + 2, MAP_W / 2, 0, 0, wallC);

  // casas (uma de cada lado da rua, em diagonal — como em Nuketown)
  fullHouse(-17, -11, 1, 0xc9b45c);   // casa amarela (lado alpha)
  fullHouse(17, 11, -1, 0x76b5a0);    // casa verde (lado bravo)

  // ônibus no centro da rua
  solid(9, 3, 2.6, 0, 0, 0.8, 0xd8a02a);
  solid(1.5, 0.9, 2.2, -5.6, 0, 0.8, 0x333333); // motor/degrau (cobertura baixa)

  // carros
  solid(4.2, 1.4, 2, -8, 0, -3.4, 0x9c3b3b);
  solid(1.8, 0.7, 1.8, -8, 1.4, -3.4, 0x88b0c8);
  solid(4.2, 1.4, 2, 9, 0, 3.6, 0x3b5e9c);
  solid(1.8, 0.7, 1.8, 9, 1.4, 3.6, 0x88b0c8);

  // caminhão de mudança no quintal alpha
  solid(3, 2.6, 5.5, -24, 0, 6, 0xb8b8b8);
  // trailer no quintal bravo
  solid(3, 2.6, 5.5, 24, 0, -6, 0x9fb8a0);

  // cercas dos quintais (criam corredores laterais)
  const fenceC = 0xa88f5f;
  solid(0.25, 2.2, 12, -10.5, 0, -14, fenceC);
  solid(0.25, 2.2, 12, 10.5, 0, 14, fenceC);
  solid(9, 2.2, 0.25, -15, 0, -5.5, fenceC);
  solid(9, 2.2, 0.25, 15, 0, 5.5, fenceC);

  // caixotes espalhados (cobertura)
  const crate = 0x8f6b3d;
  solid(1.4, 1.4, 1.4, -3, 0, 7.5, crate);
  solid(1.4, 1.4, 1.4, -4.5, 0, 7.9, crate);
  solid(1.4, 1.4, 1.4, -3.7, 1.4, 7.7, crate);
  solid(1.4, 1.4, 1.4, 4, 0, -7.5, crate);
  solid(1.4, 1.4, 1.4, 5.5, 0, -7.1, crate);
  solid(1.4, 1.4, 1.4, 2.5, 0, 12, crate);
  solid(1.4, 1.4, 1.4, -2.5, 0, -12, crate);
  solid(2, 1.1, 2, -22, 0, -13, crate);
  solid(2, 1.1, 2, 22, 0, 13, crate);

  // postes decorativos
  for (const [px, pz] of [[-12, 5.5], [12, -5.5]]) {
    solid(0.28, 5, 0.28, px, 0, pz, 0x555555);
  }

  // manequins de bairro-teste (decoração nuketown)
  for (const [px, pz] of [[-26, -2], [26, 2]]) {
    solid(0.5, 1.7, 0.5, px, 0, pz, 0xd8cfc0);
  }

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
