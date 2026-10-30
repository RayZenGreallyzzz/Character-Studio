import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {anatomicalFrame,anatomicalTargets} from '../src/rig-anatomy.js';
import {addBoneChain,weightExistingSkin} from '../src/rig.js';
import {connectedSurfaceIslands} from '../src/mesh-islands.js';
import {storeClothProtection} from '../src/cloth-protection.js';

function rig({rotation=0,mesh=true}={}){
  const root=new THREE.Group();
  const hips=new THREE.Bone();hips.name='mixamorig:Hips';hips.position.y=1;root.add(hips);
  const chest=new THREE.Bone();chest.name='mixamorig:Spine2';chest.position.y=.45;hips.add(chest);
  const head=new THREE.Bone();head.name='mixamorig:Head';head.position.y=.35;chest.add(head);
  const L=new THREE.Bone();L.name='mixamorig:LeftArm';L.position.x=-.25;chest.add(L);
  const R=new THREE.Bone();R.name='mixamorig:RightArm';R.position.x=.25;chest.add(R);
  root.rotation.y=rotation;
  root.updateMatrixWorld(true);
  if(mesh){
    const geo=new THREE.BufferGeometry();
    // Front breast vertices are separated to avoid cross-chest skin bleed.
    geo.setAttribute('position',new THREE.Float32BufferAttribute([
      -.13,1.45,.13, -.10,1.43,.15, .13,1.45,.13, .10,1.43,.15,
      -.12,1.45,-.13, .12,1.45,-.13
    ],3));
    geo.setAttribute('skinIndex',new THREE.Uint16BufferAttribute([
      ...Array.from({length:6},()=>[1,0,0,0]).flat()
    ],4));
    geo.setAttribute('skinWeight',new THREE.Float32BufferAttribute([
      ...Array.from({length:6},()=>[.9,.1,0,0]).flat()
    ],4));
    const skin=new THREE.SkinnedMesh(geo,new THREE.MeshBasicMaterial());
    skin.userData.pcsMainSkin=true;skin.userData.pcsBodySurface='all';root.add(skin);
    root.updateMatrixWorld(true);
    skin.bind(new THREE.Skeleton([hips,chest,head,L,R]),skin.matrixWorld.clone());
  }
  return {root,hips,chest,head};
}
test('anatomical anchors symmetrical even with rotated chest and character',()=>{
  const {root,chest}=rig({rotation:Math.PI/2});
  chest.rotation.z=.4;
  root.updateMatrixWorld(true);
  const frame=anatomicalFrame(root);
  const left=addBoneChain(root,chest,'breast',1,'L')[0];
  const right=addBoneChain(root,chest,'breast',1,'R')[0];
  const a=left.getWorldPosition(new THREE.Vector3());
  const b=right.getWorldPosition(new THREE.Vector3());
  assert.ok(a.clone().sub(frame.chest).dot(frame.right)<0);
  assert.ok(b.clone().sub(frame.chest).dot(frame.right)>0);
  assert.ok(Math.abs(a.clone().sub(frame.chest).dot(frame.front)-
                     b.clone().sub(frame.chest).dot(frame.front))<1e-5);
  const wingsL=addBoneChain(root,chest,'wing',3,'L');
  const wingsR=addBoneChain(root,chest,'wing',3,'R');
  assert.ok(wingsL[0].getWorldPosition(new THREE.Vector3()).sub(frame.chest).dot(frame.right)<0);
  assert.ok(wingsR[0].getWorldPosition(new THREE.Vector3()).sub(frame.chest).dot(frame.right)>0);
});
test('ear/hair/tail have distinct anchors, not the same skull center',()=>{
  const {root,hips,head}=rig({mesh:false});
  const fr=anatomicalFrame(root);
  const hair=addBoneChain(root,head,'hair',2)[0];
  const earL=addBoneChain(root,head,'ear',2,'L')[0];
  const earR=addBoneChain(root,head,'ear',2,'R')[0];
  const tail=addBoneChain(root,hips,'tail',3)[0];
  assert.ok(hair.getWorldPosition(new THREE.Vector3()).distanceTo(earL.getWorldPosition(new THREE.Vector3()))>.04);
  assert.ok(earL.getWorldPosition(new THREE.Vector3()).distanceTo(earR.getWorldPosition(new THREE.Vector3()))>.08);
  assert.ok(tail.getWorldPosition(new THREE.Vector3()).sub(fr.hips).dot(fr.front)<0);
});
test('breast skinning updates weights only on corresponding FRONT side and not back',()=>{
  const {root,chest}=rig();
  const left=addBoneChain(root,chest,'breast',1,'L')[0];
  const right=addBoneChain(root,chest,'breast',1,'R')[0];
  const resultL=weightExistingSkin(root,left,{radius:.30,strength:.65});
  const resultR=weightExistingSkin(root,right,{radius:.30,strength:.65});
  assert.ok(resultL.vertices>0);assert.ok(resultR.vertices>0);
  const skin=root.children.find(x=>x.isSkinnedMesh);
  const joint=skin.geometry.getAttribute('skinIndex'),
        weights=skin.geometry.getAttribute('skinWeight');
  const L=skin.skeleton.bones.indexOf(left),R=skin.skeleton.bones.indexOf(right);
  assert.ok(L>=0&&R>=0);
  function weightAt(vertex,bone){
    let w=0;
    for(let j=0;j<4;j++)if(joint.getComponent(vertex,j)===bone)w+=weights.getComponent(vertex,j);
    return w;
  }
  assert.ok(weightAt(0,L)>.02);
  assert.ok(weightAt(2,R)>.02);
  assert.equal(weightAt(0,R),0);
  assert.equal(weightAt(2,L),0);
  assert.equal(weightAt(4,L),0);
  assert.equal(weightAt(5,R),0);
  for(let i=0;i<weights.count;i++){
    let s=0;for(let j=0;j<4;j++)s+=weights.getComponent(i,j);
    assert.ok(Math.abs(s-1)<1e-5);
  }
});

