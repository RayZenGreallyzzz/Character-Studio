/**
 * Phoenix Forge cloth protection. An opt-in per-vertex mask written to glTF
 * node extras as run-length ranges. No change to geometry, UVs or bone weights.
 * Brush follows triangle edges, not Euclidean proximity through cloth layers.
 */
const masks = new WeakMap();
const graphCache = new WeakMap();
const MAX_PAINT_VERTICES = 120000;
function geometrySignature(geo) {
  const p=geo?.getAttribute?.('position'),idx=geo?.getIndex?.();
  if(!p)return '';
  let h=2166136261>>>0;
  function hash(n){h=Math.imul(h^(n>>>0),16777619)>>>0}
  hash(p.count);hash(idx?.count||p.count);
  const step=Math.max(1,Math.floor(p.count/96));
  for(let i=0;i<p.count;i+=step){
    hash(Math.round(p.getX(i)*100000));hash(Math.round(p.getY(i)*100000));hash(Math.round(p.getZ(i)*100000));
  }
  const last=p.count-1;
  hash(Math.round(p.getX(last)*100000));hash(Math.round(p.getY(last)*100000));hash(Math.round(p.getZ(last)*100000));
  return h.toString(16).padStart(8,'0');
}
export function encodeClothMask(mask,geo){
 const position=geo.getAttribute('position');
 if(!position||position.count!==mask.length)throw Error('Protection vertex count mismatch');
 const runs=[];
 for(let i=0;i<mask.length;){
   if(!mask[i]){i++;continue}
   const start=i;while(i<mask.length&&mask[i])i++;
   runs.push([start,i-start]);
 }
 return {type:'phoenix-cloth-guard-v1',vertices:mask.length,signature:geometrySignature(geo),runs};
}
export function decodeClothMask(data,geo){
 const pos=geo?.getAttribute?.('position');
 if(!pos)throw Error('Отсутствуют вершины для маски');
 if(data?.type!=='phoenix-cloth-guard-v1'||data.vertices!==pos.count||
    data.signature!==geometrySignature(geo)||!Array.isArray(data.runs))
   throw Error('Маска одежды не совпадает с геометрией. Автовеса остановлены.');
 const result=new Uint8Array(pos.count);
 let prev=0;
 for(const run of data.runs){
   if(!Array.isArray(run)||run.length!==2)throw Error('Повреждена маска одежды');
   const [start,length]=run;
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||length<=0||start<prev||start+length>pos.count)
     throw Error('Повреждены диапазоны маски одежды');
   result.fill(1,start,start+length);prev=start+length;
 }
 return result;
}
export function clothProtection(mesh){
 const geo=mesh?.geometry;
 if(!geo)return null;
 const data=mesh.userData?.pcsClothMask;
 if(!data)return null;
 const cached=masks.get(mesh);
 if(cached?.data===data&&cached?.geo===geo)return cached.mask;
 const mask=decodeClothMask(data,geo); // fail closed on stale/mismatched topology
 masks.set(mesh,{data,geo,mask});
 return mask;
}
export function storeClothProtection(mesh,mask){
 if(!mesh?.geometry)throw Error('Нет геометрии');
 const data=encodeClothMask(mask,mesh.geometry);
 mesh.userData.pcsClothMask=data;
 masks.set(mesh,{data,geo:mesh.geometry,mask});
 return data;
}
export function countProtected(mask){let n=0;for(const v of mask||[])n+=v?1:0;return n}
export function surfaceAdjacency(geo){
 if(graphCache.has(geo))return graphCache.get(geo);
 const p=geo?.getAttribute?.('position');const count=p?.count||0;
 if(!count||count>MAX_PAINT_VERTICES)throw Error('Кисть работает с мешами до 120 000 вершин. Упрости модель.');
 const index=geo.getIndex?.(),triangleElements=index?.count??count;
 if(triangleElements%3!==0)throw Error('Повреждены треугольники меша');
 const adj=Array.from({length:count},()=>[]);
 const add=(a,b)=>{if(a===b)return;adj[a].push(b);adj[b].push(a)};
 for(let i=0;i<triangleElements;i+=3){
   const a=index?index.getX(i):i,b=index?index.getX(i+1):i+1,c=index?index.getX(i+2):i+2;
   if(Math.max(a,b,c)>=count)throw Error('Повреждены индексы треугольников');
   add(a,b);add(b,c);add(c,a);
 }
 // Deduplicate without merging geometrically nearby skin and fabric.
 for(let i=0;i<count;i++)if(adj[i].length>1)adj[i]=[...new Set(adj[i])];
 graphCache.set(geo,adj);
 return adj;
}
function distance(p,a,b){
 return Math.hypot(p.getX(a)-p.getX(b),p.getY(a)-p.getY(b),p.getZ(a)-p.getZ(b));
}
/** Geodesic approximation: Dijkstra along triangle edges with local hit seeds.
 * Does not jump to nearby back-facing surfaces or other disconnected garments.
 * Each call paints at most 6000 vertices to keep Android responsive.
 */
export function paintProtection(geometry,mask,face,hitLocal,radius,protect=true,{allowed=null}={}){
 const p=geometry?.getAttribute?.('position');if(!p||mask?.length!==p.count)throw Error('Маска не совпадает с мешем');
 if(!face||!Number.isFinite(radius)||radius<=0) return 0;
 const adjacency=surfaceAdjacency(geometry);
 const dist=new Float64Array(p.count);dist.fill(Infinity);
 const heap=[];
 function push(id,d){heap.push([d,id]);let i=heap.length-1;while(i>0){const par=(i-1)>>1;if(heap[par][0]<=heap[i][0])break;const tmp=heap[par];heap[par]=heap[i];heap[i]=tmp;i=par}}
 function pop(){
  const v=heap[0],end=heap.pop();if(heap.length){heap[0]=end;let i=0;for(;;){let a=i*2+1,b=a+1,k=i;if(a<heap.length&&heap[a][0]<heap[k][0])k=a;if(b<heap.length&&heap[b][0]<heap[k][0])k=b;if(k===i)break;const tmp=heap[i];heap[i]=heap[k];heap[k]=tmp;i=k}}
  return v;
 }
 for(const id of [face.a,face.b,face.c]){
  if(!Number.isInteger(id)||id<0||id>=p.count)continue;
  const d=Math.hypot(p.getX(id)-hitLocal.x,p.getY(id)-hitLocal.y,p.getZ(id)-hitLocal.z);
  if(d<dist[id]){dist[id]=d;push(id,d)}
 }
 let changed=0,processed=0;
 while(heap.length&&processed<6000){
  const [d,id]=pop();
  if(d>radius)break;
  if(d>dist[id]+1e-9)continue;
  processed++;
  if(!allowed||allowed(id)){
   const next=protect?1:0;
   if(mask[id]!==next){mask[id]=next;changed++}
  }
  for(const to of adjacency[id]){
   const next=d+distance(p,id,to);
   if(next<=radius&&next+1e-9<dist[to]){dist[to]=next;push(to,next)}
  }
 }
 return changed;
}
