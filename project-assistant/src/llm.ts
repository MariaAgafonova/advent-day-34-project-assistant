import { Fault, LIMITS } from './common.js';

export type ToolCall={id:string;type:'function';function:{name:string;arguments:string}};
export type ChatMessage={role:'system'|'user'|'assistant'|'tool';content:string|null;tool_calls?:ToolCall[];tool_call_id?:string};
export type ModelReply={content:string|null;tool_calls?:ToolCall[]};
export interface Model {name:string;complete(messages:ChatMessage[],tools:unknown[],signal:AbortSignal):Promise<ModelReply>}
export class DeepSeek implements Model {
  name:string;
  private key:string;
  constructor(env:NodeJS.ProcessEnv){
    this.name=env.DEEPSEEK_MODEL?.trim()||'deepseek-v4-flash';this.key=env.DEEPSEEK_API_KEY?.trim()||'';
    if(!this.key)throw new Fault('missing_key','Задайте DEEPSEEK_API_KEY в окружении или через --env-file.');
  }
  async complete(messages:ChatMessage[],tools:unknown[],signal:AbortSignal):Promise<ModelReply>{
    const limited=AbortSignal.any([signal,AbortSignal.timeout(LIMITS.modelMs)]);
    for(let attempt=0;attempt<2;attempt++){
      try{
        const response=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',redirect:'error',signal:limited,
          headers:{Authorization:'Bearer '+this.key,'Content-Type':'application/json'},
          body:JSON.stringify({model:this.name,messages,tools,tool_choice:'auto',thinking:{type:'disabled'},max_tokens:8000,stream:false})});
        if(!response.ok){await response.body?.cancel();if((response.status===429||response.status>=500)&&attempt===0){await backoff(limited);continue;}throw new Fault('model_http','DeepSeek вернул HTTP '+response.status+'.');}
        const reader=response.body?.getReader();if(!reader)throw new Fault('model_response','Пустой ответ модели.');
        let size=0;const chunks:Uint8Array[]=[];
        try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>524_288)throw new Fault('model_response','Ответ модели превышает лимит.');chunks.push(value);}}finally{await reader.cancel();}
        const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const choice=value.choices?.[0];
        if(!choice||!['stop','tool_calls'].includes(choice.finish_reason))throw new Fault('model_response','Ответ модели отсутствует или обрезан.');
        const message=choice.message;
        if(typeof message.content!=='string'&&message.content!==null)throw new Fault('model_response','Некорректный ответ модели.');
        if(message.tool_calls && (!Array.isArray(message.tool_calls)||message.tool_calls.length>10||message.tool_calls.some((c:ToolCall)=>typeof c.id!=='string'||c.type!=='function'||typeof c.function?.name!=='string'||typeof c.function?.arguments!=='string')))throw new Fault('model_response','Некорректные вызовы инструментов.');
        // Deliberately discard reasoning_content and all other provider fields.
        return {content:message.content,tool_calls:message.tool_calls};
      }catch(e){
        if(limited.aborted)throw new Fault('model_timeout','Истёк таймаут модели.');
        if(e instanceof TypeError && attempt===0){await backoff(limited);continue;}
        if(e instanceof Fault)throw e;
        throw new Fault('model_response','Не удалось проверить ответ DeepSeek.');
      }
    }
    throw new Fault('model_unavailable','Модель недоступна.');
  }
}
async function backoff(signal:AbortSignal){
  await new Promise<void>((resolve,reject)=>{
    if(signal.aborted){reject(signal.reason);return;}
    const stop=()=>{clearTimeout(timer);reject(signal.reason);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},300);
    signal.addEventListener('abort',stop,{once:true});
  });
}
