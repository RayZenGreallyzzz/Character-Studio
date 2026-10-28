import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {Filesystem,Directory} from '@capacitor/filesystem';
import {Share} from '@capacitor/share';
import {Capacitor} from '@capacitor/core';
import {getBones,getSkins,getDefaultParent,addBoneChain,skinAccessoryToChain,weightExistingSkin,applyExtraPose,animationTracksForExtras} from './rig.js';
import {secondaryAngles,suggestBodySkinIndex,isLikelyGarmentName} from './rig-utils.js';
import {inspectSkeletonCompatibility,remapAnimationTracks} from './retarget-compat.js';
import './style.css';

const $=id=>document.getElementById(id);
const app=$('app');
app.innerHTML=`
<header><div class="brand"><span class="mark">✦</span><div><strong>PHOENIX</strong><small>CHARACTER STUDIO · alpha 0.1</small></div></div><div class="toolbar">
<label class="btn primary">Загрузить персонажа GLB<input id="base-file" type="file" accept=".glb" hidden></label>
<label class="btn">Добавить деталь GLB<input id="detail-file" type="file" accept=".glb" hidden></label>
<label class="btn">Открыть проект<input id="project-file" type="file" accept=".pcs,.json" hidden></label>
<label class="btn">Анимация GLB<input id="animation-file" type="file" accept=".glb" hidden></label><button id="save-project">Проект</button><button class="btn primary" id="export">Экспорт GLB</button></div></header>
<div class="main-layout"><aside class="sidebar"><div class="scroll">
<section><div class="heading">01 / Скелет</div><label>Родительская кость<select id="parent-bone"></select></label><label>Новая часть<select id="slot"><option value="hair">Волосы</option><option value="tail">Хвост</option><option value="breast">Грудь</option><option value="face">Лицо</option><option value="ear">Уши</option><option value="wing">Крылья</option><option value="cloth">Одежда / юбка</option></select></label><div class="line"><label>Количество костей<input id="count" type="number" min="1" max="15" value="3"/></label><label>Сторона<select id="side"><option value="">Центр</option><option value="L">Лево</option><option value="R">Право</option></select></label></div><button class="btn wide" id="add-chain">+ Создать цепочку</button><button class="btn wide" id="breasts">+ Пара костей груди L/R</button></section>
<section><div class="heading">02 / Детали и кости</div><label>Выбранный элемент<select id="selection"></select></label><label>Цепочка для деформации<select id="rig-chain"></select></label><button class="btn wide" id="rig-detail">Привязать деталь к цепочке</button><button class="btn wide" id="attach">Прикрепить деталь к кости</button><div class="subhead">Позиция / поворот / масштаб</div><div id="transform-controls"></div></section>
<section><div class="heading">03 / Автовеса тела</div><p class="hint">Для новых костей груди и других мягких частей тела. Применять в исходной позе персонажа. Одежда НЕ должна входить в выбор.</p><label>Анатомический меш (не одежда!)<select id="body-skin"><option value="">Не выбран — автопривязка выключена</option></select></label><p class="hint" id="skin-guard-info">Выбери GLB и проверь, какой меш относится к телу.</p><label>Радиус влияния, м<input id="radius" type="number" min="0.01" step="0.01" value="0.18"></label><label>Сила влияния (0–0.95)<input id="strength" type="number" min="0" max="0.95" step="0.05" value="0.55"></label><button class="btn wide" id="auto-weights">Назначить веса выбранной кости</button></section>
<section><div class="heading">04 / Вторичное движение</div><label class="check"><input id="motion-enabled" type="checkbox"> Автоматическое покачивание</label><label>Амплитуда, °<input id="amplitude" type="range" min="0" max="35" step="1" value="5"><span id="amplitude-out">5°</span></label><label>Частота, Гц<input id="frequency" type="range" min="0.2" max="4" step="0.1" value="1.3"><span id="frequency-out">1.3</span></label><p class="hint">Движение запекается в ключи выбранных анимаций.</p></section>
</div></aside><main class="workspace"><div class="viewport-head"><div><strong id="character-name">Демонстрационный манекен</strong><span id="mesh-info">Загрузите GLB для редактирования</span></div><div class="tools"><button id="focus">Центрировать</button><button id="skeleton-toggle">Кости: вкл</button><button id="rest">Исходная поза</button></div></div><div id="stage"></div><div class="floor-note">Один палец — вращение · два — масштаб / движение камеры</div>
<div class="timeline"><div class="timeline-top"><div class="heading">05 / Анимация</div><div class="play-controls"><button id="play">▶</button><select id="clip-select"></select><button id="new-clip">+ Клип</button></div></div><input type="range" id="time" min="0" max="3" step="0.01" value="0"><div class="line timeline-bottom"><span id="time-label">0.00 / 3.00 сек</span><div class="line"><button id="keyframe">◆ Записать ключ кости</button><button id="clear-keys">Удалить ключи кости</button></div></div><p class="hint">Ключ сохраняет углы из полей «Поворот» для выбранной добавленной кости; существующие клипы не перезаписываются до экспорта.</p></div>
</main></div><div class="status" id="status">Готово. Загрузите GLB или попробуйте демо-манекен.</div>
`;

