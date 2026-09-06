import assert from 'node:assert/strict';
import test from 'node:test';
import React, {act} from 'react';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {RenderQualitySetting} from '../app/components/RenderQualitySetting.tsx';
import {EdgeHighlightSetting} from '../app/components/EdgeHighlightSetting.tsx';
import {normalizeGlobalSettings,parseGlobalSettings} from '../app/components/appSettings.ts';
const dom=new JSDOM('<!doctype html><body></body>');
Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true,React});
const {createRoot}=await import('react-dom/client');

test('quality settings migrate old preferences and bound corrupt values',()=>{
  assert.equal(parseGlobalSettings('{"unitSystem":"imperial"}').meshQuality,40);
  assert.equal(normalizeGlobalSettings({meshQuality:150}).meshQuality,100);
  assert.equal(normalizeGlobalSettings({meshQuality:-5}).meshQuality,0);
  assert.equal(normalizeGlobalSettings({meshQuality:NaN}).meshQuality,40);
  assert.equal(parseGlobalSettings(JSON.stringify({meshQuality:88})).meshQuality,88);
});

test('quality slider is labeled, bounded and follows saved/reset preferences',async t=>{
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const calls=[];
  const render=async value=>{await act(async()=>root.render(React.createElement(RenderQualitySetting,{value,onChange:v=>calls.push(v)})));};
  t.after(async()=>{await act(async()=>root.unmount());host.remove();});
  await render(40); const slider=host.querySelector('input');
  assert.equal(slider.type,'range');assert.equal(slider.min,'0');assert.equal(slider.max,'100');
  assert.equal(slider.getAttribute('aria-label'),'Render and mesh export quality');
  await act(async()=>{
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(slider,'85');
    slider.dispatchEvent(new window.Event('input',{bubbles:true}));
  });
  assert.match(host.textContent,/85%/); assert.deepEqual(calls,[]);
  await act(async()=>slider.dispatchEvent(new window.Event('pointerup',{bubbles:true})));
  assert.deepEqual(calls,[85]); calls.length=0;
  await render(100);assert.equal(slider.value,'100');assert.match(host.textContent,/0.0100 mm/);
  assert.match(host.textContent,/STEP \/ STP always exports exact CAD surfaces/);
  await act(async()=>slider.dispatchEvent(new window.Event('pointerup',{bubbles:true})));
  assert.deepEqual(calls,[]); // no remesh for an unchanged value
  await render(40);assert.equal(slider.value,'40');
});

test('display and mesh exports share preference; changing quality does not modify saved CAD geometry',()=>{
  const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
  assert.match(page,/referenceGeometry: referenceGeometryForViewport, meshQuality: globalSettings.meshQuality/);
  assert.match(page,/JSON.stringify\(\{ \.\.\.cadDocument, meshQuality: globalSettings.meshQuality \}\)/);
  const setting=readFileSync(new URL('../app/components/RenderQualitySetting.tsx',import.meta.url),'utf8');
  assert.match(setting,/onChange=\{\(event\) => setDraft/);
  assert.match(setting,/onPointerUp=\{commit\} onKeyUp=\{commit\} onBlur=\{commit\}/);
});
test('selected edge thickness slider immediately updates its value and orange sample',async t=>{
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const calls=[];
  const render=value=>root.render(React.createElement(EdgeHighlightSetting,{value,onChange:v=>{calls.push(v);render(v);}}));
  await act(async()=>render(4));t.after(async()=>{await act(async()=>root.unmount());host.remove();});
  const slider=host.querySelector('input');assert.equal(slider.getAttribute('aria-label'),'Selected edge thickness');
  assert.equal(slider.min,'1');assert.equal(slider.max,'10');
  await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(slider,'7.5');slider.dispatchEvent(new window.Event('input',{bubbles:true}));});
  assert.deepEqual(calls,[7.5]);assert.equal(host.querySelector('output').textContent,'7.5 px');
  assert.equal(host.querySelector('[aria-hidden] span').style.height,'7.5px');
});
