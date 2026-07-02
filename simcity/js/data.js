/* ============================================================
 * Micropolis 2000 — data.js
 * Tile / building catalog, costs, simulation constants.
 * ============================================================ */
'use strict';

// Terrain codes
const T_GRASS = 0, T_WATER = 1, T_TREE = 2, T_RUBBLE = 3, T_SAND = 4;

// Tile type codes (0 = empty terrain)
const B_NONE = 0, B_ROAD = 1, B_WIRE = 2, B_RES = 3, B_COM = 4, B_IND = 5, B_RAIL = 6;
const B_COAL = 10, B_GAS = 11, B_NUKE = 12, B_WIND = 13, B_SOLAR = 14;
const B_POLICE = 20, B_FIRE = 21, B_HOSP = 22, B_SCHOOL = 23, B_COLLEGE = 24, B_LIBRARY = 25;
const B_PARK = 30, B_ZOO = 31, B_STADIUM = 32, B_MARINA = 33;
const B_PUMP = 40, B_WTOWER = 41;
const B_AIRPORT = 50, B_SEAPORT = 51;

// Catalog. size = footprint (n x n). power = MW consumed. plant = MW produced.
// cov = {map, radius, amount} service coverage. flam = flammability 0..1.
const BLD = {
  [B_ROAD]:    { name: 'Road',          size: 1, cost: 10,    maint: 1,   flam: 0,   drag: true },
  [B_RAIL]:    { name: 'Rail',          size: 1, cost: 25,    maint: 2,   flam: 0,   drag: true },
  [B_WIRE]:    { name: 'Power Line',    size: 1, cost: 5,     maint: 0.5, flam: 0.1, drag: true },
  [B_RES]:     { name: 'Residential Zone', size: 1, cost: 50, maint: 0, power: 1, flam: 0.9, zone: true, drag: true },
  [B_COM]:     { name: 'Commercial Zone',  size: 1, cost: 75, maint: 0, power: 1, flam: 0.8, zone: true, drag: true },
  [B_IND]:     { name: 'Industrial Zone',  size: 1, cost: 100, maint: 0, power: 1, flam: 0.9, zone: true, drag: true },
  [B_COAL]:    { name: 'Coal Power Plant', size: 3, cost: 4000, maint: 40, plant: 250, flam: 0.6, poll: 90 },
  [B_GAS]:     { name: 'Gas Power Plant',  size: 2, cost: 2000, maint: 25, plant: 120, flam: 0.7, poll: 45 },
  [B_NUKE]:    { name: 'Nuclear Plant',    size: 3, cost: 15000, maint: 100, plant: 700, flam: 0.2, poll: 0 },
  [B_WIND]:    { name: 'Wind Turbine',     size: 1, cost: 400,  maint: 4,  plant: 8,   flam: 0.1, poll: 0 },
  [B_SOLAR]:   { name: 'Solar Farm',       size: 2, cost: 1500, maint: 8,  plant: 60,  flam: 0.1, poll: 0 },
  [B_POLICE]:  { name: 'Police Station', size: 2, cost: 500,  maint: 30, power: 3, flam: 0.4, cov: { map: 'pcov', radius: 16 } },
  [B_FIRE]:    { name: 'Fire Station',   size: 2, cost: 500,  maint: 30, power: 3, flam: 0.2, cov: { map: 'fcov', radius: 16 } },
  [B_HOSP]:    { name: 'Hospital',       size: 2, cost: 600,  maint: 35, power: 4, flam: 0.5, cov: { map: 'hcov', radius: 18 } },
  [B_SCHOOL]:  { name: 'School',         size: 2, cost: 400,  maint: 25, power: 2, flam: 0.7, cov: { map: 'ecov', radius: 16 } },
  [B_COLLEGE]: { name: 'College',        size: 3, cost: 1200, maint: 50, power: 4, flam: 0.6, cov: { map: 'ecov', radius: 24 } },
  [B_LIBRARY]: { name: 'Library',        size: 2, cost: 300,  maint: 15, power: 1, flam: 0.7, cov: { map: 'ecov', radius: 12 } },
  [B_PARK]:    { name: 'Park',           size: 1, cost: 20,   maint: 2,  flam: 0.6, lval: 12, drag: true },
  [B_ZOO]:     { name: 'Zoo',            size: 3, cost: 3000, maint: 60, power: 3, flam: 0.5, lval: 25 },
  [B_STADIUM]: { name: 'Stadium',        size: 4, cost: 5000, maint: 80, power: 8, flam: 0.4, lval: 20 },
  [B_MARINA]:  { name: 'Marina',         size: 2, cost: 1000, maint: 20, power: 1, flam: 0.4, lval: 25, nearWater: true },
  [B_PUMP]:    { name: 'Water Pump',     size: 1, cost: 250,  maint: 10, power: 2, flam: 0.2, nearWater: true, watCov: 22 },
  [B_WTOWER]:  { name: 'Water Tower',    size: 2, cost: 450,  maint: 12, power: 2, flam: 0.2, watCov: 14 },
  [B_AIRPORT]: { name: 'Airport',        size: 4, cost: 10000, maint: 150, power: 12, flam: 0.5, poll: 40 },
  [B_SEAPORT]: { name: 'Seaport',        size: 3, cost: 5000, maint: 80, power: 6, flam: 0.5, poll: 30, nearWater: true },
};

