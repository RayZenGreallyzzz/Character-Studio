/**
 * Strict direct-clip compatibility gate for imported GLB motion.
 * Does NOT claim to retarget different skeletons. Different rig topology or
 * rest rotations must go through a dedicated rest-space retargeter.
 */
function bonesOf(root){
 const bones=[];
 root?.traverse?.(o=>{if(o.isBone)bones.push(o)});
 return bones;
}
function getParentName(bone) {
 let parent=bone.parent;
 while(parent&&!parent.isBone)parent=parent.parent;
 return parent?.name||null;
}
function orientationDegrees(a,b){
 if(!a||!b)return Infinity;
 const d=Math.abs((a.x||0)*(b.x||0)+(a.y||0)*(b.y||0)+(a.z||0)*(b.z||0)+(a.w||0)*(b.w||0));
 return 2*Math.acos(Math.min(1,Math.max(0,d)))*180/Math.PI;
}
export function inspectSkeletonCompatibility(source,target,{rotationTolerance=5}={}){
 const left=bonesOf(source),right=bonesOf(target),problems=[];
 if(!left.length||!right.length)return {ok:false,problems:['Отсутствуют кости у источника или персонажа'],matches:0};
 const sourceByName=new Map(),targetByName=new Map();
 for(const b of left){if(sourceByName.has(b.name))problems.push('Повтор имени кости источника: '+b.name); sourceByName.set(b.name,b)}
 for(const b of right){if(targetByName.has(b.name))problems.push('Повтор имени кости цели: '+b.name);targetByName.set(b.name,b)}
 // Missing target extras are allowed: a creature may add hair, wings or breast bones,
 // but donor bones must all match the original core hierarchy.
 let matched=0;
 for(const donor of left){
  const dest=targetByName.get(donor.name);
  if(!dest){problems.push('Нет кости: '+donor.name);continue}
  matched++;
  const dParent=getParentName(donor),tParent=getParentName(dest);
  if(dParent!==tParent)problems.push('Другой родитель '+donor.name+': '+String(dParent)+' / '+String(tParent));
  const degrees=orientationDegrees(donor.quaternion,dest.quaternion);
  if(degrees>rotationTolerance)problems.push('Другая исходная ориентация '+donor.name+' ('+degrees.toFixed(1)+'°)');
 }
 return {ok:problems.length===0,problems,matches:matched,donorBones:left.length,targetBones:right.length};
}
export function remapAnimationTracks(clip,source,target){
 const from=bonesOf(source),to=bonesOf(target);
 const targetByName=new Map(to.map(b=>[b.name,b]));
 const sourceByRef=new Map();
 for(const b of from){
  if(!targetByName.has(b.name))continue;
  sourceByRef.set(b.name,b.name);
  if(b.uuid)sourceByRef.set(b.uuid,b.name);
 }
 const tracks=[],skipped=[];
 for(const track of clip.tracks||[]){
  const dot=track.name.lastIndexOf('.');
  if(dot<=0){skipped.push(track.name);continue}
  const id=track.name.slice(0,dot);
  const field=track.name.slice(dot+1);
  const boneName=sourceByRef.get(id);
  if(!boneName||!['position','quaternion','scale'].includes(field)){skipped.push(track.name);continue}
  const mapped=track.clone();
  // Use the TARGET UUID to avoid names that collide with unrelated scene objects.
  mapped.name=targetByName.get(boneName).uuid+'.'+field;
  tracks.push(mapped);
 }
 return {tracks,skipped};
}