test('repainting breast on one disconnected island cannot repaint the other island of same skinned mesh',()=>{
 const {root,chest}=rig();
 const mesh=root.children.find(x=>x.isSkinnedMesh);
 const analysis=connectedSurfaceIslands(mesh.geometry);
 assert.equal(analysis.components.length,2);
 mesh.userData.pcsBodySurface='0';
 const before=Array.from(mesh.geometry.getAttribute('skinWeight').array);
 const left=addBoneChain(root,chest,'breast',1,'L')[0];
 const result=weightExistingSkin(root,left,{radius:.30,strength:.65});
 assert.ok(result.vertices>0);
 const after=mesh.geometry.getAttribute('skinWeight').array;
 for(let v=0;v<analysis.componentByVertex.length;v++){
  if(analysis.componentByVertex[v]===0)continue;
  for(let j=0;j<4;j++)
   assert.equal(after[v*4+j],before[v*4+j],'non-selected surface must retain original weights');
 }
});

test('cloth-painted vertices retain original skin weights after breast auto skinning',()=>{
 const {root,chest}=rig(),skin=root.children.find(x=>x.isSkinnedMesh);
 const beforeJ=Array.from(skin.geometry.getAttribute('skinIndex').array.slice(0,4));
 const beforeW=Array.from(skin.geometry.getAttribute('skinWeight').array.slice(0,4));
 const cloth=new Uint8Array(skin.geometry.getAttribute('position').count);
 cloth[0]=1;
 storeClothProtection(skin,cloth);
 const left=addBoneChain(root,chest,'breast',1,'L')[0];
 const result=weightExistingSkin(root,left,{radius:.30,strength:.65});
 assert.ok(result.vertices>0,'another unprotected breast vertex must still move');
 assert.deepEqual(Array.from(skin.geometry.getAttribute('skinIndex').array.slice(0,4)),beforeJ);
 assert.deepEqual(Array.from(skin.geometry.getAttribute('skinWeight').array.slice(0,4)),beforeW);
});
