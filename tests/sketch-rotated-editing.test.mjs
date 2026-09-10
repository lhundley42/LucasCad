import assert from 'node:assert/strict';
import test from 'node:test';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {projectSketchPoint} from '../app/components/sketchProjection.ts';
import {makeTangentConstraint,tangentSatisfied} from '../app/components/sketchTangency.ts';
import {parseLucasCadProject} from '../app/components/projectFile.ts';
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
async function mount(t,projection,unified=false,initialProps={}) {
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const edits=[],constraints=[],offsets=[];let snaps=0;
  let props={entities:[],constraints:[],view:{center:{x:20,y:-10},zoom:1.8,projection},viewRotated:true,onChange:v=>edits.push(v),onConstraintsChange:v=>constraints.push(v),onDimensionOffsetsChange:v=>offsets.push(v),onFinish:()=>{},onSnapNormal:()=>snaps++};
  const model=()=>({sketches:[{id:'s',name:'Sketch',plane:'XY',entities:props.entities,constraints:props.constraints,dimensionOffsets:props.dimensionOffsets??{},hiddenDimensionKeys:props.hiddenDimensionKeys??[]}],features:[],referenceGeometry:[]});
  const draw=()=>root.render(unified?React.createElement(DocumentHistory,{document:model(),onRestore:doc=>{const s=doc.sketches[0];props={...props,entities:s.entities,constraints:s.constraints,dimensionOffsets:s.dimensionOffsets,hiddenDimensionKeys:s.hiddenDimensionKeys};draw();},cancelPending:()=>false},React.createElement(Sketcher,props)):React.createElement(Sketcher,props));
  if(unified) props={...props,onChange:v=>{edits.push(v);props={...props,entities:v};draw();},onConstraintsChange:v=>{constraints.push(v);props={...props,constraints:v};draw();},onDimensionOffsetsChange:v=>{offsets.push(v);props={...props,dimensionOffsets:v};draw();},onHiddenDimensionKeysChange:v=>{props={...props,hiddenDimensionKeys:v};draw();}};
  const render=async patch=>{props={...props,...patch};await act(async()=>draw());};
  await render(initialProps);t.after(async()=>{await act(async()=>root.unmount());host.remove();});
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

for(const circleFirst of [true,false])test(`tangent constraint picks either order (${circleFirst}), survives dragging, undo and removal`,async t=>{
  const seeds=[{id:'line',type:'line',a:{x:-80,y:0},b:{x:80,y:0}},{id:'circle',type:'circle',c:{x:20,y:30},r:10}];
  const ui=await mount(t,[0.8,0.25,-0.3,0.55,12,-7],true,{entities:seeds});
  await ui.tool('Snap');await ui.tool('Tangent');
  const pickLine=()=>ui.down({x:-40,y:0},ui.svg().querySelector('.sketch-line-hit'));
  const pickCircle=()=>ui.down({x:30,y:30},ui.svg().querySelector('.tangent-circle-hit'));
  if(circleFirst){await pickCircle();await pickLine();}else{await pickLine();await pickCircle();}
  assert.equal(ui.model().sketches[0].constraints[0].type,'tangent');near(ui.edits.at(-1)[1].c,{x:20,y:10});
  assert.ok(ui.svg().querySelector('.tangent-constraint-badge'));
  await ui.key();assert.equal(ui.model().sketches[0].constraints.length,0);near(ui.model().sketches[0].entities[1].c,{x:20,y:30});
  await ui.key('y');assert.equal(ui.model().sketches[0].constraints.length,1);
  await ui.tool('Select');
  let center=ui.svg().querySelectorAll('.control-layer')[1].querySelector('.control-point');
  await ui.down({x:20,y:10},center);await ui.pointer('pointermove',ui.svg(),{x:40,y:55});await ui.pointer('pointerup',ui.svg(),{x:40,y:55});
  near(ui.edits.at(-1)[1].c,{x:40,y:10});
  const badge=ui.svg().querySelector('.tangent-constraint-badge');await ui.down({x:48,y:8},badge);await ui.key('Delete',{ctrlKey:false});
  assert.equal(ui.model().sketches[0].constraints.length,0);assert.equal(ui.model().sketches[0].entities.length,2);
  center=ui.svg().querySelectorAll('.control-layer')[1].querySelector('.control-point');
  await ui.down({x:40,y:10},center);await ui.pointer('pointermove',ui.svg(),{x:40,y:50});await ui.pointer('pointerup',ui.svg(),{x:40,y:50});near(ui.edits.at(-1)[1].c,{x:40,y:50});
});

test('saved tangency survives radius edits and line endpoint movement; deleting line removes its relation',async t=>{
  const c={id:'c',type:'circle',c:{x:20,y:10},r:10},l={id:'l',type:'line',a:{x:-80,y:0},b:{x:80,y:0}};
  const relation=makeTangentConstraint(c,l,'t');
  const project=parseLucasCadProject(JSON.stringify({sketches:[{id:'s',plane:'XY',entities:[l,c],constraints:[relation]}],features:[]}));
  const ui=await mount(t,[1,0,0,1,0,0],true,project.sketches[0]);await ui.tool('Snap');
  assert.ok(ui.svg().querySelector('.tangent-constraint-badge'));
  const label=[...ui.svg().querySelectorAll('.sketch-dimension')].find(e=>e.getAttribute('aria-label').includes('20'));
  assert.ok(label);await act(async()=>label.dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true})));
  const input=ui.host.querySelector('.dimension-editor');assert.ok(input);
  await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,'40');input.dispatchEvent(new window.Event('input',{bubbles:true}));});
  await act(async()=>input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
  const sketch=()=>ui.model().sketches[0];assert.equal(sketch().entities[1].r,20);near(sketch().entities[1].c,{x:20,y:20});
  const end=ui.svg().querySelectorAll('.control-layer')[0].querySelectorAll('.control-point')[2];
  await ui.down({x:80,y:0},end);await ui.pointer('pointermove',ui.svg(),{x:80,y:40});await ui.pointer('pointerup',ui.svg(),{x:80,y:40});
  assert.ok(tangentSatisfied(relation,sketch().entities));
  await ui.down({x:-20,y:15},ui.svg().querySelector('.sketch-line-hit'));await ui.key('Delete',{ctrlKey:false});
  assert.equal(sketch().entities.length,1);assert.equal(sketch().constraints.length,0);
});

