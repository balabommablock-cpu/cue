// Preserve every accepted turn. Consecutive automatic chunks can be answered
// together, but a size boundary must never erase the beginning of a question.
export class PendingTurns {
  constructor(limit=8){this.limit=limit;this.items=[];}
  get length(){return this.items.length;}
  clear(){this.items=[];}
  push(item){
    if(typeof item.question!=='string'||!item.question.trim()||item.question.length>4000)throw new Error('Keep each question under 4,000 characters. Use Type question to edit it.');
    const existing=item.batchId===undefined?-1:this.items.findIndex(p=>p.batchId===item.batchId);
    if(existing>=0){this.items[existing]={...item};return;}
    if(this.items.length>=this.limit)throw new Error('Too many questions are waiting. Pause listening and use Answer now to catch up. The latest turn is still shown in Heard.');
    this.items.push({...item});
  }
  take(){
    const first=this.items.shift();if(!first)return null;
    while(first.autoDetect&&this.items[0]?.autoDetect&&first.inputSource===this.items[0].inputSource&&first.question.length+this.items[0].question.length+1<=4000){first.question+='\n'+this.items.shift().question;}
    return first;
  }
}