const state={root:null,scene:null,baseBytes:null,baseName:'',baseAnimations:[],extras:[],accessories:[],selected:null,activeClip:'PCS_Idle',customClips:{PCS_Idle:3},animationData:{},mixer:null,playing:false,clock:new THREE.Clock(),time:0,skeletonVisible:true,helpers:[],demo:true,applying:false};
const scene=new THREE.Scene();scene.background=new THREE.Color('#171c27');scene.fog=new THREE.Fog('#171c27',18,45);state.scene=scene;
const camera=new THREE.PerspectiveCamera(37,1,.01,150);camera.position.set(3.3,2.2,5.3);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power',preserveDrawingBuffer:false});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;$('stage').appendChild(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,1,0);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.94;controls.minDistance=.2;controls.maxDistance=35;
scene.add(new THREE.HemisphereLight(0xe0eaff,0x363447,2.2));const sun=new THREE.DirectionalLight(0xffffff,2.4);sun.position.set(3,6,4);scene.add(sun);const fill=new THREE.DirectionalLight(0x8a9ff0,.7);fill.position.set(-4,3,-5);scene.add(fill);
const grid=new THREE.GridHelper(20,40,0x404959,0x292f3a);grid.position.y=-.01;scene.add(grid);
const loader=new GLTFLoader();loader.setMeshoptDecoder(MeshoptDecoder);
const exporter=new GLTFExporter();
const categories=['hair','tail','breast','face','ear','wing','cloth'];
let resizeObserver=new ResizeObserver(()=>resize());resizeObserver.observe($('stage'));
function resize(){const r=$('stage').getBoundingClientRect();if(r.width<1||r.height<1)return;renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();}
function say(msg,type='ok'){const s=$('status');s.textContent=msg;s.dataset.kind=type;}
function err(e){console.error(e);say(e?.message||String(e),'error');}
function currentBones(){return getBones(state.root);}
function currentClip(){return state.baseAnimations.find(c=>c.name===state.activeClip) || null;}
function currentDuration(){return currentClip()?.duration||state.customClips[state.activeClip]||3;}
function getClipNames(){return [...new Set([...state.baseAnimations.map(c=>c.name),...Object.keys(state.customClips)])];}
function resetCharacter(){if($('body-skin'))$('body-skin').replaceChildren(option('','Не выбран — автовеса выключены'));if(state.root){scene.remove(state.root);state.root.traverse(o=>{if(!o.isMesh)return;if(o.geometry)o.geometry.dispose();for(const m of (Array.isArray(o.material)?o.material:[o.material])){if(!m)continue;for(const v of Object.values(m))if(v?.isTexture)v.dispose();m.dispose?.();}});}for(const h of state.helpers){scene.remove(h);h.dispose?.();}state.helpers=[];state.root=null;state.extras=[];state.accessories=[];state.animationData={};state.customClips={PCS_Idle:3};state.activeClip='PCS_Idle';state.mixer?.stopAllAction();state.mixer=null;state.baseAnimations=[];state.selected=null;state.playing=false;state.time=0;state.baseBytes=null;state.weightOperations=[];state.demo=false;}
function makeDemo(){resetCharacter();const root=new THREE.Group();root.name='Demo_Rig';const hips=new THREE.Bone();hips.name='Hips';hips.position.y=.97;root.add(hips);const chest=new THREE.Bone();chest.name='UpperChest';chest.position.y=.44;hips.add(chest);const head=new THREE.Bone();head.name='Head';head.position.y=.37;chest.add(head);const mat=new THREE.MeshStandardMaterial({color:0x9aafc9,roughness:.7});const dummy=(name,radius,length,px,py,pz,parent)=>{const o=new THREE.Mesh(new THREE.CapsuleGeometry(radius,length,4,8),mat);o.name=name;o.position.set(px,py,pz);o.userData.pcsDemo=true;parent.add(o);};dummy('Корпус (демо)',.22,.52,0,.17,0,chest);dummy('Голова (демо)',.16,.12,0,.13,0,head);dummy('Таз (демо)',.19,.12,0,-.06,0,hips);dummy('Нога Л (демо)',.095,.66,-.11,-.53,0,hips);dummy('Нога П (демо)',.095,.66,.11,-.53,0,hips);
 for(const sign of [-1,1])dummy('Рука (демо)',.077,.48,sign*.3,-.04,0,chest);
 scene.add(root);state.root=root;state.demo=true;state.baseName='Демо-скелет (неэкспортируемый персонаж)';state.selected=head;refreshAll();focus();say('Демонстрационный скелет: попробуй добавить кости. Для реального персонажа загрузи GLB.');}
