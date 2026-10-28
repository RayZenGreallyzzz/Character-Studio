import * as THREE from 'three';
import {connectedSurfaceIslands,allowsSurfaceVertex} from './mesh-islands.js';
import {anatomicalFrame,anatomicalTargets,pointAnatomyMask} from './rig-anatomy.js';
import {uniqueBoneName,suggestParent,smoothWeight,normalizedTopFour,interpolateKeyframes,secondaryAngles,existingTorsoWeight,shouldApplyBreastWeight} from './rig-utils.js';

export function getBones(root) {
  const bones=[];
  root?.traverse(o=>{if(o.isBone)bones.push(o);});
  return bones;
}
export function getSkins(root) {
  const meshes=[];
  root?.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o);});
  return meshes;
}
export function getDefaultParent(root,slot) {return suggestParent(getBones(root),slot);}
export function addBoneChain(root,parent,slot,count=3,side='',scale=1){
  if (!parent?.isBone) throw new Error('Сначала выбери родительскую кость');
  const created=[],all=getBones(root);
  const prefix=({hair:'Hair',tail:'Tail',breast:'Breast',face:'Face',ear:'Ear',wing:'Wing',cloth:'Cloth'})[slot]||'Extra';
  count=Math.max(1,Math.min(15,Math.trunc(count)||1));
  const frame=anatomicalFrame(root);
  const targets=anatomicalTargets(frame,slot,side,count);
  let from=parent;
  for(let i=0;i<count;i++){
    const bone=new THREE.Bone();
    bone.name=uniqueBoneName([...all,...created],prefix+(side?'_'+side:'')+'_'+String(i+1).padStart(2,'0'));
    const amplitude=({breast:2,tail:7,wing:3,ear:2,hair:3,face:0,cloth:2})[slot]??0;
    bone.userData.pcs={slot,extra:true,side,
      motion:{enabled:amplitude>0,amplitude,frequency:1.3,phase:side==='R'?1:0}};
    // The desired target is in the imported character's WORLD frame,
    // NOT in the (arbitrarily rotated) local axes of this parent.
    from.updateWorldMatrix(true,false);
    bone.position.copy(from.worldToLocal(targets[i].clone()));
    from.add(bone);
    from.updateMatrixWorld(true);
    created.push(bone);
    from=bone;
  }
  root.updateMatrixWorld(true);
  return created;
}

// Attach a plain, unskinned mesh to a chain and convert the geometry to linear skinning.
// New bones stay children of the original skeleton. This respects existing animations.
export function skinAccessoryToChain(characterRoot, accessoryRoot, chain) {
  if(chain.length===0) throw Error('Не выбрана цепочка костей');
  characterRoot.updateMatrixWorld(true);
  const basePositions=chain.map(b=>b.getWorldPosition(new THREE.Vector3()));
  const boneInverses=chain.map(b=>b.matrixWorld.clone().invert());
  const meshes=[];
  accessoryRoot.traverse(o=>{if(o.isMesh&&!o.isSkinnedMesh)meshes.push(o);});
  if(!meshes.length) throw Error('У детали нет обычных мешей для привязки');
  let numVertices=0;
  for (const original of meshes) {
    if(original.morphTargetInfluences?.length) continue; // morph topology must not be flattened
    original.updateMatrixWorld(true);
    const g=original.geometry.clone();
    const points=g.getAttribute('position');
    if(!points) continue;
    const ids=new Uint16Array(points.count*4);
    const weights=new Float32Array(points.count*4);
    const point=new THREE.Vector3();
    for(let i=0;i<points.count;i++) {
      point.fromBufferAttribute(points,i).applyMatrix4(original.matrixWorld);
      const candidates=basePositions.map((p,j)=>({j,d:p.distanceToSquared(point)})).sort((a,b)=>a.d-b.d).slice(0,2);
      const a=candidates[0],b=candidates[1];
      let wa=1,wb=0;
      if(b && b.d>1e-10){const da=Math.sqrt(a.d),db=Math.sqrt(b.d);wa=db/(da+db || 1);wb=1-wa;}
      ids[i*4]=a.j; weights[i*4]=wa;
      if(b){ids[i*4+1]=b.j; weights[i*4+1]=wb;}
    }
    g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(ids,4));
    g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
    const replacement=new THREE.SkinnedMesh(g,original.material);
    replacement.name=original.name||'AccessorySkin';
    // A skinned accessory must NOT stay under Head: that would apply the parent
    // transform once via the skeleton and again via the scene graph.
    const localMatrix=characterRoot.matrixWorld.clone().invert().multiply(original.matrixWorld);
    localMatrix.decompose(replacement.position,replacement.quaternion,replacement.scale);
    replacement.castShadow=original.castShadow;
    replacement.frustumCulled=false;
    characterRoot.add(replacement);
    replacement.updateMatrixWorld(true);
    replacement.bind(new THREE.Skeleton(chain,boneInverses.map(m=>m.clone())),replacement.matrixWorld.clone());
    original.parent.remove(original);
    numVertices+=points.count;
  }
  if(numVertices===0)throw Error('Не найдены обычные меши для скиннинга; морфы и уже зариганные детали пока не поддерживаются');
  return numVertices;
}

