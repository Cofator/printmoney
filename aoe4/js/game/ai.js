// IA adversária. Opera diretamente na simulação (lado host).
import { TILE, UNITS, BUILDINGS, RESOURCE_NODES, AGES } from './config.js';
import { dist2 } from '../engine/utils.js';

const DIFF = {
  easy:   { villagerTarget: 16, armyAttack: 8,  thinkEvery: 40, ageDelay: 1.4, aggression: 0.5 },
  normal: { villagerTarget: 24, armyAttack: 10, thinkEvery: 28, ageDelay: 1.0, aggression: 0.8 },
  hard:   { villagerTarget: 34, armyAttack: 12, thinkEvery: 18, ageDelay: 0.7, aggression: 1.1 },
};

export class AI {
  constructor(playerId, difficulty = 'normal') {
    this.pid = playerId;
    this.cfg = DIFF[difficulty] || DIFF.normal;
    this.lastThink = 0;
    this.attackWave = 0;
    this.resFocus = ['food','wood','food','gold','wood','stone'];
  }

  update(sim) {
    if (sim.tick - this.lastThink < this.cfg.thinkEvery) return;
    this.lastThink = sim.tick;
    const p = sim.players[this.pid];
    if (!p || p.defeated) return;

    const mine = this.myEntities(sim);
    const villagers = mine.filter(e => e.type === 'villager');
    const buildings = mine.filter(e => e.building);
    const tc = buildings.find(b => b.type === 'town_center' && b.constructed);
    const military = mine.filter(e => e.unit && e.type !== 'villager');

    // 1) economia: aldeões ociosos vão coletar + rebalanceamento contínuo
    this.assignIdleVillagers(sim, villagers);
    this.rebalanceGatherers(sim, villagers);

    // 2) treinar aldeões
    if (tc && villagers.length < this.cfg.villagerTarget &&
        p.popUsed + sim.queuedPop(p) < p.popCap && tc.queue.length < 2) {
      if (sim.canAfford(p, UNITS.villager.cost))
        sim.applyCommand({ type:'train', owner:this.pid, buildingId:tc.id, unitType:'villager' });
    }

    // 3) casas quando perto do limite
    if (p.popCap - p.popUsed <= 3 && p.popCap < 190 && this.countQueuedBuild(sim,'house') < 1) {
      this.buildNear(sim, villagers, 'house');
    }

    // 4) edifícios econômicos/militares por prioridade
    const has = (t) => buildings.some(b => b.type === t);
    const building = (t) => this.countQueuedBuild(sim, t) > 0;
    const wantBuild = [];
    if (!has('mill') && !building('mill')) wantBuild.push('mill');
    if (!has('lumber_camp') && !building('lumber_camp')) wantBuild.push('lumber_camp');
    if (!has('barracks') && !building('barracks') && villagers.length >= 8) wantBuild.push('barracks');
    if (!has('mining_camp') && !building('mining_camp') && villagers.length >= 12) wantBuild.push('mining_camp');
    if (p.age >= 1 && !has('archery') && !building('archery')) wantBuild.push('archery');
    if (p.age >= 1 && !has('stable') && !building('stable')) wantBuild.push('stable');
    for (const t of wantBuild) {
      if (sim.canAfford(p, BUILDINGS[t].cost)) { this.buildNear(sim, villagers, t); break; }
    }

    // 5) avançar era
    if (tc && !p.ageResearch && p.age + 1 < AGES.length && villagers.length >= 12 * this.cfg.ageDelay) {
      if (sim.canAfford(p, AGES[p.age+1].cost))
        sim.applyCommand({ type:'age', owner:this.pid, buildingId:tc.id });
    }

    // 6) treinar militares
    this.trainMilitary(sim, p, buildings);

    // 7) atacar: pressão persistente com attack-move (engaja inimigos no caminho)
    const target = this.findEnemyTarget(sim);
    if (target && military.length >= 3) {
      const engaged = military.filter(m => m.state === 'attack' || m.state === 'attackmove').length;
      const idleN = military.length - engaged;
      const ready = military.length >= this.cfg.armyAttack;
      if (ready) this.attackWave = 1; // uma vez atingido o tamanho de leva, mantém a pressão
      const push = this.attackWave > 0;
      if (push && (idleN > military.length * 0.3 || sim.tick - (this.lastAttackTick || 0) > 120)) {
        sim.applyCommand({ type:'move', owner:this.pid, ids: military.map(e=>e.id),
          x: target.x, y: target.y, attackMove: true });
        this.lastAttackTick = sim.tick;
      }
    } else if (tc && military.length > 0) {
      for (const m of military) if (m.state === 'idle')
        sim.applyCommand({ type:'move', owner:this.pid, ids:[m.id], x: tc.x, y: tc.y + TILE*3 });
    }
  }

  myEntities(sim) {
    const out = [];
    for (const e of sim.entities.values()) if (e.owner === this.pid) out.push(e);
    return out;
  }

