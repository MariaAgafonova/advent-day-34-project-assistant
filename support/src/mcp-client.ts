import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/client/validators/cf-worker';
import { AppError, customerContextSchema, ticketContextSchema, type Env } from './types';
export function crmClient(env:Env,customer:string,ticket:string,signal:AbortSignal) {
 const client=new Client({name:'daily-tasks-support',version:'1.0.0'},{jsonSchemaValidator:new CfWorkerJsonSchemaValidator()});
 const transport=new StreamableHTTPClientTransport(new URL('https://crm.internal/mcp'),{
  fetch:async(input,init)=>{
   const headers=new Headers(init?.headers);
   headers.set('Host','crm.internal');headers.set('Authorization',`Bearer ${env.MCP_INTERNAL_SECRET}`);headers.set('x-support-customer',customer);headers.set('x-support-ticket',ticket);
   return env.CRM_MCP.fetch(new Request(String(input),{...init,headers,signal}));
  }
 });
 return {client,transport};
}
export async function crmContext(env:Env,customer:string,ticket:string,signal:AbortSignal) {
 const limited=AbortSignal.any([signal,AbortSignal.timeout(10000)]);
 const {client,transport}=crmClient(env,customer,ticket,limited);
 try {
  await client.connect(transport,{signal:limited,timeout:10000});
  await client.listTools({}, {signal:limited,timeout:10000});
  const customerResult=await client.callTool({name:'get_customer_context',arguments:{}},{signal:limited,timeout:10000});
  const ticketResult=await client.callTool({name:'get_ticket_context',arguments:{}},{signal:limited,timeout:10000});
  if(customerResult.isError||ticketResult.isError)throw new Error('MCP tool failed');
  if(JSON.stringify(ticketResult.structuredContent).length>24000)throw new Error('MCP context too large');
  return {customer:customerContextSchema.parse(customerResult.structuredContent),ticket:ticketContextSchema.parse(ticketResult.structuredContent)};
 }catch{throw new AppError(502,'mcp_unavailable','Не удалось получить контекст обращения. Сообщение сохранено; повторите запрос.',true);}
 finally{await client.close().catch(()=>{});}
}
