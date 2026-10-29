import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {encodeClothMask,decodeClothMask,clothProtection,storeClothProtection,paintProtection,countProtected,surfaceAdjacency} from '../src/cloth-protection.js';
function twoLayers(){
 const g=new THREE.BufferGeometry();
 // Physically close but topologically DISCONNECTED front fabric and body back.
 g.setAttribute('position',new THREE.Float32BufferAttribute([
  0,0,.02,  .1,0,.02,  0,.1,.02,
  0,0,0,    .1,0,0,    0,.1,0,
 ],3));g.setIndex([0,1,2,3,4,5]);return g;
}
test('touch painting follows triangle edges, not nearby underlying body',()=>{
 const geo=twoLayers(),mask=new Uint8Array(6);
 const graph=surfaceAdjacency(geo);assert.ok(!graph[0].includes(3));
 const changed=paintProtection(geo,mask,{a:0,b:1,c:2},{x:.03,y:.03,z:.02},.15,true);
 assert.equal(changed,3);
 assert.deepEqual(Array.from(mask),[1,1,1,0,0,0]);
 paintProtection(geo,mask,{a:0,b:1,c:2},{x:.03,y:.03,z:.02},.15,false);
 assert.equal(countProtected(mask),0);
 geo.dispose();
});
test('mask persists by compact ranges and validates mesh signature',()=>{
 const geo=twoLayers(),mask=new Uint8Array([0,1,1,0,0,1]);
 const packed=encodeClothMask(mask,geo);
 assert.deepEqual(packed.runs,[[1,2],[5,1]]);
 assert.deepEqual(Array.from(decodeClothMask(packed,geo)),Array.from(mask));
 const mesh=new THREE.SkinnedMesh(geo,new THREE.MeshBasicMaterial());
 storeClothProtection(mesh,mask);
 assert.equal(countProtected(clothProtection(mesh)),3);
 const changed=geo.clone();
 changed.getAttribute('position').setX(5,.777);
 mesh.geometry=changed;
 assert.throws(()=>clothProtection(mesh),/не совпадает/);
 mesh.material.dispose();geo.dispose();changed.dispose();
});
test('mask fails closed on invalid or overlapping ranges',()=>{
 const g=twoLayers();
 const data=encodeClothMask(new Uint8Array(6),g);
 data.runs=[[1,3],[2,2]];
 assert.throws(()=>decodeClothMask(data,g),/диапазоны/);
 g.dispose();
});
test('brush can be restricted to selected anatomical island',()=>{
 const g=twoLayers(),m=new Uint8Array(6);
 const selected=new Set([3,4,5]);
 paintProtection(g,m,{a:0,b:1,c:2},{x:.03,y:.03,z:.02},.15,true,
  {allowed:v=>selected.has(v)});
 assert.equal(countProtected(m),0,'wrong island must remain unpainted');
 g.dispose();
});

test('brush crosses UV seam where vertices share coordinates and compatible normals',()=>{
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute([
  0,0,0,1,0,0,0,1,0,
  1,0,0,1,1,0,0,1,0
 ],3));
 g.setAttribute('normal',new THREE.Float32BufferAttribute(Array.from({length:6},()=>[0,0,1]).flat(),3));
 const graph=surfaceAdjacency(g);
 assert.ok(graph[1].includes(3),'same-position UV seam must be connected');
 const mask=new Uint8Array(6);
 const affected=paintProtection(g,mask,{a:0,b:1,c:2},{x:.5,y:.3,z:0},1.8,true);
 assert.equal(affected,6,'paint can cross UV seam inside selected surface');
 g.dispose();
});

test('full signature detects changes to middle vertices skipped by old 96-vertex sampling',()=>{
 const count=1001,g=new THREE.BufferGeometry(),coords=new Float32Array(count*3);
 for(let i=0;i<count;i++){coords[3*i]=i/1000;coords[3*i+1]=i%4;coords[3*i+2]=0;}
 g.setAttribute('position',new THREE.Float32BufferAttribute(coords,3));
 const mask=new Uint8Array(count);mask[150]=1;
 const mesh=new THREE.SkinnedMesh(g,new THREE.MeshBasicMaterial());
 const saved=storeClothProtection(mesh,mask);
 assert.equal(saved.type,'phoenix-cloth-guard-v2');
 assert.equal(clothProtection(mesh)[150],1);
 // Old sampled algorithm observes only multiples of floor(1001/96)=10 and 1000.
 g.getAttribute('position').setZ(151,0.91);
 assert.throws(()=>clothProtection(mesh),/не совпадает/,'same BufferGeometry mutated in place');
 mesh.material.dispose();g.dispose();
});
test('legacy sampled v1 masks fail closed, never silently applied to modified mesh',()=>{
 const g=twoLayers(),m=new THREE.SkinnedMesh(g,new THREE.MeshBasicMaterial());
 m.userData.pcsClothMask={type:'phoenix-cloth-guard-v1',vertices:6,signature:'00000000',runs:[[0,3]]};
 assert.throws(()=>clothProtection(m),/не совпадает/);
 g.dispose();m.material.dispose();
});
