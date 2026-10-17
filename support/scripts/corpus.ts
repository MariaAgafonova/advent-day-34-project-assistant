import { createHash } from 'node:crypto';
import { readdir, readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Source } from '../src/types';
export const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
export function chunkDocument(path:string,raw:string):Source[] {
 const text=raw.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n'),lines=text.split('\n'),document_hash=sha(text),document_id=sha(path);
 const sections:number[]=[0];let fenced=false;
 for(let i=0;i<lines.length;i++){if(/^\s*(```|~~~)/.test(lines[i]))fenced=!fenced; if(i>0&&!fenced&&/^#{1,6}\s/.test(lines[i]))sections.push(i);}
 const chunks:Source[]=[];
 for(let s=0;s<sections.length;s++){
  const start=sections[s],end=sections[s+1]??lines.length,heading=lines[start].replace(/^#+\s*/, '').slice(0,200);
  let cursor=start;
  while(cursor<end){let last=cursor,size=0;while(last<end && (size+lines[last].length+1<=2400 || last===cursor)){size+=lines[last].length+1;last++;}
   const body=lines.slice(cursor,last).join('\n');
   if(body.length>8000)throw new Error(`Line too long in ${path}:${cursor+1}`);
   if(body.trim()){const chunk_id=sha([path,document_hash,heading,cursor+1,last,body].join('\0'));chunks.push({chunk_id,document_id,path,heading,start_line:cursor+1,end_line:last,document_hash,text:body});}
   if(last===end)break;cursor=last-cursor>2?last-1:last;
  }
 }
 return chunks;
}
export async function corpus(directory:string){
 const files=(await readdir(directory)).filter(f=>f.endsWith('.md')).sort();
 const chunks:Source[]=[];
 for(const name of files){const p=join(directory,name);if((await lstat(p)).isSymbolicLink())throw new Error('Symlinks are not indexed');chunks.push(...chunkDocument('knowledge/support/'+name,await readFile(p,'utf8')));}
 if(!chunks.length)throw new Error('Empty corpus; active index preserved');
 return {chunks,generation:sha('chunker-v1\0'+chunks.map(c=>c.chunk_id).join('\n'))};
}
const quote=(v:string|number)=>typeof v==='number'?String(v):"'"+v.replace(/'/g,"''")+"'";
export function indexStatements(data:{chunks:Source[];generation:string}) {
 const statements=data.chunks.map(c=>`INSERT OR IGNORE INTO knowledge_chunks(generation,document_id,chunk_id,path,heading,start_line,end_line,document_hash,text,search_text) VALUES(${[data.generation,c.document_id,c.chunk_id,c.path,c.heading,c.start_line,c.end_line,c.document_hash,c.text,c.text.toLowerCase().replace(/ё/g,'е')].map(quote).join(',')});`);
 // Activate only after all immutable rows are present. Old snapshots remain readable on failure.
 statements.push(`INSERT INTO knowledge_state(id,generation) VALUES(1,${quote(data.generation)}) ON CONFLICT(id) DO UPDATE SET generation=excluded.generation;`);
 statements.push(`DELETE FROM knowledge_chunks WHERE generation<>${quote(data.generation)};`);
 return statements;
}