// Tool ids used by the UI (extra pseudo-tools)
const TOOL_INSPECT = 'inspect', TOOL_DOZE = 'doze', TOOL_TERRA_TREE = 'tree', TOOL_TERRA_WATER = 'water', TOOL_TERRA_LAND = 'land';
const DOZE_COST = 5, TREE_COST = 10, WATER_COST = 100, LAND_COST = 100;

// Toolbar layout: groups of [toolId, label, hotkey]
const TOOL_GROUPS = [
  { name: 'Tools', items: [
    [TOOL_INSPECT, 'Inspect', 'Q'],
    [TOOL_DOZE, 'Bulldoze', 'B'],
  ]},
  { name: 'Terrain', items: [
    [TOOL_TERRA_TREE, 'Plant Trees', 'T'],
    [TOOL_TERRA_WATER, 'Dig Water', ''],
    [TOOL_TERRA_LAND, 'Fill Land', ''],
  ]},
  { name: 'Transport & Power', items: [
    [B_ROAD, 'Road', 'R'],
    [B_RAIL, 'Rail', ''],
    [B_WIRE, 'Power Line', 'P'],
  ]},
  { name: 'Zones', items: [
    [B_RES, 'Residential', '1'],
    [B_COM, 'Commercial', '2'],
    [B_IND, 'Industrial', '3'],
  ]},
  { name: 'Power Plants', items: [
    [B_COAL, 'Coal Plant', ''],
    [B_GAS, 'Gas Plant', ''],
    [B_NUKE, 'Nuclear', ''],
    [B_WIND, 'Wind Turbine', ''],
    [B_SOLAR, 'Solar Farm', ''],
  ]},
  { name: 'Water', items: [
    [B_PUMP, 'Water Pump', ''],
    [B_WTOWER, 'Water Tower', ''],
  ]},
  { name: 'Services', items: [
    [B_POLICE, 'Police', ''],
    [B_FIRE, 'Fire Station', ''],
    [B_HOSP, 'Hospital', ''],
    [B_SCHOOL, 'School', ''],
    [B_COLLEGE, 'College', ''],
    [B_LIBRARY, 'Library', ''],
  ]},
  { name: 'Recreation', items: [
    [B_PARK, 'Park', ''],
    [B_ZOO, 'Zoo', ''],
    [B_STADIUM, 'Stadium', ''],
    [B_MARINA, 'Marina', ''],
  ]},
  { name: 'Special', items: [
    [B_AIRPORT, 'Airport', ''],
    [B_SEAPORT, 'Seaport', ''],
  ]},
];

// Simulation constants
const SIM = {
  START_FUNDS: 20000,
  START_YEAR: 1950,
  STEPS_PER_MONTH: 24,     // sim steps per game month
  STEP_MS: 200,            // ms per sim step at speed 1
  MAX_LVL: 8,              // max zone development level
  POP_PER_LVL: { [B_RES]: 12, [B_COM]: 8, [B_IND]: 10 }, // residents / jobs per level
  ZONE_POWER: (lvl) => 1 + (lvl >> 1),
  ROAD_REACH: 4,           // zone must have road within this many dilation steps
  TAX_DEFAULT: 7,          // %
  BOND_AMOUNT: 10000,
  BOND_RATE: 0.06,
};

// Disaster ids
const DIS_FIRE = 'fire', DIS_TORNADO = 'tornado', DIS_QUAKE = 'quake', DIS_METEOR = 'meteor', DIS_MONSTER = 'monster';
