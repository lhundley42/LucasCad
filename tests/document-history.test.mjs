import assert from 'node:assert/strict';
import test from 'node:test';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {SnapshotHistory,undoRedoShortcut} from '../app/components/snapshotHistory.ts';
import {readFileSync} from 'node:fs';
const dom=new JSDOM('<!doctype html><body></body>',{url:'http://localhost:4310'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,React,IS_REACT_ACT_ENVIRONMENT:true});
const {createRoot}=await import('react-dom/client');
const {DocumentHistory,resetDocumentHistory}=await import('../app/components/DocumentHistory.tsx');
const empty=()=>({sketches:[],features:[],referenceGeometry:[]});
async function mount(t,initial=empty()) {
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);let model=initial;let pending=false;let cancels=0;let restores=0;
  const draw=()=>root.render(React.createElement(DocumentHistory,{document:model,onRestore:value=>{model=value;restores++;draw();},cancelPending:()=>{if(pending){pending=false;cancels++;return true;}return false;}},React.createElement('div',null,React.createElement('svg',{className:'sketch-canvas'}),React.createElement('input'),React.createElement('textarea'),React.createElement('div',{contentEditable:true}))));
  await act(async()=>draw());t.after(async()=>{await act(async()=>root.unmount());host.remove();});
  const commit=async value=>{model=structuredClone(value);await act(async()=>draw());};
  const key=async (key='z',options={},target=window)=>{const event=new window.KeyboardEvent('keydown',{key,ctrlKey:true,bubbles:true,cancelable:true,...options});await act(async()=>target.dispatchEvent(event));return event;};
  const pointer=async type=>{const event=new window.Event(type,{bubbles:true});Object.assign(event,{button:0,pointerId:1});await act(async()=>{host.querySelector('svg').dispatchEvent(event);if(type==='pointerup')await new Promise(r=>setTimeout(r,5));});};
  return {commit,key,pointer,host,model:()=>model,setPending:()=>pending=true,cancels:()=>cancels,restores:()=>restores,reset:async value=>{await act(async()=>{resetDocumentHistory(value);model=value;draw();});}};
}

for(const type of ['extrude','revolve','loft','sweep','fillet','chamfer','draft','shell','union']) {
  test(`Ctrl+Z / redo restores ${type} creation, all edited parameters and dependency deletion`,async t=>{
    const baseline={...empty(),sketches:[{id:'sketch',name:'Section',plane:'XY',entities:[{id:'circle',type:'circle',c:{x:0,y:0},r:10}]}],features:[{id:'base',type:'extrude',sketchId:'sketch',bodyId:'body',distance:20}]};
    const ui=await mount(t,baseline);
    const created={...baseline,features:[...baseline.features,{id:'feature',type,bodyId:'result',targetBodyId:'body',sketchId:'sketch',sketchIds:['sketch'],bodyIds:['body','second'],orientation:'follow',transition:'round',distance:15,angle:10,radius:2,thickness:1,faceIndices:[1,3],edgeIndices:[1,2,3,4]}]};
    await ui.commit(created);await ui.key();assert.deepEqual(ui.model(),baseline);await ui.key('y');assert.deepEqual(ui.model(),created);
    const edited=structuredClone(created);Object.assign(edited.features[1],{orientation:'fixed',transition:'right',sketchIds:['profile-2','path-2'],distance:32,angle:25,radius:4,thickness:3,faceIndices:[2,4],edgeIndices:[5,6]});
    await ui.commit(edited);await ui.key();assert.deepEqual(ui.model(),created);await ui.key('z',{shiftKey:true});assert.deepEqual(ui.model(),edited);
    await ui.commit(empty());await ui.key();assert.deepEqual(ui.model(),edited);await ui.key('y');assert.deepEqual(ui.model(),empty());
  });
}

test('planes, axes, points, names and visibility participate in the same history',async t=>{
  const ui=await mount(t);const versions=[empty()];
  for(const type of ['plane','axis','point']) {const next=structuredClone(versions.at(-1));next.referenceGeometry.push({id:type,type,name:type,visible:true,origin:[1,2,3],normal:[0,0,1],direction:[1,0,0],position:[1,2,3]});versions.push(next);await ui.commit(next);}
  const renamed=structuredClone(versions.at(-1));renamed.referenceGeometry[0].name='Deck';renamed.referenceGeometry[1].visible=false;versions.push(renamed);await ui.commit(renamed);
  for(let i=versions.length-2;i>=0;i--){await ui.key();assert.deepEqual(ui.model(),versions[i]);}
  for(let i=1;i<versions.length;i++){await ui.key('y');assert.deepEqual(ui.model(),versions[i]);}
});

test('100 drag frames collapse into one undo and redo restores the final value',async t=>{
  const ui=await mount(t);await ui.pointer('pointerdown');for(let i=1;i<=100;i++)await ui.commit({ ...empty(),sketches:[{id:'s',plane:'XY',entities:[{id:'line',type:'line',a:{x:0,y:0},b:{x:i,y:1}}]}]});await ui.pointer('pointerup');
  const final=structuredClone(ui.model());await ui.key();assert.deepEqual(ui.model(),empty());const restored=ui.restores();await ui.key();assert.equal(ui.restores(),restored);await ui.key('y');assert.deepEqual(ui.model(),final);
});

