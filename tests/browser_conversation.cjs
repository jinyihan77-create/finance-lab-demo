const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const url=process.env.TEST_URL || 'http://127.0.0.1:8878/';
const mixed='今天工资到账12000元，打算拿工资的30%投纳斯达克。订阅GPT Pro花了200美元，中午吃饭实付18元。帮我找美团猪脚饭优惠券。今天真烦，天气也不好。';
const out=path.resolve('artifacts');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const read=()=>page.evaluate(async()=> (await (await fetch('/api/assistant/state')).json()).state);
 const send=async text=>{await page.locator('#message').fill(text);await page.locator('#send').click();await page.waitForFunction(()=>!document.getElementById('send').disabled,{},{timeout:80000});await page.locator('#error').waitFor({state:'hidden'});};
 try {
 await page.goto(url);await page.waitForFunction(()=>document.getElementById('save-state').textContent.includes('保存在本机'));
 assert.equal((await read()).records.length,0);
 await page.screenshot({path:path.join(out,'desktop-home.png')});
 const hit=await page.locator('#message').evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;});assert(hit);
 await page.locator('#message').click();await page.keyboard.type('editable draft');await page.keyboard.press('Control+A');await page.keyboard.press('Backspace');assert.equal(await page.locator('#message').inputValue(),'');
 await send(mixed);let s=await read();assert.equal(s.records.length,5);assert.equal(s.summary.totals.CNY.planned,360000);assert.equal(s.summary.totals.USD.expense,20000);
 await send('0');await send('6000元');await send('5000元');s=await read();assert.equal(s.summary.available_cents,-261800);
 await send('午饭其实实付28元');s=await read();assert.equal(s.records.length,5);assert.equal(s.summary.totals.CNY.expense,2800);
 await page.locator('#open-results').click();assert((await page.locator('#panel-content').innerText()).includes('-2,628.00'));
 await page.screenshot({path:path.join(out,'desktop-conversation.png')});
 await page.locator('[role=tab][data-panel=ledger]').click();await page.locator(`[data-edit="${s.records.find(r=>r.kind==='expense').id}"]`).click();await send('实付29元');s=await read();assert.equal(s.records.length,5);assert.equal(s.summary.totals.CNY.expense,2900);
 const csv=await context.request.get(new URL('/api/assistant/export',url).href);assert.equal(csv.status(),200);assert((await csv.text()).includes('用户自述'));
 await page.locator('[role=tab][data-panel=memory]').click();const before=s.memories.length;await page.locator('[data-forget]').first().click();await page.waitForFunction(()=>!document.getElementById('send').disabled);s=await read();assert.equal(s.memories.length,before-1);
 await page.locator('#close-panel').click();await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.message').length>0);assert.equal((await read()).records.length,5);
 await page.locator('#new-chat').click();await page.locator('#welcome').waitFor({state:'visible'});await send('今天打车花了35元');assert.equal((await read()).threads.length,2);
 await page.locator('#history button').last().click();assert((await page.locator('#messages').innerText()).includes('工资到账12000'));
 await page.route('**/api/assistant/message',route=>route.abort());await page.locator('#message').fill('今天晚饭实付36元');await page.locator('#send').click();await page.locator('#error').waitFor();assert.equal(await page.locator('#message').inputValue(),'今天晚饭实付36元');await page.unroute('**/api/assistant/message');await send('今天晚饭实付36元');assert.equal((await read()).records.length,7);
 page.on('dialog',d=>d.accept());await page.locator('#open-results').click();await page.locator('[role=tab][data-panel=ledger]').click();await page.locator('[data-delete]').first().click();await page.waitForFunction(()=>!document.getElementById('send').disabled);assert.equal((await read()).records.length,6);await page.locator('#close-panel').click();
 if(process.argv.includes('--live'))await send('结合已记录的信息，帮我分析生活与投资安排');
 if(process.argv.includes('--live')){s=await read();const id=await page.evaluate(()=>sessionStorage.getItem('finance-thread'));const answer=s.threads.find(t=>t.id===id).messages.at(-1);fs.writeFileSync(path.join(out,'live-review-latest.json'),JSON.stringify({engine:answer.engine,model:answer.model,text:answer.text},null,2));assert.equal(answer.engine,'core-agent');assert.equal(answer.model.execution_allowed,false);}
 const isolated=await browser.newContext();const other=await isolated.newPage();await other.goto(url);await other.waitForFunction(()=>document.getElementById('save-state').textContent.includes('保存在本机'));assert.equal((await other.evaluate(async()=> (await (await fetch('/api/assistant/state')).json()).state)).records.length,0);await isolated.close();
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});await page.locator('#menu-toggle').click();await page.locator('#new-chat').click();await page.screenshot({path:path.join(out,`mobile-${width}-home.png`)});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#menu-toggle').click();await page.locator('#sidebar [data-panel=ledger]').click();await page.locator('#artifact-panel').waitFor({state:'visible'});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(out,`mobile-${width}-ledger.png`)});await page.keyboard.press('Escape');await page.locator('#artifact-panel').waitFor({state:'hidden'});
  await page.locator('#message').click();await page.keyboard.type('delete me');await page.keyboard.press('Control+A');await page.keyboard.press('Backspace');assert.equal(await page.locator('#message').inputValue(),'');
 }
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({passed:true,viewports:[1440,390,320],liveModel:process.argv.includes('--live'),pageErrors:errors,checks:['mixed entry','budget followups and zero','natural correction','panel edit','CSV','forget','reload','threads','failed network draft and retry','delete','session isolation','mobile hit and edit','no horizontal overflow']},null,2));
 console.log('Browser acceptance passed; screenshots and evidence are in artifacts/.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
