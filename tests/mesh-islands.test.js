import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {connectedSurfaceIslands,allowsSurfaceVertex} from '../src/mesh-islands.js';
function mesh(vertices,triangles) {
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(vertices.flat(),3));
 g.setIndex(triangles.flat());
 return g;
}
test('body and disconnected garment get distinct island IDs without changing original mesh',()=>{
 const g=mesh([
  [0,0,0],[1,0,0],[0,1,0],[1,1,0],
  [0,0,.1],[1,0,.1],[0,1,.1]
 ],[[0,1,2],[1,3,2],[4,5,6]]);
 const oldIndices=Array.from(g.index.array);
 const r=connectedSurfaceIslands(g);
 assert.equal(r.reason,null);assert.equal(r.components.length,2);
 assert.equal(r.components[0].vertices,4);
 assert.equal(r.components[1].vertices,3);
 for(let v=0;v<4;v++)assert.equal(allowsSurfaceVertex(r,v,'0'),true);
 for(let v=4;v<7;v++)assert.equal(allowsSurfaceVertex(r,v,'0'),false);
 assert.equal(allowsSurfaceVertex(r,5,'all'),true);
 assert.equal(allowsSurfaceVertex(r,5,''),false);
 assert.deepEqual(Array.from(g.index.array),oldIndices);
 g.dispose();
});
test('UV-seam duplicates welded by 3D coordinates are same body island',()=>{
 const g=mesh([[0,0,0],[1,0,0],[0,1,0],[0,0,0],[1,0,0],[1,1,0]],[[0,1,2],[3,4,5]]);
 const r=connectedSurfaceIslands(g);
 assert.equal(r.components.length,1);
 assert.equal(r.components[0].vertices,6);
 g.dispose();
});
test('same mesh with body and cloth SEWN together remains one island; no false split',()=>{
 const g=mesh([[0,0,0],[1,0,0],[0,1,0],[1,1,0]],[[0,1,2],[1,3,2]]);
 const r=connectedSurfaceIslands(g);
 assert.equal(r.components.length,1);
 g.dispose();
});
test('bad geometry and huge meshes fail closed',()=>{
 const g=mesh([[0,0,0],[1,0,0],[0,1,0]],[[0,1,2]]);
 assert.match(connectedSurfaceIslands(g,{maxVertices:2}).reason,/Слишком большой/);
 g.setIndex([0,1,99]);
 assert.match(connectedSurfaceIslands(g).reason,/Некорректные индексы/);
 g.dispose();
});
