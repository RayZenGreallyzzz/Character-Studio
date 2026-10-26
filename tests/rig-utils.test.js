import test from 'node:test';
import assert from 'node:assert/strict';
import {guessBoneCategory,suggestParent,uniqueBoneName,smoothWeight,normalizedTopFour,interpolateKeyframes,secondaryAngles} from '../src/rig-utils.js';
test('Mixamo parent matching',()=>{
  const bones=[{name:'mixamorig:Hips'},{name:'mixamorig:Spine2'},{name:'mixamorig:Head'}];
  assert.equal(suggestParent(bones,'hair').name,'mixamorig:Head');
  assert.equal(suggestParent(bones,'breast').name,'mixamorig:Spine2');
  assert.equal(suggestParent(bones,'tail').name,'mixamorig:Hips');
  assert.equal(guessBoneCategory('upperChest'),'chest');
});
test('additions never overwrite existing bone name',()=>assert.equal(uniqueBoneName([{name:'Tail_01'}, {name:'Tail_01_2'}],'Tail_01'),'Tail_01_3'));
test('weights remain normalized and fit glTF 4 slots',()=>{
 const a=normalizedTopFour([{bone:1,weight:.7},{bone:2,weight:.3}],5,.6);
 assert.equal(a.length,3); assert.ok(Math.abs(a.reduce((s,v)=>s+v.weight,0)-1)<1e-6);
 assert.equal(a[0].bone,5);
 assert.equal(smoothWeight(2,1),0); assert.equal(smoothWeight(0,1),1);
});
test('animation interpolation and procedural motion',()=>{
 assert.deepEqual(interpolateKeyframes([{time:0,euler:[0,0,0]},{time:2,euler:[20,-10,0]}],1),[10,-5,0]);
 assert.deepEqual(secondaryAngles(0,{enabled:false}),[0,0,0]);
});
