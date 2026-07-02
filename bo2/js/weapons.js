// Arsenal inspirado no Black Ops 2 (valores balanceados para web).
export const WEAPONS = {
  m8a1: {
    name: 'M8A1', slot: 'primary', icon: '🔫',
    desc: 'Fuzil de assalto. Versátil, boa cadência e controle.',
    dmg: 26, headMult: 1.5, rpm: 720, mag: 32, reserve: 128, reloadTime: 2.0,
    spread: 0.016, adsSpread: 0.003, recoil: 0.011, auto: true, zoom: 1.35,
    range: 70, pellets: 1, moveMult: 1.0, sniper: false,
  },
  pdw57: {
    name: 'PDW-57', slot: 'primary', icon: '⚡',
    desc: 'Submetralhadora. Cadência altíssima, ideal no corpo a corpo.',
    dmg: 20, headMult: 1.4, rpm: 900, mag: 50, reserve: 150, reloadTime: 1.8,
    spread: 0.024, adsSpread: 0.007, recoil: 0.013, auto: true, zoom: 1.25,
    range: 40, pellets: 1, moveMult: 1.08, sniper: false,
  },
  dsr50: {
    name: 'DSR 50', slot: 'primary', icon: '🎯',
    desc: 'Sniper de ferrolho. Um tiro, uma baixa.',
    dmg: 105, headMult: 1.6, rpm: 52, mag: 5, reserve: 25, reloadTime: 3.0,
    spread: 0.09, adsSpread: 0.0004, recoil: 0.05, auto: false, zoom: 4.2,
    range: 200, pellets: 1, moveMult: 0.9, sniper: true,
  },
  r870: {
    name: 'R-870 MCS', slot: 'primary', icon: '💥',
    desc: 'Escopeta de repetição. Devastadora à queima-roupa.',
    dmg: 13, headMult: 1.2, rpm: 68, mag: 8, reserve: 40, reloadTime: 2.6,
    spread: 0.055, adsSpread: 0.04, recoil: 0.05, auto: false, zoom: 1.15,
    range: 18, pellets: 8, moveMult: 0.98, sniper: false,
  },
  fiveseven: {
    name: 'FIVE-SEVEN', slot: 'secondary', icon: '🔹',
    desc: 'Pistola semi-automática confiável.',
    dmg: 24, headMult: 1.5, rpm: 420, mag: 20, reserve: 60, reloadTime: 1.5,
    spread: 0.018, adsSpread: 0.006, recoil: 0.014, auto: false, zoom: 1.2,
    range: 35, pellets: 1, moveMult: 1.1, sniper: false,
  },
};

// Classes prontas (estilo "Create-a-Class").
export const CLASSES = [
  { key: 'assault',  name: 'ASSALTO',    primary: 'm8a1',   icon: '🔫' },
  { key: 'smg',      name: 'VELOCISTA',  primary: 'pdw57',  icon: '⚡' },
  { key: 'sniper',   name: 'ATIRADOR',   primary: 'dsr50',  icon: '🎯' },
  { key: 'shotgun',  name: 'DEMOLIDOR',  primary: 'r870',   icon: '💥' },
];

// Scorestreaks (pontos necessários; kill = 100 pts).
export const STREAKS = [
  { key: 'uav',      name: 'UAV',            cost: 300, keybind: '3', desc: 'Revela inimigos no minimapa por 30s' },
  { key: 'strike',   name: 'HELLSTORM',      cost: 500, keybind: '4', desc: 'Míssil atinge todos os inimigos em área aberta' },
  { key: 'dogs',     name: 'CÃES DE GUERRA', cost: 700, keybind: '5', desc: 'Dano massivo em todos os inimigos' },
];
