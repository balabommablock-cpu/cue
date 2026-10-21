import {parseResponse} from './core.js';
// Streaming prefixes can arrive one character at a time. Never replace the
// visible answer until a real answer body exists; WAIT preserves that answer.
export function turnDecision(text){
  if(/^\s*WAIT:/.test(text))return 'wait';
  if(parseResponse(text).answer)return 'answer';
  return 'pending';
}
