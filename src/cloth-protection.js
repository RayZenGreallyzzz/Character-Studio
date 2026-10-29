/**
 * Phoenix Forge cloth protection. An opt-in per-vertex mask written to glTF
 * node extras as run-length ranges. No change to geometry, UVs or bone weights.
 * Brush follows triangle edges, not Euclidean proximity through cloth layers.
 */
const graphCache = new WeakMap();
const MAX_PAINT_VERTICES = 120000;
/** Full ordered-vertex and triangle-index digest, shared with Optimize.
 * No sampled vertices: a reordered or modified middle vertex invalidates mask.
 * Two independent 32-bit FNV-inspired lanes, computed without allocating per vertex.
 */
export function geometrySignature(geo) {
 const p=geo?.getAttribute?.('position'),idx=geo?.getIndex?.();
 if(!p||p.count<1)return '';
 let a=2166136261>>>0,b=0x9e3779b9>>>0;
 const mix=n=>{
  const v=n>>>0;
  a=Math.imul(a^v,16777619)>>>0;
  b=Math.imul((b+(v^0x85ebca6b))>>>0,0x27d4eb2d)>>>0;
 };
 const bytes=new DataView(new ArrayBuffer(8));
 const addFloat=n=>{
  if(!Number.isFinite(n))throw Error('Неверные координаты вершин');
  bytes.setFloat64(0,n,true);
  mix(bytes.getUint32(0,true));mix(bytes.getUint32(4,true));
 };
 mix(p.count);mix(p.itemSize);mix(idx?.count||0);
 for(let i=0;i<p.count;i++){
  addFloat(p.getX(i));addFloat(p.getY(i));addFloat(p.getZ(i));
 }
 if(idx)for(let i=0;i<idx.count;i++)mix(idx.getX(i));
 return a.toString(16).padStart(8,'0')+b.toString(16).padStart(8,'0');
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
 return {type:'phoenix-cloth-guard-v2',vertices:mask.length,signature:geometrySignature(geo),runs};
}
export function decodeClothMask(data,geo){
 const pos=geo?.getAttribute?.('position');
 if(!pos)throw Error('Отсутствуют вершины для маски');
 if(data?.type!=='phoenix-cloth-guard-v2'||data.vertices!==pos.count||
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
 // Always recheck geometry, even when BufferGeometry is the same object:
 // edits may update vertex coordinates in place without replacing it.
 return decodeClothMask(data,geo);
}
export function storeClothProtection(mesh,mask){
 if(!mesh?.geometry)throw Error('Нет геометрии');
 const data=encodeClothMask(mask,mesh.geometry);
 mesh.userData.pcsClothMask=data;
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
 // Reconnect UV-seam duplicates and non-indexed triangle corners only at
 // practically identical positions with compatible normals. Never connect
 // physically nearby but separated layers (fabric over skin).
 geo.computeBoundingBox();
 const bounds=geo.boundingBox;
 const span=Math.max(bounds.max.x-bounds.min.x,bounds.max.y-bounds.min.y,bounds.max.z-bounds.min.z,1e-6);
 const eps=Math.max(1e-8,span*1e-7),norm=geo.getAttribute('normal'),seams=new Map();
 for(let v=0;v<count;v++){
  const x=p.getX(v),y=p.getY(v),z=p.getZ(v);
  if(![x,y,z].every(Number.isFinite))throw Error('Неверные координаты меша');
  const key=Math.round(x/eps)+','+Math.round(y/eps)+','+Math.round(z/eps);
  const matches=seams.get(key);
  if(!matches){seams.set(key,[v]);continue}
  // Limit cross-connections in accidental stacks of coincident surfaces.
  for(const other of matches.slice(0,8)){
   if(norm){
    const dot=norm.getX(other)*norm.getX(v)+norm.getY(other)*norm.getY(v)+norm.getZ(other)*norm.getZ(v);
    if(dot<0.2)continue;
   }
   add(other,v);
  }
  if(matches.length<8)matches.push(v);
 }
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