test('new edit clears redo; no-op selection renders preserve it; file opening resets history even for the same filename',async t=>{
  const ui=await mount(t);const changed={...empty(),features:[{id:'one',type:'extrude'}]};await ui.commit(changed);await ui.key();await ui.commit(empty());await ui.key('y');assert.deepEqual(ui.model(),changed);
  await ui.key();const branch={...empty(),features:[{id:'two',type:'revolve'}]};await ui.commit(branch);await ui.key('y');assert.deepEqual(ui.model(),branch);
  await ui.reset(changed);await ui.key();assert.deepEqual(ui.model(),changed);await ui.key('y');assert.deepEqual(ui.model(),changed);
});

test('input controls keep native undo and pending previews cancel without deleting the built model',async t=>{
  const ui=await mount(t);const changed={...empty(),features:[{id:'one',type:'extrude'}]};await ui.commit(changed);
  for(const input of ui.host.querySelectorAll('input,textarea,[contenteditable]')){const event=await ui.key('z',{},input);assert.equal(event.defaultPrevented,false);assert.deepEqual(ui.model(),changed);}
  ui.setPending();await ui.key();assert.equal(ui.cancels(),1);assert.deepEqual(ui.model(),changed);await ui.key();assert.deepEqual(ui.model(),empty());
});

test('history snapshots are isolated, bounded, and support Windows/Mac redo combinations',()=>{
  const history=new SnapshotHistory({value:0},2);for(let i=1;i<=3;i++)history.record({value:i});const result=history.step('undo');result.value=99;assert.deepEqual(history.step('undo'),{value:1});assert.equal(history.step('undo'),null);assert.deepEqual(history.step('redo'),{value:2});
  const event={key:'z',ctrlKey:false,metaKey:true,shiftKey:false,altKey:false};assert.equal(undoRedoShortcut(event),'undo');assert.equal(undoRedoShortcut({...event,shiftKey:true}),'redo');assert.equal(undoRedoShortcut({...event,key:'y'}),'redo');assert.equal(undoRedoShortcut({...event,altKey:true}),null);
});

test('the real application wraps every document writer in history, preserves active sketch editing, and resets on Open',()=>{
  const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
  assert.match(page,/<DocumentHistory document=\{cadDocument\} onRestore=\{restoreHistoryDocument\} cancelPending=\{cancelPendingHistoryEdit\}>/);
  assert.match(page,/resetDocumentHistory\(\{ sketches: project.sketches/);
  assert.match(page,/const staysInSketch = editingSketchId && document.sketches.some/);
  assert.match(page,/setSketches\(document.sketches as LocalSketch\[\]\); setFeatures\(document.features\); setReferenceGeometry\(document.referenceGeometry/);
  assert.match(page,/hiddenDimensionKeys=\{editingSketch.hiddenDimensionKeys\} onHiddenDimensionKeysChange=\{updateHiddenDimensions\}/);
  const viewport=readFileSync(new URL('../app/components/CadViewport.tsx',import.meta.url),'utf8');
  const featureTypes=viewport.match(/export type FeatureType = (.*);/)[1].match(/"[a-z]+"/g).map(x=>x.slice(1,-1)).sort();
  assert.deepEqual(featureTypes,['chamfer','draft','extrude','fillet','loft','revolve','shell','sweep','union']);
});

test('undo/redo preserves full sketch constraint/pattern/spline metadata and support changes, plus body naming/visibility',async t=>{
  const ui=await mount(t);const versions=[empty()];
  const complete={sketches:[{id:'s',name:'Profile',plane:{kind:'reference-plane',referenceId:'deck'},flipped:false,entities:[{id:'curve',type:'spline',points:[{x:0,y:0},{x:10,y:20},{x:30,y:5}],handles:[{in:{x:0,y:0},out:{x:4,y:9}}]}],constraints:[],dimensionOffsets:{'curve:length':{x:15,y:20}},hiddenDimensionKeys:['curve:length']}],features:[],referenceGeometry:[{id:'deck',type:'plane',origin:[0,0,40],normal:[0,0,1]}]};
  versions.push(complete);await ui.commit(complete);
  for(const type of ['linear','angular','diameter','radial','mirror','linear-pattern','rectangular-pattern','circular-pattern']) {
    const next=structuredClone(versions.at(-1));next.sketches[0].constraints.push({id:type,type,entityId:'curve',value:17,position:{x:20,y:30},pairs:[{sourceId:'curve',mirroredId:'copy',instances:[{entityId:'copy',column:1,row:0}]}]});versions.push(next);await ui.commit(next);
  }
  const changed=structuredClone(versions.at(-1));changed.sketches[0].plane='XZ';changed.sketches[0].flipped=true;changed.features.push({id:'e',type:'extrude',sketchId:'s',bodyId:'b',bodyName:'Renamed hull',bodyVisible:false});versions.push(changed);await ui.commit(changed);
  for(let i=versions.length-2;i>=0;i--){await ui.key();assert.deepEqual(ui.model(),versions[i]);}
  for(let i=1;i<versions.length;i++){await ui.key('y');assert.deepEqual(ui.model(),versions[i]);}
});
