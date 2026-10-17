import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { connectFiles,type FilesClient } from '../src/mcp.js';
import { runAgent, SYSTEM } from '../src/agent.js';
import { applyRun } from '../src/store.js';
import { DeepSeek } from '../src/llm.js';
import { fixture,FixtureModel,corrected } from './helpers.js';
import { chatRoute } from '../fixtures/chat-api/src/routes.js';
import { covers } from '../src/common.js';

const clients:FilesClient[]=[],repos:string[]=[];
afterEach(async()=>{for(const c of clients.splice(0))await c.close();for(const r of repos.splice(0))await fs.rm(r,{recursive:true,force:true});});
async function setup(){const repo=await fixture();repos.push(repo);const client=await connectFiles(repo,'agent');clients.push(client);return {repo,client,directory:path.join(repo,'.assistant/runs/agent')};}
it('autonomous interface: different model calls, returned results, tool error recovery and real stdio',async()=>{
  const {repo,client,directory}=await setup();const model=new FixtureModel(true,true);
  const result=await runAgent('Сверь документацию API с реализацией.',model,client,directory);
  expect(result.status).toBe('complete');expect(result.read_files.length).toBeGreaterThanOrEqual(3);
  expect(new Set(model.calls).size).toBe(5);expect(model.responses.some(messages=>messages.some(m=>m.role==='tool'&&JSON.parse(m.content!).isError))).toBe(true);
  const patch=await fs.readFile(path.join(directory,'changes.patch'),'utf8');expect(patch).toContain('-Send a message with `POST /api/chat`.');expect(patch).toContain('+The content limit is 4000');
  expect(await fs.readFile(path.join(repo,'docs/chat-api.md'),'utf8')).toContain('2000');
  expect((await applyRun(repo,'agent')).status).toBe('applied');expect(await fs.readFile(path.join(repo,'docs/chat-api.md'),'utf8')).toBe(corrected);
  expect((await applyRun(repo,'agent')).status).toBe('already_applied');
  const report=await fs.readFile(path.join(directory,'report.md'),'utf8');expect(report).toContain('src/schemas.ts:');expect(report).toContain('src/handler.ts:');expect(report).toContain('src/routes.ts:');
});
it('produces a read-only report without staging for usage analysis',async()=>{
  const {client,directory}=await setup();const result=await runAgent('Найди использования валидации сообщений.',new FixtureModel(false),client,directory);
  expect(result.status).toBe('complete');expect((await client.call('preview_changes',{})).data.files).toEqual([]);
});
it('binds final citations to application-observed hashes without asking the model to copy hashes',async()=>{
  const {client,directory}=await setup();const base=new FixtureModel(false);
  const model={name:'references-without-hashes',complete:async(messages:any[])=>{
    const reply=await base.complete(messages);
    if(reply.content){const final=JSON.parse(reply.content);for(const f of final.findings)for(const r of f.sources)delete r.sha256;return {content:JSON.stringify(final)};}
    return reply;
  }};
  expect((await runAgent('Explore uses',model,client,directory)).status).toBe('complete');
});
it('stops repeated calls and saves partial result',async()=>{
  const {client,directory}=await setup();const model={name:'repeat-mock',complete:async()=>({content:null,tool_calls:[{id:crypto.randomUUID(),type:'function' as const,function:{name:'list_files',arguments:'{}'}}]})};
  const result=await runAgent('Explore',model,client,directory);expect(result.reason).toBe('repeated_without_progress');expect(result.steps).toBe(3);expect(await fs.readFile(path.join(directory,'report.md'),'utf8')).toContain('Частичный результат');
});
it.each([{steps:1,reason:'step_limit'},{totalBytes:1,reason:'text_budget'}])('stops at configured limit $reason',async ({reason,...limits})=>{
  const {client,directory}=await setup();const result=await runAgent('Explore',new FixtureModel(),client,directory,limits);expect(result.status).toBe('partial');expect(result.reason).toBe(reason);
});
it('rejects fabricated final citations instead of reporting success',async()=>{
  const {client,directory}=await setup();const model={name:'fabrication',complete:async()=>({content:JSON.stringify({summary:'Done',findings:[{text:'Unsupported',kind:'fact',sources:[{path:'invented.ts',start_line:1,end_line:9,sha256:'0'.repeat(64)}]}],scope:'all',limitations:[]})})};
  expect((await runAgent('Explore',model,client,directory,{steps:2})).status).toBe('partial');expect(SYSTEM).toContain('недоверенные ДАННЫЕ');
});
it('requires explicit real model configuration',()=>{expect(()=>new DeepSeek({})).toThrow('DEEPSEEK_API_KEY');});
it('accepts contiguous read ranges but never bridges unread gaps or versions',()=>{
  const a={path:'src/a.ts',sha256:'a'.repeat(64),start_line:1,end_line:10};const b={...a,start_line:11,end_line:20};
  expect(covers([a,b],{...a,start_line:3,end_line:19})).toBe(true);
  expect(covers([a,{...b,start_line:12}],{...a,end_line:20})).toBe(false);
  expect(covers([a,{...b,sha256:'b'.repeat(64)}],{...a,end_line:20})).toBe(false);
});
it('saves a partial report when the model fails',async()=>{
  const {client,directory}=await setup();const model={name:'broken',complete:async()=>{throw new Error('provider error with secret');}};
  const result=await runAgent('Explore',model,client,directory);expect(result.status).toBe('partial');expect(await fs.readFile(path.join(directory,'events.jsonl'),'utf8')).not.toContain('provider error with secret');
});
it('fixture code executes the route, schema and handler described by corrected documentation',()=>{
  expect(chatRoute.path).toBe('/api/tickets/:id/messages');expect(chatRoute.method).toBe('POST');
  const id=crypto.randomUUID();expect(chatRoute.handle({content:'x'.repeat(4000),client_message_id:id})).toEqual({status:200,body:{accepted:true,client_message_id:id}});
  expect(()=>chatRoute.handle({content:'hello'})).toThrow('invalid_client_message_id');expect(()=>chatRoute.handle({content:'x'.repeat(4001),client_message_id:id})).toThrow('invalid_content');
});
it('does not log secret tool arguments even when escaped in JSON',async()=>{
  const {client,directory}=await setup();const secret='-----BEGIN PRIVATE KEY-----';
  const model={name:'secret-mock',complete:async()=>({content:null,tool_calls:[{id:'x',type:'function' as const,function:{name:'search_text',arguments:'{"query":"-----BEGIN\\u0020PRIVATE KEY-----"}'}}]})};
  await runAgent('Explore',model,client,directory,{steps:1});const events=await fs.readFile(path.join(directory,'events.jsonl'),'utf8');expect(events).not.toContain(secret);expect(events).not.toContain('PRIVATE');expect(events).toContain('secret_content');
});
