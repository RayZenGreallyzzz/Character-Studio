/** Pure helpers for name matching, weights, and keyframe samples. */
export function guessBoneCategory(name) {
  const n = String(name || '').toLowerCase().replace(/^mixamorig:?/, '');
  if (/(head|cranium|skull)/.test(n)) return 'head';
  if (/(upperchest|chest|spine2|spine3|thorax)/.test(n)) return 'chest';
  if (/(hips|pelvis|root)/.test(n)) return 'hips';
  if (/(jaw|chin)/.test(n)) return 'jaw';
  return 'other';
}
export function suggestParent(bones, slot) {
  const preference = ({hair:['head'],tail:['hips'],breast:['chest'],face:['head'],ear:['head'],wing:['chest'],cloth:['hips','chest']})[slot] || ['head'];
  for (const p of preference) {
    const found = bones.find(b => guessBoneCategory(b.name) === p);
    if (found) return found;
  }
  return bones[0] || null;
}
export function uniqueBoneName(bones, desired) {
  const names = new Set(bones.map(b => b.name));
  if (!names.has(desired)) return desired;
  let i=2;
  while(names.has(`${desired}_${i}`)) i++;
  return `${desired}_${i}`;
}
export function clamp(x, lo, hi) { return Math.max(lo,Math.min(hi,x)); }
export function smoothWeight(distance, radius, power=1) {
  if (!(radius>0) || !Number.isFinite(distance)) return 0;
  const t = clamp(1-distance/radius,0,1);
  const smooth=t*t*(3-2*t);
  return Math.pow(smooth, Math.max(.1,power));
}
export function normalizedTopFour(base, extra, influence) {
  // base = [{bone:index, weight:number}] and extra is a new bone id.
  const acc=new Map();
  for(const v of base) if(v.weight>0) acc.set(v.bone,(acc.get(v.bone)||0)+v.weight);
  const a=clamp(influence,0,0.95);
  for(const [k,v] of acc) acc.set(k,v*(1-a));
  acc.set(extra,(acc.get(extra)||0)+a);
  const entries=[...acc].map(([bone,weight])=>({bone,weight})).sort((a,b)=>b.weight-a.weight).slice(0,4);
  let sum=entries.reduce((s,v)=>s+v.weight,0);
  if(sum<1e-9) return [{bone:0,weight:1}];
  return entries.map(v=>({...v,weight:v.weight/sum}));
}
export function interpolateKeyframes(frames, t) {
  if(!frames.length) return [0,0,0];
  const sorted=[...frames].sort((a,b)=>a.time-b.time);
  if(t<=sorted[0].time) return sorted[0].euler.slice();
  if(t>=sorted.at(-1).time) return sorted.at(-1).euler.slice();
  for(let i=1;i<sorted.length;i++) if(t<=sorted[i].time){
    const a=sorted[i-1],b=sorted[i],u=(t-a.time)/(b.time-a.time || 1);
    return a.euler.map((v,j)=>v+(b.euler[j]-v)*u);
  }
  return [0,0,0];
}
export function secondaryAngles(t, motion) {
  if(!motion?.enabled) return [0,0,0];
  const a=(motion.amplitude||0)*Math.PI/180;
  const w=2*Math.PI*(motion.frequency||1);
  const phase=motion.phase||0;
  return [a*Math.sin(w*t+phase),0,a*.38*Math.sin(w*.63*t+phase+1.3)];
}

/** Only the selected anatomical body skin may be repainted by extra-body bones.
 * A garment may be a SkinnedMesh too; this never makes it anatomical body skin.
 */
export function isLikelyGarmentName(value) {
  return /(?:cloth|clothing|dress|skirt|shirt|sleeve|coat|jacket|pants?|trousers|shoe|boot|glove|cape|cloak|armor|armour|hair|hat|helmet|accessor|eyelash|lash|tooth|teeth|belt|sock|outfit|garment|одеж|плать|юбк|волос|сапог|броня|плащ)/i.test(String(value || ''));
}
export function isLikelyBodyName(value) {
  return /(?:^|[_ .-])(?:body|skin|torso|basebody|nude|naked|голое_тело|тело)(?:$|[_ .-])/i.test(String(value || ''));
}
/** Conservative default: when the target cannot be unambiguously identified,
 * ask the user to choose it instead of silently touching every skin.
 */
export function suggestBodySkinIndex(items) {
  if (!items.length) return -1;
  const available=items.map((x,i)=>({i,name:String(x.name||''),size:Number(x.vertices)||0}))
    .filter(x=>!isLikelyGarmentName(x.name));
  const named=available.filter(x=>isLikelyBodyName(x.name));
  if(named.length===1)return named[0].i;
  if(named.length>1)return -1;
  if(available.length===1)return available[0].i;
  return -1;
}
/** Torso gate for breast vertices. A physically nearby shoulder, hair or
 * detached garment is NOT a valid reason to receive breast weights.
 * Accept aliases used by Mixamo and common human rigs.
 */
export function existingTorsoWeight(influences,boneNames) {
  let sum=0;
  for(const x of influences){
    if(!Number.isFinite(x.weight)||x.weight<=0)continue;
    const n=String(boneNames[x.bone]||'').replace(/^mixamorig:?/i,'');
    if(/(?:spine|chest|torso|rib|upperbody)/i.test(n))sum+=x.weight;
  }
  return clamp(sum,0,1);
}
export function shouldApplyBreastWeight({side,pointLocalX,boneLocalX,torsoWeight,threshold=.45}) {
  if(torsoWeight<threshold)return false;
  // Only the correct half of the torso; keep a small midline blending band.
  if(side==='L' && pointLocalX>Math.min(0,boneLocalX*.2)+.015)return false;
  if(side==='R' && pointLocalX<Math.max(0,boneLocalX*.2)-.015)return false;
  return true;
}
