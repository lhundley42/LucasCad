import assert from 'node:assert/strict';
import test from 'node:test';
import React, {act, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {TreeBranch} from '../app/components/TreeBranch.tsx';

const dom=new JSDOM('<!doctype html><body></body>');
Object.assign(globalThis,{window:dom.window,document:dom.window.document,React,IS_REACT_ACT_ENVIRONMENT:true});
async function mount(t) {
  let selections=0,visibilityChanges=0;
  function Body() {
    const [visible,setVisible]=useState(true);
    return React.createElement('div',null,React.createElement('input',{type:'checkbox',checked:visible,onChange:()=>{visibilityChanges++;setVisible(v=>!v);}}),React.createElement('button',{onClick:()=>selections++},'Tire'));
  }
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const render=async (label='LucasCoupe')=>act(async()=>root.render(React.createElement(TreeBranch,{label,icon:'◩',root:true},
    React.createElement(TreeBranch,{label:'Origin',icon:'⊕'},React.createElement('button',null,'XY Plane')),
    React.createElement(TreeBranch,{label:'Reference Geometry',icon:'⌖',count:1},React.createElement('button',null,'Plane 1')),
    React.createElement(TreeBranch,{label:'Solid Bodies',icon:'◫',count:1},React.createElement(Body)),
    React.createElement('button',null,'Fillet 1'))));
  await render();t.after(async()=>{await act(async()=>root.unmount());host.remove();});
  const button=label=>host.querySelector(`button[aria-label="${label}"]`);
  const content=label=>document.getElementById(button(label).getAttribute('aria-controls'));
  const click=async el=>act(async()=>el.click());
  return {host,button,content,click,render,selections:()=>selections,visibilityChanges:()=>visibilityChanges};
}
test('all four tree chevrons toggle their own content and update accessible state',async t=>{
  const ui=await mount(t);
  for(const label of ['Origin','Reference Geometry','Solid Bodies','LucasCoupe']) {
    assert.equal(ui.button(label).getAttribute('aria-expanded'),'true');
    await ui.click(ui.button(label).querySelector('.twisty'));
    assert.equal(ui.content(label).hidden,true);
    assert.equal(ui.button(label).getAttribute('aria-expanded'),'false');
    await ui.click(ui.button(label));assert.equal(ui.content(label).hidden,false);
  }
  assert.equal(ui.selections(),0);assert.equal(ui.visibilityChanges(),0);
});
test('collapsing the root retains nested disclosure state and child visibility',async t=>{
  const ui=await mount(t);await ui.click(ui.button('Origin'));
  await ui.click(ui.button('LucasCoupe'));await ui.click(ui.button('LucasCoupe'));
  assert.equal(ui.content('Origin').hidden,true);assert.equal(ui.content('Solid Bodies').hidden,false);
  assert.equal(ui.host.querySelector('input').checked,true);assert.equal(ui.visibilityChanges(),0);
  await ui.render('Renamed coupe');assert.equal(ui.content('Origin').hidden,true);
});
test('row selection and hide/show remain independent from the folder control',async t=>{
  const ui=await mount(t); const body=ui.content('Solid Bodies');
  await ui.click(body.querySelector('button'));assert.equal(ui.selections(),1);
  await ui.click(body.querySelector('input'));assert.equal(ui.visibilityChanges(),1);
  await ui.click(ui.button('Solid Bodies'));await ui.click(ui.button('Solid Bodies'));
  assert.equal(body.querySelector('input').checked,false);
  assert.equal(ui.selections(),1);assert.equal(ui.visibilityChanges(),1);
});
test('left and right arrows collapse and expand without affecting parent folders',async t=>{
  const ui=await mount(t);
  for(const [key,hidden] of [['ArrowLeft',true],['ArrowRight',false]]) {
    await act(async()=>ui.button('Origin').dispatchEvent(new window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true})));
    assert.equal(ui.content('Origin').hidden,hidden);assert.equal(ui.content('LucasCoupe').hidden,false);
  }
});
test('the real feature tree wraps bodies in their folder and retains the feature history outside it',()=>{
  const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
  assert.ok(page.includes('<TreeBranch label={projectFileName} icon="◩" root>'));
  for(const name of ['Origin','Reference Geometry','Solid Bodies']) assert.ok(page.includes(`<TreeBranch label="${name}"`));
  const bodies=page.slice(page.indexOf('<TreeBranch label="Solid Bodies"'),page.indexOf('{sketches.map((sketch) => { const profileCandidate'));
  assert.ok(bodies.includes('operation-body-row'));assert.ok(bodies.includes('toggleBodyVisibility'));
  const features=page.slice(page.indexOf('{features.map((feature) => <div key={feature.id} className="feature-tree-block">'),page.indexOf('      </aside>'));
  assert.ok(features.includes('editFeature(feature.id)'));assert.ok(!features.includes('operation-body-row'));
});
