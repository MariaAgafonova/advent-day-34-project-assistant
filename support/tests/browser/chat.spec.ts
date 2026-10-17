import {test,expect} from '@playwright/test';
test('chat: answer, sources, reload, persisted conversation and escalation',async({page})=>{
 if(!process.env.SUPPORT_URL){
  const customer={id:'customer-browser-fixture',display_name:'Посетитель',language:'ru',platform:'unknown',app_version:'unknown',created_at:Date.now()};
  const ticket={id:'browser-fixture',subject:'Как перенести задачу на завтра?',status:'open',updated_at:Date.now(),customer_id:customer.id,customer_name:customer.display_name};const messages:unknown[]=[];
  await page.route('**/api/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;let data:unknown={};
   if(path==='/api/session')data={authenticated:true,anonymous:true};
   else if(path==='/api/profile'){if(req.method()==='POST'){Object.assign(customer,req.postDataJSON());ticket.customer_name=customer.display_name;}data={customer};}
   else if(path==='/api/tickets')data=req.method()==='POST'?{ticket}:{tickets:messages.length?[ticket]:[]};
   else if(path.endsWith('/escalate')){ticket.status='needs_human';data={ticket,message:'Запрос помощи специалиста сохранён. Оператор пока не подключён.'};}
   else if(path.endsWith('/messages')){
    if(req.method()==='POST'){const input=req.postDataJSON();messages.push({id:'u1',seq:1,role:'user',...input,processing_status:'complete',created_at:Date.now(),sources:[]},{id:'a1',seq:2,role:'assistant',content:'Откройте меню задачи, выберите «Перенести», затем дату и подтвердите.',processing_status:'complete',created_at:Date.now(),sources:[{chunk_id:'fixture-source',heading:'Как перенести задачу на завтра',path:'knowledge/support/tasks.md',start_line:6,end_line:9,text:'Учебные правила. Перенос задачи — через меню и выбор даты.'}]});ticket.status='waiting_for_customer';}
    data={ticket,customer,messages,has_more:false};
   }
   else if(path.endsWith('/llm-calls'))data={has_more:false,calls:['answer','search'].map((phase,i)=>({seq:2-i,id:'call-'+phase,ticket_id:ticket.id,message_id:'u1',generation_id:'generation-fixture',phase,attempt_number:1,model:'test-model',status:'success',http_status:200,prompt_tokens:50,completion_tokens:10,total_tokens:60,duration_ms:100,started_at:Date.now(),finished_at:Date.now(),error_code:null}))};
   await route.fulfill({json:data});
  });
 }
 await page.goto('/');await expect(page.getByRole('heading',{name:'Чем помочь сегодня?'})).toBeVisible();
 await page.getByLabel('Имя клиента',{exact:true}).fill('Учебная Мария');await page.getByLabel('Платформа',{exact:true}).selectOption('Android');await page.getByLabel('Версия приложения',{exact:true}).fill('1.2-demo');await page.getByRole('button',{name:'Сохранить профиль',exact:true}).click();
 await expect(page.getByRole('region',{name:'Профиль клиента'}).getByText('Учебная Мария',{exact:true})).toBeVisible();
 await page.getByLabel('Ваш вопрос').fill('Как перенести задачу на завтра?');await page.getByLabel('Ваш вопрос').press('Enter');
 await expect(page.locator('.message.assistant')).toBeVisible();
 await page.locator('summary').first().click();await expect(page.locator('.source').first()).toBeVisible();
 const answer=await page.locator('.message.assistant .bubble').first().innerText();expect(answer.length).toBeGreaterThan(20);
 await page.locator('.llm-logs summary').click();await expect(page.getByText('Генерация ответа',{exact:true})).toBeVisible();await expect(page.getByText('Поиск по базе знаний',{exact:true})).toBeVisible();await expect(page.locator('.llm-call').first()).toContainText('Токены вход / выход');
 await page.reload();await expect(page.locator('.message.assistant .bubble').first()).toHaveText(answer);
 await expect(page.getByRole('region',{name:'Профиль клиента'})).toContainText('Учебная Мария');await expect(page.getByRole('region',{name:'Профиль клиента'})).toContainText('1.2-demo');
 await page.getByRole('button',{name:'Нужна помощь специалиста',exact:true}).click();await expect(page.getByText('Запрос помощи специалиста сохранён',{exact:true})).toBeVisible();
 await page.reload();await expect(page.getByText('Запрос помощи специалиста сохранён',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:`artifacts/chat-${test.info().project.name}.png`,fullPage:true});
});
