import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAutoLODTarget,inspectAutoLODCandidate,inspectGeometry} from '../src/autolod-quality.js';
function geo(points,indices) {
 const pos=points.flat();
 const attr={itemSize:3,count:points.length,getX:i=>pos[i*3],getY:i=>pos[i*3+1],getZ:i=>pos[i*3+2]};
 const index=indices?{count:indices.length,getX:i=>indices[i]}:null;
 return {getAttribute:n=>n==='position'?attr:null,getIndex:()=>index};
}
const tetra=geo([[0,0,0],[1,0,0],[0,1,0],[0,0,1]],[0,2,1,0,1,3,0,3,2,1,2,3]);
test('target range inclusive',()=>{
 assert.equal(validateAutoLODTarget(12000),12000);
 assert.equal(validateAutoLODTarget(50000),50000);
 for(const v of [11999,50001,25000.5,NaN])assert.throws(()=>validateAutoLODTarget(v));
});
test('identical geometry is rejected: no simplification',()=>{
 const r=inspectAutoLODCandidate(tetra,tetra,{target:12000});
 assert.equal(r.accepted,false);assert.match(r.reasons.join(' '),/не уменьшилось/);
});
test('shrinking volume proxy is rejected',()=>{
 const smaller=geo([[0,0,0],[.5,0,0],[0,.5,0],[0,0,.5]],[0,2,1]);
 const r=inspectAutoLODCandidate(tetra,smaller,{target:12000});
 assert.equal(r.accepted,false);
 assert.match(r.reasons.join(' '),/размер/);
});
test('new degenerate triangles are rejected',()=>{
 const bad=geo([[0,0,0],[1,0,0],[0,1,0],[0,0,1]],[0,0,1]);
 const r=inspectAutoLODCandidate(tetra,bad,{target:12000});
 assert.equal(r.accepted,false);
 assert.match(r.reasons.join(' '),/вырожденные/);
});
test('invalid triangle indices fail validation',()=>{
 assert.throws(()=>inspectGeometry(geo([[0,0,0],[1,0,0],[0,1,0]],[0,1,99])));
});
