import {packager} from '@electron/packager';
import {mkdir,rm,cp,readFile,writeFile,readdir,symlink,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildNative} from './build-native.mjs';
import {buildLauncher} from './build-launcher.mjs';
import {signDesktop} from './sign-desktop.mjs';

if(process.platform!=='darwin')throw new Error('Package the Mac app on macOS with Xcode Command Line Tools.');
const root=import.meta.dirname,stage=join(root,'dist','share-stage');
execFileSync('python3',['scripts/audit-public.py'],{cwd:root,stdio:'inherit'});
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
// Package only this manifest. Never include local accounts, workspaces or .env.
const files=['api-providers.mjs','api-desktop.cjs','chatgpt-auth.bundle.mjs','chatgpt-desktop.cjs','desktop.cjs','preload.cjs',
 'desktop-data.cjs','desktop-lifecycle.cjs','desktop-start.cjs','share-view.cjs','session-interrupts.cjs',
 'server.mjs','prompt.mjs','local-provider.mjs','codex-stream.mjs','speech-worker.mjs',
 'transcribe.py','answer-context.mjs','coaching.mjs','knowledge.mjs','knowledge-bank.mjs',
 'interview-workspace.mjs','background.json'];
for(const file of files)await cp(join(root,file),join(stage,file));
await cp(join(root,'public'),join(stage,'public'),{recursive:true});
const seed=JSON.parse(await readFile(join(stage,'public','seed.json'),'utf8'));
const background=JSON.parse(await readFile(join(stage,'background.json'),'utf8'));
if(seed.profile!==''||background.records.length||background.sources.length)throw new Error('Release defaults contain user context.');
await writeFile(join(stage,'package.json'),JSON.stringify({name:pkg.name,productName:'Cue',version:pkg.version,type:'module',main:'desktop.cjs',license:pkg.license,private:true},null,2));
await cp(join(root,'LICENSE'),join(stage,'LICENSE'));
let notices=await readFile(join(root,'THIRD_PARTY_NOTICES.md'),'utf8');
const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
for(const [location,data] of Object.entries(lock.packages)){
 if(!location)continue;const dir=join(root,location);
 for(const file of (await readdir(dir).catch(()=>[])).filter(f=>/^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/i.test(f))){
  const content=await readFile(join(dir,file),'utf8').catch(()=>null);
  if(content)notices+=`\n----- ${location.replace('node_modules/','')} ${data.version||''} / ${file} -----\n${content}\n`;
 }
}
await writeFile(join(stage,'THIRD_PARTY_NOTICES.txt'),notices);
const nativeApp=await buildNative(),launcher=await buildLauncher();
const [output]=await packager({dir:stage,name:'Cue',executableName:'Cue',appBundleId:'com.boredfolio.cue',appVersion:pkg.version,electronVersion:lock.packages['node_modules/electron'].version,platform:'darwin',arch:process.arch,out:join(root,'dist','share'),overwrite:true,asar:true,prune:false,icon:join(root,'assets','Cue.icns'),extraResource:[nativeApp,launcher],extendInfo:{LSMinimumSystemVersion:'14.2',NSMicrophoneUsageDescription:'Cue listens only when you start. On this Mac mode transcribes locally.',NSAudioCaptureUsageDescription:'Cue transcribes selected computer audio. Local mode processes it on this Mac.',NSScreenCaptureUsageDescription:'Cue uses screen recording for computer audio and optional Share View. Screen images are not sent to AI.'}});
const app=join(output,'Cue.app');await signDesktop(app);
const target=process.arch==='arm64'?'Apple-Silicon':'Intel';
const zip=join(root,'dist','share',`Cue-${pkg.version}-${target}.zip`);
await rm(zip,{force:true});execFileSync('ditto',['-c','-k','--sequesterRsrc','--keepParent',app,zip]);
const digest=createHash('sha256').update(await readFile(zip)).digest('hex');
await writeFile(zip+'.sha256',`${digest}  ${zip.split('/').at(-1)}\n`);
const dmgStage=join(root,'dist','dmg-stage'),dmg=join(root,'dist','share',`Cue-${pkg.version}-${target}.dmg`);
await rm(dmgStage,{recursive:true,force:true});await mkdir(dmgStage,{recursive:true});
try{
 execFileSync('ditto',[app,join(dmgStage,'Cue.app')]);
 await symlink('/Applications',join(dmgStage,'Applications'),'dir');
 await writeFile(join(dmgStage,'Install Cue.txt'),`Install Cue ${pkg.version}\n\n1. Drag Cue.app into Applications.\n2. Open Cue from Applications. You can then eject this disk image.\n3. Add your own context and choose your AI. Recording starts only when you choose Start listening.\n\nUpdating? Quit the old Cue app first and replace it in Applications. Your own saved context, accounts and downloaded models stay in your local app data.\n\nThis preview is ad-hoc signed and is not Apple notarized. macOS may block it. Do not disable your Mac's security protections. A normally signed public release is still pending.\n\nHelp and current downloads: https://github.com/balabommablock-cpu/cue\n`);
 await rm(dmg,{force:true});
 execFileSync('hdiutil',['create','-volname','Cue','-srcfolder',dmgStage,'-fs','HFS+','-format','UDZO','-ov',dmg],{stdio:'pipe'});
}finally{await rm(dmgStage,{recursive:true,force:true});}
const dmgDigest=createHash('sha256').update(await readFile(dmg)).digest('hex');
await writeFile(dmg+'.sha256',`${dmgDigest}  ${dmg.split('/').at(-1)}\n`);
const artifacts={zip:{file:zip.split('/').at(-1),bytes:(await stat(zip)).size,sha256:digest},dmg:{file:dmg.split('/').at(-1),bytes:(await stat(dmg)).size,sha256:dmgDigest}};
await writeFile(join(root,'dist','share','release-audit.json'),JSON.stringify({version:pkg.version,architecture:process.arch,seedProfileEmpty:true,backgroundRecords:0,signature:'ad-hoc; not Developer ID signed or notarized',sha256:digest,artifacts},null,2));
console.log(JSON.stringify({app,zip,dmg,artifacts,signature:'Ad-hoc only; not notarized'},null,2));
