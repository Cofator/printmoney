// Estado global compartilhado entre os módulos.
export const G = {
  scene: null, camera: null, renderer: null,
  colliders: [],      // AABBs estáticos {min:{x,y,z}, max:{x,y,z}}
  rayTargets: [],     // meshes do mundo + partes dos soldados (para tiros)
  worldMeshes: [],    // apenas cenário
  spawns: { alpha: [], bravo: [], ffa: [] },
  waypoints: [],      // pontos de patrulha dos bots

  players: new Map(), // id -> {id,name,team,hp,kills,deaths,score,streak,alive,isBot,soldier,lastState}
  myId: 'local',
  isHost: true,
  online: false,
  net: null,

  state: 'menu',      // menu | class | playing | dead | ended
  mode: 'tdm',
  timeLeft: 600,
  scoreLimit: 75,
  scores: { alpha: 0, bravo: 0 },
  uavUntil: { alpha: 0, bravo: 0 },
  now: 0,             // relógio do jogo em segundos (acumulado)

  hooks: {},          // preenchido por game.js: applyDamage, shotFired, throwNade, addKillfeed...
};

export function me() { return G.players.get(G.myId); }

export function aabb(cx, cy, cz, w, h, d) {
  return { min: { x: cx - w / 2, y: cy - h / 2, z: cz - d / 2 },
           max: { x: cx + w / 2, y: cy + h / 2, z: cz + d / 2 } };
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
