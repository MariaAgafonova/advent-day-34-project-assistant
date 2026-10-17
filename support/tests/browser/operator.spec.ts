import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
test('operator sees customer profile, history and LLM logs behind a separate login',async({page})=>{
 let password='test-only-operator-password';
 if(process.env.SUPPORT_URL){
  const vars=await readFile('.dev.vars','utf8');password=vars.match(/^OPERATOR_PASSWORD=(.+)$/m)?.[1].trim().replace(/^["']|["']$/g,'')||'';
  if(!password)throw new Error('Run npm run operator:setup before the live operator browser check');
 }else{
  let authenticated=false;
  const customer={id:'demo-auth',display_name:'Учебный клиент А',language:'ru',platform:'Android',app_version:'1.0-demo',created_at:1760000000000};
  const ticket={id:'demo-auth-ticket',customer_id:customer.id,customer_name:customer.display_name,subject:'Не приходит email-код',status:'waiting_for_customer',updated_at:Date.now()};
  await page.route('**/api/operator/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;let data:unknown={};
   if(path.endsWith('/session')){if(req.method()==='POST')authenticated=req.postDataJSON().password===password;data={authenticated};}
   else if(path.endsWith('/logout')){authenticated=false;data={authenticated};}
   else if(!authenticated){await route.fulfill({status:401,json:{error:{code:'operator_session_required',message:'Войдите'}}});return;}
   else if(path.endsWith('/tickets'))data={tickets:[ticket],has_more:false};
   else if(path.endsWith('/messages'))data={ticket,customer,has_more:false,messages:[{id:'m1',role:'user',content:'Спам уже проверил — письма нет.',created_at:Date.now(),processing_status:'complete',sources:[]}]};
   else if(path.endsWith('/llm-calls'))data={calls:[],has_more:false};
   await route.fulfill({json:data});
  });
 }
 await page.goto('/operator');await page.getByLabel('Пароль оператора').fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Обращения клиентов',exact:true})).toBeVisible();
 await page.locator('.operator-ticket').filter({hasText:'Учебный клиент А'}).first().click();
 await expect(page.getByRole('region',{name:'Профиль клиента'})).toContainText('demo-auth');await expect(page.getByRole('region',{name:'Профиль клиента'})).toContainText('Android');
 await expect(page.locator('.operator-conversation')).toContainText('Спам уже проверил');
 await page.locator('.llm-logs summary').click();await expect(page.getByText('Вызовов пока нет.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Все обращения этого клиента',exact:true}).click();await expect(page.getByRole('button',{name:'Показать всех клиентов',exact:true})).toBeVisible();
 await expect(page.locator('.operator-ticket')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:`artifacts/operator-${test.info().project.name}.png`,fullPage:true});
 await page.getByRole('button',{name:'Выйти',exact:true}).click();await expect(page.getByLabel('Пароль оператора')).toBeVisible();
 await page.reload();await expect(page.getByLabel('Пароль оператора')).toBeVisible();
});