async function chooseRectangle(ui, centered) {
  await ui.tool('Rect');
  const menu=document.querySelector('[role="menu"][aria-label="Rectangle creation modes"]');
  assert.ok(menu);
  const options=menu.querySelectorAll('[role="menuitemradio"]');
  assert.equal(options.length,2);
  await act(async()=>options[centered?1:0].click());
  assert.equal(document.querySelector('.rectangle-mode-menu'),null);
}

for (const references of ['axes','seed-and-background']) test(`rectangular pattern drag-box seeds followed by ${references} directions`,async t=>{
  const seeds=[{id:'seed-a',type:'line',a:{x:20,y:20},b:{x:40,y:20}},
    {id:'seed-b',type:'line',a:{x:20,y:40},b:{x:40,y:40}}];
  const ui=await mount(t,[0.8,0.25,-0.3,0.55,12,-7],false,{entities:seeds,externalReferences:[{id:'background-edge',kind:'body-edge',label:'Background vertical edge',points:[{x:80,y:10},{x:80,y:70}]}]});
  const button=ui.host.querySelector('button[title^="Rectangular sketch pattern"]');
  await act(async()=>button.click());
  assert.match(ui.host.textContent,/Select in sketch/);
  await ui.down({x:0,y:0});
  await ui.pointer('pointermove',ui.svg(),{x:80,y:80});
  assert.ok(ui.svg().querySelector('.sketch-selection-box'));
  await ui.pointer('pointerup',ui.svg(),{x:80,y:80});
  assert.equal(ui.svg().querySelectorAll('.sketch-entity.selected').length,2);
  assert.match(ui.host.textContent,/2 selected/);
  assert.equal(ui.edits.length,0);
  if(references==='axes'){
    await ui.down({x:-100,y:0},ui.svg().querySelector('[aria-label="Red sketch X axis"]'));
    assert.ok(ui.svg().querySelector('.sketch-axis.x.pattern-reference-selected'));
    assert.equal(ui.svg().querySelectorAll('.sketch-pattern-preview>g').length,4,'first direction previews two copies of each seed immediately');
    await ui.pointer('pointerout',ui.svg().querySelector('[aria-label="Red sketch X axis"]'),{x:-100,y:0},0,0);
    assert.ok(ui.svg().querySelector('.sketch-axis.x.pattern-reference-selected'),'chosen axis stays highlighted after pointer leaves');
    await ui.down({x:0,y:-100},ui.svg().querySelector('[aria-label="Green sketch Y axis"]'));
    assert.ok(ui.svg().querySelector('.sketch-axis.y.pattern-reference-selected'));
    assert.ok(ui.svg().querySelector('.sketch-axis.x.pattern-reference-selected'));
    assert.equal(ui.svg().querySelectorAll('.sketch-pattern-preview>g').length,16,'second direction expands into a 3x3 pattern');
  }else{
    await ui.down({x:30,y:20},ui.svg().querySelector('.sketch-entity line'));
    assert.ok(ui.svg().querySelector('.sketch-entity .pattern-reference-selected'));
    assert.equal(ui.svg().querySelectorAll('.sketch-pattern-preview>g').length,4);
    await ui.down({x:80,y:50},ui.svg().querySelector('[aria-label="Background vertical edge"]'));
  }
  assert.ok(ui.svg().querySelector('.sketch-pattern-preview'));
  const apply=ui.host.querySelector('.sketch-pattern-manager .apply')??ui.host.querySelector('aside .apply');
  assert.ok(apply);assert.equal(apply.disabled,false);await act(async()=>apply.click());
  const pattern=ui.constraints.at(-1).find(c=>c.type==='rectangular-pattern');
  assert.equal(pattern.pairs.length,2);
  assert.ok(ui.edits.at(-1).length>2);
  if(references==='axes'){assert.equal(pattern.direction1.referenceId,'sketch-axis:x');assert.equal(pattern.direction2.referenceId,'sketch-axis:y');}
  else {assert.equal(pattern.direction1.entityId,'seed-a');assert.equal(pattern.direction2.referenceId,'background-edge');}
});

