// Shows observed pipeline work and elapsed time, never a fabricated percentage.
export class ProgressView {
  constructor({$,now=()=>performance.now(),every=(fn,ms)=>setInterval(fn,ms),clear=id=>clearInterval(id),onChange=()=>{}}){Object.assign(this,{$,now,every,clear,onChange});this.stage='idle';}
  set(stage,detail=''){
    if(stage!==this.stage){this.stage=stage;this.since=this.now();}
    const labels={idle:'Ready when you are',start:'Starting',listen:'Listening',speech:'Hearing the question',transcribe:'Transcribing',match:'Reading the question',draft:'Preparing your answer',switch:'Switching to the follow-up',write:'Writing your answer',ready:'Answer ready',hold:'Next answer ready',paused:'Listening paused',error:'Needs attention',stopped:'Recording off'};
    const label=labels[stage]||stage;
    this.$('processLabel').textContent=label;this.$('processDetail').textContent=detail.replace(/[.…]+$/,'').toLowerCase()===label.toLowerCase()?'':detail;
    this.$('processStrip').setAttribute('data-state',stage);
    this.clear(this.timer);this.timer=null;
    const working=['start','speech','transcribe','match','draft','switch','write'].includes(stage);
    const tick=()=>{this.$('processTime').textContent=working?((this.now()-this.since)/1000).toFixed(1)+'s':'';};tick();
    if(working)this.timer=this.every(tick,100);
    this.onChange(stage);
  }
}
