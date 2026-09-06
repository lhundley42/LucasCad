import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';

const dom = new JSDOM('<!doctype html><body></body>', {url:'http://localhost:4310'});
Object.assign(globalThis, {window:dom.window, document:dom.window.document, devicePixelRatio:1, IS_REACT_ACT_ENVIRONMENT:true, React});
globalThis.ResizeObserver = class { constructor(cb) { this.cb=cb; } observe() { this.cb(); } disconnect() {} };
const frames = new Map(); let frameId=0;
globalThis.requestAnimationFrame = cb => { frames.set(++frameId, cb); return frameId; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
const frame = () => { const callbacks=[...frames.values()]; frames.clear(); callbacks.forEach(cb=>cb()); };
window.HTMLElement.prototype.getBoundingClientRect = () => ({left:0, top:0, right:800, bottom:600, width:800, height:600});
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => {};
const renderers=[];
class Renderer {
  constructor() { this.domElement=document.createElement('canvas'); renderers.push(this); }
  setPixelRatio() {} setSize() {} dispose() { this.disposed=true; }
  render(scene,camera) { this.scene=scene; this.camera=camera; scene.updateMatrixWorld(true); camera.updateMatrixWorld(true); }
}
mock.module('three', {namedExports:{...THREE, WebGLRenderer:Renderer}});
const { CadViewport } = await import('../app/components/CadViewport.tsx');
const { FilletSession } = await import('../app/components/FilletSession.tsx');
const { projectSketchPoint } = await import('../app/components/sketchProjection.ts');

test('sketch orbit continuously publishes the editable plane projection; Normal uses the nearest side without a rebuild',async t=>{
  const views=[],rotations=[];
  const sketch={id:'sketch',name:'Offset sketch',visible:true,frame:{origin:[10,20,30],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]},paths:[]};
  const record={id:'sketch',name:'Offset sketch',plane:'XY',entities:[]};
  const ui=await mount(t,{...payload,sketches:[sketch]},{document:{features:[],sketches:[record]},editingSketchId:'sketch',editingSketch:record,onSketchViewChange:v=>views.push(v),onSketchRotatedChange:v=>rotations.push(v)});
  const camera=ui.renderer.camera;assert.ok(camera instanceof THREE.OrthographicCamera);assert.ok(views.at(-1).projection);
  const dispatch=async(type,x,y,button=1,buttons=4,shiftKey=false)=>{
    const event=new window.Event(type,{bubbles:true});Object.assign(event,{clientX:x,clientY:y,button,buttons,pointerId:1,shiftKey});await act(async()=>ui.canvas.dispatchEvent(event));frame();
  };
  await dispatch('pointerdown',400,300);await dispatch('pointermove',480,350);
  assert.equal(rotations.at(-1),true);assert.ok(views.length>=2);
  const verify=()=>{
    const view=views.at(-1),point={x:33,y:-24};const actual=new THREE.Vector3(43,-4,30).project(camera);
    const projected=projectSketchPoint(point,view.projection);
    assert.ok(Math.abs(projected.x-(view.center.x+actual.x*(camera.right-camera.left)/camera.zoom/2))<1e-6);
    assert.ok(Math.abs(projected.y-(view.center.y-actual.y*(camera.top-camera.bottom)/camera.zoom/2))<1e-6);
  };
  verify();await dispatch('pointermove',480,600);await dispatch('pointerup',480,600,1,0);verify();
  const before=camera.getWorldDirection(new THREE.Vector3()),zoom=camera.zoom;const side=Math.sign(before.z);
  await ui.render({snapNormalRequest:1});
  assert.equal(rotations.at(-1),false);assert.ok(camera.getWorldDirection(new THREE.Vector3()).z*side>0.9999);assert.equal(camera.zoom,zoom);
  assert.equal(ui.calls.length,1);assert.equal(ui.host.querySelector('canvas'),ui.canvas);verify();
});
const face = {id:'body:face-1',bodyId:'body',faceIndex:1,vertices:[[-20,-20,0],[20,-20,0],[20,20,0],[-20,20,0]],triangles:[[0,1,2],[0,2,3]],normal:[0,0,1],center:[0,0,0],planar:true};
const edge = {id:'body:edge-1',bodyId:'body',edgeIndex:1,points:[[-20,-20,0],[20,-20,0]],linear:true};
const payload = {faces:[face],edges:[edge],sketches:[],properties:{valid:true,solidCount:1,bodyCount:1,faceCount:1,edgeCount:1,volume:1,bounds:{x:40,y:40,z:1}}};
async function mount(t, testPayload = payload, initialProps = {}) {
  const calls=[],statuses=[],faces=[],edges=[];
  globalThis.fetch = (url,options) => new Promise(resolve=>calls.push({url,body:JSON.parse(options.body),resolve}));
  const host=document.createElement('div'); document.body.append(host); const root=createRoot(host);
  let props={document:{features:[],sketches:[]},onStatus:(...args)=>statuses.push(args),onSelectFace:(...args)=>faces.push(args),onSelectEdge:(...args)=>edges.push(args)};
  const render=async patch=>{ props={...props,...patch}; const {fillet,...viewportProps}=props; const viewport=React.createElement(CadViewport,viewportProps); await act(async()=>root.render(fillet === undefined ? viewport : React.createElement(FilletSession,fillet,viewport))); frame(); };
  await render(initialProps); const renderer=renderers.at(-1),canvas=renderer.domElement;
  const reply=async (index,ok=true,result=testPayload)=>{ await act(async()=>calls[index].resolve({ok,json:async()=>ok?result:{detail:'invalid radius'}})); frame(); };
  await reply(0);
  t.after(async()=>{await act(async()=>root.unmount());host.remove();});
  const click=async (point,shiftKey=false)=>{
    frame(); const projected=new THREE.Vector3(...point).project(renderer.camera);
    for(const type of ['pointermove','pointerdown','pointerup']) {
      const event=new window.Event(type,{bubbles:true}); Object.assign(event,{button:0,buttons:type==='pointerdown'?1:0,pointerId:1,clientX:(projected.x+1)*400,clientY:(1-projected.y)*300,shiftKey});
      await act(async()=>canvas.dispatchEvent(event));
    }
  };
  return {host,canvas,renderer,calls,statuses,faces,edges,render,reply,click};
}
test('interactive fillet keeps previews through radius changes and commit mesh handoff without rebuilding for selection', async t=>{
  const base={features:[],sketches:[]};
  const draft={type:'fillet',targetBodyId:'body',edgeIndices:[1],radius:1};
  const fillet={draft:null,baseDocument:base,candidate:base,api:'http://localhost:4311',onRadiusChange:()=>{},onCommit:()=>{},onClose:()=>{}};
  const ui=await mount(t,payload,{document:base,fillet});
  await ui.render({fillet:{...fillet,draft}});
  await act(async()=>new Promise(r=>setTimeout(r,110)));frame();
  assert.equal(ui.calls.length,2);assert.match(ui.calls[1].url,/api\/fillet$/);
  const result={available:true,maxRadius:4,minimumRadius:.001,radius:1,limitResolved:true,targetBodyId:'body',anchor:[0,-20,0],direction:[0,-1,1],previewFaces:[face],message:''};
  await ui.reply(1,true,result);
  const previewCount=()=>ui.renderer.scene.children.flatMap(g=>g.children).filter(o=>o instanceof THREE.Mesh && o.renderOrder===5).length;
  assert.equal(previewCount(),1);
  await ui.render({fillet:{...fillet,draft:{...draft,radius:2}},selectedEdgeIds:[edge.id]});
  assert.equal(previewCount(),1);
  await act(async()=>new Promise(r=>setTimeout(r,110)));frame();
  assert.equal(ui.calls.length,3);assert.match(ui.calls[2].url,/api\/fillet$/);
  await ui.reply(2,true,{...result,radius:2});
  const committed={...base,features:[{...draft,id:'fillet',radius:2}]};
  await ui.render({document:committed,fillet:{...fillet,baseDocument:committed}});
  assert.equal(ui.calls.length,4);assert.match(ui.calls[3].url,/api\/document$/);
  assert.equal(previewCount(),1,'accepted preview stays until the committed mesh arrives');
  await ui.reply(3);
  assert.equal(previewCount(),0,'committed model replaces the phantom');
  assert.equal(ui.host.querySelector('canvas'),ui.canvas);
  // Cancel differs from commit: restore the base body immediately.
  await ui.render({fillet:{...fillet,baseDocument:committed,draft}});
  await act(async()=>new Promise(r=>setTimeout(r,110)));frame();
  await ui.reply(4,true,result);assert.equal(previewCount(),1);
  await ui.render({fillet:{...fillet,baseDocument:committed}});
  assert.equal(previewCount(),0);
  assert.equal(ui.calls.filter(c=>c.url.endsWith('/api/document')).length,2);
});

