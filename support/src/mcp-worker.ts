import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { hash, redact } from './security';
import { customerContextSchema, ticketContextSchema, type Env, type Ticket, type Message } from './types';

export default {
 async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response> {
  if(new URL(request.url).pathname!=='/mcp')return new Response('Not found',{status:404});
  const supplied=request.headers.get('authorization')?.replace(/^Bearer /,'') ?? '';
  if(!env.MCP_INTERNAL_SECRET || !supplied)return new Response('Unauthorized',{status:401});
  const a=await hash(supplied), b=await hash(env.MCP_INTERNAL_SECRET);let mismatch=0;
  for(let i=0;i<a.length;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);
  if(mismatch)return new Response('Unauthorized',{status:401});
  const customer=request.headers.get('x-support-customer'),ticketId=request.headers.get('x-support-ticket');
  if(!customer||!ticketId||customer.length>80||ticketId.length>80)return new Response('Forbidden',{status:403});
  const ticket=await env.DB.prepare('SELECT * FROM tickets WHERE id=? AND customer_id=?').bind(ticketId,customer).first<Ticket>();
  if(!ticket)return new Response('Not found',{status:404});
  const handler=createMcpHandler(()=>{
   const server=new McpServer({name:'daily-tasks-crm',version:'1.0.0'});
   server.registerTool('get_customer_context',{description:'Контекст клиента, закреплённого серверной сессией.',inputSchema:z.object({}).strict(),outputSchema:customerContextSchema},async()=>{
    const row=await env.DB.prepare('SELECT language,platform,app_version FROM customers WHERE id=?').bind(customer).first<{language:string;platform:string;app_version:string}>();
    const value=customerContextSchema.parse({...row,profile_origin:'user_reported'});
    return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value};
   });
   server.registerTool('get_ticket_context',{description:'Ограниченная история только разрешённого обращения. Факты не извлекаются автоматически.',inputSchema:z.object({}).strict(),outputSchema:ticketContextSchema},async()=>{
    const result=await env.DB.prepare('SELECT role,content FROM messages WHERE ticket_id=? ORDER BY seq DESC LIMIT 13').bind(ticketId).all<Pick<Message,'role'|'content'>>();
    const history:Pick<Message,'role'|'content'>[]=[];let total=0;
    for(const m of result.results.slice(0,12)){const content=redact(m.content).slice(0,4000);if(total+content.length>12000)break;total+=content.length;history.push({role:m.role,content});}
    const value=ticketContextSchema.parse({subject:redact(ticket.subject),status:ticket.status,history:history.reverse(),truncated:result.results.length>history.length,facts:[]});
    return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value};
   });
   return server;
  },{route:'/mcp',responseMode:'json',corsOptions:false,allowedHostnames:['crm.internal','localhost','127.0.0.1']});
  return handler(request,env,ctx);
 }
} satisfies ExportedHandler<Env>;