  assignIdleVillagers(sim, villagers) {
    const p = sim.players[this.pid];
    for (const v of villagers) {
      if (v.state === 'idle' || (v.state === 'gather' && !v.gather)) {
        // escolhe recurso menos abundante conforme foco
        const res = this.pickResource(p);
        const node = this.nearestNode(sim, v, res) || this.nearestNode(sim, v, null);
        if (node) sim.applyCommand({ type:'gather', owner:this.pid, ids:[v.id], nodeId: node.id });
      }
    }
  }

  // Reequilibra os coletores conforme a necessidade (evita fome de comida etc.)
  rebalanceGatherers(sim, villagers) {
    const p = sim.players[this.pid];
    const gatherers = villagers.filter(v => v.gather && v.gather.res &&
      (v.state === 'gather' || v.state === 'return'));
    if (gatherers.length < 3) return;
    const counts = { food:0, wood:0, gold:0, stone:0 };
    for (const v of gatherers) counts[v.gather.res]++;
    const total = gatherers.length;
    const early = p.age === 0;
    const want = early ? { food:0.42, wood:0.35, gold:0.14, stone:0.09 }
                       : { food:0.36, wood:0.30, gold:0.24, stone:0.10 };
    // se comida muito baixa, prioriza comida ainda mais
    if (p.res.food < 60) { want.food += 0.15; want.gold -= 0.08; want.stone -= 0.04; want.wood -= 0.03; }
    let defRes = null, defScore = 0.6, surRes = null, surScore = 0.6;
    for (const r of ['food','wood','gold','stone']) {
      const target = total * want[r];
      if (target - counts[r] > defScore) { defScore = target - counts[r]; defRes = r; }
      if (counts[r] - target > surScore && counts[r] > 0) { surScore = counts[r] - target; surRes = r; }
    }
    if (defRes && surRes && defRes !== surRes) {
      const v = gatherers.find(g => g.gather.res === surRes);
      const node = this.nearestNode(sim, v, defRes);
      if (v && node) sim.applyCommand({ type:'gather', owner:this.pid, ids:[v.id], nodeId: node.id });
    }
  }

  pickResource(p) {
    // balanceia: retorna o recurso com menor estoque relativo entre food/wood/gold/stone
    const weights = { food: p.res.food, wood: p.res.wood, gold: p.res.gold*1.5, stone: p.res.stone*2 };
    let min = 'food', minV = Infinity;
    for (const [k, v] of Object.entries(weights)) if (v < minV) { minV = v; min = k; }
    return min;
  }

  nearestNode(sim, e, res) {
    let best = null, bestD = Infinity;
    for (const n of sim.nodes.values()) {
      if (res && RESOURCE_NODES[n.type].gives !== res) continue;
      if (n.amount <= 0) continue;
      const d = dist2(e.x, e.y, n.x*TILE, n.y*TILE);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  countQueuedBuild(sim, type) {
    let n = 0;
    for (const e of sim.entities.values())
      if (e.owner === this.pid && e.building && e.type === type && !e.constructed) n++;
    return n;
  }

  buildNear(sim, villagers, type) {
    const p = sim.players[this.pid];
    if (!sim.canAfford(p, BUILDINGS[type].cost)) return;
    const tc = this.myEntities(sim).find(b => b.type === 'town_center');
    if (!tc) return;
    const def = BUILDINGS[type];
    // procura ponto válido em espiral ao redor do TC
    const cx = tc.bx, cy = tc.by;
    for (let r = 3; r < 14; r++) {
      for (let a = 0; a < 8; a++) {
        const ang = a / 8 * Math.PI * 2;
        const tx = Math.round(cx + Math.cos(ang) * r);
        const ty = Math.round(cy + Math.sin(ang) * r);
        if (sim.canPlace(tx, ty, def.size)) {
          const builder = villagers.find(v => v.state === 'idle' || v.state === 'gather') || villagers[0];
          if (!builder) return;
          sim.applyCommand({ type:'build', owner:this.pid, buildingType:type, tx, ty, ids:[builder.id] });
          return;
        }
      }
    }
  }

  trainMilitary(sim, p, buildings) {
    const options = [];
    for (const b of buildings) {
      if (!b.constructed || !BUILDINGS[b.type].trains) continue;
      for (const ut of BUILDINGS[b.type].trains) {
        if (ut === 'villager') continue;
        if (UNITS[ut].age > p.age) continue;
        options.push({ b, ut });
      }
    }
    if (!options.length) return;
    // treina até 2 opções por ciclo se houver população e recursos
    let trained = 0;
    for (const { b, ut } of options) {
      if (trained >= 2) break;
      if (b.queue.length >= 3) continue;
      if (p.popUsed + sim.queuedPop(p) >= p.popCap) break;
      if (sim.canAfford(p, UNITS[ut].cost)) {
        sim.applyCommand({ type:'train', owner:this.pid, buildingId:b.id, unitType:ut });
        trained++;
      }
    }
  }

  findEnemyTarget(sim) {
    // prioriza aldeões/edifícios inimigos mais próximos do centro inimigo
    let tc = null, anyEnemy = null;
    for (const e of sim.entities.values()) {
      if (e.owner === this.pid || sim.players[e.owner]?.defeated) continue;
      anyEnemy = anyEnemy || e;
      if (e.type === 'town_center') { tc = e; break; }
    }
    return tc || anyEnemy;
  }
}
