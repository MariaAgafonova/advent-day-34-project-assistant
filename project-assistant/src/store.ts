import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { Policy } from './policy.js';
import { Fault, LIMITS, atomicJson, bytes, covers, hash, manifestSchema, runId, safeText, type Manifest, type Reference, type Change } from './common.js';

export class Store {
  directory=''; manifest!:Manifest;
  constructor(public policy:Policy,public id:string) {runId(id);}
  async init(create:boolean) {
    const rel='.assistant/runs/'+this.id;
    this.directory=await this.policy.checked(rel,true);
    if(create){
      await fs.mkdir(path.dirname(this.directory),{recursive:true});
      try{await fs.mkdir(this.directory);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new Fault('run_exists','Этот запуск уже существует; выберите новый --run.');throw e;}
      this.manifest={version:1,run:this.id,root:this.policy.root,changes:[],reads:[],status:'staged',applied:[]};
      await this.save();
      await atomicJson(path.join(this.directory,'project-rules.json'),this.policy.rules);
    }else{
      const file=await this.policy.checked(rel+'/manifest.json');
      if((await fs.stat(file)).size>3_000_000)throw new Fault('manifest_invalid','Manifest слишком велик.');
      this.manifest=manifestSchema.parse(JSON.parse(await fs.readFile(file,'utf8')));
      if(this.manifest.root!==this.policy.root||this.manifest.run!==this.id)throw new Fault('wrong_repo','Manifest относится к другому корню или запуску.');
    }
    return this;
  }
  async save() {await this.policy.checked('.assistant/runs/'+this.id+'/manifest.json',true);await atomicJson(path.join(this.directory,'manifest.json'),this.manifest);}
  async evidence(ref:Reference) {
    if(this.manifest.reads.some(r=>r.path===ref.path&&r.sha256!==ref.sha256))this.manifest.reads=this.manifest.reads.filter(r=>r.path!==ref.path);
    if(!this.manifest.reads.some(r=>JSON.stringify(r)===JSON.stringify(ref)))this.manifest.reads.push(ref);
    await this.save();
  }
  hasEvidence(ref:Reference) {return covers(this.manifest.reads,ref);}
  async stage(input:{path:string;expected_hash:string|null;content:string;explanation:string;sources:Reference[]}) {
    if(this.manifest.status!=='staged')throw new Fault('run_closed','Запуск уже применялся.');
    safeText(input.content);safeText(input.explanation);
    if(bytes(input.content)>LIMITS.fileBytes)throw new Fault('file_limit','Предложение превышает 256 KiB.');
    await this.policy.access(input.path,true,true);
    for(const ref of input.sources){
      if(!this.hasEvidence(ref))throw new Fault('unread_source','Источник не подтверждён прочитанными диапазонами.');
      if((await this.policy.read(ref.path)).sha256!==ref.sha256)throw new Fault('stale_source','Источник изменился; прочитайте его заново.');
    }
    let original:string|null=null, originalHash:string|null=null;
    try{const current=await this.policy.read(input.path);original=current.text;originalHash=current.sha256;}
    catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    if(originalHash!==input.expected_hash)throw new Fault('hash_conflict','Исходный хеш не совпадает; прочитайте актуальную версию.');
    if(original!==null){
      const total=original.split('\n').length;
      const spans=this.manifest.reads.filter(r=>r.path===input.path&&r.sha256===originalHash).sort((a,b)=>a.start_line-b.start_line);
      let end=0;for(const span of spans){if(span.start_line>end+1)break;end=Math.max(end,span.end_line);}
      if(end<total)throw new Fault('incomplete_read','Перед изменением прочитайте весь документ диапазонами.');
    }
    if(original===input.content)throw new Fault('no_change','Новое содержимое совпадает с исходным.');
    const change:Change={path:input.path,type:original===null?'create':'modify',original_hash:originalHash,new_hash:hash(input.content),content:input.content,original,explanation:input.explanation,sources:input.sources};
    const identity=(p:string)=>process.platform==='win32'?p.toLowerCase():p;
    const changes=[...this.manifest.changes.filter(c=>identity(c.path)!==identity(input.path)),change].sort((a,b)=>a.path.localeCompare(b.path));
    if(changes.length>LIMITS.changes||changes.reduce((n,c)=>n+bytes(c.content),0)>LIMITS.stagedBytes)throw new Fault('staging_limit','Превышен лимит staging.');
    if(bytes({...this.manifest,changes})>2_500_000)throw new Fault('staging_limit','Исходные версии и предложения превышают лимит manifest.');
    this.manifest.changes=changes;await this.save();await this.preview();
    return {path:change.path,type:change.type,new_hash:change.new_hash,staged:true};
  }
  async preview() {
    const patch=this.manifest.changes.map(c=>createTwoFilesPatch(c.type==='create'?'/dev/null':'a/'+c.path,'b/'+c.path,c.original??'',c.content,'','',{context:3})).join('\n');
    await this.policy.checked('.assistant/runs/'+this.id+'/changes.patch',true);
    await fs.writeFile(path.join(this.directory,'changes.patch'),patch,{mode:0o600});
    return {files:this.manifest.changes.map(({path,type,explanation})=>({path,type,explanation})),patch:Buffer.from(patch).subarray(0,16_000).toString('utf8'),truncated:bytes(patch)>16_000};
  }
}

