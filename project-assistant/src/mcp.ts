import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';
import { LIMITS, Fault } from './common.js';

export async function connectFiles(repo:string,run:string){
  const env:Record<string,string>={};
  for(const key of ['PATH','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','LANG'])if(process.env[key])env[key]=process.env[key]!;
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../dist/server.js',import.meta.url)),'--repo',repo,'--run',run],env,stderr:'pipe',maxBufferSize:1_048_576});
  const client=new Client({name:'project-assistant',version:'1.0.0'});
  // Never forward raw process output: even startup errors must not disclose environment data.
  transport.stderr?.on('data',()=>{});
  try {
    await client.connect(transport,{timeout:LIMITS.toolMs});
    const listing=await client.listTools({}, {timeout:LIMITS.toolMs});
    return {
      tools:listing.tools,
      async call(name:string,args:Record<string,unknown>,signal?:AbortSignal){
        const result=await client.callTool({name,arguments:args},{timeout:LIMITS.toolMs,signal});
        const data=result.structuredContent as Record<string,unknown>|undefined;
        if(!data&&result.isError)return {isError:true,data:{code:'invalid_arguments',message:'MCP отклонил вызов. Проверьте аргументы по опубликованной схеме.'}};
        if(!data)throw new Fault('invalid_mcp','MCP-сервер не вернул структурированный результат.');
        return {isError:!!result.isError,data};
      },
      close:()=>client.close()
    };
  }catch{await client.close().catch(()=>{});throw new Fault('mcp_start_failed','Не удалось запустить MCP. Проверьте --repo, уникальность --run и сборку пакета.');}
}
export type FilesClient=Awaited<ReturnType<typeof connectFiles>>;
