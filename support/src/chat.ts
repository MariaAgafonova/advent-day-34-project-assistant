import { AppError, type Env, type Message, type Ticket } from './types';
import { ownTicket, history } from './db';
import { rateLimit } from './security';
import { crmContext } from './mcp-client';
import { queryTerms, answer } from './llm';
import { search } from './rag';

export async function sendMessage(env:Env,customer:string,ticket:Ticket,content:string,clientId:string) {
 const db=env.DB;
 const existing=await db.prepare('SELECT * FROM messages WHERE ticket_id=? AND client_message_id=?').bind(ticket.id,clientId).first<Message>();
 if(existing && existing.content!==content)throw new AppError(409,'message_id_conflict','Этот ID уже используется для другого сообщения.');
 if(existing?.processing_status==='complete')return {...await history(db,await ownTicket(db,ticket.id,customer)),ticket:await ownTicket(db,ticket.id,customer)};
 await rateLimit(db,'message:'+customer,10);
 const attempt=crypto.randomUUID(), messageId=existing?.id ?? crypto.randomUUID(),now=Date.now();
 // The UPDATE is the compare-and-swap. Every following write is fenced by its token.
 const acquired=await db.batch([
  db.prepare(`UPDATE tickets SET active_attempt=?,active_message=?,lease_until=?,updated_at=?
   WHERE id=? AND customer_id=? AND (active_attempt IS NULL OR lease_until<?)`)
   .bind(attempt,messageId,now+120000,now,ticket.id,customer,now),
  db.prepare(`UPDATE messages SET processing_status='failed',error_code='interrupted' WHERE ticket_id=? AND processing_status='processing'
   AND EXISTS(SELECT 1 FROM tickets WHERE id=? AND active_attempt=?)`).bind(ticket.id,ticket.id,attempt),
  db.prepare(`INSERT INTO messages(id,ticket_id,role,content,client_message_id,processing_status,created_at)
   SELECT ?,?,'user',?,?,'processing',? WHERE EXISTS(SELECT 1 FROM tickets WHERE id=? AND active_attempt=?)
   ON CONFLICT(ticket_id,client_message_id) DO UPDATE SET processing_status='processing',error_code=NULL`)
   .bind(messageId,ticket.id,content,clientId,now,ticket.id,attempt)
 ]);
 if(acquired[0].meta.changes!==1)throw new AppError(409,'ticket_busy','Ассистент уже готовит ответ в этом диалоге. Дождитесь завершения.',true);
 const signal=AbortSignal.timeout(90000);
 const scope={ticket_id:ticket.id,message_id:messageId,generation_id:attempt};
 try {
  const context=await crmContext(env,customer,ticket.id,signal);
  const query=await queryTerms(env,content,context.ticket,signal,scope);
  const sources=await search(db,query);
  const result=await answer(env,content,context.customer,context.ticket,sources,signal,scope);
  if(signal.aborted)throw new AppError(504,'generation_timeout','Время ожидания истекло. Повторите запрос.',true);
  const answerId=crypto.randomUUID(),finished=Date.now();
  const snapshots=sources.filter(s=>result.source_ids.includes(s.chunk_id));
  const saved=await db.batch([
   db.prepare(`INSERT INTO messages(id,ticket_id,role,content,reply_to,processing_status,sources_json,created_at)
    SELECT ?,?,'assistant',?,?,'complete',?,? WHERE EXISTS(SELECT 1 FROM tickets WHERE id=? AND active_attempt=? AND lease_until>?)`)
    .bind(answerId,ticket.id,result.answer,messageId,JSON.stringify(snapshots),finished,ticket.id,attempt,finished),
   db.prepare(`UPDATE messages SET processing_status='complete',error_code=NULL WHERE id=? AND EXISTS(SELECT 1 FROM messages WHERE id=?)`).bind(messageId,answerId),
   db.prepare(`UPDATE tickets SET status=CASE WHEN status='needs_human' THEN status ELSE ? END,
    escalation_reason=CASE WHEN status='needs_human' THEN escalation_reason ELSE ? END,
    active_attempt=NULL,active_message=NULL,lease_until=NULL,updated_at=? WHERE id=? AND active_attempt=? AND EXISTS(SELECT 1 FROM messages WHERE id=?)`)
    .bind(result.suggested_ticket_status,result.escalation_reason,finished,ticket.id,attempt,answerId)
  ]);
  if(saved[0].meta.changes!==1)throw new AppError(409,'attempt_expired','Попытка устарела. Обновите историю перед повтором.',true);
  const updated=await ownTicket(db,ticket.id,customer);
  return {ticket:updated,...await history(db,updated)};
 }catch(e){
  const error=e instanceof AppError?e:new AppError(503,'generation_failed','Не удалось подготовить ответ. Сообщение сохранено; повторите запрос.',true);
  await db.batch([
   db.prepare(`UPDATE messages SET processing_status='failed',error_code=? WHERE id=? AND processing_status!='complete' AND EXISTS(SELECT 1 FROM tickets WHERE id=? AND active_attempt=?)`).bind(error.code,messageId,ticket.id,attempt),
   db.prepare('UPDATE tickets SET active_attempt=NULL,active_message=NULL,lease_until=NULL WHERE id=? AND active_attempt=?').bind(ticket.id,attempt)
  ]).catch(()=>{});
  throw error;
 }
}