test('face and edge pointer picking uses current callbacks without fetching or replacing canvas', async t=>{
  const ui=await mount(t); const originalMesh=ui.renderer.scene.children.flatMap(g=>g.children).find(o=>o.userData.faceId===face.id && o instanceof THREE.Mesh);
  await ui.click([0,0,0]); assert.equal(ui.faces.at(-1)[0].id,face.id);
  await ui.render({selectedFaceIds:[face.id]});
  assert.equal(originalMesh.material.color.getHex(),0xf6b94d);
  const newEdges=[]; await ui.render({onSelectEdge:(...args)=>newEdges.push(args)});
  await ui.click([0,-20,0],true); assert.equal(newEdges.at(-1)[0].id,edge.id); assert.equal(newEdges.at(-1)[1],true);
  await ui.render({selectedEdgeIds:[edge.id]});
  assert.equal(ui.host.querySelector('canvas'),ui.canvas); assert.equal(ui.renderer.disposed,undefined); assert.equal(ui.calls.length,1);
  assert.ok(ui.renderer.scene.children.some(g=>g.children.includes(originalMesh)));
});
test('picking remains live during pending and failed previews; rapid changes coalesce',async t=>{
  const ui=await mount(t);
  const preview=radius=>({type:'fillet',targetBodyId:'body',edgeIndices:[1],radius});
  await ui.render({featurePreview:preview(1)}); assert.equal(ui.calls.length,2);
  await ui.click([0,-20,0]); assert.equal(ui.edges.at(-1)[0].id,edge.id);
  await ui.render({featurePreview:preview(2)}); await ui.render({featurePreview:preview(3)});
  assert.equal(ui.calls.length,2); await ui.reply(1,false);
  assert.equal(ui.calls.length,3); assert.equal(ui.calls[2].body.previewFeature.radius,3);
  assert.notEqual(ui.statuses.at(-1)[0],'error');
  await ui.reply(2,false); assert.equal(ui.statuses.at(-1)[0],'error');
  await ui.click([0,0,0],true); assert.equal(ui.faces.at(-1)[0].id,face.id); assert.equal(ui.faces.at(-1)[1],true);
  assert.equal(ui.host.querySelector('canvas'),ui.canvas);
  await ui.render({featurePreview:null}); assert.equal(ui.calls.length,3); assert.equal(ui.statuses.at(-1)[0],'ready');
});
test('fit, grid, names and visibility do not submit geometry requests',async t=>{
  const ui=await mount(t);
  await ui.render({fitViewRequest:1,showModelGrid:false});
  await ui.render({document:{features:[],sketches:[],name:'Renamed'}});
  await ui.render({solidSelectionMode:'edges'});
  assert.equal(ui.calls.length,1); assert.equal(ui.host.querySelector('canvas'),ui.canvas);
});

