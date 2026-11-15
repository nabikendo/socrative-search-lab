import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/lib/theme.js', import.meta.url), 'utf8')
  .replaceAll('export function ', 'function ');
function harness(initial = {}) {
  const values = new Map(Object.entries(initial));
  const attrs = new Map();
  const root = {
    dataset: {},
    setAttribute(key,value) { attrs.set(key,value); },
    removeAttribute(key) { attrs.delete(key); if(key==='data-theme')delete this.dataset.theme; },
    toggleAttribute(key,on) { if(on)attrs.set(key,'');else attrs.delete(key); }
  };
  const document = { documentElement:root, querySelectorAll:()=>[] };
  const localStorage = { getItem:key=>values.get(key)??null, setItem:(key,value)=>values.set(key,value) };
  const window = { dispatchEvent(){} };
  const context = vm.createContext({ document, localStorage, window, CustomEvent:class { constructor(type,options){this.type=type;this.detail=options.detail;} } });
  vm.runInContext(source+'\nthis.api={getAppearance,setAppearance,applySavedTheme,toggleTheme}',context);
  return { ...context.api,root,attrs,values };
}
test('theme cycle light → dark → auto → light',()=>{
  const h=harness({'atlas.theme':'light'});
  assert.equal(h.toggleTheme(),'dark');assert.equal(h.root.dataset.theme,'dark');
  assert.equal(h.toggleTheme(),'auto');assert.equal(h.root.dataset.theme,undefined);
  assert.equal(h.toggleTheme(),'light');assert.equal(h.root.dataset.theme,'light');
});
test('appearance persists across new sessions',()=>{
  const h=harness();h.setAppearance({theme:'dark',fontSize:'large',highContrast:true,compact:true});
  const next=harness(Object.fromEntries(h.values));
  next.applySavedTheme();
  assert.equal(next.root.dataset.theme,'dark');
  assert.equal(next.root.dataset.fontSize,'large');
  assert.equal(next.attrs.has('data-high-contrast'),true);
  assert.equal(next.attrs.has('data-compact'),true);
});
test('automatic mode leaves OS color scheme in control',()=>{
  const h=harness({'atlas.theme':'auto'});
  h.applySavedTheme();
  assert.equal(h.root.dataset.theme,undefined);
});
test('presentation independent of selected theme',()=>{
  const h=harness({'atlas.theme':'light'});
  h.setAppearance({presentation:true});
  assert.equal(h.root.dataset.theme,'light');
  assert.equal(h.attrs.has('data-presentation'),true);
});
