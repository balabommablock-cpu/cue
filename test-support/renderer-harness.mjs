// A simulated DOM, clock and network around the actual renderer modules.
// This is fault injection, not browser or physical-audio verification.
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';

export const tick=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
export function channel(){
 let control;const body=new ReadableStream({start(c){control=c;}}),encoder=new TextEncoder();
 return {response:new Response(body,{headers:{'Content-Type':'application/x-ndjson'}}),
   send:event=>control.enqueue(encoder.encode(JSON.stringify(event)+'\n')),
   raw:text=>control.enqueue(encoder.encode(text)),close:()=>control.close(),error:e=>control.error(e)};
}
export async function renderer({fetch:override,prefs={},native}={}){
 const elements=new Map(),timers=new Map(),rafs=new Map();let id=0;
 class Element{
  constructor(name){this.name=name;this.textContent='';this.value='';this.hidden=false;this.disabled=false;this.checked=false;this.options=[];this.events={};this.scrollTop=0;this.scrollHeight=1600;this.clientHeight=300;this.open=false;this.classList={add(){},remove(){},toggle(){}};this.style={setProperty(){}};}
  addEventListener(name,fn){this.events[name]=fn;}setAttribute(){}focus(){}close(){this.open=false;}showModal(){this.open=true;}
  replaceChildren(...values){this.options=values;}append(...v){this.options.push(...v);}add(v){this.options.push(v);}click(){return this.onclick?.();}
  getBoundingClientRect(){return {top:0};}get firstChild(){return {nodeType:3,textContent:this.textContent};}
 }
 const el=name=>{if(!elements.has(name))elements.set(name,new Element(name));return elements.get(name);};
 const requests=[],store=new Map(Object.entries({source:'text',provider:'codex',...prefs}).map(([k,v])=>['cue.'+k,JSON.stringify(v)]));
 const context=vm.createContext({console,crypto:webcrypto,URL,Response,TextDecoder,TextEncoder,AbortController,AbortSignal,DOMException,performance,Float32Array,Uint8Array,DataView,Set,Map,
  window:{addEventListener(){},cueDesktop:native},document:{getElementById:el,createElement:tag=>new Element(tag),body:el('body'),documentElement:el('root'),addEventListener(){},createRange(){return {setStart(_text,offset){this.offset=offset;},setEnd(){},getBoundingClientRect(){return {top:this.offset*2};}};}},
  localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},Option:class{constructor(text,value){this.text=text;this.value=value;}},
  navigator:{mediaDevices:{enumerateDevices:async()=>[]}},AudioContext:class{},MediaStream:class{},matchMedia:()=>({matches:true}),
  requestAnimationFrame:fn=>{rafs.set(++id,fn);return id;},cancelAnimationFrame:n=>rafs.delete(n),
  setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:n=>timers.delete(n),
  setInterval:function(fn,ms){if(this!==undefined&&this!==context)throw new TypeError('Illegal invocation');timers.set(++id,{fn,ms,repeat:true});return id;},clearInterval:function(n){if(this!==undefined&&this!==context)throw new TypeError('Illegal invocation');return timers.delete(n);},
  fetch:async(url,init)=>{
   requests.push({url,init});const value=await override?.(url,init);if(value!==undefined)return value;
   if(url==='/seed.json')return Response.json({profile:'Synthetic candidate. Built a product with a small team.',demo:{question:'Demo?',answer:'Demo answer.',cues:'Demo cues.'}});
   if(url==='/api/interviews')return Response.json({legacy:true,interviews:[]});
   if(url==='/api/background')return Response.json({records:[],sources:[],applicationSections:0,applicationFields:0});
   if(url==='/api/config')return Response.json({keyConfigured:false,localAudioAvailable:true});
   if(url==='/platforms.json')return Response.json({platforms:[]});
   if(url==='/api/codex/check')return Response.json({sessionId:'synthetic-session'});
   if(url==='/api/codex/stop')return Response.json({});
   throw new Error('Unexpected network call: '+url);
  },
 });
 const cache=new Map();let moduleId=0;
 async function load(name){
  if(cache.has(name))return cache.get(name);
  let source=await readFile(new URL('../public/'+name,import.meta.url),'utf8');const exports=[];
  for(const match of [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/([^'"]+)['"];?/g)]){
   const dep=await load(match[2]);const key='__module'+moduleId++;context[key]=dep;
   source=source.replace(match[0],`const {${match[1]}}=${key};`);
  }
  source=source.replace(/export\s+(?=(?:async\s+)?function|class|const|let)/g,'');
  const original=await readFile(new URL('../public/'+name,import.meta.url),'utf8');
  for(const match of original.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let)\s+(\w+)/g))exports.push(match[1]);
  if(name==='app.js'){vm.runInContext(source,context,{filename:name});return;}
  const result=vm.runInContext(`(()=>{${source}\nreturn {${exports.join(',')}};})()`,context,{filename:name});cache.set(name,result);return result;
 }
 await load('app.js');await tick();
 return {el,requests,run:code=>vm.runInContext(code,context),async advance(ms){for(const [key,timer] of [...timers])if(timer.ms<=ms){if(!timer.repeat)timers.delete(key);timer.fn();}await tick();},animate(ms){let now=performance.now();for(let elapsed=0;elapsed<ms;elapsed+=16){now+=16;for(const [key,fn] of [...rafs]){rafs.delete(key);fn(now);}}},close(){vm.runInContext('stop()',context);}};
}
