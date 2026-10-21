export const ANSWER_MODELS = [
  {id:'gpt-6-sol',label:'GPT-6 Sol · recommended'},
  {id:'gpt-6.1-sol',label:'GPT-6.1 Sol'},
  {id:'gpt-6-luna',label:'GPT-6 Luna'},
  {id:'gpt-6-astra',label:'GPT-6 Astra'},
];
export const DEFAULT_ANSWER_MODEL = 'gpt-6-sol';
export const DEFAULT_ANSWER_SPEED = 'priority';
export function answerOptions({answerModel=DEFAULT_ANSWER_MODEL,answerSpeed=DEFAULT_ANSWER_SPEED}={}){
  if(!ANSWER_MODELS.some(m=>m.id===answerModel))throw new Error('Choose an available answer model in Settings.');
  if(!['default','priority'].includes(answerSpeed))throw new Error('Choose Standard or Fast. Ultrafast is not available on this Codex connection.');
  return {model:answerModel,serviceTier:answerSpeed,effort:'low'};
}
