import { AppError, type Ticket, type Message, type Customer, type LlmCall } from './types';
export async function customerProfile(db:D1Database,id:string) {
 const customer=await db.prepare('SELECT id,display_name,language,platform,app_version,created_at FROM customers WHERE id=?').bind(id).first<Customer>();
 if(!customer)throw new AppError(404,'customer_not_found','Клиент не найден.');
 return customer;
}
export async function llmLogs(db:D1Database,ticket:string,before=Number.MAX_SAFE_INTEGER) {
 const rows=await db.prepare('SELECT * FROM llm_calls WHERE ticket_id=? AND seq<? ORDER BY seq DESC LIMIT 51').bind(ticket,before).all<LlmCall>();
 return {calls:rows.results.slice(0,50),has_more:rows.results.length>50};
}
export async function ownTicket(db:D1Database,id:string,customer:string) {
 const ticket=await db.prepare('SELECT * FROM tickets WHERE id=? AND customer_id=?').bind(id,customer).first<Ticket>();
 if(!ticket) throw new AppError(404,'ticket_not_found','Обращение не найдено.');
 return ticket;
}
export async function history(db:D1Database,ticket:Ticket,before?:number) {
 const rows=await db.prepare('SELECT * FROM messages WHERE ticket_id=? AND seq<? ORDER BY seq DESC LIMIT 51').bind(ticket.id,before ?? Number.MAX_SAFE_INTEGER).all<Message>();
 const hasMore=rows.results.length>50;
 return {messages:rows.results.slice(0,50).reverse().map(m=>{
  const stale=m.processing_status==='processing' && (!ticket.active_attempt || (ticket.lease_until ?? 0)<Date.now());
  const {sources_json,...rest}=m; return {...rest,processing_status:stale?'failed':m.processing_status,error_code:stale?'interrupted':m.error_code,sources:JSON.parse(sources_json)};
 }),has_more:hasMore};
}
