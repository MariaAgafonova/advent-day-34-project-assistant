import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2);if(args.some(a=>a!=='--local'))throw new Error('Use no arguments to upload the secret, or --local to only configure local access');
let vars=await readFile('.dev.vars','utf8');
let password=vars.match(/^OPERATOR_PASSWORD=(.*)$/m)?.[1].trim().replace(/^(["'])(.*)\1$/,'$2');
if(!password){password=randomBytes(32).toString('hex');vars=vars.replace(/^OPERATOR_PASSWORD=.*\r?\n?/m,'').trimEnd()+'\nOPERATOR_PASSWORD='+password+'\n';await writeFile('.dev.vars',vars,{mode:0o600});}
if(password.length<32)throw new Error('OPERATOR_PASSWORD must have at least 32 characters');
if(!args.includes('--local')){
 const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','put','OPERATOR_PASSWORD','-c','wrangler.web.jsonc'],{input:password,stdio:['pipe','inherit','inherit']});
 if(result.status!==0)process.exit(result.status??1);
}
console.log('Operator access configured. Password is in the ignored .dev.vars file (OPERATOR_PASSWORD). It was not printed.');
