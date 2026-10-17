import type { Env, CallScope } from './types';

export async function startCall(env:Env,scope:CallScope,phase:'search'|'answer',attempt:number,model:string) {
 const id=crypto.randomUUID(),started_at=Date.now();
 await env.DB.prepare(`INSERT INTO llm_calls(id,ticket_id,message_id,generation_id,phase,attempt_number,model,status,started_at)
 VALUES(?,?,?,?,?,?,?,'running',?)`).bind(id,scope.ticket_id,scope.message_id,scope.generation_id,phase,attempt,model,started_at).run();
 return {id,started_at};
}
export interface CallOutcome {status:'success'|'error';http_status:number|null;prompt_tokens:number|null;completion_tokens:number|null;total_tokens:number|null;error_code:string|null}
export function tokenCount(value:unknown):number|null {return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;}
export async function finishCall(env:Env,call:{id:string;started_at:number},outcome:CallOutcome) {
 const finished=Date.now();
 try {
  await env.DB.prepare(`UPDATE llm_calls SET status=?,http_status=?,prompt_tokens=?,completion_tokens=?,total_tokens=?,duration_ms=?,error_code=?,finished_at=? WHERE id=?`)
   .bind(outcome.status,outcome.http_status,outcome.prompt_tokens,outcome.completion_tokens,outcome.total_tokens,Math.max(0,finished-call.started_at),outcome.error_code,finished,call.id).run();
 }catch{
  // A telemetry outage must not discard a valid model answer or trigger another paid call.
  // The durable 'running' row remains visible as incomplete. Never log input/provider bodies.
  console.error(JSON.stringify({code:'llm_log_update_failed',call_id:call.id}));
 }
}
