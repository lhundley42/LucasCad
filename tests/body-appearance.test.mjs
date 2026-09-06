import assert from 'node:assert/strict';
import test from 'node:test';
import React, {act} from 'react';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {BodyAppearance} from '../app/components/BodyAppearance.tsx';
import {bodyColorMap, normalizeBodyColor, setBodyColor} from '../app/components/bodyColors.ts';
import {geometryDocumentKey} from '../app/components/viewportRequests.ts';
import {parseLucasCadProject, serializeLucasCadProject} from '../app/components/projectFile.ts';

const dom=new JSDOM('<!doctype html><body></body>');
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLInputElement:dom.window.HTMLInputElement,IS_REACT_ACT_ENVIRONMENT:true,React});
const {createRoot}=await import('react-dom/client');
const features=[{id:'e',name:'Hull',type:'extrude',combine:'new',bodyId:'hull',distance:20},{id:'f',type:'fillet',targetBodyId:'hull',radius:1},{id:'other',type:'revolve',combine:'new',bodyId:'mast',angle:360}];

test('body appearance persists through JSON and modifiers without altering geometry identity',()=>{
  const colored=setBodyColor(features,'hull','#B87333');
  assert.equal(colored[0].bodyColor,'#b87333');assert.equal(colored[1],features[1]);assert.equal(colored[2],features[2]);assert.equal(features[0].bodyColor,undefined);
  const doc={sketches:[],features:colored};
  const reopened=parseLucasCadProject(serializeLucasCadProject(doc));
  assert.equal(bodyColorMap(reopened.features).hull,'#b87333');
  assert.equal(geometryDocumentKey(doc),geometryDocumentKey({sketches:[],features}));
  const renamed=colored.map(f=>f.id==='e'?{...f,bodyName:'New hull'}:f);
  assert.equal(bodyColorMap(renamed).hull,'#b87333');
  assert.deepEqual(setBodyColor(colored,'hull'),features);
  assert.equal(normalizeBodyColor('url(bad)'),undefined);assert.equal(normalizeBodyColor('#fff'),undefined);
  assert.equal(setBodyColor(features,'hull','bad'),features);
  assert.equal(bodyColorMap([{...features[0],bodyColor:'bad'}]).hull,undefined);
  const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
  assert.match(page,/bodyColor: existingFeature\?\.bodyColor/,'editing the original extrusion/revolve retains the body override');
});

test('Appearance picker applies once, cancels drafts, validates hex and resets to theme',async t=>{
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const applied=[];
  await act(async()=>root.render(React.createElement(BodyAppearance,{color:'#b87333',themeColor:'#3097bd',onApply:c=>applied.push(c)})));
  t.after(async()=>{await act(async()=>root.unmount());host.remove();});
  const click=async text=>{const button=[...host.querySelectorAll('button')].find(b=>b.textContent.includes(text));assert.ok(button,text);await act(async()=>button.click());};
  await click('Appearance');assert.equal(host.querySelector('input[type=color]').value,'#b87333');
  const input=host.querySelector('input[type=text]');
  const fill=async value=>{await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new window.Event('input',{bubbles:true}));});};
  const change=fill;
  await change('#');assert.equal(host.querySelector('[aria-invalid=true]'),input);assert.ok(host.querySelector('button:disabled'));assert.equal(applied.length,0);
  await change('#123456');await click('Cancel');assert.equal(applied.length,0);
  await click('Appearance');assert.equal(host.querySelector('input[type=text]').value,'#b87333');
  await click('Apply color');assert.deepEqual(applied,['#b87333']);
  await click('Use theme color');assert.deepEqual(applied,['#b87333',undefined]);
});
