import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { connectFiles } from './mcp.js';
import { DeepSeek } from './llm.js';
import { runAgent } from './agent.js';
import { applyRun, Store } from './store.js';
import { Policy } from './policy.js';
import { LIMITS, atomicJson, runId, safeError, safeText } from './common.js';
import { HELP, parseCommand, savedEnvFile, saveEnvFile, listRuns } from './commands.js';

async function gitMetadata(repo:string){
  const run=async(args:string[]) => (await promisify(execFile)('git',['--no-pager','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',...args],{cwd:repo,timeout:5000,maxBuffer:1_048_576,windowsHide:true})).stdout.trim();
  try{return {commit:await run(['rev-parse','HEAD']),dirty:!!await run(['status','--porcelain','--untracked-files=normal'])};}catch{return {commit:null,dirty:null};}
}
async function main(){
  const command=parseCommand(process.argv.slice(2));
  if(command.name==='help'){console.log(HELP);return;}
  const repo=await fs.realpath(command.repo);
  if(command.name==='config'){
    const file=command.envFile===undefined?await savedEnvFile(repo):await saveEnvFile(repo,command.envFile);
    console.log(file?'Файл настроек LLM: '+file:'Путь не настроен. Используйте .\\pa config --env-file PATH.');return;
  }
  if(command.name==='runs'){console.log(await listRuns(repo));return;}
  if(command.name==='diff'){
    const store=await new Store(await new Policy(repo).init(),command.run!).init(false);
    const preview=await store.preview();
    console.log(preview.files.length?safeText(await fs.readFile(path.join(store.directory,'changes.patch'),'utf8')):'В запуске нет подготовленных изменений.');return;
  }
  if(command.name==='apply'){
    const result=await applyRun(repo,command.run!);console.log(JSON.stringify(result,null,2));
    if(!['applied','already_applied'].includes(result.status))process.exitCode=1;return;
  }
  const task=command.task!;safeText(task);
  const env={...process.env};
  const envFile=command.envFile??await savedEnvFile(repo);
  if(envFile){
    const raw=await fs.readFile(path.resolve(envFile),'utf8');
    const parsed=parseEnv(raw);for(const name of ['DEEPSEEK_API_KEY','DEEPSEEK_MODEL'])if(!env[name]&&parsed[name])env[name]=parsed[name];
  }
  const model=new DeepSeek(env);
  const id=runId(command.run??new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,8));
  const metadata=await gitMetadata(repo);
  const client=await connectFiles(repo,id);
  const directory=path.join(repo,'.assistant','runs',id);
  const controller=new AbortController();
  const stop=async()=>{controller.abort();await client.close().catch(()=>{});process.exitCode=130;};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    await atomicJson(path.join(directory,'task.json'),{goal:task,started_at:new Date().toISOString(),model:model.name,repo,run:id,...metadata,limits:LIMITS});
    console.log('Запуск '+id+'; результаты: '+directory);
    const result=await runAgent(task,model,client,directory,{signal:controller.signal});
    const store=await new Store(await new Policy(repo).init(),id).init(false);const preview=await store.preview();
    await atomicJson(path.join(directory,'result.json'),{...result,finished_at:new Date().toISOString(),files:preview.files});
    console.log(await fs.readFile(path.join(directory,'report.md'),'utf8'));
    console.log(JSON.stringify({status:result.status,files:preview.files},null,2));
    if(preview.files.length){
      console.log(await fs.readFile(path.join(directory,'changes.patch'),'utf8'));
      const prefix=process.platform==='win32'?'.\\pa':'node project-assistant/dist/cli.js';
      console.log(`Применить после проверки: ${prefix} apply ${id}`);
      if(repo!==await fs.realpath(process.cwd()))console.log('Добавьте --repo с тем же корнем: '+repo);
    }
    if(result.status!=='complete')process.exitCode=2;
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await client.close();}
}
main().catch(e=>{console.error(JSON.stringify(safeError(e)));process.exitCode=1;});
