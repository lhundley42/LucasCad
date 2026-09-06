import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { UnionPanel } from '../app/components/UnionPanel.tsx';
import { activeBodyIds, toggleUnionBody } from '../app/components/unionBodies.ts';

const dom = new JSDOM('<!doctype html><body></body>', {url:'http://localhost:4310'});
Object.assign(globalThis, {window:dom.window, document:dom.window.document, IS_REACT_ACT_ENVIRONMENT:true, React});
const delay = () => new Promise(resolve => setTimeout(resolve, 240));
const bodies = ['A','B','C','D'].map(id => ({id,name:`Body ${id}`}));
const success = () => ({ok:true,json:async()=>({properties:{valid:true,solidCount:1}})});
async function mount(t, ids=[], editing=false) {
  const host=document.createElement('div'); document.body.append(host); const root=createRoot(host);
  let value={type:'union',bodyIds:ids,targetBodyId:ids[0]??''};
  const calls={commit:0,close:0};
  const render=()=>root.render(React.createElement(UnionPanel,{value,bodies,editing,api:'http://localhost:4311',candidate:{sketches:[],features:[{...value,id:'union',name:'Union'}]},onChange:next=>{value=next;render();},onClose:()=>calls.close++,onCommit:()=>calls.commit++}));
  await act(async()=>render());
  t.after(async()=>{await act(async()=>root.unmount());host.remove();});
  return {host,calls,value:()=>value,button:()=>[...host.querySelectorAll('button')].find(b=>b.textContent===(editing?'Apply changes':'Create union')),
    select:async i=>{await act(async()=>host.querySelectorAll('input')[i].click());}};
}
test('union opens immediately and supports any number of toggle selections',async t=>{
  globalThis.fetch=async()=>success();
  const ui=await mount(t); assert.ok(ui.host.querySelector('[role="dialog"]')); assert.equal(ui.button().disabled,true);
  for(let i=0;i<4;i++) await ui.select(i);
  assert.deepEqual(ui.value().bodyIds,['A','B','C','D']);
  await act(delay); assert.equal(ui.button().disabled,false);
  await ui.select(0); assert.equal(ui.value().targetBodyId,'B'); assert.equal(ui.button().disabled,true);
  await act(delay); await act(async()=>ui.button().click()); assert.equal(ui.calls.commit,1);
});
test('preselection and saved edit parameters appear checked without extra clicks',async t=>{
  globalThis.fetch=async()=>success();
  const ui=await mount(t,['B','D'],true);
  assert.deepEqual([...ui.host.querySelectorAll('input')].map(i=>i.checked),[false,true,false,true]);
  await act(delay); assert.equal(ui.button().disabled,false);
});
test('invalid union cannot commit; corrected selection validates again',async t=>{
  globalThis.fetch=async()=>({ok:false,json:async()=>({detail:'Bodies must touch or overlap.'})});
  const ui=await mount(t,['A','B']); await act(delay);
  assert.match(ui.host.textContent,/touch or overlap/); assert.equal(ui.button().disabled,true);
  globalThis.fetch=async()=>success(); await ui.select(2); await act(delay);
  assert.equal(ui.button().disabled,false);
});
test('late approval cannot enable a different selection',async t=>{
  const pending=[]; globalThis.fetch=(_url,options)=>new Promise(resolve=>pending.push({resolve,options}));
  const ui=await mount(t,['A','B']); await act(delay);
  await ui.select(1); await act(async()=>pending[0].resolve(success()));
  assert.equal(ui.button().disabled,true); assert.deepEqual(ui.value().bodyIds,['A']);
});
test('consumed bodies disappear from active list and return on rollback',()=>{
  const creators=bodies.map(b=>({id:`e${b.id}`,type:'extrude',combine:'new',bodyId:b.id}));
  const union={id:'u',type:'union',bodyIds:['B','A','C'],targetBodyId:'B'};
  assert.deepEqual(activeBodyIds([...creators,union]),['B','D']);
  assert.deepEqual(activeBodyIds(creators),['A','B','C','D']);
  assert.deepEqual(activeBodyIds([...creators,union,{id:'u2',type:'union',bodyIds:['B','D'],targetBodyId:'B'}]),['B']);
  assert.deepEqual(toggleUnionBody({type:'union',bodyIds:['B','D'],targetBodyId:'B'},'B'),{type:'union',bodyIds:['D'],targetBodyId:'D'});
});
