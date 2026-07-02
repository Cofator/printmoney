// Geração procedural do mapa: terreno, água, florestas e depósitos de recursos.
import { makeRNG, randInt, dist } from '../engine/utils.js';
import { RESOURCE_NODES } from './config.js';

export const TERRAIN = { GRASS:0, WATER:1, DIRT:2, SAND:3 };

export function generateWorld(size, numPlayers, seed) {
  const W = size, H = size;
  const rng = makeRNG(seed);
  const terrain = new Uint8Array(W * H).fill(TERRAIN.GRASS);
  const nodes = [];
  let nodeId = 1;

  // Ruído de valor simples para variação de terreno (grama/terra)
  const noise = valueNoise(W, H, rng, 0.12);
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){
    const n = noise[y*W+x];
    if (n < 0.30) terrain[y*W+x] = TERRAIN.DIRT;
  }

  // Alguns lagos de água
  const lakes = randInt(rng, 1, 3);
  for (let l=0;l<lakes;l++){
    const cx = randInt(rng, 8, W-8), cy = randInt(rng, 8, H-8);
    const rad = randInt(rng, 3, 6);
    for (let y=cy-rad-2;y<=cy+rad+2;y++) for (let x=cx-rad-2;x<=cx+rad+2;x++){
      if (x<0||y<0||x>=W||y>=H) continue;
      const d = dist(x,y,cx,cy) + (noise[y*W+x]-0.5)*3;
      if (d < rad) terrain[y*W+x] = TERRAIN.WATER;
      else if (d < rad+1.4) terrain[y*W+x] = TERRAIN.SAND;
    }
  }

  // Posições iniciais dos jogadores, espalhadas nas bordas
  const starts = [];
  const margin = Math.floor(W * 0.16);
  const corners = [
    { tx: margin, ty: margin },
    { tx: W-margin, ty: H-margin },
    { tx: W-margin, ty: margin },
    { tx: margin, ty: H-margin },
  ];
  for (let i=0;i<numPlayers;i++) starts.push(corners[i]);

  const occupied = new Set();
  const key=(x,y)=>y*W+x;
  const isFree=(x,y,r=0)=>{
    for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
      const nx=x+dx,ny=y+dy;
      if(nx<0||ny<0||nx>=W||ny>=H) return false;
      if(terrain[key(nx,ny)]===TERRAIN.WATER) return false;
      if(occupied.has(key(nx,ny))) return false;
    }
    return true;
  };
  const place=(type,x,y)=>{
    if(!isFree(x,y)) return false;
    occupied.add(key(x,y));
    const def=RESOURCE_NODES[type];
    nodes.push({ id: nodeId++, type, x, y, amount: def.amount, max: def.amount });
    return true;
  };

  // Recursos garantidos perto de cada base
  for (const s of starts){
    // clareira central livre para o Centro Urbano (raio 4)
    for (let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
      const nx=s.tx+dx, ny=s.ty+dy;
      if(nx<0||ny<0||nx>=W||ny>=H) continue;
      if(terrain[key(nx,ny)]===TERRAIN.WATER) terrain[key(nx,ny)]=TERRAIN.GRASS;
    }
    // floresta próxima
    scatterCluster(rng, place, 'tree', s.tx-6, s.ty-1, 3, 22, W, H);
    scatterCluster(rng, place, 'tree', s.tx+1, s.ty+6, 3, 18, W, H);
    // ouro e pedra
    scatterCluster(rng, place, 'gold', s.tx+5, s.ty-3, 1, 5, W, H);
    scatterCluster(rng, place, 'stone', s.tx-3, s.ty+5, 1, 4, W, H);
    // comida: arbustos e ovelhas
    scatterCluster(rng, place, 'berry', s.tx+4, s.ty+3, 1, 4, W, H);
    for(let k=0;k<5;k++) place('sheep', s.tx+randInt(rng,-3,3), s.ty+randInt(rng,-3,3));
  }

  // Florestas e recursos espalhados pelo mapa
  const forests = Math.floor(W*H/280);
  for(let f=0; f<forests; f++)
    scatterCluster(rng, place, 'tree', randInt(rng,4,W-4), randInt(rng,4,H-4), 2, randInt(rng,8,20), W, H);
  for(let g=0; g<Math.floor(W/12); g++)
    scatterCluster(rng, place, 'gold', randInt(rng,6,W-6), randInt(rng,6,H-6), 1, 4, W, H);
  for(let st=0; st<Math.floor(W/16); st++)
    scatterCluster(rng, place, 'stone', randInt(rng,6,W-6), randInt(rng,6,H-6), 1, 3, W, H);
  for(let b=0; b<Math.floor(W/14); b++)
    scatterCluster(rng, place, 'berry', randInt(rng,6,W-6), randInt(rng,6,H-6), 1, 3, W, H);

  // limpa recursos coincidentes com a clareira do Centro Urbano (5x5) de cada base
  const cleared = nodes.filter(n => {
    for (const s of starts)
      if (Math.max(Math.abs(n.x - s.tx), Math.abs(n.y - s.ty)) <= 2) return false;
    return true;
  });

  return { W, H, terrain, nodes: cleared, starts, seed };
}

function scatterCluster(rng, place, type, cx, cy, radMin, count, W, H){
  let placed=0, tries=0;
  const rad = Math.max(radMin, Math.ceil(Math.sqrt(count)));
  while(placed<count && tries<count*8){
    tries++;
    const x = cx + randInt(rng,-rad,rad);
    const y = cy + randInt(rng,-rad,rad);
    if(x<0||y<0||x>=W||y>=H) continue;
    if(place(type,x,y)) placed++;
  }
}

function valueNoise(W,H,rng,scale){
  const gw=Math.ceil(W*scale)+2, gh=Math.ceil(H*scale)+2;
  const grid=new Float32Array(gw*gh);
  for(let i=0;i<grid.length;i++) grid[i]=rng();
  const out=new Float32Array(W*H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const gx=x*scale, gy=y*scale;
    const x0=Math.floor(gx), y0=Math.floor(gy);
    const fx=gx-x0, fy=gy-y0;
    const a=grid[y0*gw+x0], b=grid[y0*gw+x0+1];
    const c=grid[(y0+1)*gw+x0], d=grid[(y0+1)*gw+x0+1];
    const sx=fx*fx*(3-2*fx), sy=fy*fy*(3-2*fy);
    out[y*W+x]=(a*(1-sx)+b*sx)*(1-sy)+(c*(1-sx)+d*sx)*sy;
  }
  return out;
}
