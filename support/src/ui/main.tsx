import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {Customer} from '../types';
import {api,ApiError} from './api';
import {ProfileCard,LlmLogs,MessageView,statuses,type Chat,type UiTicket as Ticket} from './details';
import {OperatorApp} from './operator';
import './style.css';
import './details.css';
function Icon({name}:{name:'plus'|'arrow'|'chat'|'check'}){return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name==='plus'?<path d="M12 5v14M5 12h14"/>:name==='arrow'?<path d="m5 12 14 0m-6-6 6 6-6 6"/>:name==='check'?<path d="m5 12 4 4L19 6"/>:<path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z"/>}</svg>}
function App(){
 const [profile,setProfile]=useState<Customer|null>(null);
 const [tickets,setTickets]=useState<Ticket[]>([]),[current,setCurrent]=useState<string|null>(localStorage.getItem('support-ticket'));
 const [chat,setChat]=useState<Chat|null>(null),[draft,setDraft]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<ApiError|null>(null),[notice,setNotice]=useState('');
 const [pending,setPending]=useState<{content:string;client_message_id:string}|null>(null);
 const currentRef=useRef(current);currentRef.current=current;const end=useRef<HTMLDivElement>(null),textarea=useRef<HTMLTextAreaElement>(null);
 const processing=chat?.messages.some(m=>m.processing_status==='processing')??false;
 const failed=chat?.messages.slice().reverse().find(m=>m.role==='user'&&m.processing_status==='failed');
 const locked=busy||processing;
 async function list(){const result=await api<{tickets:Ticket[]}>('/tickets');setTickets(result.tickets);return result.tickets;}
 async function load(id:string){const value=await api<Chat>(`/tickets/${id}/messages`);if(currentRef.current===id)setChat(value);return value;}
 function select(id:string|null){setError(null);setNotice('');setChat(null);setDraft('');setCurrent(id);currentRef.current=id;id?localStorage.setItem('support-ticket',id):localStorage.removeItem('support-ticket');}
 useEffect(()=>{let live=true;(async()=>{try{await api('/session',{});const all=await list();const data=await api<{customer:Customer}>('/profile');if(!live)return;setProfile(data.customer);const saved=currentRef.current;if(saved&&!all.some(t=>t.id===saved))select(null);setReady(true);}catch(e){if(live)setError(e as ApiError);}})();return()=>{live=false;};},[]);
 useEffect(()=>{if(!ready||!current){setPending(null);return;}const id=current;load(id).catch(e=>setError(e));try{const saved=sessionStorage.getItem('support-pending:'+id);setPending(saved?JSON.parse(saved):null);}catch{setPending(null);}},[current,ready]);
 useEffect(()=>{if(!current||!processing||busy)return;const timer=setInterval(()=>load(current).catch(e=>setError(e)),2000);return()=>clearInterval(timer);},[current,processing,busy]);
 useEffect(()=>{if(pending && chat?.messages.some(m=>m.client_message_id===pending.client_message_id&&m.processing_status==='complete')){sessionStorage.removeItem('support-pending:'+chat.ticket.id);setPending(null);}},[chat,pending]);
 useEffect(()=>{end.current?.scrollIntoView({behavior:'smooth',block:'end'});},[chat?.messages.length,busy]);
 async function send(retry?:{content:string;client_message_id:string}){
  if(locked||!ready)return;const input=retry??{content:draft.trim(),client_message_id:crypto.randomUUID()};if(!input.content)return;
  if(!profile||profile.display_name==='Посетитель'){setError(new ApiError('Укажите имя в карточке профиля — так будет понятно, от кого обращение.','profile_required'));document.getElementById('customer-name')?.focus();return;}
  setBusy(true);setError(null);setNotice('');let id=current;
  try{
   if(!id){const created=await api<{ticket:Ticket}>('/tickets',{subject:input.content.slice(0,100)});id=created.ticket.id;select(id);setChat({ticket:created.ticket,customer:profile,messages:[],has_more:false});}
   sessionStorage.setItem('support-pending:'+id,JSON.stringify(input));setPending(input);setDraft('');
   const result=await api<Chat>(`/tickets/${id}/messages`,input);setChat(result);setPending(null);sessionStorage.removeItem('support-pending:'+id);await list();
  }catch(e){setError(e as ApiError);if(id)await load(id).catch(()=>{});}
  finally{setBusy(false);textarea.current?.focus();}
 }
 async function escalate(){if(!current)return;setError(null);try{const result=await api<{ticket:Ticket;message:string}>(`/tickets/${current}/escalate`,{});setChat(c=>c?{...c,ticket:result.ticket}:c);setNotice(result.message);await list();}catch(e){setError(e as ApiError);}}
 async function older(){if(!current||!chat?.messages.length)return;try{const old=await api<Chat>(`/tickets/${current}/messages?before=${chat.messages[0].seq}`);setChat({...old,messages:[...old.messages,...chat.messages]});}catch(e){setError(e as ApiError);}}
 const retryInput=failed?.client_message_id?{content:failed.content,client_message_id:failed.client_message_id}:pending;
 return <div className="app-shell">
  <aside className="sidebar" aria-label="Обращения">
   <a className="brand" href="/" aria-label="Daily Tasks, поддержка"><span className="brand-mark"><Icon name="check"/></span><span>Daily Tasks<small>ЦЕНТР ПОДДЕРЖКИ</small></span></a>
   <button className="new-chat" disabled={busy} onClick={()=>select(null)}><Icon name="plus"/>Новый диалог</button>
   <div className="sidebar-label">ВАШИ ОБРАЩЕНИЯ <span>{tickets.length.toString().padStart(2,'0')}</span></div>
   <nav className="ticket-list" aria-label="Предыдущие обращения">{tickets.length===0?<p className="sidebar-empty">Здесь появятся ваши диалоги.<br/>К ним можно вернуться позже.</p>:tickets.map(t=><button key={t.id} disabled={busy} aria-current={current===t.id?'page':undefined} className={'ticket '+(current===t.id?'selected':'')} onClick={()=>select(t.id)}><Icon name="chat"/><span><strong>{t.subject}</strong><small className="ticket-customer">{t.customer_name||profile?.display_name} · {t.customer_id?.slice(0,8)}</small><small><i className={'dot '+t.status}/>{statuses[t.status]}</small></span></button>)}</nav>
   <div className="sidebar-footer"><span className="quiet-badge">УЧЕБНЫЙ ПРОЕКТ · ДЕНЬ 33</span><p>Меньше забот.<br/>Больше времени на важное.</p><span className="footer-line">Daily Tasks <span>2026</span></span></div>
  </aside>
  <main>
   <header className="topbar"><div><span className="eyebrow">МЫ РЯДОМ</span><h1>Давайте разберёмся</h1></div><span className="ai-pill"><i/>AI-помощник</span></header>
   <div className="workspace">
    <section className="conversation" aria-label="Чат поддержки">
     <div className="conversation-heading"><div className="assistant-avatar">dt<span>✦</span></div><div><h2>{chat?.ticket.subject||'Поддержка Daily Tasks'}</h2><p>{chat?<span className={'status '+chat.ticket.status}>{statuses[chat.ticket.status]}</span>:'Задайте вопрос — начнём с него'}</p>{profile&&<p className="chat-owner">Клиент: <strong>{chat?.customer?.display_name||profile.display_name}</strong></p>}</div></div>
     <div className="messages" aria-live="polite" aria-relevant="additions text">
      {!chat?.messages.length&&!busy?<div className="welcome"><span className="welcome-symbol">✳</span><span className="eyebrow">ОДИН ВОПРОС — ПЕРВЫЙ ШАГ</span><h2>Чем помочь сегодня?</h2><p>Объясню, как устроен Daily Tasks,<br/>и помогу разобраться с трудностями.</p><div className="suggestions">{['Не приходит код на email','Не приходят уведомления','Как перенести задачу на завтра?'].map((q,i)=><button key={q} disabled={!ready} onClick={()=>{setDraft(q);textarea.current?.focus();}}><span className="suggestion-number">0{i+1}</span>{q}<Icon name="arrow"/></button>)}</div><span className="welcome-note">Не присылайте пароли, коды входа и токены.</span></div>:<>
       {chat?.has_more&&<button className="text-button" onClick={older}>Показать предыдущие сообщения</button>}
       {chat?.messages.map(m=><MessageView key={m.id} message={m} customerName={chat.customer?.display_name||profile?.display_name||'Вы'}/>)}
       {pending&&!chat?.messages.some(m=>m.client_message_id===pending.client_message_id)&&<article className="message user"><div className="message-meta">Вы</div><div className="bubble">{pending.content}</div></article>}
      </>}
      {locked&&<div className="thinking" role="status"><span className="thinking-dots">•••</span>Ассистент готовит ответ</div>}
      {chat?.ticket.status==='needs_human'&&<div className="escalation-note"><Icon name="check"/><div><strong>Запрос помощи специалиста сохранён</strong><p>Оператор пока не подключён. Переписка остаётся в этом обращении.</p></div></div>}
      {notice&&chat?.ticket.status!=='needs_human'&&<p role="status">{notice}</p>}
      {error&&<div className="error" role="alert"><strong>Не всё получилось</strong><p>{error.message}</p>{error.requestId&&<small>Номер запроса: {error.requestId}</small>}{!ready&&<button onClick={()=>location.reload()}>Обновить страницу</button>}</div>}
      {retryInput&&!locked&&<button className="retry-button" onClick={()=>send(retryInput)}>Повторить отправку без дубликата</button>}
      <div ref={end}/>
     </div>
     <form className="composer" onSubmit={e=>{e.preventDefault();void send();}}><label className="sr-only" htmlFor="question">Ваш вопрос</label><textarea id="question" ref={textarea} maxLength={4000} rows={2} value={draft} disabled={!ready||locked||!!retryInput} placeholder="Расскажите, что произошло…" onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/><div className="composer-bottom"><span>Enter — отправить <span className="desktop-hint">· Shift + Enter — новая строка</span></span><button className="send" type="submit" disabled={!ready||locked||!draft.trim()||!!retryInput} aria-label="Отправить сообщение"><Icon name="arrow"/></button></div></form>
     <p className="privacy-note">Отвечает AI на основе базы знаний. Если вопрос останется — запросите специалиста.</p>
    </section>
    <aside className="help-panel" aria-label="О поддержке">{profile&&<ProfileCard customer={chat?.customer||profile} onSave={value=>{setProfile(value);setChat(c=>c?{...c,customer:value}:c);setError(null);void list();}}/>}{current&&<LlmLogs key={current} path={`/tickets/${current}/llm-calls`} refreshKey={`${chat?.messages.length}:${busy}:${processing}:${error?.code}`}/>}<div className="human-card"><span className="small-star">✳</span><h3>Нужна помощь человека?</h3><p>Сохраним запрос специалисту вместе с этой перепиской.</p><button disabled={!current||chat?.ticket.status==='needs_human'} onClick={escalate}>Нужна помощь специалиста<Icon name="arrow"/></button><small>Открытие обращения оператором не означает подключение к переписке.</small></div><a className="operator-link" href="/operator">Панель оператора →</a></aside>
   </div>
  </main>
 </div>;
}
createRoot(document.getElementById('root')!).render(location.pathname.startsWith('/operator')?<OperatorApp/>:<App/>);
