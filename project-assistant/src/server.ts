import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { parseArgs } from 'node:util';
import { Policy } from './policy.js';
import { Store } from './store.js';
import { FileTools, schemas, descriptions, type ToolName } from './tools.js';
import { safeError } from './common.js';

async function main(){
  const {values}=parseArgs({options:{repo:{type:'string'},run:{type:'string'}}});
  if(!values.repo||!values.run)throw new Error();
  const store=await new Store(await new Policy(values.repo).init(),values.run).init(true);
  const implementation=new FileTools(store);
  const server=new McpServer({name:'project-files',version:'1.0.0'});
  for(const name of Object.keys(schemas) as ToolName[]){
    server.registerTool(name,{description:descriptions[name],inputSchema:schemas[name]},async (args:unknown)=>{
      try{const result=await implementation.call(name,args);return {content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result};}
      catch(e){const error=safeError(e);return {isError:true,content:[{type:'text' as const,text:JSON.stringify(error)}],structuredContent:error};}
    });
  }
  await server.connect(new StdioServerTransport());
  const close=async()=>{await server.close();process.exit(0);};
  process.on('SIGINT',close);process.on('SIGTERM',close);
}
main().catch(e=>{process.stderr.write(JSON.stringify(safeError(e))+'\n');process.exitCode=1;});
