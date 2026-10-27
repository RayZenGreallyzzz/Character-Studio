import * as THREE from 'three';
import {suggestParent} from './rig-utils.js';

// Use the imported skeleton's WORLD axes. The parent bone may be rotated
// 90/180 degrees (Mixamo, Tripo, Z-up conversions); its raw local X is not
// a reliable left/right direction.
const point=b=>b?.getWorldPosition(new THREE.Vector3())||new THREE.Vector3();
const boneMatch=(bones, side,role)=>bones.find(b=>{
  const n=b.name.replace(/^mixamorig[:_]?/i,'').toLowerCase().replace(/[._:-]/g,'');
  const left=/(left|(^|[^a-z])l)/i.test(n)||/^l(shoulder|arm|clavicle)/.test(n);
  const right=/(right|(^|[^a-z])r)/i.test(n)||/^r(shoulder|arm|clavicle)/.test(n);
  const isArm=/(shoulder|upperarm|arm|clavicle)/.test(n)&&!/(forearm|lowerarm|hand|finger|thumb)/.test(n);
  return (side==='L'?left:right) && (role==='shoulder'?isArm:false);
});
export function anatomicalFrame(root){
  root.updateMatrixWorld(true);
  const bones=[];root.traverse(o=>{if(o.isBone)bones.push(o);});
  const hips=suggestParent(bones,'tail'),chest=suggestParent(bones,'breast'),
    head=suggestParent(bones,'hair');
  const hp=point(hips),cp=point(chest),np=point(head);
  let up=np.clone().sub(hp);
  if(up.length()<.001)up.set(0,1,0);
  up.normalize();
  const leftBone=boneMatch(bones,'L','shoulder'),
    rightBone=boneMatch(bones,'R','shoulder');
  let right=leftBone&&rightBone?
    point(rightBone).sub(point(leftBone)):new THREE.Vector3(1,0,0);
  right.addScaledVector(up,-right.dot(up));
  if(right.length()<.001)right.set(1,0,0);
  right.normalize();
  let front=right.clone().cross(up).normalize();
  if(front.length()<.001)front.set(0,0,1);
  const bounds=new THREE.Box3().setFromObject(root);
  const size=bounds.getSize(new THREE.Vector3());
  const scale=Math.max(.15,Math.min(30,size.length()/2.3));
  const shoulders=leftBone&&rightBone?
    point(rightBone).distanceTo(point(leftBone)):.38*scale;
  const shoulderWidth=Math.max(.2*scale,Math.min(.7*scale,shoulders));
  return {up,right,front,hips:hp,chest:cp,head:np,scale,shoulderWidth};
}
const loc=(base,terms)=>terms.reduce((a,[axis,value])=>a.addScaledVector(axis,value),base.clone());
export function anatomicalTargets(frame,slot,side,count=3){
  const {up,right,front,hips,chest,head,scale:s,shoulderWidth:w}=frame;
  const sign=side==='L'?-1:side==='R'?1:0;
  let first,step;
  if(slot==='breast'){
    first=loc(chest,[[right,sign*w*.32],[front,s*.085],[up,-s*.025]]);
    step=loc(first,[[front,s*.065],[right,sign*s*.008],[up,-s*.013]]);
  }else if(slot==='hair'){
    first=loc(head,[[up,s*.11]]);
    step=loc(first,[[up,s*.08]]);
  }else if(slot==='ear'){
    first=loc(head,[[right,sign*s*.085],[up,s*.1]]);
    step=loc(first,[[right,sign*s*.03],[up,s*.07]]);
  }else if(slot==='wing'){
    first=loc(chest,[[right,sign*w*.52],[up,s*.09],[front,-s*.085]]);
    step=loc(first,[[right,sign*s*.14],[up,s*.07],[front,-s*.085]]);
  }else if(slot==='tail'){
    first=loc(hips,[[front,-s*.11],[up,-s*.055]]);
    step=loc(first,[[front,-s*.11],[up,-s*.045]]);
  }else if(slot==='face'){
    first=loc(head,[[up,-s*.055],[front,s*.09]]);
    step=loc(first,[[front,s*.03]]);
  }else{
    first=loc(hips,[[right,sign*s*.085],[up,-s*.10]]);
    step=loc(first,[[up,-s*.11]]);
  }
  const result=[first],delta=step.clone().sub(first);
  for(let i=1;i<count;i++)result.push(first.clone().addScaledVector(delta,i));
  return result;
}
export function pointAnatomyMask(point,frame,slot,side){
  if(slot!=='breast')return 1;
  const dx=point.clone().sub(frame.chest),lateral=dx.dot(frame.right),
    forward=dx.dot(frame.front);
  const s=frame.scale;
  // Do not grab the opposite breast, spine, back or shoulders.
  if(side==='L' && lateral>-s*.008)return 0;
  if(side==='R' && lateral<s*.008)return 0;
  if(forward<s*.02)return 0;
  // Suppress tiny stray influence across midline and behind sternum.
  return Math.min(1,Math.max(0,(Math.abs(lateral)-s*.008)/(s*.055))) *
      Math.min(1,Math.max(0,(forward-s*.02)/(s*.055)));
}