test('four closely spaced tire rings are individually picked with Shift, not toggled as two nearer rings', async t=>{
  const rings = [10,11,12,13].map((radius,i)=>({id:`tire:edge-${i+1}`,bodyId:'tire',edgeIndex:i+1,points:Array.from({length:129},(_,j)=>[radius*Math.cos(j*Math.PI/64),radius*Math.sin(j*Math.PI/64),0])}));
  const ui=await mount(t,{...payload,faces:[],edges:rings});
  const picked=[];
  await ui.render({onSelectEdge:(edge,shift)=>{ if (!shift) picked.length=0; const index=picked.findIndex(e=>e.id===edge.id); if(index>=0) picked.splice(index,1); else picked.push(edge); }});
  for(let i=0;i<rings.length;i++) {
    await ui.click([0,-(10+i),0],i>0);
    assert.equal(picked.at(-1)?.id,rings[i].id);
    await ui.render({selectedEdgeIds:picked.map(e=>e.id)});
    assert.equal(picked.length,i+1);
  }
  await ui.render({solidSelectionMode:'edges',featurePreview:{type:'fillet',targetBodyId:'tire',edgeIndices:picked.map(e=>e.edgeIndex),radius:0.25}});
  assert.deepEqual(ui.calls[1].body.previewFeature.edgeIndices,[1,2,3,4]);
});

