import { z } from 'zod';
import { AppError,type Env,type Ticket } from './types';
import { hash,rateLimit,readJson } from './security';
import { customerProfile,history,llmLogs } from './db';

function token(request:Request) {return request.headers.get('cookie')?.match(/(?:^|;\s*)support_operator=([a-f0-9]{64})(?:;|$)/)?.[1];}
function cookie(request:Request,env:Env,value:string,age:number) {
 const url=new URL(request.url),local=env.ALLOW_INSECURE_LOCAL==='true'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(url.protocol!=='https:'&&!local)throw new AppError(400,'https_required','Требуется HTTPS.');
 return `support_operator=${value}; HttpOnly; SameSite=Strict; Path=/api/operator; Max-Age=${age}${local?'':'; Secure'}`;
}
async function authenticated(request:Request,env:Env) {
 const value=token(request);if(!value||!env.OPERATOR_PASSWORD)return false;
 return !!await env.DB.prepare('SELECT token_hash FROM operator_sessions WHERE token_hash=? AND expires_at>? AND credential_hash=?')
  .bind(await hash(value),Date.now(),await hash(env.OPERATOR_PASSWORD)).first();
}
export async function operatorRoute(request:Request,env:Env) {
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(path==='/api/operator/session'){
  if(method==='GET')return Response.json({authenticated:await authenticated(request,env)});
  if(method==='POST'){
   await rateLimit(env.DB,'operator-login:'+await hash(request.headers.get('CF-Connecting-IP')||'local'),5);
   const {password}=z.object({password:z.string().min(1).max(256)}).strict().parse(await readJson(request));
   if(!env.OPERATOR_PASSWORD||env.OPERATOR_PASSWORD.length<32)throw new AppError(503,'operator_not_configured','Вход оператора пока не настроен.');
   const provided=await hash(password),expected=await hash(env.OPERATOR_PASSWORD);let diff=0;
   for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^provided.charCodeAt(i);
   if(diff)throw new AppError(401,'operator_login_failed','Неверный пароль оператора.');
   const value=[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join(''),now=Date.now();
   const setCookie=cookie(request,env,value,28800);
   await env.DB.batch([
    env.DB.prepare('INSERT INTO operator_sessions VALUES(?,?,?,?)').bind(await hash(value),now+28800000,expected,now),
    env.DB.prepare('DELETE FROM operator_sessions WHERE expires_at<? OR credential_hash<>?').bind(now,expected)
   ]);
   return Response.json({authenticated:true},{headers:{'Set-Cookie':setCookie}});
  }
 }
 if(!await authenticated(request,env))throw new AppError(401,'operator_session_required','Войдите в панель оператора.');
 if(path==='/api/operator/logout'&&method==='POST'){
  z.object({}).strict().parse(await readJson(request));
  await env.DB.prepare('DELETE FROM operator_sessions WHERE token_hash=?').bind(await hash(token(request)!)).run();
  return Response.json({authenticated:false},{headers:{'Set-Cookie':cookie(request,env,'',0)}});
 }
 if(path==='/api/operator/tickets'&&method==='GET'){
  const offset=z.coerce.number().int().min(0).max(100000).parse(url.searchParams.get('offset')||0);
  const customer=url.searchParams.has('customer_id')?z.string().min(1).max(80).parse(url.searchParams.get('customer_id')):null;
  const rows=await env.DB.prepare(`SELECT t.id,t.customer_id,t.subject,t.status,t.updated_at,c.display_name AS customer_name
   FROM tickets t JOIN customers c ON c.id=t.customer_id WHERE (? IS NULL OR t.customer_id=?)
   ORDER BY t.updated_at DESC,t.id LIMIT 51 OFFSET ?`).bind(customer,customer,offset).all();
  return Response.json({tickets:rows.results.slice(0,50),has_more:rows.results.length>50,offset});
 }
 const match=path.match(/^\/api\/operator\/tickets\/([a-zA-Z0-9-]{1,80})\/(messages|llm-calls)$/);
 if(match&&method==='GET'){
  const ticket=await env.DB.prepare('SELECT * FROM tickets WHERE id=?').bind(match[1]).first<Ticket>();
  if(!ticket)throw new AppError(404,'ticket_not_found','Обращение не найдено.');
  const before=url.searchParams.has('before')?z.coerce.number().int().positive().safe().parse(url.searchParams.get('before')):undefined;
  if(match[2]==='llm-calls')return Response.json(await llmLogs(env.DB,ticket.id,before));
  const {id,subject,status,escalation_reason,created_at,updated_at}=ticket;
  return Response.json({ticket:{id,subject,status,escalation_reason,created_at,updated_at},customer:await customerProfile(env.DB,ticket.customer_id),...await history(env.DB,ticket,before)});
 }
 throw new AppError(404,'not_found','Маршрут не найден.');
}