function focus(){if(!state.root)return;state.root.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(state.root);if(b.isEmpty())return;const center=b.getCenter(new THREE.Vector3());const size=b.getSize(new THREE.Vector3()).length();controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(size*.9,size*.55,size*1.25));controls.update();}
function figureScale(){if(!state.root)return 1;const b=new THREE.Box3().setFromObject(state.root);return Math.max(.01,b.getSize(new THREE.Vector3()).y/1.8);}
async function parseGLB(bytes){return await new Promise((resolve,reject)=>loader.parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'',resolve,reject));}
async function loadBase(bytes,name){const gltf=await parseGLB(bytes);if(!gltf.scene)throw Error('В файле не найден персонаж');const bones=getBones(gltf.scene);if(!bones.length)throw Error('В GLB нет скелета. Нужна заранее зариганная модель.');resetCharacter();state.baseBytes=bytes.slice();state.baseName=name;state.root=gltf.scene;state.root.name=state.root.name||'Character';state.root.traverse(o=>{if(o.isSkinnedMesh)o.userData.pcsMainSkin=false;});scene.add(state.root);state.baseAnimations=gltf.animations||[];state.mixer=new THREE.AnimationMixer(state.root);state.activeClip=state.baseAnimations[0]?.name||'PCS_Idle';state.selected=getDefaultParent(state.root,'head');refreshAll();refreshBodySkinOptions(true);focus();say(`Загружен ${name}: ${bones.length} костей · ${state.baseAnimations.length} анимаций. Проверь меш тела!`);}
async function loadAccessory(bytes,name,opts={}){if(!state.root||state.demo)throw Error('Сначала загрузи персонажа GLB со скелетом');const gltf=await parseGLB(bytes);if(!gltf.scene)throw Error('В детали не найден меш');const id=opts.id||`Detail_${state.accessories.length+1}`;const parent=getBones(state.root).find(b=>b.name===opts.parent)||getDefaultParent(state.root,opts.slot||'hair');if(!parent)throw Error('Кость крепления не найдена');const group=gltf.scene;group.name=id;parent.add(group);group.position.set(0,0,0);group.quaternion.identity();group.scale.set(1,1,1);if(opts.transform){group.position.fromArray(opts.transform.position);group.quaternion.fromArray(opts.transform.quaternion);group.scale.fromArray(opts.transform.scale);}const item={id,name,bytes:bytes.slice(),group,slot:opts.slot||'hair',parent:parent.name,rigged:false};state.accessories.push(item);state.selected=group;refreshAll();say(`Деталь «${name}» привязана к ${parent.name}. Проверь положение.`);return item;}
function refreshSkeletonHelper(){for(const h of state.helpers){scene.remove(h);h.dispose?.();}state.helpers=[];if(!state.skeletonVisible||!state.root)return;const helper=new THREE.SkeletonHelper(state.root);helper.material.depthTest=false;helper.material.opacity=.74;helper.material.transparent=true;scene.add(helper);state.helpers.push(helper);}
function option(value,label){const o=document.createElement('option');o.value=value;o.textContent=label;return o;}
function refreshAll(){const bones=currentBones(),picked=state.selected;
 const sel=$('selection');sel.replaceChildren(option('','Выбери кость или деталь'));for(const b of bones)sel.add(option(`bone:${b.uuid}`,`🦴 ${b.name}`));for(const a of state.accessories)sel.add(option(`detail:${a.id}`,`✦ ${a.id}`));
 if(picked?.isBone)sel.value=`bone:${picked.uuid}`;else {const acc=state.accessories.find(a=>a.group===picked);if(acc)sel.value=`detail:${acc.id}`;}
 const parent=$('parent-bone');parent.replaceChildren();for(const b of bones)parent.add(option(b.uuid,b.name));if(picked?.isBone)parent.value=picked.uuid;else parent.value=getDefaultParent(state.root,$('slot').value)?.uuid||'';
 const clips=$('clip-select');clips.replaceChildren();for(const name of getClipNames())clips.add(option(name,name));clips.value=state.activeClip;
 const chain=$('rig-chain');chain.replaceChildren(option('','Выбери первую кость цепочки'));for(const b of state.extras)chain.add(option(b.name,b.name));
 $('character-name').textContent=state.baseName||'Демонстрационный манекен';$('mesh-info').textContent=`${bones.length} костей · ${getSkins(state.root).length} skinned meshes · ${state.accessories.length} деталей`;
 $('time').max=String(currentDuration());refreshSkeletonHelper();refreshSelection();updateTimeline();}

