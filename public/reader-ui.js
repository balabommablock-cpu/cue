import {matchReading,words} from './reading.js';

export class VoiceReader {
  constructor({frame,answer,state,resume,getMode,getHint=()=>'',getSpeed=()=>18,canScroll=()=>true}){
    Object.assign(this,{frame,answer,state,resume,getMode,getHint,getSpeed,canScroll});this.cursor=0;this.held=false;
    // Focusing/clicking the script is not a request to stop the teleprompter.
    for(const event of ['wheel','touchmove'])frame.addEventListener(event,()=>this.hold(5000),{passive:true});
    frame.addEventListener('pointerdown',e=>{const box=frame.getBoundingClientRect();if(e.target===frame&&frame.scrollHeight>frame.clientHeight&&e.clientX>=box.right-14)this.hold(5000);},{passive:true});
    frame.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(e.key))this.hold(5000);});
    resume.onclick=()=>{clearTimeout(this.holdTimer);this.held=false;this.resume.hidden=true;if(this.getMode()==='steady')this.describe();else{this.state.textContent=this.cursor?'Following your voice':'Speak to follow';this.follow();}};
  }
  reset(){this.stop();this.cursor=0;this.held=false;this.overflowSince=null;this.resume.hidden=true;this.frame.scrollTop=0;this.describe();}
  stop(){cancelAnimationFrame(this.animation);this.animation=0;clearTimeout(this.holdTimer);}
  hold(duration=Infinity){this.stop();this.holdUntil=performance.now()+duration;if(this.getMode()!=='manual'){this.held=true;this.resume.hidden=false;this.state.textContent='Manual position';if(Number.isFinite(duration))this.holdTimer=setTimeout(()=>{if(this.held)this.resume.onclick();},duration);}}
  describe(){
    this.stop();this.resume.hidden=!this.held||this.getMode()==='manual';
    if(this.getMode()==='voice'&&this.getHint()){this.state.textContent=this.getHint();this.resume.hidden=true;return;}
    if(this.held&&this.getMode()!=='manual'){this.state.textContent='Manual position';return;}
    this.state.textContent=this.getMode()==='voice'?'Speak to follow':this.getMode()==='steady'?'Auto-scroll':'Manual scroll';
    if(this.getMode()==='steady'&&this.canScroll())this.steady();
  }
  update(){if(this.getMode()==='steady'&&!this.held&&!this.animation&&this.canScroll())this.steady();}
  hear(text){
    const match=matchReading(this.answer.textContent,text,this.cursor);
    if(!match)return null;
    this.cursor=match.wordIndex;
    if(this.held&&performance.now()>=this.holdUntil){this.held=false;this.resume.hidden=true;}
    if(this.getMode()==='voice'&&!this.held){this.follow();this.state.textContent=this.cursor>=match.total?'Answer complete':'Following your voice';}
    return match;
  }
  follow(){
    if(this.getMode()!=='voice'||this.held)return;
    const text=this.answer.firstChild;if(!text||text.nodeType!==3)return;
    const tokens=words(text.textContent),token=tokens[Math.min(this.cursor,tokens.length-1)];if(!token)return;
    const range=document.createRange();range.setStart(text,token.start);range.setEnd(text,token.end);
    const box=range.getBoundingClientRect(),frameBox=this.frame.getBoundingClientRect();
    const target=Math.max(0,Math.min(this.frame.scrollHeight-this.frame.clientHeight,this.frame.scrollTop+box.top-frameBox.top-this.frame.clientHeight*.28));
    this.stop();
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){this.frame.scrollTop=target;return;}
    let last=performance.now();
    const tick=now=>{if(this.held||this.getMode()!=='voice')return;const delta=target-this.frame.scrollTop;if(Math.abs(delta)<1){this.frame.scrollTop=target;return;}this.frame.scrollTop+=delta*(1-Math.exp(-Math.min(now-last,50)/110));last=now;this.animation=requestAnimationFrame(tick);};
    this.animation=requestAnimationFrame(tick);
  }
  steady(){
    let last=performance.now(),position=this.frame.scrollTop;
    const tick=now=>{
      this.animation=0;if(this.getMode()!=='steady'||this.held)return;
      const elapsed=Math.max(0,Math.min(now-last,50));last=now;
      const max=Math.max(0,this.frame.scrollHeight-this.frame.clientHeight);
      if(!this.canScroll()||!this.answer.textContent.trim()||!max){
        position=this.frame.scrollTop;this.overflowSince=null;
      }else{
        this.overflowSince??=now;
        // Let the opening settle, then move at a readable pace. Appending
        // streamed text never jumps to the bottom or restarts this grace period.
        if(now-this.overflowSince>=1400){
          const speed=Math.max(8,Math.min(36,Number(this.getSpeed())||18));
          position=Math.max(0,Math.min(max,position+elapsed*speed/1000));
          this.frame.scrollTop=position;
        }
      }
      this.animation=requestAnimationFrame(tick);
    };
    this.animation=requestAnimationFrame(tick);
  }
}
