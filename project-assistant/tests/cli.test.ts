import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { parseCommand, savedEnvFile, saveEnvFile } from '../src/commands.js';
import { connectFiles } from '../src/mcp.js';
import { fixture, corrected } from './helpers.js';

const temporary:string[]=[];
afterEach(async()=>{for(const repo of temporary.splice(0))await fs.rm(repo,{recursive:true,force:true});});
async function repository(){const repo=await fixture();temporary.push(repo);return repo;}
const cli=fileURLToPath(new URL('../dist/cli.js',import.meta.url));
async function invoke(repo:string,args:string[],preload?:string){
  const env={...process.env};delete env.DEEPSEEK_API_KEY;delete env.DEEPSEEK_MODEL;
  return promisify(execFile)(process.execPath,[...(preload?['--import',pathToFileURL(preload).href]:[]),cli,...args],{cwd:repo,env,timeout:30_000,windowsHide:true});
}

it('parses short commands, defaults to cwd and preserves legacy arguments',()=>{
  expect(parseCommand(['task','Найди API','--run','demo'])).toMatchObject({name:'task',repo:'.',task:'Найди API',run:'demo'});
  expect(parseCommand(['apply','demo'])).toEqual({name:'apply',repo:'.',run:'demo'});
  expect(parseCommand(['diff','demo','--repo','elsewhere'])).toEqual({name:'diff',repo:'elsewhere',run:'demo'});
  expect(parseCommand(['--repo','work','--task','Explore','--env-file','settings'])).toMatchObject({name:'task',repo:'work',task:'Explore',envFile:'settings'});
  expect(parseCommand(['apply','--repo','work','--run','demo'])).toEqual({name:'apply',repo:'work',run:'demo'});
  expect(parseCommand([]).name).toBe('help');expect(parseCommand(['-h']).name).toBe('help');
  for(const args of [['task'],['task','one','two'],['apply'],['apply','../escape'],['apply','one','--run','two'],['runs','extra'],['runs','--env-file','x'],['config','--task','x'],['--unknown']])expect(()=>parseCommand(args)).toThrow();
});

it('saves only the env-file path locally and rejects linked config directories',async()=>{
  const repo=await repository(), other=await repository();
  const file=path.join(other,'.env');await fs.writeFile(file,'DEEPSEEK_API_KEY=test-key-do-not-copy\n');
  const absolute=await saveEnvFile(repo,file);expect(await savedEnvFile(repo)).toBe(absolute);
  const content=await fs.readFile(path.join(repo,'.assistant/cli.json'),'utf8');
  expect(JSON.parse(content)).toEqual({version:1,env_file:absolute});expect(content).not.toContain('test-key-do-not-copy');
  const linked=await repository();await fs.symlink(path.join(repo,'.assistant'),path.join(linked,'.assistant'),'junction');
  await expect(saveEnvFile(linked,file)).rejects.toMatchObject({code:'symlink_denied'});
  await expect(savedEnvFile(linked)).rejects.toMatchObject({code:'invalid_cli_config'});
});

it('runs help and lists an empty repository without an LLM key',async()=>{
  const repo=await repository();
  expect((await invoke(repo,['help'])).stdout).toContain('apply ID');
  expect((await invoke(repo,['runs'])).stdout).toContain('Запусков пока нет');
  await expect(invoke(repo,['task','Explore'])).rejects.toMatchObject({code:1,stderr:expect.stringContaining('missing_key')});
  await expect(fs.stat(path.join(repo,'.assistant'))).rejects.toMatchObject({code:'ENOENT'});
});

it('uses positional diff/apply against real MCP staging and applies exactly once',async()=>{
  const repo=await repository(),client=await connectFiles(repo,'short-cli');
  try {
    const read=await client.call('read_file',{path:'docs/chat-api.md'});
    const d=read.data as {sha256:string;lines:{number:number}[]};
    const staged=await client.call('stage_file_change',{path:'docs/chat-api.md',expected_hash:d.sha256,content:corrected,explanation:'Align the fixture documentation.',sources:[{path:'docs/chat-api.md',start_line:1,end_line:d.lines.at(-1)!.number,sha256:d.sha256}]});
    expect(staged.isError).toBe(false);
  } finally {await client.close();}
  expect((await invoke(repo,['diff','short-cli'])).stdout).toContain('+Send a message with `POST /api/tickets/:id/messages`.');
  expect((await invoke(repo,['runs'])).stdout).toContain('short-cli\tstaged\t1');
  expect(JSON.parse((await invoke(repo,['apply','short-cli'])).stdout).status).toBe('applied');
  expect(JSON.parse((await invoke(repo,['apply','--run','short-cli'])).stdout).status).toBe('already_applied');
  expect((await invoke(repo,['runs'])).stdout).toContain('short-cli\tapplied\t1');
  expect(await fs.readFile(path.join(repo,'docs/chat-api.md'),'utf8')).toBe(corrected);
},30_000);

it('executes a short task with saved config, mock LLM and real MCP',async()=>{
  const repo=await repository(), privateDirectory=await repository();
  const settings=path.join(privateDirectory,'.env');
  await fs.writeFile(settings,'DEEPSEEK_API_KEY=cli-fixture-key\nDEEPSEEK_MODEL=cli-fixture-model\n');
  expect((await invoke(repo,['config','--env-file',settings])).stdout).toContain(await fs.realpath(settings));
  expect((await invoke(repo,['config'])).stdout).toContain(await fs.realpath(settings));
  // Mock only the provider transport; the actual CLI and MCP subprocess run unchanged.
  const preload=path.join(privateDirectory,'mock-provider.mjs');
  await fs.writeFile(preload,`
globalThis.fetch=async(_url,options)=>{
  const request=JSON.parse(options.body);
  if(request.model!=='cli-fixture-model'||options.headers.Authorization!=='Bearer cli-fixture-key')throw new Error('Configuration not loaded');
  const outputs=request.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content).data);
  const listing=outputs.find(d=>Array.isArray(d.files));
  const reads=outputs.filter(d=>Array.isArray(d.lines));
  const unread=listing?.files.find(p=>!reads.some(r=>r.path===p));
  const call=(name,args)=>({content:null,tool_calls:[{id:'call-'+outputs.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  let message;
  if(!listing)message=call('list_files',{});
  else if(unread)message=call('read_file',{path:unread});
  else message={content:JSON.stringify({summary:'Read fixture API files.',findings:[{kind:'fact',text:'The API uses POST /api/tickets/:id/messages.',sources:reads.map(r=>({path:r.path,start_line:1,end_line:1,sha256:r.sha256}))}],scope:'Fixture files',limitations:['Mock LLM.']})};
  return Response.json({choices:[{finish_reason:message.tool_calls?'tool_calls':'stop',message}]});
};
`);
  const result=await invoke(repo,['task','Find the chat API','--run','short-task'],preload);
  expect(result.stdout).toContain('Read fixture API files.');
  const directory=path.join(repo,'.assistant/runs/short-task');
  expect(JSON.parse(await fs.readFile(path.join(directory,'result.json'),'utf8')).status).toBe('complete');
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
  expect(new Set(manifest.reads.map((r:{path:string})=>r.path)).size).toBe(4);
  expect(await fs.readFile(path.join(directory,'events.jsonl'),'utf8')).not.toContain('cli-fixture-key');
  // An explicit env-file overrides the saved path and still runs without a real provider.
  await fs.rename(settings,settings+'.moved');
  await invoke(repo,['task','Find the chat API','--run','override','--env-file',settings+'.moved'],preload);
},30_000);
