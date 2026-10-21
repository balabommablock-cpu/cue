import {build} from 'esbuild';
await build({entryPoints:['chatgpt-auth.mjs'],bundle:true,platform:'node',format:'esm',target:'node22',outfile:'chatgpt-auth.bundle.mjs'});
