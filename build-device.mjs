import {build} from 'vite';
import {mkdir,cp,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=import.meta.dirname;
await build({configFile:false,root,base:'/device/',publicDir:false,worker:{format:'es'},build:{outDir:'public/device',emptyOutDir:true,target:'es2022',sourcemap:false,assetsInlineLimit:0,rollupOptions:{input:resolve(root,'device-src/runtime.js'),preserveEntrySignatures:'strict',output:{format:'es',entryFileNames:'runtime.js',chunkFileNames:'assets/[name]-[hash].js'}},chunkSizeWarningLimit:6500}});
const wasm=resolve(root,'public/device/wasm');await mkdir(wasm,{recursive:true});
const runtime=resolve(root,'node_modules/onnxruntime-web/dist');
for(const file of await readdir(runtime))if(/\.(?:wasm|mjs)$/.test(file))await cp(resolve(runtime,file),resolve(wasm,file));