export async function applyRun(repo:string,id:string, hooks:{beforeWrite?:(index:number)=>Promise<void>}={}) {
  const policy=await new Policy(repo).init(),store=await new Store(policy,id).init(false);
  const lock=await policy.checked('.assistant/runs/'+id+'/apply.lock',true);
  let handle;try{handle=await fs.open(lock,'wx',0o600);}catch{throw new Fault('apply_locked','Применение уже выполняется или осталось после прерывания; проверьте apply.lock.');}
  const result:{status:string;written:string[];already_applied:string[];error?:{code:string;message:string}}={status:'applied',written:[],already_applied:[]};
  const pending:Change[]=[];const temporaries:string[]=[];
  try {
    const seen=new Set<string>();
    for(const c of store.manifest.changes){
      const identity=process.platform==='win32'?c.path.toLowerCase():c.path;
      if(seen.has(identity)||hash(c.content)!==c.new_hash|| (c.original===null?c.original_hash!==null:hash(c.original)!==c.original_hash) || (c.type==='create')!==(c.original===null))throw new Fault('manifest_invalid','Manifest повреждён.');
      seen.add(identity);safeText(c.content);
      await policy.access(c.path,true,true);
      let current:string|null=null;try{current=(await policy.read(c.path)).sha256;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
      if(current===c.new_hash && (store.manifest.status!=='staged'||store.manifest.applied.includes(c.path))){result.already_applied.push(c.path);continue;}
      if(current!==c.original_hash)throw new Fault('hash_conflict','Конфликт исходной версии: '+c.path);
      pending.push(c);
    }
    if(!store.manifest.changes.length)throw new Fault('no_changes','В запуске нет предложений.');
    store.manifest.status='applying';await store.save();
    for(let index=0;index<pending.length;index++){
      const c=pending[index],abs=await policy.access(c.path,true,true);
      await fs.mkdir(path.dirname(abs),{recursive:true});await policy.access(c.path,true,true);
      const tmp=path.join(path.dirname(abs),'.assistant-'+crypto.randomUUID()+'.tmp');temporaries.push(tmp);
      const targetMode=c.type==='modify'?(await fs.stat(abs)).mode:0o644;
      const out=await fs.open(tmp,'wx',targetMode);try{await out.writeFile(c.content);await out.sync();}finally{await out.close();}
      await hooks.beforeWrite?.(index);
      await policy.access(c.path,true,true);
      let current:string|null=null;try{current=(await policy.read(c.path)).sha256;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
      if(current!==c.original_hash)throw new Fault('hash_conflict','Файл изменился перед записью: '+c.path);
      if(c.type==='create'){await fs.link(tmp,abs);await fs.unlink(tmp);}else{await fs.rename(tmp,abs);}
      result.written.push(c.path);store.manifest.applied=[...new Set([...store.manifest.applied,c.path])];await store.save();
    }
    result.status=pending.length?'applied':'already_applied';store.manifest.status='applied';await store.save();
  }catch(e){
    result.status=result.written.length||store.manifest.applied.length?'partial':'conflict';
    result.error=e instanceof Fault?{code:e.code,message:e.message}:{code:'write_failed',message:'Запись не завершена. Проверьте права и состояние файлов.'};
    if(store.manifest.status==='applying'){store.manifest.status='partial';await store.save();}
  }finally{
    for(const tmp of temporaries)await fs.unlink(tmp).catch(()=>{});
    await atomicJson(path.join(store.directory,'apply-result.json'),{...result,time:new Date().toISOString()});
    await handle.close();await fs.unlink(lock);
  }
  return result;
}
