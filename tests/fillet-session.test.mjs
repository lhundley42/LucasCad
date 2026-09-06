import assert from 'node:assert/strict';
import test from 'node:test';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import * as THREE from 'three';
import {FilletSession, FilletPanel, useFilletSession} from '../app/components/FilletSession.tsx';
import {FilletManipulator} from '../app/components/FilletManipulator.ts';

const dom = new JSDOM('<!doctype html><body></body>', {url:'http://localhost:4310'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,React,IS_REACT_ACT_ENVIRONMENT:true});
const wait = () => new Promise(resolve=>setTimeout(resolve,130));
const valid = radius=>({available:true,radius,maxRadius:1,minimumRadius:.001,limitResolved:true,targetBodyId:'body',anchor:[0,0,0],direction:[1,0,0],previewFaces:[],message:'Valid fillet preview'});
async function mount(t,initial={}) {
  const host=document.createElement('div'); document.body.append(host); const root=createRoot(host);
  let draft={type:'fillet',targetBodyId:'body',edgeIndices:[1],radius:2,...initial};
  const calls=[],commits=[];let session;
  globalThis.fetch=(url,options)=>new Promise(resolve=>calls.push({url,body:JSON.parse(options.body),resolve}));
  function Observer(){ session=useFilletSession();return React.createElement(FilletPanel); }
  const render=()=>root.render(React.createElement(FilletSession,{draft,baseDocument:{sketches:[],features:[]},candidate:{sketches:[],features:draft?[{...draft,id:'fillet',name:'Fillet'}]:[]},api:'http://localhost:4311',imperial:false,editing:false,bodyName:'Test body',onRadiusChange:radius=>{draft={...draft,radius};render();},onCommit:()=>commits.push(draft),onClose:()=>{draft=null;render();}},React.createElement(Observer)));
  await act(async()=>render());
  t.after(async()=>{await act(async()=>root.unmount());host.remove();});
  return {host,calls,commits,get session(){return session;},get draft(){return draft;},update:async patch=>act(async()=>{draft=patch===null?null:{...draft,...patch};render();}),
    reply:async(index,result,ok=true)=>act(async()=>calls[index].resolve({ok,json:async()=>result})),
    setRadius:async radius=>act(async()=>session.setRadius(radius)),button:()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Create fillet')};
}

test('fillet opens immediately, fits an oversized default, clamps slider/arrow and verifies history before commit',async t=>{
  const ui=await mount(t);assert.ok(ui.host.querySelector('[role="dialog"]'));assert.equal(ui.button().disabled,true);
  await act(wait);assert.match(ui.calls[0].url,/api\/fillet$/);assert.equal(ui.calls[0].body.radius,2);
  await ui.reply(0,{...valid(.999),adjusted:true,message:'Radius adjusted to a tested value.'});
  assert.equal(ui.draft.radius,.999);assert.equal(ui.button().disabled,false);assert.match(ui.host.textContent,/Maximum radius/);
  await act(wait);assert.equal(ui.calls.length,1,'accepted adjusted value is not redundantly rebuilt');
  await ui.setRadius(200);assert.equal(ui.draft.radius,1);assert.equal(ui.button().disabled,true);
  await act(wait);await ui.reply(1,valid(1));
  await act(async()=>ui.button().click());assert.equal(ui.commits.length,0);assert.match(ui.calls[2].url,/api\/document$/);
  await ui.reply(2,{properties:{valid:true,solidCount:1}});assert.equal(ui.commits.length,1);
});

test('rapid drag values coalesce, stale answers do not change radius, last valid preview stays visible',async t=>{
  const ui=await mount(t,{radius:.2});await act(wait);await ui.reply(0,valid(.2));
  const previous=ui.session.result;
  await ui.setRadius(.3);await act(wait);await ui.setRadius(.4);await ui.setRadius(.5);await act(wait);
  assert.equal(ui.calls.length,2);assert.equal(ui.session.result,previous);assert.equal(ui.button().disabled,true);
  await ui.reply(1,valid(.3));assert.equal(ui.draft.radius,.5);assert.equal(ui.calls.length,3);assert.equal(ui.calls[2].body.radius,.5);
  await ui.reply(2,valid(.5));assert.equal(ui.session.ready,true);
});

test('edge changes invalidate limits; unavailable edges and downstream failures never commit',async t=>{
  const ui=await mount(t,{radius:.2});await act(wait);await ui.reply(0,valid(.2));
  await ui.update({edgeIndices:[1,2,3,4]});assert.equal(ui.session.result,null);assert.equal(ui.button().disabled,true);
  await act(wait);await ui.reply(1,{available:false,message:'Choose a sharp edge, not a seam.'});
  assert.match(ui.host.textContent,/seam/);assert.equal(ui.button().disabled,true);assert.equal(ui.commits.length,0);
  await ui.update({edgeIndices:[1]});await act(wait);await ui.reply(2,valid(.2));
  await act(async()=>ui.button().click());await ui.reply(3,{detail:'Downstream shell cannot rebuild'},false);
  assert.equal(ui.commits.length,0);assert.match(ui.host.textContent,/Your model has not been changed/);
});

test('closing or clearing selection discards late radius responses',async t=>{
  const ui=await mount(t);await act(wait);await ui.update(null);await ui.reply(0,valid(.5));
  assert.equal(ui.draft,null);assert.equal(ui.host.textContent,'');assert.equal(ui.commits.length,0);
});

test('3D gold radius handle captures drags, clamps at the tested maximum and cancels safely',()=>{
  const canvas=document.createElement('canvas');canvas.getBoundingClientRect=()=>({left:0,top:0,width:800,height:600});
  canvas.setPointerCapture=()=>{};canvas.hasPointerCapture=()=>false;
  const camera=new THREE.PerspectiveCamera(45,800/600,.1,1000);camera.position.set(0,0,100);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const controls={enabled:true},changes=[];const handle=new FilletManipulator(camera,canvas,controls,r=>changes.push(r));
  const value={radius:.5,maxRadius:1,minimumRadius:.001,anchor:[0,0,0],direction:[1,0,0]};handle.update(value);
  let stray=0;canvas.addEventListener('pointerup',()=>stray++);
  const dispatch=(type,x,y)=>{const event=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(event,{button:0,pointerId:1,clientX:x,clientY:y});canvas.dispatchEvent(event);};
  dispatch('pointerdown',475,300);assert.equal(handle.dragging,true);assert.equal(controls.enabled,false);
  dispatch('pointermove',700,300);assert.equal(changes.at(-1),1);dispatch('pointerup',700,300);assert.equal(controls.enabled,true);assert.equal(stray,0);
  handle.update(value);dispatch('pointerdown',475,300);dispatch('pointermove',460,300);dispatch('pointercancel',460,300);assert.equal(changes.at(-1),.5);
  handle.update(null);assert.equal(handle.group.visible,false);handle.dispose();
});
