import assert from 'node:assert/strict';
import test from 'node:test';
import React, {act} from 'react';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {ThemeSettings} from '../app/components/ThemeSettings.tsx';
import {normalizeTheme, THEME_PRESETS, themeCssVariables} from '../app/components/themes.ts';
import {DEFAULT_GLOBAL_SETTINGS, normalizeGlobalSettings, parseGlobalSettings} from '../app/components/appSettings.ts';
import {parseLucasCadProject, serializeLucasCadProject} from '../app/components/projectFile.ts';

const dom=new JSDOM('<!doctype html><body></body>');
Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true,React});
const {createRoot}=await import('react-dom/client');

test('Tron preserves dark cyan defaults; Old School supplies a blue/white gradient with neutral gray solids',()=>{
  assert.equal(DEFAULT_GLOBAL_SETTINGS.theme.preset,'tron');
  assert.equal(DEFAULT_GLOBAL_SETTINGS.theme.colors.model,'#3097bd');
  assert.match(themeCssVariables(THEME_PRESETS.tron)['--model-background'],/^radial-gradient/);
  assert.match(themeCssVariables(THEME_PRESETS['old-school'])['--model-background'],/^linear-gradient\(to bottom/);
  assert.equal(THEME_PRESETS['old-school'].colors.model,'#a0a0a0');
  assert.equal(themeCssVariables({...THEME_PRESETS.tron,backgroundStyle:'solid'})['--model-background'],'#26313c');
});

test('unfinished sketch geometry uses the visible theme color, not white, in every creation tool',()=>{
  const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');
  const preview=css.match(/\.sketch-preview>\*\{([^}]+)\}/)[1];
  assert.match(preview,/stroke:var\(--theme-sketch,#55b9e8\)/);
  assert.match(preview,/stroke-width:1\.6/);
  assert.match(preview,/stroke-dasharray:5 3/);
  const luminance=hex=>{const rgb=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
  for(const theme of Object.values(THEME_PRESETS)){
    const vars=themeCssVariables(theme),a=luminance(vars['--theme-sketch']),b=luminance(vars['--theme-sketch-background']);
    assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=3,`${theme.preset} preview contrast`);
  }
  const custom=normalizeTheme({preset:'old-school',colors:{sketch:'#194a82'}});
  assert.equal(themeCssVariables(custom)['--theme-sketch'],'#194a82');
});

test('theme validation rejects malformed/injected colors and never mutates presets',()=>{
  const theme=normalizeTheme({preset:'old-school',backgroundStyle:'invalid',colors:{model:'#AABBCC',backgroundTop:'url(https://invalid)',grid:null}});
  assert.equal(theme.colors.model,'#aabbcc');assert.equal(theme.colors.backgroundTop,'#879bb7');assert.equal(theme.backgroundStyle,'linear');
  theme.colors.model='#ffffff';assert.equal(THEME_PRESETS['old-school'].colors.model,'#a0a0a0');
  assert.deepEqual(parseGlobalSettings('broken').theme,THEME_PRESETS.tron);
  assert.deepEqual(parseGlobalSettings('{"unitSystem":"imperial"}').theme,THEME_PRESETS.tron);
});

test('complete customized preferences round-trip with model JSON and startup browser preferences',()=>{
  const settings=normalizeGlobalSettings({theme:{...THEME_PRESETS['old-school'],colors:{...THEME_PRESETS['old-school'].colors,model:'#cda765',backgroundTop:'#112233'}},unitSystem:'imperial',meshQuality:95,selectedEdgeWidthPx:9,sketchDimensionTextScale:.75,sketchNodeDiameterPx:7,sketchHighlightWidthPx:2.3,sketchGridSizeMm:2.54});
  const model={sketches:[{id:'s',plane:'XY',entities:[]}],features:[{id:'e',type:'extrude',distance:42}],referenceGeometry:[]};
  const file=parseLucasCadProject(serializeLucasCadProject(model,settings));
  assert.deepEqual(file.metadata.settings,settings);
  assert.deepEqual(parseGlobalSettings(JSON.stringify(file.metadata.settings)),settings);
  assert.deepEqual(file.features,model.features);assert.equal(file.units,'mm');
  assert.equal(parseLucasCadProject(JSON.stringify(model)).metadata,undefined);
  assert.deepEqual(parseLucasCadProject(serializeLucasCadProject(model)).metadata.settings,DEFAULT_GLOBAL_SETTINGS);
  const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
  assert.match(page,/serializeLucasCadProject\(cadDocument, globalSettings\)/);
  assert.match(page,/if \(project.metadata\?\.settings\) updateGlobalSettings\(project.metadata.settings\)/);
  assert.match(page,/parseGlobalSettings\(window.localStorage.getItem\(GLOBAL_SETTINGS_STORAGE_KEY\)\)/);
});

test('Themes submenu switches presets, edits every color live, resets and collapses',async t=>{
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);let value=normalizeTheme(THEME_PRESETS.tron);
  const render=()=>root.render(React.createElement(ThemeSettings,{value,onChange:next=>{value=next;render();}}));
  await act(async()=>render());t.after(async()=>{await act(async()=>root.unmount());host.remove();});
  const toggle=host.querySelector('button');assert.equal(toggle.getAttribute('aria-expanded'),'false');
  await act(async()=>toggle.click());
  await act(async()=>host.querySelectorAll('.theme-presets button')[1].click());
  assert.equal(value.preset,'old-school');assert.equal(host.querySelector('[aria-label="Background style"]').value,'linear');
  const inputs=[...host.querySelectorAll('input[type="color"]')];assert.equal(inputs.length,Object.keys(value.colors).length);
  for (const input of inputs) await act(async()=>{
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,'#123456');
    input.dispatchEvent(new window.Event('input',{bubbles:true}));
  });
  for (const color of Object.values(value.colors)) assert.equal(color,'#123456');
  await act(async()=>{const select=host.querySelector('select');select.value='solid';select.dispatchEvent(new window.Event('change',{bubbles:true}));});
  assert.equal(value.backgroundStyle,'solid');
  await act(async()=>host.querySelector('.theme-reset').click());assert.deepEqual(value,THEME_PRESETS['old-school']);
  await act(async()=>host.querySelectorAll('.theme-presets button')[0].click());assert.deepEqual(value,THEME_PRESETS.tron);
  await act(async()=>toggle.click());assert.equal(host.querySelector('.theme-submenu'),null);
});
