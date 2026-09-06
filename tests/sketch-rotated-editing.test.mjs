import assert from 'node:assert/strict';
import test from 'node:test';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {projectSketchPoint} from '../app/components/sketchProjection.ts';
const dom=new JSDOM('<!doctype html><body></body>',{url:'http://localhost:4310'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,React,IS_REACT_ACT_ENVIRONMENT:true});
globalThis.requestAnimationFrame=cb=>{cb();return 1;};globalThis.cancelAnimationFrame=()=>{};
const {createRoot}=await import('react-dom/client');
const {Sketcher}=await import('../app/components/Sketcher.tsx');
const {DocumentHistory}=await import('../app/components/DocumentHistory.tsx');
window.SVGElement.prototype.setPointerCapture=()=>{};
window.SVGElement.prototype.releasePointerCapture=()=>{};
window.SVGElement.prototype.hasPointerCapture=()=>false;
// jsdom lacks SVG matrix APIs: supply the browser's root viewBox -> CSS-pixel
// mapping. The production inverse plane projection itself is NOT mocked.
window.SVGElement.prototype.createSVGPoint=function(){return {x:0,y:0,matrixTransform(m){return {x:this.x*m.a+m.e,y:this.y*m.d+m.f};}};};
window.SVGElement.prototype.getScreenCTM=function(){
  const [x,y,w,h]=this.getAttribute('viewBox').split(' ').map(Number),s=Math.max(800/w,600/h);
  const e=400-(x+w/2)*s,f=300-(y+h/2)*s;
  return {inverse:()=>({a:1/s,d:1/s,e:-e/s,f:-f/s})};
};
async function mount(t,projection,unified=false) {
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const edits=[],constraints=[],offsets=[];let snaps=0;
  let props={entities:[],constraints:[],view:{center:{x:20,y:-10},zoom:1.8,projection},viewRotated:true,onChange:v=>edits.push(v),onConstraintsChange:v=>constraints.push(v),onDimensionOffsetsChange:v=>offsets.push(v),onFinish:()=>{},onSnapNormal:()=>snaps++};
  const model=()=>({sketches:[{id:'s',name:'Sketch',plane:'XY',entities:props.entities,constraints:props.constraints,dimensionOffsets:props.dimensionOffsets??{},hiddenDimensionKeys:props.hiddenDimensionKeys??[]}],features:[],referenceGeometry:[]});
  const draw=()=>root.render(unified?React.createElement(DocumentHistory,{document:model(),onRestore:doc=>{const s=doc.sketches[0];props={...props,entities:s.entities,constraints:s.constraints,dimensionOffsets:s.dimensionOffsets,hiddenDimensionKeys:s.hiddenDimensionKeys};draw();},cancelPending:()=>false},React.createElement(Sketcher,props)):React.createElement(Sketcher,props));
  if(unified) props={...props,onChange:v=>{edits.push(v);props={...props,entities:v};draw();},onConstraintsChange:v=>{constraints.push(v);props={...props,constraints:v};draw();},onDimensionOffsetsChange:v=>{offsets.push(v);props={...props,dimensionOffsets:v};draw();},onHiddenDimensionKeysChange:v=>{props={...props,hiddenDimensionKeys:v};draw();}};
  const render=async patch=>{props={...props,...patch};await act(async()=>draw());};
  await render({});t.after(async()=>{await act(async()=>root.unmount());host.remove();});
  const svg=()=>host.querySelector('svg.sketch-canvas');
  const tool=async name=>{const button=[...host.querySelectorAll('.sketch-commandbar button')].find(b=>b.textContent.trim().endsWith(name) && (name!=='Linear' || b.title.toLowerCase().includes('dimension')));assert.ok(button, name);assert.equal(button.disabled,false);await act(async()=>button.click());};
  const pointer=async (type,element,point,button=0,buttons=type==='pointerup'?0:1)=>{
    const p=projectSketchPoint(point,props.view.projection);const [x,y,w,h]=svg().getAttribute('viewBox').split(' ').map(Number);const s=Math.max(800/w,600/h);
    const event=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(event,{button,buttons,pointerId:1,clientX:400+(p.x-x-w/2)*s,clientY:300+(p.y-y-h/2)*s,shiftKey:false});await act(async()=>{element.dispatchEvent(event);if(unified&&type==='pointerup')await new Promise(r=>setTimeout(r,5));});
  };
  const down=async (point,element=svg())=>pointer('pointerdown',element,point);
  const key=async (key='z',options={})=>{await act(async()=>window.dispatchEvent(new window.KeyboardEvent('keydown',{key,ctrlKey:true,bubbles:true,cancelable:true,...options})));};
  return {host,svg,tool,pointer,down,render,edits,constraints,offsets,key,model,snaps:()=>snaps};
}
const near=(actual,expected)=>{assert.ok(Math.abs(actual.x-expected.x)<1e-7, JSON.stringify({actual,expected}));assert.ok(Math.abs(actual.y-expected.y)<1e-7, JSON.stringify({actual,expected}));};

