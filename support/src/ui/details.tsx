import React,{useEffect,useState} from 'react';
import ReactMarkdown from 'react-markdown';
import type {Customer,LlmCall,Source,TicketStatus} from '../types';
import {api} from './api';
export type UiTicket={id:string;subject:string;status:TicketStatus;escalation_reason?:string;updated_at:number;customer_id?:string;customer_name?:string};
export type UiMessage={id:string;seq:number;role:'user'|'assistant';content:string;client_message_id:string|null;processing_status:string;created_at:number;sources:Source[]};
export type Chat={ticket:UiTicket;customer:Customer;messages:UiMessage[];has_more:boolean};
export const statuses:Record<TicketStatus,string>={open:'Открыто',waiting_for_customer:'Ждём вашего ответа',needs_human:'Нужна помощь специалиста',resolved:'Решено'};
const known=(value:string)=>value==='unknown'?'Не указано':value;
export function ProfileCard({customer,onSave}:{customer:Customer;onSave?:(customer:Customer)=>void}){
 const [editing,setEditing]=useState(customer.display_name==='Посетитель'&&!!onSave),[saving,setSaving]=useState(false),[message,setMessage]=useState('');
 const [form,setForm]=useState({display_name:customer.display_name==='Посетитель'?'':customer.display_name,language:customer.language,platform:customer.platform,app_version:customer.app_version==='unknown'?'':customer.app_version});
 useEffect(()=>{setForm({display_name:customer.display_name==='Посетитель'?'':customer.display_name,language:customer.language,platform:customer.platform,app_version:customer.app_version==='unknown'?'':customer.app_version});},[customer]);
 async function save(e:React.FormEvent){e.preventDefault();setSaving(true);setMessage('');try{const value=await api<{customer:Customer}>('/profile',{...form,app_version:form.app_version.trim()||'unknown'});onSave?.(value.customer);setEditing(false);setMessage('Профиль сохранён');}catch(e){setMessage((e as Error).message);}finally{setSaving(false);}}
 return <section className="profile-card" aria-label="Профиль клиента"><div className="detail-heading"><h3>Профиль клиента</h3>{onSave&&!editing&&<button className="text-button" onClick={()=>setEditing(true)}>Изменить</button>}</div>
  <strong className="customer-name">{customer.display_name}</strong><code className="customer-id">ID: {customer.id}</code>
  <dl><div><dt>Язык</dt><dd>{customer.language==='ru'?'Русский':customer.language==='en'?'English':customer.language}</dd></div><div><dt>Платформа</dt><dd>{known(customer.platform)}</dd></div><div><dt>Версия</dt><dd>{known(customer.app_version)}</dd></div><div><dt>В сервисе с</dt><dd>{new Date(customer.created_at).toLocaleDateString('ru')}</dd></div></dl>
  <small>Имя и сведения указаны клиентом. Личность владельца аккаунта не подтверждена.</small>
  {editing&&onSave&&<form className="profile-form" onSubmit={save}>
   <label htmlFor="customer-name">Имя клиента</label><input id="customer-name" required minLength={2} maxLength={80} autoComplete="name" value={form.display_name} onChange={e=>setForm({...form,display_name:e.target.value})}/>
   <label htmlFor="customer-language">Язык ответов</label><select id="customer-language" value={form.language} onChange={e=>setForm({...form,language:e.target.value})}><option value="ru">Русский</option><option value="en">English</option></select>
   <label htmlFor="customer-platform">Платформа</label><select id="customer-platform" value={form.platform} onChange={e=>setForm({...form,platform:e.target.value})}>{['unknown','Android','iOS','Web','Desktop'].map(v=><option key={v} value={v}>{known(v)}</option>)}</select>
   <label htmlFor="customer-version">Версия приложения</label><input id="customer-version" maxLength={64} placeholder="Например, 1.0" value={form.app_version} onChange={e=>setForm({...form,app_version:e.target.value})}/>
   <button type="submit" disabled={saving}>{saving?'Сохраняем…':'Сохранить профиль'}</button>{customer.display_name!=='Посетитель'&&<button type="button" className="text-button" onClick={()=>setEditing(false)}>Отмена</button>}
  </form>}{message&&<p role="status">{message}</p>}
 </section>;
}
export function MessageView({message:m,customerName}:{message:UiMessage;customerName:string}){
 return <article id={'message-'+m.id} className={'message '+m.role}><div className="message-meta">{m.role==='user'?customerName:'Daily Tasks · AI'}<time dateTime={new Date(m.created_at).toISOString()}>{new Date(m.created_at).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})}</time></div><div className="bubble"><ReactMarkdown skipHtml components={{img:()=>null,a:({children})=><span>{children}</span>}}>{m.content}</ReactMarkdown></div>{m.sources?.length>0&&<details className="sources"><summary>Источники ответа · {m.sources.length}</summary>{m.sources.map(s=><div className="source" key={s.chunk_id}><strong>{s.heading}</strong><small>{s.path} · строки {s.start_line}–{s.end_line}</small><p>{s.text}</p><code>{s.chunk_id.slice(0,12)}</code></div>)}</details>}{m.processing_status==='failed'&&<span className="failed-note">Сообщение сохранено. Ответ не получен.</span>}</article>;
}
export function LlmLogs({path,refreshKey}:{path:string;refreshKey?:string}){
 const [open,setOpen]=useState(false),[calls,setCalls]=useState<LlmCall[]>([]),[more,setMore]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 async function load(older=false){setLoading(true);setError('');try{const r=await api<{calls:LlmCall[];has_more:boolean}>(path+(older&&calls.length?'?before='+calls[calls.length-1].seq:''));setCalls(old=>older?[...old,...r.calls]:r.calls);setMore(r.has_more);}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 useEffect(()=>{setCalls([]);setMore(false);setError('');},[path]);
 useEffect(()=>{if(!open)return;let active=true;setLoading(true);api<{calls:LlmCall[];has_more:boolean}>(path).then(r=>{if(active){setCalls(r.calls);setMore(r.has_more);setError('');}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[path,open,refreshKey]);
 return <details className="llm-logs" onToggle={e=>setOpen(e.currentTarget.open)}><summary>Журнал LLM</summary>
  <p>Вызовы DeepSeek для поиска и ответа. Тексты сообщений, промпты и ключи сюда не записываются. Старые вызовы до включения журнала не восстановлены.</p>
  <button type="button" className="text-button" onClick={()=>load()} disabled={loading}>Обновить журнал</button>
  {error&&<p role="alert">{error}</p>}{loading&&<p role="status">Загрузка журнала…</p>}{!loading&&!error&&!calls.length&&<p>Вызовов пока нет.</p>}
  {calls.map(c=><article className="llm-call" key={c.id}><div className="call-heading"><strong>{c.phase==='search'?'Поиск по базе знаний':'Генерация ответа'}</strong><span className={'call-status '+c.status}>{c.status==='success'?'Успешно':c.status==='error'?'Ошибка':Date.now()-c.started_at>120000?'Не завершён':'Выполняется'}</span></div><time>{new Date(c.started_at).toLocaleString('ru')}</time><dl><div><dt>Модель</dt><dd>{c.model}</dd></div><div><dt>Попытка</dt><dd>{c.attempt_number}</dd></div><div><dt>Время</dt><dd>{c.duration_ms===null?'—':(c.duration_ms/1000).toFixed(2)+' с'}</dd></div><div><dt>HTTP</dt><dd>{c.http_status??'—'}</dd></div><div><dt>Токены вход / выход</dt><dd>{c.prompt_tokens??'—'} / {c.completion_tokens??'—'}</dd></div><div><dt>Всего токенов</dt><dd>{c.total_tokens??'Не сообщено API'}</dd></div></dl>{c.error_code&&<p className="log-error">{c.error_code}</p>}<small>Сообщение: {c.message_id.slice(0,8)} · Генерация: {c.generation_id.slice(0,8)}</small><code>{c.id}</code></article>)}
  {more&&<button className="text-button" disabled={loading} onClick={()=>load(true)}>Показать более ранние вызовы</button>}
 </details>;
}
