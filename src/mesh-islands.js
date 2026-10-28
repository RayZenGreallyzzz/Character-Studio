/**
 * Locate disconnected spatial surfaces within ONE mesh without changing geometry.
 * UV seam vertices are welded by near-identical positions for component analysis
 * ONLY. Do not mutate indices, positions, skin weights, UVs, materials or morphs.
 * This is a conservative *surface island* selector, not body segmentation.
 */
export function connectedSurfaceIslands(geometry,{maxVertices=220000}={}){
 const pos=geometry?.getAttribute?.('position');
 if(!pos)return {reason:'Нет вершин POSITION',components:[],componentByVertex:null};
 const n=pos.count;
 if(n<3)return {reason:'В меше недостаточно вершин',components:[],componentByVertex:null};
 if(n>maxVertices)return {reason:'Слишком большой меш для анализа островов на планшете: '+n+' вершин.',components:[],componentByVertex:null};
 const box=geometry.boundingBox||geometry.computeBoundingBox()||geometry.boundingBox;
 const span=box?.getSize?.({x:0,y:0,z:0,set(){}}); // use direct min/max below, no Three dependency
 const dim=Math.max(
  (box?.max.x??1)-(box?.min.x??0),
  (box?.max.y??1)-(box?.min.y??0),
  (box?.max.z??1)-(box?.min.z??0),1e-6);
 const tolerance=Math.max(1e-8,dim*1e-7);
 const parent=new Uint32Array(n),size=new Uint32Array(n);
 for(let i=0;i<n;i++){parent[i]=i;size[i]=1}
 function find(a){let k=a;while(parent[k]!==k){parent[k]=parent[parent[k]];k=parent[k]}return k}
 function union(a,b){let x=find(a),y=find(b);if(x===y)return;if(size[x]<size[y]){const t=x;x=y;y=t}parent[y]=x;size[x]+=size[y]}
 const index=geometry.getIndex?.();
 const count=index?.count??n;
 // Three.js BufferGeometry represents triangles. Invalid indices fail closed.
 if(count%3!==0)return {reason:'Сетка содержит неполные треугольники',components:[],componentByVertex:null};
 for(let k=0;k<count;k+=3){
  const a=index?index.getX(k):k,b=index?index.getX(k+1):k+1,c=index?index.getX(k+2):k+2;
  if(a>=n||b>=n||c>=n)return {reason:'Некорректные индексы треугольников',components:[],componentByVertex:null};
  union(a,b);union(a,c);
 }
 // Weld duplicate coordinates to reconnect UV seam fragments, not spatially
 // adjacent cloth and skin. The tolerance is intentionally very small.
 const welded=new Map();
 for(let i=0;i<n;i++){
  const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
  if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z))
   return {reason:'В меше нечисловые координаты',components:[],componentByVertex:null};
  const key=Math.round(x/tolerance)+','+Math.round(y/tolerance)+','+Math.round(z/tolerance);
  const old=welded.get(key);
  if(old===undefined)welded.set(key,i);
  else union(old,i);
 }
 const buckets=new Map();
 for(let i=0;i<n;i++){
  const root=find(i);
  let entry=buckets.get(root);
  if(!entry){entry={root,firstVertex:i,vertices:0};buckets.set(root,entry)}
  entry.vertices++;
 }
 const components=[...buckets.values()].sort((a,b)=>b.vertices-a.vertices||a.firstVertex-b.firstVertex);
 const labelByRoot=new Map(components.map((c,i)=>[c.root,i]));
 const componentByVertex=new Int32Array(n);
 for(let i=0;i<n;i++)componentByVertex[i]=labelByRoot.get(find(i));
 return {components:components.map((c,id)=>({id,vertices:c.vertices,firstVertex:c.firstVertex})),
 componentByVertex,vertices:n,reason:null};
}
export function allowsSurfaceVertex(mask,vertexIndex,choice){
 if(!mask?.componentByVertex)return false;
 if(choice==='all')return true;
 const region=Number(choice);
 return Number.isInteger(region)&&region>=0&&mask.componentByVertex[vertexIndex]===region;
}