test('Shift picking accumulates 32 distinct nearby edges without a selection cap', async t=>{
  const rings = Array.from({length:32},(_,i)=>({id:`tire:edge-${i+1}`,bodyId:'tire',edgeIndex:i+1,points:Array.from({length:129},(_,j)=>[(10+i*.5)*Math.cos(j*Math.PI/64),(10+i*.5)*Math.sin(j*Math.PI/64),0])}));
  const ui=await mount(t,{...payload,faces:[],edges:rings});
  const ids=[];
  await ui.render({onSelectEdge:(edge,shift)=>{assert.equal(shift,ids.length>0);ids.push(edge.id);}});
  for(let i=0;i<rings.length;i++) { await ui.click([0,-(10+i*.5),0],i>0); await ui.render({selectedEdgeIds:[...ids]}); }
  assert.deepEqual(ids,rings.map(e=>e.id));
  assert.equal(ui.calls.length,1);
  const highlighted=ui.renderer.scene.children.flatMap(g=>g.children).filter(o=>o.userData.edgeId && o.userData.selected);
  assert.equal(highlighted.length,32);
});

test('committing a fillet keeps its visible preview until the finished solid replaces it without a visibility toggle', async t=>{
  const ui=await mount(t);
  const rounded={...face,id:'body:face-2',faceIndex:2,vertices:face.vertices.map(([x,y,z])=>[x,y,z+3])};
  const preview={type:'fillet',targetBodyId:'body',edgeIndices:[1],radius:1};
  await ui.render({featurePreview:preview,solidSelectionMode:'edges'});
  await ui.reply(1,true,{...payload,previewTargetBodyId:'body',previewFaces:[{...rounded,id:'preview:face-1',bodyId:'preview'}]});
  const allMeshes=()=>ui.renderer.scene.children.flatMap(g=>g.children).filter(o=>o instanceof THREE.Mesh);
  const raisedVisible=()=>allMeshes().filter(m=>m.material.opacity>0.2 && m.geometry.getAttribute('position')?.getZ(0)===3);
  assert.equal(raisedVisible().length,1);
  await ui.render({document:{sketches:[],features:[{...preview,id:'fillet-1',name:'Fillet 1'}]},featurePreview:null,solidSelectionMode:null,highlightedFeatureId:'fillet-1'});
  assert.equal(raisedVisible().length,1,'do not revert to the unfilleted body while committing');
  await ui.reply(2,true,{...payload,faces:[rounded],previewFaces:[],previewTargetBodyId:null});
  assert.equal(ui.statuses.at(-1)[0],'ready');
  const finished=raisedVisible(); assert.equal(finished.length,1);
  assert.equal(finished[0].userData.faceId,rounded.id);
  assert.equal(finished[0].material.opacity,1);
  assert.equal(finished[0].material.transparent,false);
  assert.equal(ui.host.querySelector('canvas'),ui.canvas);
});
test('union body picking bypasses edge selection and highlights multiple bodies without rebuild', async t=>{
  const other={...face,id:'other:face-1',bodyId:'other',vertices:face.vertices.map(([x,y,z])=>[x+60,y,z]),center:[60,0,0]};
  const ui=await mount(t,{...payload,faces:[face,other]});
  await ui.render({solidSelectionMode:'bodies',selectedBodyIds:['body','other']});
  await ui.click([0,-20,0]); assert.equal(ui.faces.at(-1)[0].bodyId,'body'); assert.equal(ui.edges.length,0);
  await ui.click([60,0,0]); assert.equal(ui.faces.at(-1)[0].bodyId,'other');
  await ui.click([200,200,0]); // Move off both bodies; hover amber returns to selected cyan.
  const meshes=ui.renderer.scene.children.flatMap(g=>g.children).filter(o=>o instanceof THREE.Mesh && o.userData.faceId);
  assert.equal(meshes.length,2); assert.ok(meshes.every(m=>m.material.color.getHex()===0x4fb9df));
  assert.equal(ui.calls.length,1);
});

