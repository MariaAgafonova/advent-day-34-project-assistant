import { AppError, type Env } from './types';
export async function hash(value: string) {
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function redact(text: string) {
 return text.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[email скрыт]')
 .replace(/\b(?:sk-|Bearer\s+)[a-zA-Z0-9_./-]+/gi,'[секрет скрыт]')
 .replace(/\b\d{4,8}\b/g,'[число скрыто]')
 .replace(/(?:пароль|password|токен|token|код(?:\s+входа)?)\s*[:=]\s*\S+/gi,'[секрет скрыт]');
}
export async function readJson(request: Request) {
 if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new AppError(415,'content_type','Ожидается JSON.');
 const reader = request.body?.getReader();
 if (!reader) throw new AppError(400,'invalid_json','Пустой запрос.');
 const chunks: Uint8Array[] = []; let size = 0;
 while (true) { const {done,value} = await reader.read(); if(done) break; size += value.byteLength;
  if(size>16384) { await reader.cancel(); throw new AppError(413,'body_too_large','Запрос слишком большой.'); } chunks.push(value); }
 const all = new Uint8Array(size); let offset=0; for(const c of chunks){all.set(c,offset);offset+=c.length;}
 try { return JSON.parse(new TextDecoder().decode(all)); } catch { throw new AppError(400,'invalid_json','Некорректный JSON.'); }
}
export function checkOrigin(request: Request) {
 const url = new URL(request.url);
 if(request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new AppError(403,'origin_denied','Обновите страницу и повторите запрос.');
}
export async function rateLimit(db: D1Database, key: string, limit: number, windowMs=60000) {
 const start = Math.floor(Date.now()/windowMs)*windowMs;
 const row = await db.prepare(`INSERT INTO rate_limits(key,window_start,count) VALUES(?,?,1)
 ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start=excluded.window_start THEN count+1 ELSE 1 END,window_start=excluded.window_start RETURNING count`).bind(key,start).first<{count:number}>();
 if(!row || row.count>limit) throw new AppError(429,'rate_limited','Слишком много запросов. Подождите минуту.',true);
}
export async function session(request: Request, env: Env): Promise<string | null> {
 const token = request.headers.get('cookie')?.match(/(?:^|;\s*)support_session=([a-f0-9]{64})(?:;|$)/)?.[1];
 if(!token) return null;
 return (await env.DB.prepare('SELECT customer_id FROM sessions WHERE token_hash=? AND expires_at>?').bind(await hash(token),Date.now()).first<{customer_id:string}>())?.customer_id ?? null;
}
export async function createSession(request: Request, env: Env) {
 const existing = await session(request,env);
 if(existing) return Response.json({authenticated:true,anonymous:true});
 await rateLimit(env.DB,'session:'+await hash(request.headers.get('CF-Connecting-IP') || 'local'),10);
 const url = new URL(request.url);
 const local = env.ALLOW_INSECURE_LOCAL === 'true' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(url.protocol!=='https:' && !local) throw new AppError(400,'https_required','Требуется HTTPS.');
 const token = [...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const now=Date.now(), id=crypto.randomUUID();
 await env.DB.batch([
  env.DB.prepare('INSERT INTO customers(id,display_name,created_at) VALUES(?,?,?)').bind(id,'Посетитель',now),
  env.DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hash(token),id,now+30*86400000,now),
  env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
  env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(now-86400000)
 ]);
 return Response.json({authenticated:true,anonymous:true},{headers:{'Set-Cookie':`support_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${local?'':'; Secure'}`}});
}
