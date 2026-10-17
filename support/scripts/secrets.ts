import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
// Read a local ignored file; pass secrets over stdin, never command-line arguments or artifacts.
const values:Record<string,string>={};
for(const line of (await readFile('.dev.vars','utf8')).split(/\r?\n/)){
 const match=line.match(/^([A-Z_]+)=(.*)$/);if(match)values[match[1]]=match[2].trim().replace(/^(["'])(.*)\1$/,'$2');
}
if(!values.DEEPSEEK_API_KEY||!values.MCP_INTERNAL_SECRET)throw new Error('Fill DEEPSEEK_API_KEY and MCP_INTERNAL_SECRET in .dev.vars first');
for(const [config,secrets] of [
 ['wrangler.mcp.jsonc',{MCP_INTERNAL_SECRET:values.MCP_INTERNAL_SECRET}],
 ['wrangler.web.jsonc',{MCP_INTERNAL_SECRET:values.MCP_INTERNAL_SECRET,DEEPSEEK_API_KEY:values.DEEPSEEK_API_KEY,...(values.OPERATOR_PASSWORD?{OPERATOR_PASSWORD:values.OPERATOR_PASSWORD}:{})}]
] as const){
 const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','bulk','-c',config],{input:JSON.stringify(secrets),stdio:['pipe','inherit','inherit']});if(r.status!==0)process.exit(r.status??1);
}