for(const unified of [false,true]) test(`${unified?'document':'standalone'} undo restores geometry, constraints and multi-frame dimension/node drags together`,async t=>{
  const ui=await mount(t,[0.8,0.25,-0.3,0.55,12,-7],unified);await ui.tool('Snap');
  const click=async(p,target=ui.svg())=>{await ui.down(p,target);await ui.pointer('pointerup',ui.svg(),p);};
  await ui.tool('Line');await click({x:10,y:20});await click({x:70,y:35});await ui.tool('Select');
  await ui.tool('Horiz');await click({x:40,y:27},ui.host.querySelector('.sketch-entity'));
  assert.ok(ui.host.querySelector('.locked-axis-constraint'));await ui.key();assert.equal(ui.host.querySelector('.locked-axis-constraint'),null);assert.equal(ui.host.querySelectorAll('.sketch-entity').length,1);
  await ui.key('y');assert.ok(ui.host.querySelector('.locked-axis-constraint'));await ui.key();
  await ui.tool('Linear');await click({x:10,y:20},ui.host.querySelectorAll('.constraint-node-hit')[0]);await click({x:70,y:35},ui.host.querySelectorAll('.constraint-node-hit')[2]);await click({x:40,y:60});
  assert.ok(ui.host.querySelector('.constraint-label'));await ui.key();assert.equal(ui.host.querySelector('.constraint-label'),null);assert.equal(ui.host.querySelectorAll('.sketch-entity').length,1);await ui.key('z',{shiftKey:true});
  const label=ui.host.querySelector('.constraint-label');const before=label.getAttribute('transform');await ui.down({x:40,y:60},label);
  for(let x=41;x<=60;x++)await ui.pointer('pointermove',ui.svg(),{x,y:70});await ui.pointer('pointerup',ui.svg(),{x:60,y:70});
  const after=ui.host.querySelector('.constraint-label').getAttribute('transform');assert.notEqual(after,before);await ui.key();assert.equal(ui.host.querySelector('.constraint-label').getAttribute('transform'),before);await ui.key('y');assert.equal(ui.host.querySelector('.constraint-label').getAttribute('transform'),after);
  await ui.tool('Select');const endpoint=[...ui.host.querySelectorAll('.control-point')].find(p=>Math.abs(Number(p.getAttribute('cx'))-70)<0.001);await ui.down({x:70,y:35},endpoint);
  for(let x=71;x<=85;x++)await ui.pointer('pointermove',ui.svg(),{x,y:40});await ui.pointer('pointerup',ui.svg(),{x:85,y:40});
  await ui.key();const restored=[...ui.host.querySelectorAll('.control-point')].find(p=>Math.abs(Number(p.getAttribute('cx'))-70)<0.001);assert.ok(restored);assert.ok(Math.abs(Number(restored.getAttribute('cy'))-35)<0.001);
});

test('mirror creation and deletion undo restores both linked geometry and its constraint',async t=>{
  const ui=await mount(t,[1,0,0,1,0,0],true);await ui.tool('Snap');
  const click=async(p,target=ui.svg())=>{await ui.down(p,target);await ui.pointer('pointerup',ui.svg(),p);};
  await ui.tool('Line');await click({x:20,y:10});await click({x:50,y:20});await ui.tool('Select');await ui.tool('Line');await click({x:0,y:-30});await click({x:0,y:50});await ui.tool('Select');
  await click({x:30,y:14},ui.host.querySelectorAll('.sketch-entity')[0]);await ui.tool('Mirror');await click({x:0,y:0},ui.host.querySelectorAll('.sketch-entity')[1]);
  const mirrored=structuredClone(ui.model());assert.equal(mirrored.sketches[0].entities.length,3);assert.equal(mirrored.sketches[0].constraints[0].type,'mirror');
  await ui.key();assert.equal(ui.model().sketches[0].entities.length,2);assert.equal(ui.model().sketches[0].constraints.length,0);await ui.key('y');assert.deepEqual(ui.model(),mirrored);
  await click({x:20,y:10},ui.host.querySelectorAll('.sketch-entity')[0]);await ui.key('Delete',{ctrlKey:false});assert.equal(ui.model().sketches[0].constraints.length,0);await ui.key();assert.deepEqual(ui.model(),mirrored);
});

