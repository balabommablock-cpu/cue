import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createKnowledge} from './knowledge.mjs';

// Read and index at startup or on explicit reload only. Live retrieval delegates
// directly to the in-memory index: no disk reads, network or extra model call.
export function openKnowledgeBank({directory,seed}){
  mkdirSync(directory,{recursive:true,mode:0o700});
  const file=join(directory,'background.json');
  let current=createKnowledge(seed),warning='';
  if(!existsSync(file))writeFileSync(file,JSON.stringify(seed,null,2)+'\n',{flag:'wx',mode:0o600});
  function reload(){
    try{
      const candidate=createKnowledge(JSON.parse(readFileSync(file,'utf8')));
      current=candidate;warning='';
    }catch{
      // Never overwrite a damaged user bank or replace a valid loaded index.
      warning='Saved knowledge could not be loaded. Cue is using the last valid background. Check background.json in your saved knowledge folder.';
    }
    return summary();
  }
  function summary(){return {...current.summary(),persistent:true,warning};}
  reload();
  return {directory,reload,retrieve:(...args)=>current.retrieve(...args),summary,view:()=>({...current.view(),persistent:true,warning})};
}
