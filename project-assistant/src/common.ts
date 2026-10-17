import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const LIMITS = Object.freeze({ steps: 40, runMs: 600_000, modelMs: 60_000, toolMs: 10_000,
  fileBytes: 262_144, resultBytes: 24_576, totalBytes: 262_144, scanBytes: 33_554_432,
  files: 20_000, changes: 10, stagedBytes: 524_288 });
export class Fault extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const bytes = (data: unknown) => Buffer.byteLength(typeof data === 'string' ? data : JSON.stringify(data));
export const secretPattern = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b|(?:api[_-]?key|password|secret|access[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9+/_-]{24,}/i;
export function safeText(value: string) {
  if(secretPattern.test(value)) throw new Fault('secret_content', 'Текст содержит признаки секрета и исключён.');
  return value;
}
export function safeError(error: unknown) {
  if((error as NodeJS.ErrnoException)?.code==='ENOENT')return {code:'file_not_found',message:'Файл не найден.'};
  return error instanceof Fault ? { code: error.code, message: error.message } : { code: 'operation_failed', message: 'Операция не выполнена; детали исключены из журнала.' };
}
export function relative(value: string): string {
  if (!value || value.length > 1024 || /[\\:\x00-\x1f]/.test(value) || path.posix.isAbsolute(value) ||
      value.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))
    throw new Fault('invalid_path', 'Нужен относительный путь внутри репозитория без .., ссылок и специальных компонентов.');
  return value;
}
export function runId(value: string) {
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value)) throw new Fault('invalid_run', 'Недопустимый идентификатор запуска.');
  return value;
}
export async function atomicJson(file: string, value: unknown) {
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  try { await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await fs.rename(tmp, file); }
  finally { await fs.unlink(tmp).catch(() => {}); }
}
export const referenceSchema = z.object({ path: z.string(), start_line: z.number().int().positive(), end_line: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type Reference = z.infer<typeof referenceSchema>;
export function covers(reads:Reference[],ref:Reference) {
  if(ref.end_line<ref.start_line)return false;
  const spans=reads.filter(r=>r.path===ref.path&&r.sha256===ref.sha256).sort((a,b)=>a.start_line-b.start_line);
  let next=ref.start_line;
  for(const span of spans){if(span.end_line<next)continue;if(span.start_line>next)return false;next=span.end_line+1;if(next>ref.end_line)return true;}
  return false;
}
export const changeSchema = z.object({ path: z.string(), type: z.enum(['create','modify']), original_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), new_hash: z.string().regex(/^[a-f0-9]{64}$/), content: z.string(), original: z.string().nullable(), explanation: z.string(), sources: z.array(referenceSchema).min(1) }).strict();
export const manifestSchema = z.object({ version: z.literal(1), run: z.string(), root: z.string(), changes: z.array(changeSchema).max(LIMITS.changes), reads: z.array(referenceSchema), status: z.enum(['staged','applying','partial','applied']), applied: z.array(z.string()) }).strict();
export type Manifest = z.infer<typeof manifestSchema>;
export type Change = z.infer<typeof changeSchema>;
export type Rule = { path: string; scope: string; sha256: string; text: string };
