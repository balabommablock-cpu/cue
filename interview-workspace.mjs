import {readFileSync,writeFileSync,mkdirSync,readdirSync,renameSync,existsSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createKnowledge} from './knowledge.mjs';
const validId=id=>typeof id==='string'&&/^[a-z0-9][a-z0-9-]{0,79}$/.test(id);
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const readJSON=file=>JSON.parse(readFileSync(file,'utf8'));
function save(file,value){const temp=file+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});renameSync(temp,file);}

// Independent in-memory indexes. Company materials never enter another index.
export function openInterviewWorkspace({directory}){
 if(!isAbsolute(directory))throw error('The interview folder must use an absolute path.');
 let entries=new Map(),warning='',defaultId='personal';
 function reload(){
  try{
   const shared=readJSON(join(directory,'shared','background.json'));
   const profile=readFileSync(join(directory,'shared','profile.txt'),'utf8').trim();
   const manifest=readJSON(join(directory,'workspace.json'));
   const next=new Map();
   for(const folder of readdirSync(join(directory,'interviews'),{withFileTypes:true})){
    if(!folder.isDirectory()||!validId(folder.name))continue;
    const root=join(directory,'interviews',folder.name),meta=readJSON(join(root,'interview.json'));
    if(meta.id!==folder.name||typeof meta.name!=='string'||!meta.name.trim()||meta.name.length>150||typeof meta.context!=='string'||meta.context.length>20000)throw error('Invalid interview details.');
    const own=readJSON(join(root,'background.json'));
    createKnowledge(shared);createKnowledge(own);
    const combined={...own,id:meta.id,records:[...shared.records,...own.records],sources:[...shared.sources,...own.sources.filter(s=>!shared.sources.some(x=>x.id===s.id))],note:[shared.note,own.note].filter(Boolean).join('\n')};
    const base=createKnowledge(combined);
    const factSheet=profile+'\n\nCURRENT INTERVIEW: '+meta.name+'\n'+meta.context;
    if(factSheet.length>39000)throw error('Interview fact sheet is too large.');
    next.set(meta.id,{...base,meta:{id:meta.id,name:meta.name},profile:factSheet,root,view:()=>({...base.view(),persistent:true,warning,interviewName:meta.name,profile:factSheet})});
   }
   if(!next.size||!next.has(manifest.defaultId))throw error('Default interview is missing.');
   entries=next;defaultId=manifest.defaultId;warning='';
  }catch(e){if(!entries.size)throw error('The interview workspace could not load. Check its files before starting Cue.',503);warning='Saved interview files could not reload. The last valid interview contexts are still loaded.';}
  return {warning};
 }
 function get(id){if(!validId(id)||!entries.has(id))throw error('Choose an existing interview. No background was substituted.',404);return entries.get(id);}
 function list(){return {defaultId,warning,interviews:[...entries.values()].map(e=>e.meta)};}
 function create({name,context=''}){
  if(typeof name!=='string'||!name.trim()||name.trim().length>150||typeof context!=='string'||context.length>20000)throw error('Use a name under 150 characters and notes under 20,000 characters.');
  if(entries.size>=100)throw error('The workspace already contains 100 interviews.');
  const id=(name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50)||'interview')+'-'+randomUUID().slice(0,8),root=join(directory,'interviews',id);
  mkdirSync(root,{recursive:true,mode:0o700});
  const note=context.trim()||'No role, application or company research supplied yet. Ask for missing specifics; do not assume the candidate is applying as a founder.';
  save(join(root,'interview.json'),{id,name:name.trim(),context:note});
  save(join(root,'background.json'),{schemaVersion:1,id,sources:[],records:[],applicationSections:0,applicationFields:0,note:'This interview uses shared career facts plus its own notes. No application has been imported.'});
  writeFileSync(join(root,'Mock Interview.md'),`# ${name.trim()}\n\nRead ../../shared/Career Context.md and this folder's interview.json and background.json. Ask one question at a time. Distinguish confirmed career facts from application claims. Do not invent details.\n\n## Interview notes\n\n${note}\n`,{mode:0o600});
  reload();get(id);return {id,...list()};
 }
 function mockPath(id){const file=join(get(id).root,'Mock Interview.md');if(!existsSync(file))throw error('This interview has no mock interview file yet.');return file;}
 reload();return {directory,list,get,create,reload,mockPath};
}
export async function loadConfiguredWorkspace(knowledgeDirectory){
 const file=join(knowledgeDirectory,'workspace.json');
 if(!existsSync(file))return null;
 const value=readJSON(file);
 // Let the native run loop handle macOS protected-folder access before indexing.
 if(typeof value.directory!=='string'||!isAbsolute(value.directory))throw error('Invalid interview workspace path.');
 await readFile(join(value.directory,'shared','background.json'),'utf8');
 return openInterviewWorkspace({directory:value.directory});
}
