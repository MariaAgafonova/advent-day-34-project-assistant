import { z } from 'zod';
export interface Env {
 DB: D1Database; CRM_MCP: Fetcher; ASSETS: Fetcher;
 MCP_INTERNAL_SECRET: string; DEEPSEEK_API_KEY: string; DEEPSEEK_MODEL: string;
 ALLOW_INSECURE_LOCAL?: string;
 OPERATOR_PASSWORD?: string;
}
export interface Customer { id:string; display_name:string; language:string; platform:string; app_version:string; created_at:number }
export interface CallScope { ticket_id:string; message_id:string; generation_id:string }
export interface LlmCall extends CallScope {
 seq:number; id:string; phase:'search'|'answer'; attempt_number:number; model:string;
 status:'running'|'success'|'error'; http_status:number|null; prompt_tokens:number|null;
 completion_tokens:number|null; total_tokens:number|null; duration_ms:number|null;
 error_code:string|null; started_at:number; finished_at:number|null;
}
export const statusSchema = z.enum(['open','waiting_for_customer','needs_human','resolved']);
export type TicketStatus = z.infer<typeof statusSchema>;
export interface Ticket {
 id: string; customer_id: string; subject: string; status: TicketStatus; escalation_reason: string | null;
 active_attempt: string | null; active_message: string | null; lease_until: number | null; created_at: number; updated_at: number;
}
export interface Source { chunk_id: string; document_id: string; path: string; heading: string; start_line: number; end_line: number; document_hash: string; text: string }
export interface Message { id: string; ticket_id: string; seq: number; role: 'user'|'assistant'; content: string; client_message_id: string | null; reply_to: string | null; processing_status: 'processing'|'failed'|'complete'; error_code: string | null; created_at: number; sources_json: string }
export const customerContextSchema = z.object({ language: z.string().max(16), platform: z.string().max(40), app_version: z.string().max(64), profile_origin: z.literal('user_reported') }).strict();
export const ticketContextSchema = z.object({ subject: z.string().max(160), status: statusSchema,
 history: z.array(z.object({ role: z.enum(['user','assistant']), content: z.string().max(4000) }).strict()).max(12),
 truncated: z.boolean(), facts: z.array(z.object({ text: z.string(), origin: z.enum(['user_reported','hypothesis']) })).max(8)
}).strict();
export type CustomerContext = z.infer<typeof customerContextSchema>;
export type TicketContext = z.infer<typeof ticketContextSchema>;
export const answerSchema = z.object({
 answer: z.string().trim().min(1).max(8000), source_ids: z.array(z.string().max(64)).max(6),
 needs_human: z.boolean(), escalation_reason: z.string().trim().max(500).nullable(), suggested_ticket_status: statusSchema
}).strict().superRefine((v,ctx) => {
 if (v.needs_human !== (v.suggested_ticket_status === 'needs_human') || (v.needs_human && !v.escalation_reason) || (!v.needs_human && v.escalation_reason !== null)) ctx.addIssue({code:'custom',message:'Inconsistent escalation'});
});
export type Answer = z.infer<typeof answerSchema>;
export class AppError extends Error {
 constructor(public status: number, public code: string, message: string, public retryable = false) { super(message); }
}
