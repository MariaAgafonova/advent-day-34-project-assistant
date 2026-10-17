import type { Source } from './types';
import { redact } from './security';
const stop=new Set('и в во на не нет но а я мы вы он она оно это что как уже мне меня мой моя мои для по из у к с со до от же ли бы был была были быть есть всё все еще при если или да спасибо пожалуйста'.split(' '));
export function terms(text:string):string[] {
 return [...new Set(redact(text).toLowerCase().replace(/ё/g,'е').match(/[\p{L}][\p{L}\p{N}_-]{2,39}/gu) ?? [])].filter(t=>!stop.has(t) && t!=='скрыт' && t!=='скрыто').slice(0,20);
}
export async function search(db:D1Database,query:string):Promise<Source[]> {
 const words=terms(query); if(!words.length)return [];
 // Tokens are rebuilt, quoted and bound; neither user nor model controls FTS operators.
 const expression=words.map(w=>'"'+w+'"*').join(' OR ');
 const rows=await db.prepare(`SELECT c.chunk_id,c.document_id,c.path,c.heading,c.start_line,c.end_line,c.document_hash,c.text
 FROM knowledge_fts JOIN knowledge_chunks c ON c.id=knowledge_fts.rowid
 WHERE knowledge_fts MATCH ? AND c.generation=(SELECT generation FROM knowledge_state WHERE id=1)
 ORDER BY bm25(knowledge_fts,3.0,1.0),c.chunk_id LIMIT 12`).bind(expression).all<Source>();
 const selected:Source[]=[]; let size=0;
 for(const row of rows.results){if(size+row.text.length>12000)continue;selected.push(row);size+=row.text.length;if(selected.length===6)break;}
 return selected;
}
