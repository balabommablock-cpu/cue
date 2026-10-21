import {STORY_FIELDS,cleanStory,contextStories} from './story-core.js';
import {VoiceNotes} from './voice-notes.js';

export class StoryStudio {
  constructor({$,read,request,getProfile,getSettings,stopInterview,transcribe,onChange=()=>{},storage=localStorage}){
    Object.assign(this,{$,request,getProfile,getSettings,stopInterview,transcribe,onChange,storage});this.stories=[];this.history=[];this.practiceEpoch=0;
    this.loadStories(read);
    $('storyNotes').value=read('storyNotes','');this.selected='';
    const voice=target=>new VoiceNotes({getSettings,transcribe,onText:text=>{
      const field=$(target),limit=target==='storyNotes'?60000:18000;field.value=(field.value+'\n'+text).trim().slice(0,limit);
      if(target==='storyNotes')this.saveNotes();else this.invalidatePractice();if(field.value.length>=limit){void this.recorder?.finish();this.message('Text limit reached. Review this batch before recording more.');}
    },onState:text=>{$('studioRecording').textContent=text;$(target==='storyNotes'?'storyRecording':'practiceRecording').textContent=text;this.recordButtons(!!this.recorder?.active);const finishing=text==='Finishing transcription…';$('recordStory').disabled=finishing;$('recordPractice').disabled=finishing||!!this.practiceBusy;},onError:e=>this.message(e.message)});
    this.memo=voice('storyNotes');this.practiceVoice=voice('practiceAnswer');
    $('storiesButton').onclick=()=>this.open('storiesDialog');$('practiceButton').onclick=()=>this.open('practiceDialog');
    for(const [dialog,close] of [['storiesDialog','closeStories'],['practiceDialog','closePractice']]){$(close).onclick=()=>{this.close();$(dialog).close();};$(dialog).addEventListener('cancel',()=>this.close());}
    $('recordStory').onclick=()=>void this.record(this.memo);$('recordPractice').onclick=()=>void this.record(this.practiceVoice);
    $('storyNotes').oninput=()=>this.saveNotes();$('extractStories').onclick=()=>void this.extract();$('newStory').onclick=()=>this.edit();
    $('storyForm').onsubmit=e=>{e.preventDefault();this.saveStory();};$('deleteStory').onclick=()=>this.remove();
    $('practiceStart').onclick=()=>void this.practice(true);$('practiceReview').onclick=()=>void this.practice(false);
    $('practiceAnswer').oninput=()=>this.invalidatePractice();
    $('practiceNext').onclick=()=>{if(!this.nextQuestion||this.practiceBusy)return;if(this.reviewedAnswer!==$('practiceAnswer').value){this.invalidatePractice();return;}this.history.push({question:this.question,answer:this.reviewedAnswer});this.history=this.history.slice(-6);this.question=this.nextQuestion;this.nextQuestion='';$('practiceFollowUp').textContent='';$('practiceQuestion').textContent=this.question;$('practiceAnswer').value='';$('practiceNext').hidden=true;$('practiceFeedback').replaceChildren();$('practiceReview').disabled=false;$('practiceAnswer').focus();};
    this.list();this.edit();
  }
  message(text=''){this.$('studioMessage').textContent=text;this.$('storySaveMessage').textContent=text;this.$('practiceMessage').textContent=text;}
  loadStories(read){
    let source,raw,damaged=false;
    try{raw=this.storage.getItem('cue.stories');source=raw?JSON.parse(raw):read('stories',[]);if(!Array.isArray(source))throw new Error('Invalid library');
      for(const entry of source.slice(0,30)){try{const story=cleanStory(entry);if(!story.id||this.stories.some(s=>s.id===story.id))throw new Error('Invalid story identity');this.stories.push(story);}catch{damaged=true;}}
    }catch{damaged=true;}
    if(damaged){try{if(raw&&!this.storage.getItem('cue.stories.recovery'))this.storage.setItem('cue.stories.recovery',raw);}catch{this.storageBlocked=true;}
      this.libraryWarning='Some saved stories could not be read. The original library has been kept for recovery; readable stories are still available.';this.message(this.libraryWarning);}
  }
  persist(next=this.stories){try{if(this.storageBlocked)throw new Error('Recovery unavailable');this.storage.setItem('cue.stories',JSON.stringify(next));this.stories=next;this.onChange();return true;}catch{this.message('Could not save stories on this device. Keep this window open and copy your text.');return false;}}
  saveNotes(){try{this.storage.setItem('cue.storyNotes',JSON.stringify(this.$('storyNotes').value));}catch{this.message('Could not save these notes. Copy the text before closing.');}}
  open(id){this.stopInterview();this.close();this.$(id).showModal();this.list();this.message(this.libraryWarning||'');}
  close(){this.recorder?.cancel();this.recorder=null;this.memo.cancel();this.practiceVoice.cancel();this.extractController?.abort();this.practiceController?.abort();this.practiceEpoch++;this.$('extractStories').disabled=false;this.lockPractice(false);}
  resetPractice(){
    this.close();this.history=[];this.question='';this.nextQuestion='';this.reviewedAnswer='';
    for(const id of ['practiceQuestion','practiceFollowUp','practiceFocus','practiceRecording'])this.$(id).textContent='';
    this.$('practiceAnswer').value='';this.$('practiceFeedback').replaceChildren();this.$('practiceNext').hidden=true;
    this.lockPractice(false);this.message('');
  }
  lockPractice(busy){this.practiceBusy=busy;this.$('practiceAnswer').readOnly=busy;this.$('recordPractice').disabled=busy;this.$('practiceStart').disabled=busy;this.$('practiceReview').disabled=busy||!!this.nextQuestion;this.$('practiceNext').disabled=busy;}
  invalidatePractice(){if(!this.nextQuestion)return;this.nextQuestion='';this.reviewedAnswer='';this.$('practiceNext').hidden=true;this.$('practiceFollowUp').textContent='';this.$('practiceFeedback').replaceChildren();this.$('practiceFocus').textContent='';this.$('practiceReview').disabled=!!this.practiceBusy;this.message('Answer changed. Review it again for a matching follow-up.');}
  recordButtons(active){this.$('recordStory').textContent=active&&this.recorder===this.memo?'■ Stop recording':'Record a memory';this.$('recordPractice').textContent=active&&this.recorder===this.practiceVoice?'■ Stop recording':'Speak your answer';}
  async record(recorder){
    if(recorder===this.practiceVoice&&this.practiceBusy)return;
    this.message('');if(this.recorder===recorder&&recorder.active){this.recordButtons(false);await recorder.finish();return;}
    this.recorder?.cancel();this.stopInterview();this.recorder=recorder;this.recordButtons(true);await recorder.start();this.recordButtons(recorder.active);
  }
  list(){
    const $=this.$;$('storyList').replaceChildren();$('storyCount').textContent=this.stories.filter(s=>s.status==='confirmed').length+' confirmed · '+this.stories.filter(s=>s.status!=='confirmed').length+' drafts';
    for(const story of this.stories){const button=document.createElement('button');button.type='button';button.className='story-card'+(story.id===this.selected?' selected':'');const title=document.createElement('strong'),state=document.createElement('small');title.textContent=story.title;state.textContent=story.status==='confirmed'?'Confirmed · available during calls':'Draft · review before use';button.append(title,state);button.onclick=()=>this.edit(story);$('storyList').append(button);}
    $('storyEmpty').hidden=!!this.stories.length;
  }
  edit(story){this.selected=story?.id||'';for(const field of STORY_FIELDS)this.$('story_'+field).value=story?.[field]||'';this.$('story_tags').value=story?.tags.join(', ')||'';this.$('confirmStory').checked=false;this.$('storySource').textContent=story?.sourceQuote?'From your notes: “'+story.sourceQuote+'”':'';this.$('storyMissing').textContent=story?.followUps.length?'Before confirming: '+story.followUps.join(' '):'';this.$('deleteStory').hidden=!story;this.$('storyEditorTitle').textContent=story?'Review this experience':'Add an experience';this.list();}
  saveStory(){
    const $=this.$;try{
      if(!this.selected&&this.stories.length>=30)throw new Error('Your library holds 30 stories. Remove a draft before adding another.');
      const old=this.stories.find(s=>s.id===this.selected),fields=Object.fromEntries(STORY_FIELDS.map(k=>[k,$('story_'+k).value]));
      const story=cleanStory({...old,...fields,id:this.selected||crypto.randomUUID(),tags:$('story_tags').value.split(',').map(s=>s.trim()).filter(Boolean),status:$('confirmStory').checked?'confirmed':'draft'});
      if(story.status==='confirmed'&&(!story.situation||!story.action))throw new Error('Add the situation and what you personally did before confirming. Unknown outcomes can stay empty.');
      const next=old?this.stories.map(s=>s.id===old.id?story:s):[...this.stories,story];if(this.persist(next)){this.edit(story);this.message(story.status==='confirmed'?'Confirmed and saved. Cue can now draw on this experience.':'Draft saved. It will not be used in live answers.');}
    }catch(e){this.message(e.message);}
  }
  remove(){const old=this.stories.find(s=>s.id===this.selected);if(!old)return;if(this.persist(this.stories.filter(s=>s.id!==old.id))){this.message('Story removed.');this.edit();}}
  async extract(){
    const $=this.$;this.message('');$('extractStories').disabled=true;
    this.extractController?.abort();const controller=new AbortController();this.extractController=controller;
    try{
      await this.recorder?.finish();if(controller.signal.aborted)return;
      this.message('Finding the distinct experiences in your notes…');
      const result=await this.request('extract',{profile:'',stories:[],notes:$('storyNotes').value},AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]));if(controller.signal.aborted)return;
      const fresh=result.stories.filter(s=>!this.stories.some(old=>old.sourceQuote&&old.sourceQuote===s.sourceQuote)).slice(0,30-this.stories.length).map(s=>cleanStory({...s,id:crypto.randomUUID(),status:'draft'}));
      const saved=this.persist([...this.stories,...fresh]);if(saved&&fresh[0])this.edit(fresh[0]);this.list();if(saved)this.message(fresh.length?fresh.length+' drafts saved. Review the details and missing questions before confirming.':this.stories.length>=30?'Your library holds 30 stories. Remove a draft before adding another.':'No new distinct experiences found. Add a specific incident, what you did, and what happened.');
    }catch(e){if(!controller.signal.aborted)this.message(e.name==='TimeoutError'?'Story extraction timed out. Your notes are saved; try again.':e.message);}finally{if(this.extractController===controller)$('extractStories').disabled=false;}
  }
  async practice(fresh){
    const $=this.$;this.practiceController?.abort();const epoch=++this.practiceEpoch,controller=new AbortController();this.practiceController=controller;
    this.lockPractice(true);this.message('');
    try{
      await this.recorder?.finish();if(epoch!==this.practiceEpoch)return;
      if(!fresh&&!this.question)throw new Error('Start a new interview first.');
      if(!fresh&&!$('practiceAnswer').value.trim())throw new Error('Speak or type your answer first.');
      const said=fresh?'':$('practiceAnswer').value;
      this.message(fresh?'Choosing your opening question…':'Reviewing what you actually said…');
      const result=await this.request('practice',{profile:this.getProfile(),stories:contextStories(this.stories,fresh?'':this.question),question:fresh?'':this.question,said,history:fresh?[]:this.history},AbortSignal.any([controller.signal,AbortSignal.timeout(60000)]));
      if(epoch!==this.practiceEpoch)return;
      if(fresh){this.history=[];this.nextQuestion='';this.reviewedAnswer='';$('practiceFollowUp').textContent='';$('practiceAnswer').value='';$('practiceFeedback').replaceChildren();$('practiceNext').hidden=true;this.question=result.question;$('practiceQuestion').textContent=result.question;$('practiceAnswer').focus();}
      else{this.reviewedAnswer=said;this.nextQuestion=result.question;$('practiceFeedback').replaceChildren();for(const item of result.feedback){const p=document.createElement('p'),quote=document.createElement('q'),comment=document.createElement('span');quote.textContent=item.quote;comment.textContent=item.comment;p.append(quote,comment);$('practiceFeedback').append(p);}$('practiceFollowUp').textContent=result.question;$('practiceNext').hidden=false;}
      $('practiceFocus').textContent=result.nextFocus;this.message('');
    }catch(e){if(epoch===this.practiceEpoch&&!controller.signal.aborted)this.message(e.message);}
    finally{if(epoch===this.practiceEpoch)this.lockPractice(false);}
  }
}
