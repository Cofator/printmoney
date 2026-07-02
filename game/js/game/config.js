// Configuração e balanceamento do jogo (data-driven).
export const TILE = 32;            // tamanho do tile em unidades de mundo
export const TICK_RATE = 20;       // ticks de simulação por segundo
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_EVERY = 2;   // host envia snapshot a cada N ticks (10 Hz)

export const RES = ['food', 'wood', 'gold', 'stone'];

export const START_RESOURCES = { food: 200, wood: 200, gold: 100, stone: 100 };

// Eras / Ages
export const AGES = [
  { name: 'Era Feudal',   cost: { food: 0,   gold: 0 } },
  { name: 'Era dos Castelos', cost: { food: 400, gold: 200 } },
  { name: 'Era Imperial', cost: { food: 800, gold: 450 } },
];

// ---------- Tipos de recurso no mapa ----------
export const RESOURCE_NODES = {
  tree:      { gives: 'wood',  amount: 120, icon: '🌲', color: '#2e5e2a', blocking: true },
  gold:      { gives: 'gold',  amount: 320, icon: '🪙', color: '#d4af37', blocking: true },
  stone:     { gives: 'stone', amount: 260, icon: '🪨', color: '#9aa0a6', blocking: true },
  berry:     { gives: 'food',  amount: 180, icon: '🫐', color: '#7b3f9e', blocking: true },
  sheep:     { gives: 'food',  amount: 140, icon: '🐑', color: '#e8e2d0', blocking: false },
  farm:      { gives: 'food',  amount: 300, icon: '🌾', color: '#c9a227', blocking: false, built: true },
};

// ---------- Edifícios ----------
// hp, cost, size (em tiles), buildTime (seg), pop (fornece), dropoff (recursos aceitos),
// trains (unidades), age (era mínima), attack (torres)
export const BUILDINGS = {
  town_center: { name:'Centro Urbano', icon:'🏛️', hp:2400, cost:{wood:350,stone:150}, size:3,
    buildTime:60, pop:5, dropoff:['food','wood','gold','stone'], trains:['villager'],
    unique:true, age:0, sightRange:9 },
  house: { name:'Casa', icon:'🏠', hp:550, cost:{wood:30}, size:1, buildTime:10, pop:5, age:0, sightRange:4 },
  mill: { name:'Moinho', icon:'🏚️', hp:600, cost:{wood:100}, size:2, buildTime:22, dropoff:['food'],
    builds:['farm'], age:0, sightRange:5 },
  lumber_camp: { name:'Serraria', icon:'🪵', hp:600, cost:{wood:100}, size:2, buildTime:20, dropoff:['wood'], age:0, sightRange:4 },
  mining_camp: { name:'Mineração', icon:'⛏️', hp:600, cost:{wood:100}, size:2, buildTime:20, dropoff:['gold','stone'], age:0, sightRange:4 },
  barracks: { name:'Quartel', icon:'⚔️', hp:1200, cost:{wood:175}, size:3, buildTime:30,
    trains:['spearman','swordsman'], age:0, sightRange:5 },
  archery: { name:'Arqueria', icon:'🏹', hp:1000, cost:{wood:175}, size:3, buildTime:30,
    trains:['archer','crossbow'], age:1, sightRange:5 },
  stable: { name:'Estábulo', icon:'🐎', hp:1000, cost:{wood:175}, size:3, buildTime:30,
    trains:['scout','knight'], age:1, sightRange:5 },
  tower: { name:'Torre', icon:'🗼', hp:1000, cost:{wood:50,stone:125}, size:1, buildTime:25,
    attack:{damage:8,range:7,cooldown:1.0,projectile:true}, age:1, sightRange:8 },
};

// ---------- Unidades ----------
// hp, cost, trainTime(seg), speed(tiles/seg), attack{damage,range,cooldown}, sight, pop(consome)
// bonus: multiplicadores de dano contra classes; class: classe da unidade
export const UNITS = {
  villager: { name:'Aldeão', icon:'🧑‍🌾', hp:40, cost:{food:50}, trainTime:12, speed:1.4,
    attack:{damage:3,range:1,cooldown:1.5}, sight:5, pop:1, class:'civ', gather:0.55, buildRate:1, age:0 },
  spearman: { name:'Lanceiro', icon:'🔱', hp:55, cost:{food:35,wood:20}, trainTime:14, speed:1.4,
    attack:{damage:6,range:1,cooldown:1.4}, sight:5, pop:1, class:'infantry', bonus:{cavalry:3}, age:0 },
  swordsman:{ name:'Espadachim', icon:'⚔️', hp:75, cost:{food:55,gold:20}, trainTime:16, speed:1.35,
    attack:{damage:10,range:1,cooldown:1.4}, sight:5, pop:1, class:'infantry', bonus:{building:1.4}, age:0 },
  archer:   { name:'Arqueiro', icon:'🏹', hp:38, cost:{wood:40,gold:25}, trainTime:16, speed:1.4,
    attack:{damage:7,range:5,cooldown:1.6,projectile:true}, sight:6, pop:1, class:'archer', bonus:{infantry:1.3}, age:1 },
  crossbow: { name:'Besteiro', icon:'🎯', hp:45, cost:{wood:40,gold:35}, trainTime:18, speed:1.4,
    attack:{damage:11,range:6,cooldown:1.7,projectile:true}, sight:7, pop:1, class:'archer', bonus:{infantry:1.4}, age:2 },
  scout:    { name:'Batedor', icon:'🐴', hp:60, cost:{food:80}, trainTime:14, speed:2.4,
    attack:{damage:5,range:1,cooldown:1.4}, sight:9, pop:1, class:'cavalry', age:1 },
  knight:   { name:'Cavaleiro', icon:'🐎', hp:120, cost:{food:70,gold:55}, trainTime:22, speed:2.0,
    attack:{damage:14,range:1,cooldown:1.5}, sight:6, pop:1, class:'cavalry', bonus:{archer:1.5}, age:2 },
};

export const PLAYER_COLORS = [
  { name:'Azul',    hex:'#3d7edb', dark:'#245296' },
  { name:'Vermelho',hex:'#d8443a', dark:'#912a23' },
  { name:'Verde',   hex:'#4caf50', dark:'#2f7a33' },
  { name:'Amarelo', hex:'#e6c02e', dark:'#9c8018' },
];

export const GATHER_CAP = 10;       // quanto um aldeão carrega
export const POP_HARD_CAP = 200;

// Retorna a definição (unidade ou edifício) por id
export function defOf(type) {
  return UNITS[type] || BUILDINGS[type] || null;
}
export function isUnit(type){ return !!UNITS[type]; }
export function isBuilding(type){ return !!BUILDINGS[type]; }