for(const title of ['Linear sketch pattern','Circular sketch pattern'])test(`${title} shares drag-box seed selection`,async t=>{
  const ui=await mount(t,[1,0,0,1,0,0],false,{entities:[{id:'a',type:'circle',c:{x:20,y:20},r:3},{id:'b',type:'circle',c:{x:40,y:40},r:3}]});
  await act(async()=>ui.host.querySelector(`button[title^="${title}"]`).click());
  await ui.down({x:10,y:10});await ui.pointer('pointermove',ui.svg(),{x:50,y:50});await ui.pointer('pointerup',ui.svg(),{x:50,y:50});
  assert.equal(ui.svg().querySelectorAll('.sketch-entity.selected').length,2);
  assert.match(ui.host.textContent,/2 selected/);
});

for(const projection of [[1,0,0,1,0,0],[0.8,0.25,-0.3,0.55,12,-7]]) {
  for(const centered of [false,true]) test(`${centered?'centered':'corner'} rectangle previews and commits the same closed contour in projection ${projection}`,async t=>{
    const ui=await mount(t,projection);await ui.tool('Snap');await chooseRectangle(ui,centered);
    const first={x:24,y:18},second={x:-16,y:-12};
    await ui.down(first);
    assert.equal(ui.edits.length,0);
    await ui.pointer('pointermove',ui.svg(),second);
    const preview=ui.svg().querySelector('[data-testid="rectangle-preview"]').getAttribute('points').split(' ').map(p=>{const [x,y]=p.split(',').map(Number);return {x,y};});
    await ui.down(second);
    const entities=ui.edits.at(-1);assert.equal(entities.length,4);
    const expectedA=centered?{x:64,y:48}:first;
    near(entities[0].a,expectedA);near(entities[2].a,second);
    for(let i=0;i<4;i++){near(entities[i].a,preview[i]);near(entities[i].b,entities[(i+1)%4].a);assert.equal(entities[i].type,'line');}
    assert.equal(ui.svg().querySelector('[data-testid="rectangle-preview"]'),null);
    if(centered)near({x:(entities[0].a.x+entities[2].a.x)/2,y:(entities[0].a.y+entities[2].a.y)/2},first);
    await ui.key();assert.equal(ui.edits.at(-1).length,0);
  });
}

test('rectangle dropdown cancels with Escape; switching modes discards old anchor; flat rectangles cannot commit',async t=>{
  const ui=await mount(t,[1,0,0,1,0,0]);await ui.tool('Snap');
  await ui.tool('Rect');
  await act(async()=>document.querySelector('.rectangle-mode-menu button').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
  assert.equal(document.querySelector('.rectangle-mode-menu'),null);
  await chooseRectangle(ui,false);await ui.down({x:1,y:2});
  await chooseRectangle(ui,true);await ui.down({x:30,y:40});
  assert.equal(ui.edits.length,0);
  await ui.down({x:30,y:60});assert.equal(ui.edits.length,0);
  await ui.down({x:50,y:60});const entities=ui.edits.at(-1);
  near(entities[0].a,{x:10,y:20});near(entities[2].a,{x:50,y:60});
});

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
  await ui.tool('Rect');await act(async()=>document.querySelector('[role="menuitemradio"]').click());await ui.down({x:10,y:20});await ui.down({x:50,y:60});assert.equal(ui.edits.at(-1).length,5);
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
