const $ = id => document.getElementById(id);
const labels = {income:'收入',expense:'生活',subscription:'订阅',investment:'投资',coupon:'优惠'};
const statuses = {recorded:'已记录 · 自述',plan:'计划 · 未执行',review:'待核对',request:'待查优惠'};
const titles = {overview:'我的概览',ledger:'生活账本',investment:'投资计划',memory:'记住的事'};
const budgetLabels = {opening:'月初可用现金',essentials:'本月剩余必要开支',buffer:'应急预留'};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = (n,c='CNY') => n == null ? '待补充' : `${c==='CNY'?'¥':'US$'}${(n/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const uuid = () => crypto.randomUUID();
let state = null, threadId = sessionStorage.getItem('finance-thread') || uuid(), busy = false, selected = null, panel = null, failedRequest = null;
let returnFocus = null;

async function api(path, body) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(),75000);
  try {
    const response = await fetch(`/api/assistant/${path}`,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json','X-Finance-Request':'1'}:{},body:body?JSON.stringify(body):undefined,signal:controller.signal});
    const type = response.headers.get('content-type') || '';
    if (!type.includes('application/json')) throw new Error('需要使用本地服务打开工作空间。连接恢复后可以重试。');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || '暂时无法保存，请重试。');
    return data;
  } catch(error) {
    if(error.name==='AbortError') throw new Error('这次等待有些久。草稿已保留，重试不会重复记账。');
    if(error instanceof TypeError) throw new Error('暂时无法连接工作空间。草稿已保留，请恢复连接后重试。');
    throw error;
  } finally { clearTimeout(timer); }
}
function showError(text='') { $('error').textContent=text; $('error').hidden=!text; }
function rememberThread(){ sessionStorage.setItem('finance-thread',threadId); }
function resize(){ $('message').style.height='auto'; $('message').style.height=Math.min($('message').scrollHeight,180)+'px'; }
function setBusy(value){
  busy=value; $('send').disabled=value; $('message').readOnly=value; $('new-chat').disabled=value;
  $('working').hidden=!value; $('save-state').textContent=value?'整理中，稍等一下':'对话和账本保存在本机';
  document.querySelectorAll('#history button,.record-actions button,.message-actions button').forEach(b=>b.disabled=value);
}
function chooseThread(id){
  if(busy) return;
  threadId=id; rememberThread(); selected=null; failedRequest=null; $('message').value=''; sessionStorage.removeItem('finance-draft'); showEdit(); showError(); resize(); render(); closeMenu(); $('message').focus();
}
function showEdit(){
  const row=state?.records.find(r=>r.id===selected);
  $('edit-context').hidden=!row;
  $('edit-context').querySelector('span').textContent=row?`正在修改：${row.title} · ${money(row.amount_cents,row.currency)}`:'';
  if(!row)$('message').placeholder='今天发了工资，买了会员，还想拿一部分做投资…';
}
function inlineRecords(rows){
  return `<details class="record-summary"><summary><span>已整理 ${rows.length} 项</span><span aria-hidden="true">展开 ↓</span></summary>${rows.map(r=>`<div class="inline-record"><div>${esc(r.title)}<small>${esc(r.occurred_on)} · ${esc(statuses[r.status])}</small></div><strong>${money(r.amount_cents,r.currency)}</strong></div>`).join('')}</details>`;
}
function render(){
  if(!state)return;
  const thread=state.threads.find(t=>t.id===threadId), messages=thread?.messages || [];
  $('welcome').hidden=messages.length>0; $('suggestions').hidden=messages.length>0;
  $('chat-title').textContent=thread?.title || '新对话';
  $('ledger-count').textContent=state.records.length || '';
  $('history').innerHTML=state.threads.length?state.threads.map(t=>`<button data-thread="${esc(t.id)}" aria-current="${t.id===threadId}">${esc(t.title)}</button>`).join(''):'<p class="empty-history">从今天的一件小事开始。</p>';
  $('messages').innerHTML=messages.map(m=>{
    if(m.role==='user')return `<article class="message user" aria-label="你">${esc(m.text)}</article>`;
    const rows=(m.record_ids || []).map(id=>state.records.find(r=>r.id===id)).filter(Boolean);
    return `<article class="message assistant" aria-label="Finance Lab"><div class="assistant-label"><span class="mini-k" aria-hidden="true">K</span>Finance Lab</div><div class="message-copy">${esc(m.text)}</div>${rows.length?inlineRecords(rows):''}<div class="message-actions">${(m.actions || []).map(a=>a.kind==='panel'?`<button data-panel="${esc(a.panel)}">${esc(a.label)} ↗</button>`:`<button data-ask="${esc(a.text)}">${esc(a.label)}</button>`).join('')}</div>${m.engine==='core-agent'?'<p class="message-meta">来自团队模型的分析 · 未执行资金操作</p>':''}</article>`;
  }).join('');
  if(panel)renderPanel(); showEdit();
  requestAnimationFrame(()=>{ $('chat-scroll').scrollTop=$('chat-scroll').scrollHeight; });
}
function empty(title,copy){ return `<div class="panel-empty"><h3>${esc(title)}</h3><p>${esc(copy)}</p></div>`; }
function financialRow(label,value){return `<div class="financial-row"><span>${esc(label)}</span><strong>${value}</strong></div>`;}
function renderPanel(){
  if(!state)return;
  $('panel-title').textContent=titles[panel];
  document.querySelectorAll('[role=tab]').forEach(b=>{ b.setAttribute('aria-selected',String(b.dataset.panel===panel)); b.tabIndex=b.dataset.panel===panel?0:-1; });
  const s=state.summary;
  if(panel==='overview'){
    let content=`<p class="panel-note">${esc(s.month)} · 根据你已记录的项目</p>`;
    if(!Object.keys(s.totals).length)content+=empty('先从一笔收支开始','告诉我实际到账或花了多少，数字会出现在这里。');
    for(const [currency,total] of Object.entries(s.totals))content+=`<section class="panel-section"><h3>${currency==='CNY'?'人民币':'美元 · 尚未折算'}</h3>${financialRow('已记录收入',money(total.income,currency))}${financialRow('生活与订阅',money(total.expense,currency))}${financialRow('投资流出',money(total.investment,currency))}${financialRow('卖出回款',money(total.proceeds,currency))}${financialRow('尚未执行的计划',money(total.planned,currency))}</section>`;
    content+=`<section class="panel-section"><h3>生活余量</h3>${s.available_cents==null?'<p class="panel-note">还需要了解现金和必要预留，才能判断生活费是否够用。</p><button class="quiet" data-ask="帮我梳理本月预算">在对话里补充</button>':`<p class="balance ${s.available_cents<0?'negative':''}">${money(s.available_cents)}</p><p class="panel-note">${s.available_cents<0?'计划与预留之后存在缺口，可以先推迟部分可选开支。':'已扣除计划和预留后的估算余量。'}</p>`}${Object.entries(s.budget).map(([k,v])=>financialRow(budgetLabels[k],money(v))).join('')}<p class="panel-note">人民币余量 = 月初现金 + 已记收入与回款 − 已记支出、投资流出、计划、必要开支与应急预留。${s.foreign_currency_unconverted?'外币未折算，实际余量可能更低。':''}</p></section><p class="panel-note">这是自述收支整理，不是总资产、实时持仓或收益。</p>`;
    $('panel-content').innerHTML=content; return;
  }
  let rows=panel==='memory'?state.memories:state.records.filter(r=>panel!=='investment'||r.kind==='investment');
  rows=[...rows].sort((a,b)=>b.occurred_on.localeCompare(a.occurred_on)||b.recorded_at.localeCompare(a.recorded_at));
  const intro=panel==='memory'?'重要事项按时间整理。忘记摘要后，原始对话和账本仍保留。':panel==='investment'?'计划与自述成交分开保存；尚未连接券商，不能作为已核验持仓。':'支持随时修改、删除和导出，待核对项目不计入收支。';
  let content=`<p class="panel-note">${intro}</p>`;
  if(panel==='memory'&&Object.keys(state.profile).length)content+=`<section class="panel-section"><h3>你的偏好</h3><p class="panel-note">${esc(Object.values(state.profile).join(' · '))}</p><button class="quiet" data-ask="忘记我的投资偏好">忘记这些偏好</button></section>`;
  if(!rows.length)content+=empty(panel==='memory'?'重点会留在这里':'目前还没有记录',panel==='memory'?'投资计划和大额事项会保留时间与来源，随时可移除。':'在对话里告诉我发生了什么，就能开始整理。');
  if(panel==='ledger')content+=`<div class="panel-tools"><span>${rows.length} 条记录</span><a class="quiet" href="/api/assistant/export" download>导出表格 ↓</a></div>`;
  content+=rows.map(r=>`<article class="panel-record"><time datetime="${esc(r.occurred_on)}">${esc(r.occurred_on)} · ${esc(labels[r.kind])}${r.attention==='high'?' · 重点':''}</time><div class="record-top"><h3>${esc(r.title)}</h3><strong>${money(r.amount_cents,r.currency)}</strong></div><span class="status-label ${esc(r.status)}">${esc(statuses[r.status])}</span>${(r.notes||[]).map(n=>`<p class="panel-note">${esc(n)}</p>`).join('')}<div class="record-actions">${panel==='memory'?`<button data-forget="${esc(r.id)}">忘记摘要</button>`:`<button data-edit="${esc(r.id)}">修改</button><button class="danger" data-delete="${esc(r.id)}">删除</button>`}</div></article>`).join('');
  $('panel-content').innerHTML=content;
}
function overlayState(){
  const compact=matchMedia('(max-width:950px)').matches;
  $('artifact-panel').setAttribute('role',compact?'dialog':'complementary');
  if(compact&&panel)$('artifact-panel').setAttribute('aria-modal','true');else $('artifact-panel').removeAttribute('aria-modal');
  const menu=$('app').classList.contains('menu-open');
  $('sidebar').inert=(matchMedia('(max-width:700px)').matches&&!menu)||(compact&&!!panel);
  $('chat-scroll').inert=compact&&!!panel;
  document.querySelector('.composer-wrap').inert=compact&&!!panel;
}
function openPanel(name){
  if(!titles[name])return;
  if(!panel)returnFocus=document.activeElement;
  closeMenu();panel=name;$('artifact-panel').hidden=false;$('app').classList.add('panel-open');renderPanel();overlayState();$('close-panel').focus();
}
function closePanel(){panel=null;$('artifact-panel').hidden=true;$('app').classList.remove('panel-open');overlayState();(returnFocus?.isConnected?returnFocus:$('message')).focus();}
function closeMenu(){ $('app').classList.remove('menu-open');$('sidebar-scrim').hidden=true;$('menu-toggle').setAttribute('aria-expanded','false');overlayState(); }
async function send(text=$('message').value){
  text=text.trim();if(!text||busy)return;
  const payload=failedRequest&&failedRequest.text===text&&failedRequest.record_id===selected?failedRequest:{text,thread_id:threadId,request_id:uuid(),record_id:selected};
  $('message').value=text;resize();setBusy(true);showError();
  try{
    const result=await api('message',payload);state=result.state;threadId=result.thread_id;rememberThread();failedRequest=null;selected=null;$('message').value='';sessionStorage.removeItem('finance-draft');render();resize();
  }catch(error){failedRequest=payload;showError(error.message);}
  finally{setBusy(false);$('message').focus();}
}
async function change(action,id){
  if(busy)return;
  if(action==='delete'&&!confirm('删除这条账本记录？统计会一起更新，原始对话仍保留。'))return;
  setBusy(true);showError();
  try{state=(await api('record',{action,id})).state;render();}catch(error){showError(error.message);}finally{setBusy(false);}
}
$('composer').addEventListener('submit',e=>{e.preventDefault();send();});
$('message').addEventListener('input',()=>{resize();sessionStorage.setItem('finance-draft',$('message').value);});
$('message').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&matchMedia('(min-width:701px)').matches){e.preventDefault();send();}});
$('new-chat').addEventListener('click',()=>chooseThread(uuid()));
$('close-panel').addEventListener('click',closePanel);
$('cancel-edit').addEventListener('click',()=>{selected=null;showEdit();$('message').focus();});
$('sidebar-scrim').addEventListener('click',()=>{closeMenu();$('menu-toggle').focus();});
$('menu-toggle').addEventListener('click',()=>{const value=!$('app').classList.contains('menu-open');$('app').classList.toggle('menu-open',value);$('sidebar-scrim').hidden=!value;$('menu-toggle').setAttribute('aria-expanded',String(value));overlayState();if(value)$('new-chat').focus();});
$('about').addEventListener('click',()=>{closeMenu();$('about-dialog').showModal();});
$('close-about').addEventListener('click',()=>$('about-dialog').close());
document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.panel)openPanel(b.dataset.panel);
  if(b.dataset.thread)chooseThread(b.dataset.thread);
  if(b.dataset.ask){if(panel&&matchMedia('(max-width:950px)').matches)closePanel();send(b.dataset.ask);}
  if(b.dataset.edit){selected=b.dataset.edit;showEdit();if(matchMedia('(max-width:950px)').matches)closePanel();$('message').value='';$('message').placeholder='告诉我准确的金额，例如：实付 28 元';$('message').focus();}
  if(b.dataset.delete)change('delete',b.dataset.delete);
  if(b.dataset.forget)change('forget',b.dataset.forget);
  if(b.dataset.suggestion){
    const examples={mixed:'今天工资到账12000元，打算拿工资的30%投纳斯达克。订阅GPT Pro花了200美元，中午吃饭实付18元。帮我找美团猪脚饭优惠券。今天真烦，天气也不好。',summary:'看看这个月的收支',memory:'你记住了什么'};
    $('message').value=examples[b.dataset.suggestion];resize();$('message').focus();
  }
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){if(panel)closePanel();else{closeMenu();$('menu-toggle').focus();}}
  if(e.target.matches('[role=tab]')&&['ArrowLeft','ArrowRight'].includes(e.key)){
    e.preventDefault();const keys=Object.keys(titles);panel=keys[(keys.indexOf(panel)+(e.key==='ArrowRight'?1:3))%4];renderPanel();document.querySelector(`[role=tab][data-panel="${panel}"]`).focus();
  }
  const modal=panel&&matchMedia('(max-width:950px)').matches?$('artifact-panel'):$('app').classList.contains('menu-open')?$('sidebar'):null;
  if(e.key==='Tab'&&modal){const focusable=[...modal.querySelectorAll('button:not(:disabled),a[href]')].filter(el=>el.tabIndex>=0);const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
});
window.addEventListener('resize',overlayState);
$('message').value=sessionStorage.getItem('finance-draft') || '';resize();overlayState();
try{state=(await api('state')).state;render();$('save-state').textContent='对话和账本保存在本机';}catch(error){showError(error.message);}