function refreshBodySkinOptions(auto=false){
 const skins=getSkins(state.root).filter(m=>!m.userData.pcsAccessory);
 const select=$('body-skin');if(!select)return;
 const current=auto?'':select.value;
 select.replaceChildren(option('','Не выбран — автовеса выключены'));
 skins.forEach((m,i)=>select.add(option(m.uuid,`${i+1}: ${m.name||'(без имени)'} · ${m.geometry?.getAttribute('position')?.count||0} вершин${isLikelyGarmentName(m.name)?' · возможно одежда':''}`)));
 if(auto){
  const index=suggestBodySkinIndex(skins.map(m=>({name:m.name,vertices:m.geometry?.getAttribute('position')?.count||0})));
  if(index>=0)select.value=skins[index].uuid;
 }else if(current&&skins.some(m=>m.uuid===current))select.value=current;
 applyBodySkinSelection();
}
function applyBodySkinSelection(){
 const selected=$('body-skin')?.value||'';
 const skins=getSkins(state.root);
 skins.forEach(m=>{m.userData.pcsMainSkin=!!selected&&m.uuid===selected;});
 const picked=skins.find(m=>m.uuid===selected);
 $('skin-guard-info').textContent=picked
  ? `Автовеса изменят только «${picked.name||'меш без имени'}». Остальные ${skins.length-1} мешей защищены. Если одежда и тело — один меш, сначала раздели их в редакторе.`
  : 'Автовеса заблокированы: укажи только меш тела. Одежда, волосы и аксессуары не будут изменены.';
}

