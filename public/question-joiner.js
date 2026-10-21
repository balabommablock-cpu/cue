import {explicitQuestion,sameUtterance,words} from './reading.js';

// Audio endpoints are pauses, not conversation boundaries. Keep every part of
// the interviewer's turn until the candidate responds. No generated text enters
// this buffer; an expanded question is always assembled from heard words.
export class InterviewTurn {
  constructor(){this.sequence=0;this.clear();}
  clear(){this.parts=[];this.lastAt=-Infinity;this.replyAt=-Infinity;this.confirmed=false;this.id=null;}
  replied(text,{at=performance.now()}={}){
    if(words(text).length<4||this.parts.some(p=>sameUtterance(p,text)))return;
    this.replyAt=Math.max(this.replyAt,at);
  }
  accept(text,{at=performance.now()}={}){
    if(this.replyAt>this.lastAt||at-this.lastAt>90000){this.clear();}
    if(!this.parts.length)this.id=++this.sequence;
    if(this.parts.some(p=>sameUtterance(p,text)))return null;
    const question=[...this.parts,text].join('\n');
    if(question.length>4000)throw new Error('This question is too long to combine. Use Correct question; the latest words remain in Heard.');
    this.parts.push(text);this.lastAt=at;this.confirmed ||= explicitQuestion(text);
    return {question,batchId:this.id,confirmed:this.confirmed,parts:this.parts.length};
  }
}
// A short pause after a linking word is not the end of a question. Keep this
// narrowly scoped: never infer missing words or rewrite recognition output.
export class QuestionJoiner {
  constructor(){this.clear();}
  clear(){this.pending=null;}
  accept(text,{at=performance.now(),speechEndedAt}={}){
    let question=text;
    if(this.pending){
      if(at-this.pending.at<5000&&!explicitQuestion(text)){
        question=this.pending.question+' '+text;speechEndedAt??=this.pending.speechEndedAt;
      }
      this.clear();
    }
    const words=question.trim().split(/\s+/);
    const tail=question.toLowerCase().replace(/[.,!?;:]\s*$/,'').trim();
    if(words.length>=3&&/\b(?:the|a|an|to|for|with|and|or|because|whether|if|your|of|did you|would you|could you|can you|what about|in terms of)$/.test(tail)){
      this.pending={question,at,speechEndedAt};return {waiting:true,question};
    }
    return {waiting:false,question,speechEndedAt};
  }
}
