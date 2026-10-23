import { chartDomain, userError } from './ui-model.mjs';
export const $ = (s) => document.querySelector(s);
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
export const money = cents => new Intl.NumberFormat("zh-CN", { style:"currency", currency:"CNY" }).format(cents / 100);
export const pct = value => (value * 100).toFixed(2) + "%";
export const today = () => new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
export const tip = (label, id, copy) => '<span class="term-label">'+esc(label)+' <button type="button" class="tip-toggle" data-tip-toggle="'+esc(id)+'" aria-controls="'+esc(id)+'" aria-expanded="false" aria-label="解释 '+esc(label)+'">?</button></span><span class="tip-copy" id="'+esc(id)+'" hidden>'+esc(copy)+'</span>';
export async function api(path, body) {
  try {
    const response = await fetch(path, { signal: AbortSignal.timeout(15000), ...(body === undefined ? {} : { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) }) });
    let data;
    try { data = await response.json(); }
    catch { throw new Error('服务返回了无法读取的内容，请确认服务运行正常后重试。'); }
    if (!response.ok) throw new Error(data.error?.message || '请求失败，请稍后重试。');
    return data;
  } catch (error) { throw new Error(userError(error)); }
}
export function feedback(selector, message, state = 'loading') {
  const panel = $(selector);
  if (!panel) return;
  panel.hidden = !message; panel.textContent = message; panel.dataset.state = state;
  panel.setAttribute('role', state === 'error' ? 'alert' : 'status');
}
export async function busy(button, label, action) {
  if (button.disabled) return;
  const previous = button.textContent;
  button.disabled = true; button.textContent = label; button.setAttribute('aria-busy', 'true');
  try { return await action(); }
  finally { button.disabled = false; button.textContent = previous; button.removeAttribute('aria-busy'); }
}
export function toast(message) { $("#status").textContent = message; clearTimeout(toast.timer); toast.timer = setTimeout(() => $("#status").textContent = "", 5500); }
export function downloadLink(url) {
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = ""; anchor.hidden = true;
  document.body.append(anchor); anchor.click(); anchor.remove();
}
document.addEventListener("click",event=>{
  const anchor=event.target.closest('a[href^="#"]');
  if(anchor) {
    const target=document.getElementById(anchor.getAttribute('href').slice(1));
    if(target?.tagName==='DETAILS') target.open=true;
  }
  const button=event.target.closest("[data-reveal]");
  if(!button)return;
  const panel=document.getElementById(button.dataset.reveal);
  if(panel){ panel.scrollIntoView({behavior:"smooth",block:"start"});panel.focus({preventScroll:true}); }
});
document.addEventListener("click",event=>{
  const button=event.target.closest("[data-tip-toggle]");
  if(!button)return;
  const copy=document.getElementById(button.dataset.tipToggle);
  if(!copy)return;
  const open=copy.hidden;
  copy.hidden=!open;
  button.setAttribute("aria-expanded",String(open));
});
// The HTML can update while an old Node process still denies a new stylesheet.
// Surface the deployment mismatch instead of silently showing a broken layout.
if(getComputedStyle(document.body).getPropertyValue("--product-shell").trim()!=="ready" || getComputedStyle(document.body).getPropertyValue("--kosx-shell").trim()!=="ready"){
  const warning=document.createElement("p");
  warning.id="asset-warning";warning.className="notice";warning.setAttribute("role","alert");
  warning.textContent="新版样式未加载。请停止旧启动窗口，重新运行 npm start，然后刷新页面。";
  document.querySelector("main")?.prepend(warning);
}
export function chart(series, labels) {
  const colors = document.body.classList.contains("archive-workbench") ? ["#f3eee8","#b8ada0","#8b8278","#d0c7be"] : ["#ff8b38","#d6c1a8","#91c7ad","#b0a2dc"];
  const { low, high } = chartDomain(series.flatMap(s => s.values));
  const y = value => 185 - (value-low)/(high-low)*145;
  const x = i => 60 + i / Math.max(1,labels.length-1)*660;
  return '<svg class="chart" viewBox="0 0 780 230" role="img" aria-label="'+esc(series.map(s=>s.name).join('、'))+'走势"><line x1="60" x2="720" y1="'+y(0)+'" y2="'+y(0)+'" stroke="#777" stroke-dasharray="4 4"/>' +
    [low,(low+high)/2,high].map(v => '<line class="grid-line" x1="60" x2="720" y1="'+y(v)+'" y2="'+y(v)+'"/><text x="2" y="'+y(v)+'">'+v.toLocaleString("zh-CN",{maximumFractionDigits:Math.abs(high-low)<10?1:0})+'</text>').join("") +
    series.map((s,i) => '<polyline fill="none" stroke="'+colors[i%colors.length]+'" stroke-width="2.5" '+(i===1?'stroke-dasharray="6 4"':'')+' points="'+s.values.map((v,j)=>x(j)+","+y(v)).join(" ")+'"/>').join("") +
    labels.filter((_,i)=>i===0||i===labels.length-1||i===Math.floor(labels.length/2)).map((l,i,a)=>'<text text-anchor="middle" x="'+(60+i/Math.max(1,a.length-1)*660)+'" y="216">'+esc(l)+'</text>').join("") +
    '</svg><div class="legend">'+series.map((s,i)=>'<span><i class="dot" style="background:'+colors[i]+'"></i>'+esc(s.name)+'</span>').join("")+'</div>';
}
