export function reconcileProfile(profile){ return profile; }
export function backgroundFacts(pack){return (pack?.records||[]).filter(r=>r.kind==='fact').map(r=>r.title+': '+r.text).join('\n\n');}
export function renderBackground($,pack,search=''){
 const list=$('backgroundList');list.replaceChildren();
 const names=Object.fromEntries((pack.sources||[]).map(s=>[s.id,s.title]));
 const query=search.trim().toLowerCase();
 const records=(pack.records||[]).filter(r=>(r.title+' '+r.text+' '+r.topics).toLowerCase().includes(query));
 const labels={fact:'Supported background',record:'Submitted field',application:'Submitted answer · confirm details',preference:'Writing preference',reference:'Interpretation',research:'External research · dated source'};
 for(const record of records){
  const card=document.createElement('details'),title=document.createElement('summary'),meta=document.createElement('p'),text=document.createElement('p');
  card.className='background-entry';title.textContent=record.title;meta.className='help';meta.textContent=(labels[record.kind]||'Reference')+' · '+(names[record.source]||record.source);text.textContent=record.text;
  card.append(title,meta,text);if(record.note){const note=document.createElement('p');note.className='help';note.textContent=record.note;card.append(note);}list.append(card);
 }
 if(!records.length){const empty=document.createElement('p');empty.className='help';empty.textContent='No matching background entries.';list.append(empty);}
 $('backgroundCount').textContent=`${records.length} of ${(pack.records||[]).length} entries`;
}
