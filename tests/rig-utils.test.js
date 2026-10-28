import test from 'node:test';
import assert from 'node:assert/strict';
import {guessBoneCategory,suggestParent,uniqueBoneName,smoothWeight,normalizedTopFour,interpolateKeyframes,secondaryAngles,suggestBodySkinIndex,isLikelyGarmentName,existingTorsoWeight,shouldApplyBreastWeight} from '../src/rig-utils.js';
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

test('garments are never auto-selected as anatomical body',()=>{
 assert.equal(suggestBodySkinIndex([{name:'SkinnedMesh_Dress',vertices:10000},{name:'Body',vertices:18000}]),1);
 assert.equal(suggestBodySkinIndex([{name:'Hair',vertices:2000},{name:'Dress',vertices:8000}]),-1);
 assert.equal(suggestBodySkinIndex([{name:'Part_1',vertices:10000},{name:'Part_2',vertices:9000}]),-1);
 assert.equal(suggestBodySkinIndex([{name:'Unlabeled',vertices:20000}]),-1);
 assert.equal(isLikelyGarmentName('Female_Dress'),true);
});
test('breast influence is limited to torso weights and signed body region',()=>{
 const w=existingTorsoWeight([{bone:0,weight:.8},{bone:1,weight:.2}],['mixamorig:Spine2','LeftArm']);
 assert.ok(Math.abs(w-.8)<1e-9);
 assert.equal(shouldApplyBreastWeight({side:'L',pointLocalX:-.1,boneLocalX:-.12,torsoWeight:w}),true);
 assert.equal(shouldApplyBreastWeight({side:'L',pointLocalX:.20,boneLocalX:-.12,torsoWeight:w}),false);
 assert.equal(shouldApplyBreastWeight({side:'R',pointLocalX:-.2,boneLocalX:.12,torsoWeight:w}),false);
 assert.equal(shouldApplyBreastWeight({side:'L',pointLocalX:-.1,boneLocalX:-.12,torsoWeight:.1}),false);
});