test('union preview replaces all selected sources and commit restores opaque result immediately',async t=>{
  const other={...face,id:'other:face-1',bodyId:'other',vertices:face.vertices.map(([x,y,z])=>[x+60,y,z]),center:[60,0,0]};
  const base={...payload,faces:[face,other]}; const ui=await mount(t,base);
  const preview={type:'union',bodyIds:['body','other'],targetBodyId:'body'};
  await ui.render({solidSelectionMode:'bodies',featurePreview:preview});
  await ui.reply(1,true,{...base,previewTargetBodyId:'body',previewTargetBodyIds:['body','other'],previewFaces:[{...face,id:'preview:face-1',bodyId:'preview'}]});
  const sources=ui.renderer.scene.children.flatMap(g=>g.children).filter(o=>o instanceof THREE.Mesh && o.userData.faceId);
  assert.ok(sources.every(m=>m.material.opacity<0.1));
  await ui.click([60,0,0]); assert.equal(ui.faces.at(-1)[0].bodyId,'other');
  await ui.render({featurePreview:null,solidSelectionMode:null,document:{sketches:[],features:[{...preview,id:'union',name:'Union'}]}});
  await ui.reply(2,true,payload);
  const result=ui.renderer.scene.children.flatMap(g=>g.children).find(o=>o instanceof THREE.Mesh && o.userData.faceId===face.id);
  assert.ok(result.material.opacity>0.9);
});
test('CAD surface normals and real boundaries replace triangulation-based shading and false crease outlines', async t=>{
  const smoothFace={...face,normals:face.vertices.map(()=>[0,0.6,0.8]),boundaries:[[face.vertices[0],face.vertices[1],face.vertices[2],face.vertices[3],face.vertices[0]]]};
  const ui=await mount(t,{...payload,faces:[smoothFace]});
  const objects=ui.renderer.scene.children.flatMap(g=>g.children);
  const surface=objects.find(o=>o instanceof THREE.Mesh && o.userData.faceId===face.id);
  assert.ok(Math.abs(surface.geometry.getAttribute('normal').getY(0)-0.6)<1e-6);
  const outline=objects.find(o=>o instanceof THREE.LineSegments && o.userData.faceId===face.id);
  assert.equal(outline.geometry.getAttribute('position').count,8);
  await ui.render({document:{features:[],sketches:[],meshQuality:100}});
  assert.equal(ui.calls[1].body.meshQuality,100);
  await ui.reply(1,true,{...payload,faces:[smoothFace]});
  assert.equal(ui.host.querySelector('canvas'),ui.canvas);
});
test('selected edges use opaque orange screen-space highlights; width updates in place without CAD requests',async t=>{
  const ui=await mount(t); await ui.render({selectedEdgeIds:[edge.id]});
  const find=()=>ui.renderer.scene.children.flatMap(g=>g.children).filter(o=>o.userData.highlightEdgeId);
  const highlight=find()[0]; assert.ok(highlight.isLine2);
  assert.equal(highlight.material.linewidth,4); assert.equal(highlight.material.color.getHex(),0xff9700);
  assert.equal(highlight.material.opacity,1); assert.equal(highlight.material.worldUnits,false);
  assert.equal(highlight.material.depthTest,false); assert.equal(highlight.material.toneMapped,false);
  await ui.render({selectedEdgeWidthPx:8.5}); assert.equal(find()[0],highlight);
  assert.equal(highlight.material.linewidth,8.5); assert.equal(ui.calls.length,1);
  await ui.click([0,-20,0],true); assert.equal(ui.edges.at(-1)[0].id,edge.id);
  let disposed=false;highlight.geometry.addEventListener('dispose',()=>{disposed=true;});
  await ui.render({selectedEdgeIds:[]});assert.equal(find().length,0);assert.equal(disposed,true);
  assert.equal(ui.host.querySelector('canvas'),ui.canvas);
});

