import { z } from 'zod';
import { Fault, LIMITS, bytes, referenceSchema, type Rule } from './common.js';
import { Store } from './store.js';

const page={offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(200).default(100)};
const filters={directory:z.string().optional(),extensions:z.array(z.string().regex(/^\.[a-zA-Z0-9]+$/)).max(20).optional()};
export const schemas={
  list_files:z.object({...filters,...page}).strict(),
  search_text:z.object({query:z.string().min(1).max(500),...filters,...page,context_lines:z.number().int().min(0).max(3).default(1)}).strict(),
  read_file:z.object({path:z.string(),start_line:z.number().int().positive().default(1),end_line:z.number().int().positive().optional()}).strict(),
  stage_file_change:z.object({path:z.string(),expected_hash:z.string().regex(/^[a-f0-9]{64}$/).nullable(),content:z.string().max(LIMITS.fileBytes),explanation:z.string().min(1).max(2000),sources:z.array(referenceSchema).min(1).max(30)}).strict(),
  preview_changes:z.object({}).strict()
};
export type ToolName=keyof typeof schemas;
export const descriptions:Record<ToolName,string>={
  list_files:'Discover permitted text files relative to the fixed repository. Paginated. Excluded files are omitted.',
  search_text:'Literal text search across permitted current files. Returns paths, line numbers and context; search is not proof of reading the complete source. Narrow directory/extension filters to control limits.',
  read_file:'Read current UTF-8 file line range, numbered lines and SHA-256 of full content. Follow next_line when truncated. Only these observations may be cited.',
  stage_file_change:'Propose documentation only; does NOT write the working copy. Read the whole existing document first. Use its original hash, or null for a new file. Cite actual read_file ranges and hashes; explain the change.',
  preview_changes:'Show the unified diff and affected files for staged documentation. Full patch is saved in the run directory. Cannot apply changes.'
};
export class FileTools {
  scanBytes=0; resultBytes=0; private ruleSent=new Set<string>();
  constructor(public store:Store) {}
  private rules(p:string):Rule[]{const list=this.store.policy.rulesFor(p).filter(r=>!this.ruleSent.has(r.path));for(const r of list)this.ruleSent.add(r.path);return list;}
  private filtered(args:{directory?:string;extensions?:string[]}) {
    const dir=args.directory;
    if(dir){if(dir==='.')throw new Fault('invalid_path','Оставьте directory пустым для корня.');}
    return this.store.policy.files.filter(p=>(!dir||p.startsWith(dir+'/'))&&(!args.extensions||args.extensions.some(e=>p.toLowerCase().endsWith(e.toLowerCase()))));
  }
  async call(name:string,input:unknown):Promise<Record<string,unknown>> {
    if(!Object.hasOwn(schemas,name))throw new Fault('unknown_tool','Неизвестный инструмент.');
    if(this.resultBytes>=LIMITS.totalBytes)throw new Fault('text_budget','Исчерпан общий лимит результатов.');
    const schema=schemas[name as ToolName];const parsed=schema.safeParse(input);
    if(!parsed.success)throw new Fault('invalid_arguments','Аргументы не соответствуют схеме инструмента.');
    const result=await this.execute(name as ToolName,parsed.data);
    const cost=bytes(result);
    if(cost>LIMITS.resultBytes)throw new Fault('result_limit','Ответ слишком велик. Запросите меньший диапазон.');
    if(this.resultBytes+cost>LIMITS.totalBytes)throw new Fault('text_budget','Исчерпан общий лимит результатов.');
    this.resultBytes+=cost;return result;
  }
  private async execute(name:ToolName,args:any):Promise<Record<string,unknown>> {
    const policy=this.store.policy;
    if(args.directory==='.')delete args.directory;
    if(args.directory){const abs=await policy.checked(args.directory);const {stat}=await import('node:fs/promises');if(!(await stat(abs)).isDirectory())throw new Fault('not_directory','directory должен указывать каталог; для точного файла используйте read_file.');}
    if(name==='list_files'){
      const files=this.filtered(args), selected=files.slice(args.offset,args.offset+Math.min(args.limit,100));
      return {files:selected,next_offset:args.offset+selected.length<files.length?args.offset+selected.length:null,truncated:args.offset+selected.length<files.length||policy.truncated,scope:args.directory??'.',excluded:'Secrets, ignored files, links, binaries, dependencies and build outputs',project_rules:this.rules(args.directory??'')};
    }
    if(name==='read_file'){
      const file=await policy.read(args.path),lines=file.text.split('\n');
      if(args.start_line>lines.length)throw new Fault('invalid_range','Начало диапазона за концом файла.');
      const end=Math.min(args.end_line??args.start_line+199,lines.length);
      if(end<args.start_line)throw new Fault('invalid_range','Конец диапазона меньше начала.');
      const selected:{number:number;text:string}[]=[];let size=0;
      for(let n=args.start_line;n<=end;n++){
        const text=lines[n-1].replace(/\r$/,'');const cost=bytes(text)+60;
        if(size+cost>16_000)break;selected.push({number:n,text});size+=cost;
      }
      if(!selected.length)throw new Fault('line_limit','Одна строка превышает лимит ответа; файл нельзя безопасно цитировать.');
      const last=selected.at(-1)!.number;
      await this.store.evidence({path:args.path,start_line:args.start_line,end_line:last,sha256:file.sha256});
      return {path:args.path,sha256:file.sha256,lines:selected,total_lines:lines.length,truncated:last<lines.length,next_line:last<lines.length?last+1:null,project_rules:this.rules(args.path)};
    }
    if(name==='search_text'){
      const matches:{path:string;line:number;text:string;context:{number:number;text:string}[]}[]=[];
      let seen=0,size=0,scanned=0,skipped=0,truncated=policy.truncated;
      outer:for(const p of this.filtered(args)){
        if(this.scanBytes>=LIMITS.scanBytes){truncated=true;break;}
        let file;try{file=await policy.read(p);}catch{skipped++;continue;}
        this.scanBytes+=file.size;scanned++;
        if(this.scanBytes>LIMITS.scanBytes){truncated=true;break;}
        const lines=file.text.split('\n');
        for(let i=0;i<lines.length;i++)if(lines[i].includes(args.query)){
          if(seen++<args.offset)continue;
          const match={path:p,line:i+1,text:lines[i].slice(0,600),context:lines.slice(Math.max(0,i-args.context_lines),i+args.context_lines+1).map((text,j)=>({number:Math.max(0,i-args.context_lines)+j+1,text:text.slice(0,600)}))};
          if(matches.length>=args.limit||size+bytes(match)>16_000){truncated=true;break outer;}
          matches.push(match);size+=bytes(match);
        }
      }
      return {matches,truncated,next_offset:truncated?args.offset+matches.length:null,files_scanned:scanned,files_skipped:skipped,scope:args.directory??'.',literal:true,scan_bytes_remaining:Math.max(0,LIMITS.scanBytes-this.scanBytes),project_rules:this.rules(args.directory??'')};
    }
    if(name==='stage_file_change')return {...await this.store.stage(args),project_rules:this.rules(args.path)};
    return this.store.preview();
  }
}