// For existing skinned BODY meshes, append influence of an added chest/breast bone.
// Only four strongest weights are retained (glTF limitation). Preview must be in bind/rest pose.
export function weightExistingSkin(root,bone,{radius=.18,strength=.55}={}) {
  if(!bone?.isBone) throw Error('Сначала создай кость груди');
  root.updateMatrixWorld(true);
  const bonePos=bone.getWorldPosition(new THREE.Vector3());
  const frame=anatomicalFrame(root);
  const slot=bone.userData?.pcs?.slot||'other',side=bone.userData?.pcs?.side||'';
  let count=0, changedMeshes=0;
  for(const mesh of getSkins(root)) {
    // Garments are skinned too: do not clone, rebind or touch their geometry.
    if(!mesh.userData.pcsMainSkin) continue;
    const chosenSurface=mesh.userData.pcsBodySurface;
    if(chosenSurface===undefined||chosenSurface===null||chosenSurface==='')continue;
    const surfaces=connectedSurfaceIslands(mesh.geometry);
    if(surfaces.reason)continue; // fail closed: unknown surface => no repaint
    if(chosenSurface!=='all'&&!surfaces.components.some(c=>c.id===Number(chosenSurface)))continue;
    if(!mesh.userData.pcsOwnGeometry){mesh.geometry=mesh.geometry.clone();mesh.userData.pcsOwnGeometry=true;}
    const geo=mesh.geometry;
    const si=geo.getAttribute('skinIndex'),sw=geo.getAttribute('skinWeight'),pos=geo.getAttribute('position');
    if(!si||!sw||!pos) continue;
    const currentBones=mesh.skeleton.bones;
    if(!currentBones.includes(bone)) {
      const all=[...currentBones,bone];
      const inverses=[...mesh.skeleton.boneInverses.map(m=>m.clone()),bone.matrixWorld.clone().invert()];
      const bind=mesh.bindMatrix.clone();
      mesh.bind(new THREE.Skeleton(all,inverses),bind);
    }
    const boneIndex=mesh.skeleton.bones.indexOf(bone);
    const resultIds=new Uint16Array(pos.count*4);
    const resultWeights=new Float32Array(pos.count*4);
    for(let v=0;v<pos.count;v++) {
      // BufferAttribute.getX/Y/Z/W de-normalizes integer glTF WEIGHTS_0.
      for(let k=0;k<4;k++) {
        const read=(attr,slot)=>[attr.getX,attr.getY,attr.getZ,attr.getW][slot].call(attr,v);
        resultIds[v*4+k]=read(si,k);
        resultWeights[v*4+k]=read(sw,k);
      }
    }
    const point=new THREE.Vector3(),parentPoint=new THREE.Vector3();
    const boneNames=mesh.skeleton.bones.map(item=>item.name);
    const parentInverse=bone.parent?.matrixWorld.clone().invert();
    let localCount=0;
    for(let v=0;v<pos.count;v++) {
      if(!allowsSurfaceVertex(surfaces,v,chosenSurface))continue;
      // Using vertex bind coordinates, not a deformed animated frame.
      point.fromBufferAttribute(pos,v).applyMatrix4(mesh.matrixWorld);
      const mask=pointAnatomyMask(point,frame,slot,side);
      const w=mask*smoothWeight(point.distanceTo(bonePos),radius)*strength;
      if(w<.0005) continue;
      const base=[];
      for(let k=0;k<4;k++) base.push({bone:resultIds[v*4+k],weight:resultWeights[v*4+k]});
      if(slot==='breast'){
        const torso=existingTorsoWeight(base,boneNames);
        if(parentInverse)parentPoint.copy(point).applyMatrix4(parentInverse);
        if(!shouldApplyBreastWeight({
          side,pointLocalX:parentPoint.x,boneLocalX:bone.position.x,torsoWeight:torso
        }))continue;
      }
      const weights=normalizedTopFour(base,boneIndex,w);
      for(let k=0;k<4;k++) {
        resultIds[v*4+k]=weights[k]?.bone ?? 0;
        resultWeights[v*4+k]=weights[k]?.weight ?? 0;
      }
      localCount++;
    }
    if(localCount) {
      geo.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(resultIds,4));
      geo.setAttribute('skinWeight',new THREE.Float32BufferAttribute(resultWeights,4));
      geo.attributes.skinIndex.needsUpdate=true;geo.attributes.skinWeight.needsUpdate=true;
      changedMeshes++;count+=localCount;
    }
  }
  return {vertices:count,meshes:changedMeshes};
}
export function applyExtraPose(bones, clipName, t, animationData, procedural=true) {
  for(const bone of bones) {
    const pc=bone.userData.pcs;
    if(!pc?.extra) continue;
    const base=pc.baseEuler||[0,0,0];
    const curves=animationData[clipName]?.[bone.name] || [];
    const manual=interpolateKeyframes(curves,t);
    const extra=procedural?secondaryAngles(t,pc.motion):[0,0,0];
    bone.rotation.set((base[0]+manual[0]+extra[0])*Math.PI/180,(base[1]+manual[1]+extra[1])*Math.PI/180,(base[2]+manual[2]+extra[2])*Math.PI/180,'XYZ');
  }
}
export function animationTracksForExtras(bones,clipName,duration,animationData,fps=30) {
  const count=Math.max(2,Math.ceil(duration*fps)+1), times=new Float32Array(count);
  const tracks=[];
  for(let i=0;i<count;i++) times[i]=duration*i/(count-1);
  for(const bone of bones) {
    if(!bone.userData.pcs?.extra)continue;
    const values=[];
    const e=new THREE.Euler();const q=new THREE.Quaternion();
    for(const t of times){
      const pcs=bone.userData.pcs,base=pcs.baseEuler||[0,0,0];
      const manual=interpolateKeyframes(animationData[clipName]?.[bone.name]||[],t);
      const wave=secondaryAngles(t,pcs.motion);
      e.set((base[0]+manual[0]+wave[0])*Math.PI/180,(base[1]+manual[1]+wave[1])*Math.PI/180,(base[2]+manual[2]+wave[2])*Math.PI/180,'XYZ');
      q.setFromEuler(e);values.push(q.x,q.y,q.z,q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`,times,values));
  }
  return tracks;
}
