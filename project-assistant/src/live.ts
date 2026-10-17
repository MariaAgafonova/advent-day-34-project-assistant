import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { applyRun } from './store.js';
import { atomicJson } from './common.js';

// Explicit, opt-in live verification. Uses the actual CLI + real model + stdio MCP.
async function main(){
  const {values}=parseArgs({options:{repo:{type:'string'},'env-file':{type:'string'}}});
  if(!values.repo)throw new Error('Pass --repo');
  const repo=await fs.realpath(values.repo),stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const reportDir=path.join(repo,'.assistant','verification',stamp);await fs.mkdir(reportDir,{recursive:true});
  const fixture=path.join(reportDir,'fixture');
  await fs.cp(fileURLToPath(new URL('../fixtures/chat-api',import.meta.url)),fixture,{recursive:true});
  const scenarios=[
    {name:'usage',root:repo,task:'Найди, как приложение получает контекст тикета через MCP. Покажи вызовы, конфигурацию, обработку ошибок и связанные тесты.'},
    {name:'docs',root:repo,task:'Сверь документацию API чата с текущими обработчиками и схемами. Подготовь исправление найденных расхождений.'},
    {name:'fixture',root:fixture,task:'Сверь документацию API чата с текущими обработчиками и схемами. Подготовь исправление найденных расхождений.'}
  ];
  const results:Record<string,unknown>[]=[];
  for(const s of scenarios){
    const id='live-'+s.name+'-'+stamp;
    const args=[fileURLToPath(new URL('./cli.js',import.meta.url)),'--repo',s.root,'--run',id,'--task',s.task];
    if(values['env-file'])args.push('--env-file',path.resolve(values['env-file']));
    console.log('Real DeepSeek + MCP: '+s.name);
    const output=await fs.open(path.join(reportDir,s.name+'.log'),'wx',0o600);
    const code=await new Promise<number>((resolve,reject)=>{
      const child=spawn(process.execPath,args,{stdio:['ignore',output.fd,output.fd],windowsHide:true});
      const timer=setTimeout(()=>child.kill(),660_000);child.on('error',reject);child.on('exit',c=>{clearTimeout(timer);resolve(c??1);});
    });await output.close();
    const directory=path.join(s.root,'.assistant','runs',id);
    let result:any;try{result=JSON.parse(await fs.readFile(path.join(directory,'result.json'),'utf8'));}catch{result={status:'failed'};}
    const record:Record<string,unknown>={scenario:s.name,run:id,repo:s.root,exit_code:code,result};
    if(s.name==='fixture'&&result.status==='complete'){
      const patch=await fs.readFile(path.join(directory,'changes.patch'),'utf8');
      record.nonempty_diff=!!patch.trim();
      record.apply=await applyRun(s.root,id);record.repeat_apply=await applyRun(s.root,id);
      const text=await fs.readFile(path.join(s.root,'docs/chat-api.md'),'utf8');
      record.document_checks={route:text.includes('/api/tickets/:id/messages'),uuid:text.includes('client_message_id')&&/UUID/i.test(text),limit:text.includes('4000')&&!text.includes('2000'),old_route_removed:!text.includes('/api/chat')};
      await fs.copyFile(path.join(directory,'changes.patch'),path.join(reportDir,'fixture.patch'));
    }
    results.push(record);await atomicJson(path.join(reportDir,'results.json'),results);
    console.log(JSON.stringify({scenario:s.name,status:result.status,steps:result.steps,read_files:result.read_files?.length,files:result.files}));
  }
  console.log('Verification: '+reportDir);
  if(results.some((r:any)=>r.exit_code!==0||r.result.status!=='complete'||(r.scenario==='fixture'&&(!r.nonempty_diff||r.apply?.status!=='applied'||r.repeat_apply?.status!=='already_applied'||Object.values(r.document_checks??{}).some(v=>!v)))))process.exitCode=1;
}
main().catch(()=>{console.error('Live verification failed; inspect the saved run artifacts. No credentials were logged.');process.exitCode=1;});
