import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectSkeletonCompatibility,remapAnimationTracks} from '../src/retarget-compat.js';
function bone(name,parent=null,q={x:0,y:0,z:0,w:1}){
 const b={isBone:true,name,uuid:'u_'+name,quaternion:q,parent,children:[],traverse(f){f(this);this.children.forEach(c=>c.traverse(f))}};
 if(parent)parent.children.push(b);
 return b;
}
function rig(twisted=false){
 const hips=bone('mixamorigHips');
 bone('mixamorigSpine',hips);
 bone('mixamorigLeftArm',hips,twisted?{x:0,y:.70710678,z:0,w:.70710678}:{x:0,y:0,z:0,w:1});
 return hips;
}
test('identical rigs are compatible and remap tracks to target node UUID',()=>{
 const src=rig(),dst=rig();
 assert.equal(inspectSkeletonCompatibility(src,dst).ok,true);
 const track={name:'mixamorigLeftArm.quaternion',clone(){return {...this}}};
 const result=remapAnimationTracks({tracks:[track]},src,dst);
 assert.equal(result.tracks.length,1);
 assert.equal(result.tracks[0].name,'u_mixamorigLeftArm.quaternion');
});
test('incompatible bind pose is blocked before animation import',()=>{
 const src=rig(),dst=rig(true);
 const report=inspectSkeletonCompatibility(src,dst);
 assert.equal(report.ok,false);
 assert.ok(report.problems.some(p=>p.includes('исходная ориентация')));
});
test('mismatched hierarchy is blocked',()=>{
 const src=rig(),dst=rig();
 const arm=dst.children.find(c=>c.name==='mixamorigLeftArm');
 dst.children=dst.children.filter(c=>c!==arm);
 dst.children[0].children.push(arm);
 arm.parent=dst.children[0];
 const report=inspectSkeletonCompatibility(src,dst);
 assert.equal(report.ok,false);
 assert.ok(report.problems.some(p=>p.includes('родитель')));
});
