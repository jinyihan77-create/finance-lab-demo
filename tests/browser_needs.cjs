const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const url = process.env.TEST_URL || 'http://127.0.0.1:8878/';
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const state=()=>page.evaluate(async()=> (await (await fetch('/api/assistant/state')).json()).state);
  const send=async text=>{await page.locator('#message').fill(text);await page.locator('#send').click();await page.waitForFunction(()=>!document.getElementById('send').disabled);assert.equal(await page.locator('#error').isVisible(),false);};
  try {
    await page.goto(url);await page.waitForFunction(()=>document.getElementById('save-state').textContent.includes('保存在本机'));
    await send('我只想记账，回答简短一点。工资到账了，午饭实付了，订阅了GPT Pro，计划买基金');
    for(const text of ['一万二千','十八元','200美元','计划3000元'])await send(text);
    let s=await state();assert.equal(s.records.length,4);assert.deepEqual(s.records.map(r=>r.status),['recorded','recorded','recorded','plan']);assert.equal(s.threads[0].pending,null);
    await page.locator('#open-results').click();await page.locator('[role=tab][data-panel=memory]').click();assert.match(await page.locator('#panel-content').innerText(),/只整理账本/);assert.match(await page.locator('#panel-content').innerText(),/简短反馈/);
    await page.screenshot({path:'artifacts/needs-desktop-memory.png'});
    await page.locator('[role=tab][data-panel=investment]').click();
    const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:'导出表格'}).click();const download=await downloadPromise;await download.saveAs('artifacts/needs-investment.csv');const csv=fs.readFileSync('artifacts/needs-investment.csv','utf8');assert.match(csv,/3000.00/);assert(!csv.includes('工资到账'));
    await page.locator('#close-panel').click();await send('今天吃饭花了28元');await send('吃饭改成30元');
    const choices=page.locator('.message.assistant').last().locator('[data-edit]');assert.equal(await choices.count(),2);await choices.last().click();await send('实付30元');assert.equal((await state()).records.at(-1).amount_cents,3000);
    await send('我想控制开支');assert.equal((await state()).threads[0].pending.field,'opening');await send('0');await send('6000元');await send('5000元');assert((await state()).summary.available_cents<0);
    await send('这次不要记住。计划买纳斯达克2000元');s=await state();assert.equal(s.records.at(-1).remember,false);assert(!s.memories.some(r=>r.id===s.records.at(-1).id));
    await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.message').length>0);assert.equal((await state()).profile.workflow,'budget_coach');
    await page.setViewportSize({width:390,height:844});await page.locator('#menu-toggle').click();await page.locator('#sidebar [data-panel=memory]').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:'artifacts/needs-mobile-memory.png'});await page.getByRole('button',{name:'忘记这些偏好'}).click();await page.waitForFunction(()=>!document.getElementById('send').disabled);assert.deepEqual((await state()).profile,{});
    const other=await browser.newContext();const otherPage=await other.newPage();await otherPage.goto(url);await otherPage.waitForFunction(()=>document.getElementById('save-state').textContent.includes('保存在本机'));assert.deepEqual(await otherPage.evaluate(async()=> (await (await fetch('/api/assistant/state')).json()).state.profile),{});await other.close();
    assert.deepEqual(errors,[]);fs.writeFileSync('artifacts/needs-browser-report.json',JSON.stringify({passed:true,errors,viewports:[1440,390],checks:['queued followups','record-only mode','preference panel','investment CSV download','ambiguous edit choices','budget switch','one-off memory choice','reload','forget preferences','separate visitor']},null,2));
    console.log('User needs browser acceptance passed.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1);});