test('all selected rings receive the configured width and remain selected across preview rebuilds',async t=>{
  const rings=[10,11,12,13].map((r,i)=>({id:`tire:edge-${i+1}`,bodyId:'tire',edgeIndex:i+1,points:Array.from({length:129},(_,j)=>[r*Math.cos(j*Math.PI/64),r*Math.sin(j*Math.PI/64),0])}));
  const data={...payload,faces:[],edges:rings};const ui=await mount(t,data);
  await ui.render({selectedEdgeIds:rings.map(e=>e.id),selectedEdgeWidthPx:6});
  const highlights=()=>ui.renderer.scene.children.flatMap(g=>g.children).filter(o=>o.userData.highlightEdgeId);
  assert.equal(highlights().length,4);assert.ok(highlights().every(o=>o.material.linewidth===6));
  await ui.render({featurePreview:{type:'fillet',targetBodyId:'tire',edgeIndices:[1,2,3,4],radius:1}});
  await ui.reply(1,true,data);assert.equal(highlights().length,4);
  assert.ok(highlights().every(o=>o.material.linewidth===6));
});
test('sketch visibility toggles hide/show every sketch without touching solids or requesting geometry',async t=>{
  const sketches=['a','b'].map((id,i)=>({id,name:id,visible:true,frame:{origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]},paths:[{id:`line-${id}`,type:'line',construction:false,points:[[i*5,0,5],[i*5+3,5,5]]}]}));
  const records=sketches.map(s=>({id:s.id,name:s.name,plane:'XY',entities:[],visible:true}));
  const ui=await mount(t,{...payload,sketches});
  await ui.render({document:{features:[],sketches:records}});await ui.reply(1,true,{...payload,sketches});
  const drawn=()=>ui.renderer.scene.children.flatMap(g=>g.children).filter(o=>o.userData.sketchId);
  assert.equal(drawn().length,2);const count=ui.calls.length;
  await ui.render({document:{features:[],sketches:records.map(s=>({...s,visible:false}))}});
  assert.equal(drawn().length,0);
  assert.ok(ui.renderer.scene.children.flatMap(g=>g.children).some(o=>o.userData.faceId===face.id));
  await ui.render({document:{features:[],sketches:records}});assert.equal(drawn().length,2);
  assert.equal(ui.calls.length,count);assert.equal(ui.host.querySelector('canvas'),ui.canvas);
});
test('live themes recolor existing solids, edges, selected highlights and grid without geometry requests',async t=>{
  const {THEME_PRESETS}=await import('../app/components/themes.ts');
  const ui=await mount(t);
  const mesh=ui.renderer.scene.children.flatMap(g=>g.children).find(o=>o.userData.faceId===face.id && o instanceof THREE.Mesh);
  const geometry=mesh.geometry;
  await ui.render({selectedEdgeIds:[edge.id],theme:THEME_PRESETS['old-school']});
  assert.equal(mesh.material.color.getHex(),0xa0a0a0);
  const outline=ui.renderer.scene.children.flatMap(g=>g.children).find(o=>o.userData.faceId===face.id && o instanceof THREE.LineSegments);
  assert.equal(outline.material.color.getHex(),0x414953);
  const custom={...THEME_PRESETS['old-school'],colors:{...THEME_PRESETS['old-school'].colors,model:'#d4b586',selection:'#ff00aa',grid:'#112233'}};
  await ui.render({theme:custom});
  assert.equal(mesh.material.color.getHex(),0xd4b586);
  const highlight=ui.renderer.scene.children.flatMap(g=>g.children).find(o=>o.userData.highlightEdgeId===edge.id);
  assert.equal(highlight.material.color.getHex(),0xff00aa);
  const grid=ui.renderer.scene.children.find(o=>o instanceof THREE.GridHelper);
  const color=new THREE.Color().fromBufferAttribute(grid.geometry.getAttribute('color'),0);
  assert.equal(color.getHex(),0x112233);
  assert.equal(mesh.geometry,geometry);assert.equal(ui.host.querySelector('canvas'),ui.canvas);assert.equal(ui.calls.length,1);
  await ui.render({theme:THEME_PRESETS.tron,selectedEdgeIds:[]});assert.equal(mesh.material.color.getHex(),0x3097bd);
});
