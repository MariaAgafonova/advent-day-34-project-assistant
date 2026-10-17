import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import type { Model, ChatMessage, ToolCall } from '../src/llm.js';
import type { Reference } from '../src/common.js';

export async function fixture(){
  const repo=await fs.mkdtemp(path.join(os.tmpdir(),'day34-test-'));
  await fs.cp(fileURLToPath(new URL('../fixtures/chat-api',import.meta.url)),repo,{recursive:true});
  return repo;
}
export const corrected='# Chat API fixture\n\nSend a message with `POST /api/tickets/:id/messages`.\n\nRequest body requires `content` and `client_message_id` (UUID).\nThe content limit is 4000 characters.\n\nSuccess returns HTTP 200 with an `accepted` flag and `client_message_id`.\n';
export class FixtureModel implements Model {
  name='mock-only';calls:string[]=[];responses:ChatMessage[][]=[];private next=0;private paths:string[]=[];private reads:Reference[]=[];
  constructor(private modify=true,private failFirst=false){}
  async complete(messages:ChatMessage[]){
    this.responses.push(structuredClone(messages));
    const last=messages.at(-1)!;
    if(last.role==='tool'){
      const out=JSON.parse(last.content!);
      if(out.data.files?.every((p:unknown)=>typeof p==='string'))this.paths=out.data.files.filter((p:string)=>/\.(ts|md)$/.test(p));
      if(out.data.lines){const x=out.data;this.reads.push({path:x.path,start_line:x.lines[0].number,end_line:x.lines.at(-1).number,sha256:x.sha256});}
    }
    const call=(name:string,args:unknown)=>{this.calls.push(name);const tool:ToolCall={id:'call-'+this.next++,type:'function',function:{name,arguments:JSON.stringify(args)}};return {content:null,tool_calls:[tool]};};
    if(!this.calls.length&&this.failFirst)return call('read_file',{path:'missing.txt'});
    if(!this.calls.includes('list_files'))return call('list_files',{});
    if(!this.calls.includes('search_text'))return call('search_text',{query:'validateMessage'});
    const unread=this.paths.find(p=>!this.reads.some(r=>r.path===p));
    if(unread)return call('read_file',{path:unread});
    if(this.modify&&!this.calls.includes('stage_file_change')){
      const document=this.reads.find(r=>r.path.startsWith('docs/'))!;
      return call('stage_file_change',{path:document.path,expected_hash:document.sha256,content:corrected,explanation:'Correct route, required UUID field, length limit and success body.',sources:this.reads.filter(r=>r.path.startsWith('src/'))});
    }
    if(this.modify&&!this.calls.includes('preview_changes'))return call('preview_changes',{});
    return {content:JSON.stringify({summary:'Исследованы маршрут, схема, обработчик и документация.',findings:[{kind:'fact',text:'POST /api/tickets/:id/messages требует client_message_id UUID и content до 4000 символов.',sources:this.reads.filter(r=>r.path.startsWith('src/'))}],scope:'Fixture chat API',limitations:['Mock LLM; настоящий MCP stdio.']})};
  }
}
