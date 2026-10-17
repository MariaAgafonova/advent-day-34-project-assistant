import { z, ZodError } from 'zod';
import { AppError, type Env, type Ticket } from './types';
import { checkOrigin, createSession, session, readJson, rateLimit } from './security';
import { ownTicket, history,customerProfile,llmLogs } from './db';
import { sendMessage } from './chat';
import { operatorRoute } from './operator';

const sendSchema=z.object({content:z.string().trim().min(1).max(4000),client_message_id:z.uuid()}).strict();
const createSchema=z.object({subject:z.string().trim().min(1).max(160).default('Новый диалог')}).strict();
const profileSchema=z.object({
 display_name:z.string().trim().min(2).max(80).refine(v=>!/[\p{C}\n\r]/u.test(v),'Invalid name'),
 language:z.enum(['ru','en']),platform:z.enum(['unknown','Android','iOS','Web','Desktop']),
 app_version:z.string().trim().min(1).max(64).refine(v=>!/[\p{C}\n\r]/u.test(v),'Invalid version')
}).strict();
function publicTicket(ticket:Ticket) {
 const {id,subject,status,escalation_reason,created_at,updated_at}=ticket;
 return {id,subject,status,escalation_reason,created_at,updated_at};
}
async function route(request:Request,env:Env):Promise<Response> {
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(!path.startsWith('/api/'))return env.ASSETS.fetch(request);
 if(method!=='GET')checkOrigin(request);
 if(path.startsWith('/api/operator/'))return operatorRoute(request,env);
 if(path==='/api/health' && method==='GET') {
  const db=await env.DB.prepare('SELECT generation FROM knowledge_state WHERE id=1').first();
  return Response.json({status:db&&env.DEEPSEEK_API_KEY&&env.MCP_INTERNAL_SECRET?'ready':'setup_required',database:true,knowledge_index:!!db,model_configured:!!env.DEEPSEEK_API_KEY,mcp_configured:!!env.MCP_INTERNAL_SECRET});
 }
 if(path==='/api/session' && method==='POST'){z.object({}).strict().parse(await readJson(request));return createSession(request,env);}
 const customer=await session(request,env);
 if(!customer)throw new AppError(401,'session_required','Сессия истекла. Обновите страницу.');
 if(path==='/api/profile'){
  if(method==='GET')return Response.json({customer:await customerProfile(env.DB,customer)});
  if(method==='POST'){
   const input=profileSchema.parse(await readJson(request));await rateLimit(env.DB,'profile:'+customer,10);
   await env.DB.prepare('UPDATE customers SET display_name=?,language=?,platform=?,app_version=? WHERE id=?')
    .bind(input.display_name,input.language,input.platform,input.app_version,customer).run();
   return Response.json({customer:await customerProfile(env.DB,customer)});
  }
 }
 if(path==='/api/tickets'){
  if(method==='GET'){
   const rows=await env.DB.prepare('SELECT * FROM tickets WHERE customer_id=? ORDER BY updated_at DESC LIMIT 100').bind(customer).all<Ticket>();
   const profile=await customerProfile(env.DB,customer);
   return Response.json({tickets:rows.results.map(t=>({...publicTicket(t),customer_id:profile.id,customer_name:profile.display_name}))});
  }
  if(method==='POST'){
   const {subject}=createSchema.parse(await readJson(request));await rateLimit(env.DB,'ticket:'+customer,10);
   const id=crypto.randomUUID(),now=Date.now();
   await env.DB.prepare('INSERT INTO tickets(id,customer_id,subject,created_at,updated_at) VALUES(?,?,?,?,?)').bind(id,customer,subject,now,now).run();
   return Response.json({ticket:publicTicket(await ownTicket(env.DB,id,customer))},{status:201});
  }
 }
 const match=path.match(/^\/api\/tickets\/([a-zA-Z0-9-]{1,80})\/(messages|escalate|llm-calls)$/);
 if(match){
  const ticket=await ownTicket(env.DB,match[1],customer);
  if(match[2]==='llm-calls'&&method==='GET'){
   const before=url.searchParams.has('before')?z.coerce.number().int().positive().safe().parse(url.searchParams.get('before')):undefined;
   return Response.json(await llmLogs(env.DB,ticket.id,before));
  }
  if(match[2]==='messages'&&method==='GET'){
   const before=url.searchParams.has('before')?z.coerce.number().int().positive().safe().parse(url.searchParams.get('before')):undefined;
   return Response.json({ticket:publicTicket(ticket),customer:await customerProfile(env.DB,customer),...await history(env.DB,ticket,before)});
  }
  if(match[2]==='messages'&&method==='POST'){
   const input=sendSchema.parse(await readJson(request));
   const result=await sendMessage(env,customer,ticket,input.content,input.client_message_id);
   return Response.json({...result,ticket:publicTicket(result.ticket),customer:await customerProfile(env.DB,customer)});
  }
  if(match[2]==='escalate'&&method==='POST'){
   z.object({}).strict().parse(await readJson(request));await rateLimit(env.DB,'escalate:'+customer,10);
   await env.DB.prepare("UPDATE tickets SET status='needs_human',escalation_reason='Пользователь запросил специалиста.',updated_at=? WHERE id=? AND customer_id=?").bind(Date.now(),ticket.id,customer).run();
   return Response.json({ticket:publicTicket(await ownTicket(env.DB,ticket.id,customer)),message:'Запрос помощи специалиста сохранён. Оператор пока не подключён.'});
  }
 }
 throw new AppError(404,'not_found','Маршрут не найден.');
}
export default {
 async fetch(request:Request,env:Env):Promise<Response>{
  const requestId=crypto.randomUUID();let response:Response;
  try{response=await route(request,env);}catch(e){
   const error=e instanceof AppError?e:e instanceof ZodError?new AppError(400,'invalid_input','Проверьте заполненные поля и длину сообщения.'):new AppError(500,'internal_error','Не удалось выполнить запрос. Попробуйте позже.',true);
   console.error(JSON.stringify({request_id:requestId,code:error.code,status:error.status}));
   response=Response.json({error:{code:error.code,message:error.message,retryable:error.retryable},request_id:requestId},{status:error.status,headers:error.status===429?{'Retry-After':'60'}:{}});
  }
  const secured=new Response(response.body,response);secured.headers.set('X-Request-Id',requestId);
  secured.headers.set('X-Content-Type-Options','nosniff');secured.headers.set('Referrer-Policy','no-referrer');
  secured.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(new URL(request.url).pathname.startsWith('/api/'))secured.headers.set('Cache-Control','no-store');
  return secured;
 }
} satisfies ExportedHandler<Env>;
