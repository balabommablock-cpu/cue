import {SpeechLedger,rankStories,contextStories} from './story-core.js';
import {turnRoute} from './reading.js';

export class LiveCoach {
  constructor({request,getFacts,render,delay=2500}){Object.assign(this,{request,getFacts,render,delay});this.epoch=0;this.ledger=new SpeechLedger();this.enabled=true;this.question='';this.running=false;}
  begin(question){
    if(!this.enabled||!question?.trim()||question===this.question&&this.running)return;
    this.cancel();this.running=true;this.question=question;this.ledger.clear();this.map=null;this.lastSaid='';
    this.paint('Finding the shape of this question…');void this.update();
  }
  hear(item){if(!this.enabled||!this.running||!this.question||turnRoute({text:item.text||'',source:'mic',dual:true})==='ack')return;this.ledger.add(item);if(item.final){clearTimeout(this.timer);this.timer=null;}if(!this.timer)this.timer=setTimeout(()=>{this.timer=null;void this.update();},item.final?150:this.delay);}
  paint(status=''){
    const facts=this.getFacts();const story=facts.stories.find(s=>s.status==='confirmed'&&s.id===this.map?.storyId)||rankStories(this.question,facts.stories)[0];
    this.render({visible:this.enabled&&!!this.question,question:this.question,map:this.map,status,story:story?.title||''});
  }
  async update(){
    if(!this.running||!this.enabled)return;
    if(this.busy){this.pending=true;return;}
    const said=this.ledger.text();if(this.map&&said===this.lastSaid)return;
    const epoch=this.epoch;this.busy=true;this.pending=false;this.controller=new AbortController();
    this.paint(this.map?'Listening to your answer…':'Building your answer map…');
    try{
      const facts=this.getFacts();const value=await this.request('live',{...facts,stories:contextStories(facts.stories,this.question),question:this.question,said,...(this.map?{plan:this.map.steps.map(s=>({label:s.label}))}:{})},AbortSignal.any([this.controller.signal,AbortSignal.timeout(45000)]));
      if(epoch!==this.epoch)return;this.map=value;this.lastSaid=said;this.paint(this.ledger.text()!==said?'Catching up with your latest point…':said?'Based on what I heard':'Speak in your own words');
    }catch(e){if(epoch===this.epoch&&e.name!=='AbortError')this.paint('Coach unavailable · '+e.message);}
    finally{if(epoch===this.epoch){this.busy=false;if(this.pending||this.ledger.text()!==said){clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;void this.update();},150);}}}
  }
  snapshot(){return {question:this.question,map:this.map,turns:[...this.ledger.turns],lastSaid:this.lastSaid};}
  restore(saved,{running=true}={}){this.cancel();this.question=saved.question;this.map=saved.map;this.ledger.turns=new Map(saved.turns);this.lastSaid=saved.lastSaid;this.running=running&&this.enabled&&!!this.question;this.paint(this.running?'Original answer · place restored':'Recording off · last coaching update');}
  cancel(){this.epoch++;this.running=false;clearTimeout(this.timer);this.timer=null;this.controller?.abort();this.busy=false;this.pending=false;}
  stop(){this.cancel();this.paint('Recording off · last coaching update');}
  toggle(enabled){this.enabled=enabled;if(!enabled)this.cancel();this.paint(enabled?'Start listening to use live coaching':'');}
}

export function renderCoach($,state){
  $('coachCard').hidden=!state.visible;$('coachStatus').textContent=state.status;
  $('coachSteps').replaceChildren();
  for(const [i,step] of (state.map?.steps||[]).entries()){
    const chip=document.createElement('span');chip.className='coach-step'+(step.covered?' covered':'');chip.textContent=(step.covered?'✓':String(i+1))+' '+step.label;chip.title=step.evidence?'You said: '+step.evidence:'Not heard yet';$('coachSteps').append(chip);
  }
  $('coachNudge').textContent=state.map?.nudge||'You speak. I’ll keep track.';
  $('coachStory').textContent=state.story?'Story to draw on: '+state.story:'';$('coachStory').hidden=!state.story;
  const checks=state.map?.checks||[];$('coachCheck').hidden=!checks.length&&!state.map?.offTopic;
  $('coachCheck').textContent=checks.map(c=>c.message+' · Fact: '+c.reference).join('\n')+(state.map?.offTopic?'\nBring this back to the question: '+state.question:'');
}
