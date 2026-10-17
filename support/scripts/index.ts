import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { corpus,indexStatements } from './corpus';
const args=process.argv.slice(2);if(args.some(a=>!['--remote','--local','--prepare'].includes(a)) || args.includes('--local')&&args.includes('--remote'))throw new Error('Use --local, --remote or --prepare');
const data=await corpus(resolve('../knowledge/support'));
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/support-index.sql',indexStatements(data).join('\n'),'utf8');
if(!args.includes('--prepare')) {
 const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','advent-day-33-support',args.includes('--remote')?'--remote':'--local','-c','wrangler.web.jsonc',...(args.includes('--remote')?[]:['--persist-to','.wrangler/state']),'--file','artifacts/support-index.sql','--yes'],{stdio:'inherit'});
 if(result.status!==0)process.exit(result.status??1);
}
console.log(JSON.stringify({documents:new Set(data.chunks.map(c=>c.document_id)).size,chunks:data.chunks.length,generation:data.generation}));
