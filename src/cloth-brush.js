import * as THREE from 'three';
import {clothProtection,storeClothProtection,countProtected,paintProtection} from './cloth-protection.js';

/** Touch brush for already-skinned character surfaces; never exports helper dots. */
export function createClothBrush({renderer,camera,scene,controls,getMesh,getSelectedSurface,pause,resetPose,say}){
 const canvas=renderer.domElement;
 const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
 let enabled=false,activePointer=null,stroke=null,dirty=false,overlay=null;
 const el=id=>document.getElementById(id);
 function removeOverlay(){
  if(!overlay)return;
  overlay.parent?.remove(overlay);overlay.geometry.dispose();overlay.material.dispose();overlay=null;
 }
 function updateInfo(message){
  const mesh=getMesh(),pos=mesh?.geometry?.getAttribute('position');
  let count=0;
  try{count=countProtected(mesh?clothProtection(mesh):null)}catch(error){el('cloth-paint-info').textContent=error.message;return}
  el('cloth-paint-info').textContent=message||
    (pos?'Защищено '+count.toLocaleString('ru-RU')+' из '+pos.count.toLocaleString('ru-RU')+' вершин. Маска сохраняется в .pcs и GLB.':
      'Сначала выбери меш тела, затем кисть одежды.');
 }
 function show(){
  removeOverlay();
  const mesh=getMesh();if(!mesh)return;
  const mask=clothProtection(mesh);if(!mask){updateInfo();return}
  const total=countProtected(mask);if(!total){updateInfo();return}
  mesh.updateMatrixWorld(true);
  const pos=mesh.geometry.getAttribute('position'),vertices=[],p=new THREE.Vector3();
  const stride=Math.max(1,Math.ceil(total/3500));let seen=0;
  for(let i=0;i<mask.length;i++){
   if(!mask[i]||((seen++%stride)!==0))continue;
   p.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);
   vertices.push(p.x,p.y,p.z);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  overlay=new THREE.Points(g,new THREE.PointsMaterial({color:0x25e3d5,size:.012,sizeAttenuation:true,depthTest:false,depthWrite:false}));
  overlay.renderOrder=105;scene.add(overlay);updateInfo();
 }
 function finish(){
  if(stroke&&dirty){
   const mesh=getMesh();if(mesh)storeClothProtection(mesh,stroke);
   show();
  }
  activePointer=null;stroke=null;dirty=false;
 }
 function disable(){
  if(activePointer!==null)finish();
  enabled=false;controls.enabled=true;canvas.style.cursor='';
  const btn=el('cloth-paint-toggle');if(btn)btn.textContent='Включить кисть на 3D-модели';
 }
 function enable(){
  const mesh=getMesh(),region=getSelectedSurface();
  if(!mesh||region===undefined||region===null||region==='')throw Error('Выбери меш и участок тела в разделе 03.');
  if(mesh.geometry.getAttribute('position').count>120000)throw Error('Кисть ограничена 120 000 вершинами для работы на планшете.');
  clothProtection(mesh); // Reject stale/mismatched masks before any painting.
  pause();resetPose();mesh.updateMatrixWorld(true);
  enabled=true;controls.enabled=false;canvas.style.cursor='crosshair';
  el('cloth-paint-toggle').textContent='Выключить кисть (вращение камеры)';
  show();updateInfo('Кисть включена: проведи пальцем по одежде; камера временно заблокирована.');
 }
 function hit(event){
  const mesh=getMesh();if(!mesh)return null;
  const rect=canvas.getBoundingClientRect();
  if(!rect.width||!rect.height)return null;
  pointer.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);
  raycaster.setFromCamera(pointer,camera);
  const entry=raycaster.intersectObject(mesh,false)[0];
  if(!entry?.face)return null;
  const local=entry.point.clone().applyMatrix4(mesh.matrixWorld.clone().invert());
  return {mesh,face:entry.face,local};
 }
 function draw(e){
  if(!stroke)return;
  const picked=hit(e);if(!picked)return;
  const geo=picked.mesh.geometry;
  geo.computeBoundingBox();
  const radius=Math.max(geo.boundingBox.getSize(new THREE.Vector3()).length(),1e-6)*Number(el('cloth-radius').value);
  const selection=getSelectedSurface();
  const changed=paintProtection(geo,stroke,picked.face,picked.local,radius,el('cloth-mode').value==='protect',
     {allowed:v=>selection==='all'||selection?.componentByVertex?.[v]!==undefined&&selection.componentByVertex[v]===selection.id});
  if(changed){dirty=true;el('cloth-paint-info').textContent='Кисть: изменено ещё '+changed+' вершин. Отпусти палец для сохранения.';}
 }
 canvas.addEventListener('pointerdown',e=>{
  if(!enabled||e.button!==0)return;
  e.preventDefault();e.stopPropagation();
  const mesh=getMesh();if(!mesh)return;
  try{
   activePointer=e.pointerId;
   const current=clothProtection(mesh);
   stroke=current?current.slice():new Uint8Array(mesh.geometry.getAttribute('position').count);
   dirty=false;canvas.setPointerCapture(e.pointerId);draw(e);
  }catch(error){disable();say(error.message,'error')}
 },true);
 canvas.addEventListener('pointermove',e=>{
  if(!enabled||activePointer!==e.pointerId)return;
  e.preventDefault();e.stopPropagation();
  try{draw(e)}catch(error){finish();disable();say(error.message,'error')}
 },true);
 for(const type of ['pointerup','pointercancel'])canvas.addEventListener(type,e=>{
  if(activePointer!==e.pointerId)return;
  e.preventDefault();e.stopPropagation();
  if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
  finish();
 },true);
 el('cloth-paint-toggle').onclick=()=>{try{enabled?disable():enable()}catch(error){say(error.message,'error')}};
 el('cloth-radius').oninput=()=>{el('cloth-radius-label').textContent=(Number(el('cloth-radius').value)*100).toFixed(1)+'%';};
 el('cloth-show').onclick=()=>{try{show()}catch(error){say(error.message,'error')}};
 el('cloth-clear').onclick=()=>{
  const mesh=getMesh();if(!mesh)return say('Выбери меш тела','error');
  if(!confirm('Очистить ВСЮ защиту одежды?'))return;
  try{
   disable();storeClothProtection(mesh,new Uint8Array(mesh.geometry.getAttribute('position').count));show();
   say('Защита одежды очищена. Ранее изменённые веса не восстанавливаются.');
  }catch(error){say(error.message,'error')}
 };
 return {enable,disable,show,removeOverlay,updateInfo};
}
