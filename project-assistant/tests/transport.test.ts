import { afterEach, expect, it, vi } from 'vitest';
import { DeepSeek } from '../src/llm.js';
import { Fault } from '../src/common.js';

afterEach(()=>vi.restoreAllMocks());
it('uses native tool calling, preserves tool responses, discards reasoning, and keeps chosen model',async()=>{
  const spy=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({choices:[{finish_reason:'tool_calls',message:{content:null,reasoning_content:'hidden',tool_calls:[{id:'x',type:'function',function:{name:'list_files',arguments:'{}'}}]}}]}));
  const model=new DeepSeek({DEEPSEEK_API_KEY:'test-key',DEEPSEEK_MODEL:'chosen-model'});
  const history=[{role:'user' as const,content:'Explore'},{role:'tool' as const,tool_call_id:'old',content:'{"files":[]}'}];
  const reply=await model.complete(history,[{type:'function',function:{name:'list_files'}}],new AbortController().signal);
  const sent=JSON.parse(String(spy.mock.calls[0][1]?.body));expect(sent.model).toBe('chosen-model');expect(sent.messages).toEqual(history);expect(sent.tool_choice).toBe('auto');expect(sent.thinking).toEqual({type:'disabled'});expect(reply).not.toHaveProperty('reasoning_content');
});
it('retries only once on transient model errors',async()=>{
  const spy=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response('not logged',{status:503}));
  await expect(new DeepSeek({DEEPSEEK_API_KEY:'test-key'}).complete([],[],new AbortController().signal)).rejects.toMatchObject({code:'model_http'});expect(spy).toHaveBeenCalledTimes(2);
});
it('does not echo provider error bodies and rejects incomplete output',async()=>{
  const spy=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('sensitive provider body',{status:401}));
  const model=new DeepSeek({DEEPSEEK_API_KEY:'test-key'});let error:unknown;try{await model.complete([],[],new AbortController().signal);}catch(e){error=e;}
  expect(error).toBeInstanceOf(Fault);expect(String(error)).not.toContain('sensitive');expect(spy).toHaveBeenCalledTimes(1);
  spy.mockResolvedValue(Response.json({choices:[{finish_reason:'length',message:{content:'partial'}}]}));
  await expect(model.complete([],[],new AbortController().signal)).rejects.toMatchObject({code:'model_response'});
});
it('aborts real adapter requests on cancellation',async()=>{
  vi.spyOn(globalThis,'fetch').mockImplementation(async(_input,options)=>{throw options?.signal?.reason;});
  const controller=new AbortController();controller.abort();
  await expect(new DeepSeek({DEEPSEEK_API_KEY:'test-key'}).complete([],[],controller.signal)).rejects.toMatchObject({code:'model_timeout'});
});