function selectedAccessory(){return state.accessories.find(a=>a.group===state.selected)||null;}
function refreshSelection(){const s=state.selected;const wrap=$('transform-controls');wrap.replaceChildren();
 if(!s){wrap.textContent='Сначала выбери кость или деталь';return;}
 const label=(name,property,axis,step)=>{const l=document.createElement('label');l.className='mini-field';const sp=document.createElement('span');sp.textContent=name;const inp=document.createElement('input');inp.type='number';inp.step=String(step);let value=s[property][axis];if(property==='rotation')value=THREE.MathUtils.radToDeg(value);inp.value=value.toFixed(3);
 inp.addEventListener('change',()=>{const v=Number(inp.value);if(!Number.isFinite(v))return;s[property][axis]=property==='rotation'?THREE.MathUtils.degToRad(v):v;state.root?.updateMatrixWorld(true);});l.append(sp,inp);return l;};
 const row=document.createElement('div');row.className='transform-grid';for(const p of [['position','Позиция',.01],['rotation','Угол °',1],['scale','Масштаб',.05]]){
 if(s.isBone&&p[0]==='scale')continue;for(const axis of ['x','y','z'])row.append(label(`${p[1]} ${axis.toUpperCase()}`,p[0],axis,p[2]));}wrap.append(row);
 const cfg=s.userData.pcs;
 $('motion-enabled').checked=!!cfg?.motion?.enabled;$('amplitude').value=String(cfg?.motion?.amplitude||5);$('frequency').value=String(cfg?.motion?.frequency||1.3);$('amplitude-out').textContent=$('amplitude').value+'°';$('frequency-out').textContent=$('frequency').value;
}
function updateTimeline(){const duration=currentDuration();$('time').max=String(duration);$('time').value=String(Math.min(state.time,duration));$('time-label').textContent=`${state.time.toFixed(2)} / ${duration.toFixed(2)} сек`;}
function pause(){state.playing=false;$('play').textContent='▶';}
function setTime(t){state.time=Math.max(0,Math.min(Number(t)||0,currentDuration()));if(state.mixer){state.mixer.stopAllAction();const clip=currentClip();if(clip){const action=state.mixer.clipAction(clip);action.play();state.mixer.setTime(state.time);}}applyExtraPose(state.extras,state.activeClip,state.time,state.animationData);updateTimeline();}
function startPlayback(){if(!state.root)return;state.playing=!state.playing;$('play').textContent=state.playing?'❚❚':'▶';state.clock.getDelta();}
function createChains({slot,side='',count=3,parentOverride=null}={}){if(!state.root)throw Error('Загрузи GLB со скелетом');pause();setTime(0);const parent=parentOverride||currentBones().find(b=>b.uuid===$('parent-bone').value)||getDefaultParent(state.root,slot);const arr=addBoneChain(state.root,parent,slot,count,side,figureScale());state.extras.push(...arr);for(const b of arr)b.userData.pcs.baseEuler=[0,0,0];state.selected=arr[0];refreshAll();return arr;}
function saveKeyframe(){const b=state.selected;if(!b?.isBone||!b.userData.pcs?.extra)throw Error('Выбери дополнительную кость');const name=state.activeClip;state.animationData[name]??={};state.animationData[name][b.name]??=[];const frames=state.animationData[name][b.name];const wave=secondaryAngles(state.time,b.userData.pcs.motion);const base=b.userData.pcs.baseEuler||[0,0,0];const pose=[b.rotation.x,b.rotation.y,b.rotation.z].map((v,i)=>THREE.MathUtils.radToDeg(v-wave[i])-base[i]);const entry={time:Math.round(state.time*1000)/1000,euler:pose};const old=frames.findIndex(f=>Math.abs(f.time-entry.time)<.005);if(old>=0)frames[old]=entry;else frames.push(entry);say(`Ключ ${b.name} записан: ${entry.time.toFixed(2)} сек`);}
function updateMotion(){const b=state.selected;if(!b?.userData.pcs?.extra){say('Сначала выбери дополнительную кость','error');return;}b.userData.pcs.motion={...b.userData.pcs.motion,enabled:$('motion-enabled').checked,amplitude:Number($('amplitude').value),frequency:Number($('frequency').value)};$('amplitude-out').textContent=$('amplitude').value+'°';$('frequency-out').textContent=$('frequency').value;setTime(state.time);}
function clipForExport(original){const tracks=[...original.tracks,...animationTracksForExtras(state.extras,original.name,original.duration,state.animationData)];return new THREE.AnimationClip(original.name,original.duration,tracks);}
function exportClips(){const all=state.baseAnimations.map(clipForExport);for(const [name,duration] of Object.entries(state.customClips)){if(state.baseAnimations.find(c=>c.name===name))continue;const tracks=animationTracksForExtras(state.extras,name,duration,state.animationData);if(tracks.length)all.push(new THREE.AnimationClip(name,duration,tracks));}return all;}
async function saveBytes(bytes,filename,mime){if(Capacitor.isNativePlatform()){
  try{
    let binary='';const chunk=32768;for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));
    const b64=btoa(binary);const res=await Filesystem.writeFile({path:filename,data:b64,directory:Directory.Cache});await Share.share({title:filename,url:res.uri,dialogTitle:'Сохранить '+filename});return;
  }catch(e){throw Error('Не удалось открыть диалог сохранения Android: '+e.message);}
 }
 const blob=new Blob([bytes],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function safeName(name){return (name||'Character').replace(/\.(glb|gltf)$/i,'').replace(/[^\w\u0400-\u04ff-]/g,'_').slice(0,45);}
async function exportGLB(){if(!state.root||state.demo)throw Error('Для экспорта нужен реальный GLB-персонаж');pause();setTime(0);refreshSkeletonHelper();
 // Export only character root; do not export grid/visual helpers.
 const clips=exportClips();
 const result=await new Promise((resolve,reject)=>exporter.parse(state.root,resolve,reject,{binary:true,trs:true,animations:clips,onlyVisible:false,maxTextureSize:2048}));
 if(!(result instanceof ArrayBuffer))throw Error('GLB экспорт не сформирован');await saveBytes(new Uint8Array(result),`${safeName(state.baseName)}_Phoenix.glb`,'model/gltf-binary');say(`Экспорт: ${(result.byteLength/1048576).toFixed(2)} МБ · ${clips.length} анимаций`);
}
function bytesToBase64(arr){let s='';for(let i=0;i<arr.length;i+=32768)s+=String.fromCharCode(...arr.subarray(i,i+32768));return btoa(s);}
function base64ToBytes(data){const str=atob(data);const a=new Uint8Array(str.length);for(let i=0;i<str.length;i++)a[i]=str.charCodeAt(i);return a;}
async function saveProject(){if(!state.baseBytes)throw Error('Сначала загрузи GLB-персонажа');const project={format:'PhoenixCharacterStudio',version:1,base:{name:state.baseName,data:bytesToBase64(state.baseBytes)},accessories:state.accessories.map(a=>({id:a.id,name:a.name,data:bytesToBase64(a.bytes),slot:a.slot,parent:a.parent,rigged:a.rigged,chain:a.chain||[],transform:{position:a.group.position.toArray(),quaternion:a.group.quaternion.toArray(),scale:a.group.scale.toArray()}})),bones:state.extras.map(b=>({name:b.name,parent:b.parent.name,position:b.position.toArray(),baseEuler:b.userData.pcs?.baseEuler||[0,0,0],pcs:b.userData.pcs})),weights:state.weightOperations||[],animationData:state.animationData,customClips:state.customClips};const encoded=new TextEncoder().encode(JSON.stringify(project));await saveBytes(encoded,`${safeName(state.baseName)}.pcs`,'application/json');say('Файл проекта .pcs сохранён');}
async function loadProject(obj){if(obj.format!=='PhoenixCharacterStudio'||obj.version!==1)throw Error('Неверный формат проекта');await loadBase(base64ToBytes(obj.base.data),obj.base.name);for(const item of obj.bones||[]){const parent=currentBones().find(b=>b.name===item.parent);if(!parent)continue;const b=new THREE.Bone();b.name=item.name;b.position.fromArray(item.position);b.userData.pcs=item.pcs;parent.add(b);state.extras.push(b);}state.root.updateMatrixWorld(true);
 for(const a of obj.accessories||[]){const acc=await loadAccessory(base64ToBytes(a.data),a.name,a);if(a.rigged){const chain=(a.chain||[]).map(n=>currentBones().find(b=>b.name===n)).filter(Boolean);if(chain.length)skinAccessoryToChain(state.root,acc.group,chain);acc.rigged=true;acc.chain=a.chain;}}
 state.weightOperations=[];for(const op of obj.weights||[]){const bone=currentBones().find(b=>b.name===op.bone);if(bone){weightExistingSkin(state.root,bone,op);state.weightOperations.push(op);}}
 state.customClips=obj.customClips||{PCS_Idle:3};state.animationData=obj.animationData||{};state.selected=state.extras[0]||getDefaultParent(state.root,'head');refreshAll();say('Проект восстановлен: кости, детали, веса и ключи');}

$('body-skin').addEventListener('change',applyBodySkinSelection);
$('base-file').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{await loadBase(new Uint8Array(await f.arrayBuffer()),f.name);}catch(e){err(e);}e.target.value='';});
$('animation-file').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{
 if(!state.root||state.demo)throw Error('Сначала загрузи GLB-персонажа со скелетом');
 const gltf=await parseGLB(new Uint8Array(await f.arrayBuffer()));
 if(!gltf.animations?.length)throw Error('В этом GLB нет анимационных клипов');
 const check=inspectSkeletonCompatibility(gltf.scene,state.root);
 if(!check.ok)throw Error('Перенос заблокирован: несовместимые скелеты. '+check.problems.slice(0,4).join('; ')+'. Нужен полноценный ретаргетинг с учётом исходной позы.');
 let imported=0;
 for(const clip of gltf.animations){
  const mapped=remapAnimationTracks(clip,gltf.scene,state.root);
  if(!mapped.tracks.length)continue;
  let name=clip.name||'Imported';
  if(state.baseAnimations.some(c=>c.name===name))name=name+'_Imported';
  while(state.baseAnimations.some(c=>c.name===name))name+='_2';
  const newClip=new THREE.AnimationClip(name,clip.duration,mapped.tracks);
  state.baseAnimations.push(newClip);
  imported++;
 }
 if(!imported)throw Error('Анимации не содержат дорожек костей целевого персонажа');
 state.activeClip=state.baseAnimations.at(-1).name;
 refreshAll();
 say(`Импортировано ${imported} клипов; имена, иерархия и исходные повороты костей проверены.`);
 }catch(e){err(e)}e.target.value='';});
