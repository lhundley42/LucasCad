import assert from 'node:assert/strict';
import test from 'node:test';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {SweepPanel} from '../app/components/SweepPanel.tsx';
import {selectSweepSketch} from '../app/components/sweepSelection.ts';
import {serializeLucasCadProject,parseLucasCadProject} from '../app/components/projectFile.ts';

const dom=new JSDOM('<!doctype html><body></body>',{url:'http://localhost:4310'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,React,IS_REACT_ACT_ENVIRONMENT:true});
const success=()=>({ok:true,json:async()=>({properties:{valid:true,solidCount:1}})});
const delay=()=>new Promise(r=>setTimeout(r,220));
const sketches=['profile','path','other'].map(id=>({id,name:id,plane:'XY',entities:[]}));
async function mount(t,ids=['',''],editing=false){
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  let value={type:'sweep',sketchIds:ids,orientation:'follow',transition:'round',combine:'new',targetBodyId:'body'};
  const calls={commit:0,close:0,validated:[]};const onValidated=key=>calls.validated.push(key);
  const render=()=>root.render(React.createElement(SweepPanel,{value,sketches,bodies:[{id:'body',name:'Target'}],candidate:{sketches,features:[{...value,id:'sweep',bodyId:'swept'}]},api:'http://localhost:4311',editing,onChange:next=>{value=next;render();},onClose:()=>calls.close++,onCommit:()=>calls.commit++,onValidated}));
  await act(async()=>render());t.after(async()=>{await act(async()=>root.unmount());host.remove();});
  return {host,calls,value:()=>value,
    pick:async id=>{await act(async()=>{value=selectSweepSketch(value,id);render();});},
    click:async label=>{const button=[...host.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.textContent===label);assert.ok(button,label);await act(async()=>button.click());},
    choose:async(label,v)=>{const select=host.querySelector(`select[aria-label="${label}"]`);await act(async()=>{select.value=v;select.dispatchEvent(new window.Event('change',{bubbles:true}));});},
    submit:()=>host.querySelector('.dialog-actions .primary'),
  };
}
test('Sweep opens instantly empty or preselected, then accepts profile and path in two geometry clicks',async t=>{
  let requests=0;globalThis.fetch=async()=>{requests++;return success();};
  const ui=await mount(t);assert.ok(ui.host.querySelector('[role="dialog"]'));assert.match(ui.host.textContent,/Select the profile sketch/);
  await ui.pick('profile');assert.match(ui.host.textContent,/Now select the path sketch/);await act(delay);assert.equal(requests,0);
  await ui.pick('path');assert.deepEqual(ui.value().sketchIds,['profile','path']);assert.equal(ui.submit().disabled,true);
  await act(delay);assert.equal(ui.submit().disabled,false);await ui.click('Create sweep');assert.equal(ui.calls.commit,1);
  const pre=await mount(t,['profile','']);assert.match(pre.host.textContent,/Now select the path sketch/);
});
test('explicit reference reselection preserves the other slot; duplicate and surplus picks do not scramble selection',async t=>{
  globalThis.fetch=async()=>success();const ui=await mount(t,['profile','path']);
  await ui.pick('other');assert.deepEqual(ui.value().sketchIds,['profile','path']);
  await ui.click('Select sweep profile');await ui.pick('path');assert.deepEqual(ui.value().sketchIds,['','path']);
  await ui.pick('other');assert.deepEqual(ui.value().sketchIds,['other','path']);
  await ui.click('Select sweep path');await ui.pick('profile');assert.deepEqual(ui.value().sketchIds,['other','profile']);
  await ui.click('⇄ Swap profile and path');assert.deepEqual(ui.value().sketchIds,['profile','other']);
});
test('orientation, corners and Boolean controls preserve geometry references and revalidate edited features',async t=>{
  globalThis.fetch=async()=>success();const ui=await mount(t,['profile','path'],true);assert.equal(ui.host.querySelector('[role="dialog"]').getAttribute('aria-label'),'Edit sweep');
  await act(delay);await ui.choose('Sweep orientation','fixed');assert.equal(ui.submit().disabled,true);
  await ui.choose('Sweep corners','right');await ui.choose('Sweep result','cut');
  assert.deepEqual(ui.value().sketchIds,['profile','path']);assert.equal(ui.value().orientation,'fixed');assert.equal(ui.value().transition,'right');
  assert.ok(ui.host.querySelector('[aria-label="Sweep target body"]'));await act(delay);await ui.click('Apply changes');assert.equal(ui.calls.commit,1);
});
test('invalid sweep reports actionable diagnostic without allowing commit; stale validation cannot approve new selections',async t=>{
  const pending=[];globalThis.fetch=()=>new Promise(resolve=>pending.push(resolve));const ui=await mount(t,['profile','path']);
  await act(delay);await ui.click('Select sweep path');await ui.pick('other');await act(delay);
  await act(async()=>pending[0](success()));assert.equal(ui.submit().disabled,true);assert.equal(ui.calls.validated.length,0);
  await act(async()=>pending[1]({ok:false,json:async()=>({detail:'Sweep path is disconnected. Snap its endpoints together.'})}));
  assert.match(ui.host.textContent,/disconnected.*Snap/);await ui.click('Create sweep');assert.equal(ui.calls.commit,0);
  await ui.click('Cancel');assert.equal(ui.calls.close,1);
});
test('demo JSON preserves sweep references/options and main UI integrates creation, tree editing and preview',()=>{
  const model=JSON.parse(readFileSync(new URL('../examples/Sweep-hollow-handle.lucascad.json',import.meta.url),'utf8'));
  assert.deepEqual(parseLucasCadProject(serializeLucasCadProject(model)).features,model.features);
  const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
  assert.match(page,/onClick=\{requestSweep\}/);assert.match(page,/loftDraft\?\.type === "sweep" && <SweepPanel/);
  assert.match(page,/if \(feature.type === "loft" \|\| feature.type === "sweep"\)/);
  assert.match(page,/selectSweepSketch\(current, sketchId\)/);
  assert.match(page,/feature.sketchIds\?\.includes\(id\)/);
});