for(const [name,projection] of [['tilted',[0.8,0.25,-0.3,0.55,12,-7]],['back-side',[-0.8,-0.25,-0.3,0.55,12,-7]]]) {
  test(`${name}: draw, drag endpoints, dimension, reposition and edit a length without Normal`,async t=>{
    const ui=await mount(t,projection);
    await ui.tool('Snap'); // free placement makes coordinate errors visible
    await ui.tool('Line');await ui.down({x:11,y:23});await ui.down({x:71,y:23});
    assert.equal(ui.edits.length,1);near(ui.edits[0][0].a,{x:11,y:23});near(ui.edits[0][0].b,{x:71,y:23});
    await ui.tool('Select');
    const endpoint=[...ui.host.querySelectorAll('.control-point')].find(p=>Math.abs(Number(p.getAttribute('cx'))-71)<0.001);
    await ui.down({x:71,y:23},endpoint);await ui.pointer('pointermove',ui.svg(),{x:85,y:38});await ui.pointer('pointerup',ui.svg(),{x:85,y:38});
    near(ui.edits.at(-1)[0].b,{x:85,y:38});
    // Create a two-node linear constraint in the same tilted view.
    await ui.tool('Linear');const nodes=ui.host.querySelectorAll('.constraint-node-hit');
    await ui.down({x:11,y:23},nodes[0]);await ui.down({x:85,y:38},nodes[2]);await ui.down({x:50,y:65});
    assert.equal(ui.constraints.at(-1).length,1);
    const label=ui.host.querySelector('.constraint-label');assert.ok(label);assert.match(label.getAttribute('transform'),/^matrix/);
    const original=ui.constraints.at(-1)[0].position;
    await ui.down(original,label);await ui.pointer('pointermove',ui.svg(),{x:original.x+12,y:original.y+8});await ui.pointer('pointerup',ui.svg(),{x:original.x+12,y:original.y+8});
    assert.notDeepEqual(ui.constraints.at(-1)[0].position,original);
    await act(async()=>ui.host.querySelector('.constraint-label').dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true})));
    const input=ui.host.querySelector('.constraint-editor');assert.ok(input);assert.match(input.parentElement.getAttribute('transform'),/^matrix/);
    await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,'100');input.dispatchEvent(new window.Event('input',{bubbles:true}));});
    await act(async()=>input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
    assert.equal(ui.constraints.at(-1)[0].value,100);
    assert.equal(ui.snaps(),0);await ui.tool('Normal');assert.equal(ui.snaps(),1);
  });
}

test('tilted tools remain enabled; box-select and delete geometry in screen space',async t=>{
  const ui=await mount(t,[0.7,0.35,-0.5,0.6,0,0]);await ui.tool('Snap');await ui.tool('Line');await ui.down({x:-20,y:0});await ui.down({x:20,y:0});await ui.tool('Select');
  await ui.down({x:-80,y:0});await ui.pointer('pointermove',ui.svg(),{x:80,y:0});await ui.pointer('pointerup',ui.svg(),{x:80,y:0});
  assert.ok(ui.host.querySelector('.sketch-entity.selected'));
  await act(async()=>window.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Delete',bubbles:true})));
  assert.equal(ui.edits.at(-1).length,0);
});

test('edge-on clicks cannot write invalid geometry, and rotating slightly restores drawing without Normal',async t=>{
  const ui=await mount(t,[1,0,0,0,0,0]);await ui.tool('Line');await ui.down({x:10,y:20});await ui.down({x:40,y:40});assert.equal(ui.edits.length,0);
  assert.match(ui.host.textContent,/exactly edge-on/);
  await ui.render({view:{center:{x:20,y:-10},zoom:1.8,projection:[1,0,0,0.2,0,0]}});
  await ui.tool('Snap');await ui.down({x:10,y:20});await ui.down({x:40,y:40});assert.equal(ui.edits.length,1);
});

test('unfinished drawing survives orbit/pan/zoom changes, and rectangles and circles retain plane coordinates',async t=>{
  const ui=await mount(t,[1,0,0,1,0,0]);await ui.tool('Snap');await ui.tool('Line');await ui.down({x:-70,y:-40});
  await ui.render({view:{center:{x:50,y:80},zoom:3.7,projection:[0.45,0.7,0.3,-0.5,33,-70]}});
  await ui.down({x:-30,y:-50});near(ui.edits.at(-1)[0].a,{x:-70,y:-40});near(ui.edits.at(-1)[0].b,{x:-30,y:-50});
  await ui.tool('Rect');await ui.down({x:10,y:20});await ui.down({x:50,y:60});assert.equal(ui.edits.at(-1).length,5);
  await ui.tool('Circle');await ui.down({x:100,y:40});await ui.down({x:125,y:40});const circle=ui.edits.at(-1).at(-1);assert.equal(circle.type,'circle');near(circle.c,{x:100,y:40});assert.ok(Math.abs(circle.r-25)<1e-7);
  assert.equal(ui.snaps(),0);
});

test('middle and right mouse on nodes navigate without starting an endpoint edit',async t=>{
  const ui=await mount(t,[0.7,0.35,-0.5,0.6,0,0]);await ui.tool('Snap');await ui.tool('Line');await ui.down({x:10,y:20});await ui.down({x:50,y:60});await ui.tool('Select');
  const count=ui.edits.length;
  for(const [button,buttons] of [[1,4],[2,2]]) {
    await ui.pointer('pointerdown',ui.host.querySelector('.control-point'),{x:10,y:20},button,buttons);
    await ui.pointer('pointermove',ui.svg(),{x:80,y:80},button,buttons);await ui.pointer('pointerup',ui.svg(),{x:80,y:80},button,0);
    assert.equal(ui.edits.length,count);assert.equal(ui.host.querySelector('.dragging-point'),null);
  }
});
