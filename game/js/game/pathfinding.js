// A* em grade com movimento em 8 direções, com cache leve por tick.
// grid: Uint8Array (0 = livre, 1 = bloqueado), largura W, altura H.
const DIRS = [
  [1,0,1],[-1,0,1],[0,1,1],[0,-1,1],
  [1,1,1.414],[1,-1,1.414],[-1,1,1.414],[-1,-1,1.414],
];

export function findPath(grid, W, H, sx, sy, tx, ty, maxNodes = 4000) {
  sx|=0; sy|=0; tx|=0; ty|=0;
  if (sx===tx && sy===ty) return [];
  if (tx<0||ty<0||tx>=W||ty>=H) return null;
  // Se o alvo é bloqueado, procura tile livre adjacente mais próximo do alvo.
  if (grid[ty*W+tx]) {
    const alt = nearestFree(grid, W, H, tx, ty, sx, sy);
    if (!alt) return null;
    tx = alt.x; ty = alt.y;
    if (sx===tx && sy===ty) return [];
  }
  const idx = (x,y)=>y*W+x;
  const open = new MinHeap();
  const came = new Map();
  const gScore = new Map();
  const startI = idx(sx,sy);
  gScore.set(startI, 0);
  open.push(startI, heur(sx,sy,tx,ty));
  let nodes = 0;
  while (open.size() && nodes < maxNodes) {
    nodes++;
    const cur = open.pop();
    const cx = cur % W, cy = (cur / W) | 0;
    if (cx===tx && cy===ty) return reconstruct(came, cur, W);
    const cg = gScore.get(cur);
    for (const [dx,dy,cost] of DIRS) {
      const nx=cx+dx, ny=cy+dy;
      if (nx<0||ny<0||nx>=W||ny>=H) continue;
      const ni = idx(nx,ny);
      if (grid[ni]) continue;
      // evita cortar quinas de obstáculos na diagonal
      if (dx!==0 && dy!==0 && (grid[idx(cx+dx,cy)] || grid[idx(cx,cy+dy)])) continue;
      const tentative = cg + cost;
      if (tentative < (gScore.get(ni) ?? Infinity)) {
        came.set(ni, cur);
        gScore.set(ni, tentative);
        open.push(ni, tentative + heur(nx,ny,tx,ty));
      }
    }
  }
  // fallback: caminho até o nó mais próximo alcançado do alvo
  let best=startI, bestH=heur(sx,sy,tx,ty);
  for (const k of gScore.keys()){
    const kx=k%W, ky=(k/W)|0, h=heur(kx,ky,tx,ty);
    if (h<bestH){bestH=h;best=k;}
  }
  return best===startI ? null : reconstruct(came, best, W);
}

function heur(x,y,tx,ty){ const dx=Math.abs(x-tx), dy=Math.abs(y-ty);
  return (dx+dy) + (1.414-2)*Math.min(dx,dy); }

function reconstruct(came, cur, W){
  const path=[];
  while(came.has(cur)){ path.push({x:cur%W, y:(cur/W)|0}); cur=came.get(cur); }
  path.reverse();
  return path;
}

export function nearestFree(grid, W, H, cx, cy, towardX, towardY){
  let best=null, bestD=Infinity;
  for (let r=1; r<=6; r++){
    for (let dx=-r; dx<=r; dx++) for (let dy=-r; dy<=r; dy++){
      if (Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
      const x=cx+dx, y=cy+dy;
      if (x<0||y<0||x>=W||y>=H) continue;
      if (grid[y*W+x]) continue;
      const d=(x-towardX)**2+(y-towardY)**2;
      if (d<bestD){bestD=d;best={x,y};}
    }
    if (best) return best;
  }
  return best;
}

// Min-heap binário simples (id -> prioridade)
class MinHeap {
  constructor(){ this.ids=[]; this.pri=[]; }
  size(){ return this.ids.length; }
  push(id, p){
    this.ids.push(id); this.pri.push(p);
    let i=this.ids.length-1;
    while(i>0){ const par=(i-1)>>1;
      if(this.pri[par]<=this.pri[i]) break;
      this.swap(i,par); i=par; }
  }
  pop(){
    const topId=this.ids[0], n=this.ids.length-1;
    this.ids[0]=this.ids[n]; this.pri[0]=this.pri[n];
    this.ids.pop(); this.pri.pop();
    let i=0;
    while(true){ let l=2*i+1,r=2*i+2,s=i;
      if(l<this.ids.length && this.pri[l]<this.pri[s]) s=l;
      if(r<this.ids.length && this.pri[r]<this.pri[s]) s=r;
      if(s===i) break; this.swap(i,s); i=s; }
    return topId;
  }
  swap(a,b){ [this.ids[a],this.ids[b]]=[this.ids[b],this.ids[a]];
    [this.pri[a],this.pri[b]]=[this.pri[b],this.pri[a]]; }
}