$('detail-file').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{await loadAccessory(new Uint8Array(await f.arrayBuffer()),f.name,{slot:$('slot').value,parent:currentBones().find(b=>b.uuid===$('parent-bone').value)?.name});}catch(e){err(e);}e.target.value='';});
$('project-file').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{await loadProject(JSON.parse(await f.text()));}catch(e){err(e);}e.target.value='';});
$('save-project').onclick=()=>saveProject().catch(err);$('export').onclick=()=>exportGLB().catch(err);
$('selection').onchange=()=>{const v=$('selection').value;state.selected=v.startsWith('bone:')?currentBones().find(b=>b.uuid===v.slice(5)):state.accessories.find(a=>a.id===v.slice(7))?.group;refreshSelection();};
$('slot').onchange=()=>{const b=getDefaultParent(state.root,$('slot').value);if(b)$('parent-bone').value=b.uuid;};
$('add-chain').onclick=()=>{try{const a=createChains({slot:$('slot').value,side:$('side').value,count:Number($('count').value)});say(`${a.length} костей добавлено. Выбери и настрой положение.`);}catch(e){err(e);}};
$('breasts').onclick=()=>{try{pause();setTime(0);$('slot').value='breast';const chest=getDefaultParent(state.root,'breast');if(!chest)throw Error('Кость груди не найдена');const a=createChains({slot:'breast',side:'L',count:1,parentOverride:chest});const b=createChains({slot:'breast',side:'R',count:1,parentOverride:chest});state.selected=a[0];refreshAll();say(`Добавлены ${a[0].name} и ${b[0].name}. Настрой положение и назначь веса по очереди.`);}catch(e){err(e);}};
$('attach').onclick=()=>{try{const item=selectedAccessory();if(!item)throw Error('Выбери импортированную деталь');const bone=currentBones().find(b=>b.uuid===$('parent-bone').value);if(!bone)throw Error('Выбери кость');if(item.rigged)throw Error('Деталь уже имеет скин. Повторное жёсткое крепление не поддерживается.');bone.attach(item.group);item.parent=bone.name;refreshSelection();say(`Деталь ${item.id} прикреплена к ${bone.name}`);}catch(e){err(e);}};
$('rig-detail').onclick=()=>{try{const item=selectedAccessory();if(!item)throw Error('Выбери импортированную деталь');if(item.rigged)throw Error('Эта деталь уже имеет скин');const first=currentBones().find(b=>b.name===$('rig-chain').value);if(!first?.userData.pcs?.extra)throw Error('Выбери первую дополнительную кость цепочки');const chain=[];let b=first;while(b&&b.userData.pcs?.extra){chain.push(b);b=b.children.find(c=>c.isBone)||null;}pause();setTime(0);const n=skinAccessoryToChain(state.root,item.group,chain);item.rigged=true;item.chain=chain.map(b=>b.name);say(`Привязано ${n} вершин к ${chain.length} костям. Положение теперь изменяется костями.`);}catch(e){err(e);}};
$('auto-weights').onclick=()=>{try{const b=state.selected;if(!b?.userData.pcs?.extra)throw Error('Выбери дополнительную кость');pause();setTime(0);for(const mesh of getSkins(state.root))if(mesh.userData.pcsMainSkin)mesh.skeleton.pose();state.root.updateMatrixWorld(true);if(!getSkins(state.root).some(m=>m.userData.pcsMainSkin))throw Error('Не выбран меш тела. Укажи его в разделе 03.');const op={bone:b.name,radius:Number($('radius').value),strength:Number($('strength').value)};if(state.weightOperations?.some(o=>o.bone===b.name))throw Error('Этой кости веса уже назначены. Чтобы пересчитать, открой исходный проект и назначь заново.');const out=weightExistingSkin(state.root,b,op);state.weightOperations??=[];state.weightOperations.push(op);say(`Веса назначены: ${out.vertices} вершин на ${out.meshes} мешах. Проверь деформацию.`);}catch(e){err(e);}};
for(const id of ['motion-enabled','amplitude','frequency'])$(id).addEventListener('input',updateMotion);
$('clip-select').onchange=()=>{state.activeClip=$('clip-select').value;pause();setTime(0);};
$('new-clip').onclick=()=>{const name=prompt('Имя новой анимации, например Tail_Idle:','New_Animation');if(!name)return;const clean=name.replace(/[^\w-]/g,'_');if(!clean)return;if(getClipNames().includes(clean)){say('Такая анимация уже есть','error');return;}const duration=Number(prompt('Длительность в секундах:','3'));state.customClips[clean]=Number.isFinite(duration)?Math.max(.2,Math.min(duration,120)):3;state.activeClip=clean;refreshAll();say(`Создан клип ${clean}`);};
$('play').onclick=startPlayback;$('time').addEventListener('input',e=>{pause();setTime(Number(e.target.value));});$('keyframe').onclick=()=>{try{saveKeyframe();}catch(e){err(e);}};
$('clear-keys').onclick=()=>{if(!state.selected?.isBone)return;const keys=state.animationData[state.activeClip];if(keys){delete keys[state.selected.name];say('Ключи этой кости очищены');}};
$('focus').onclick=focus;$('skeleton-toggle').onclick=()=>{state.skeletonVisible=!state.skeletonVisible;$('skeleton-toggle').textContent=`Кости: ${state.skeletonVisible?'вкл':'выкл'}`;refreshSkeletonHelper();};
$('rest').onclick=()=>{pause();setTime(0);state.mixer?.stopAllAction();for(const skin of getSkins(state.root))if(skin.userData.pcsMainSkin)skin.skeleton.pose();state.extras.forEach(b=>b.rotation.set(0,0,0));refreshSelection();say('Восстановлена поза связки (bind)');};
function animate(){requestAnimationFrame(animate);const dt=Math.min(state.clock.getDelta(),.05);if(state.playing){state.time=(state.time+dt)%currentDuration();if(state.mixer){const clip=currentClip();if(clip){const act=state.mixer.clipAction(clip);act.play();state.mixer.setTime(state.time);}}applyExtraPose(state.extras,state.activeClip,state.time,state.animationData);updateTimeline();}controls.update();renderer.render(scene,camera);}makeDemo();resize();animate();
