import { siteUrl } from "./site-context.mjs";
import { responseError } from "./workspace-model.mjs";
export const $ = (s) => document.querySelector(s);
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
export const money = cents => new Intl.NumberFormat("zh-CN", { style:"currency", currency:"CNY" }).format(cents / 100);
export const pct = value => (value * 100).toFixed(2) + "%";
export const today = () => new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
export const tip = (label, id, copy) => '<span class="term-label">'+esc(label)+' <button type="button" class="tip-toggle" data-tip-toggle="'+esc(id)+'" aria-controls="'+esc(id)+'" aria-expanded="false" aria-label="解释 '+esc(label)+'">?</button></span><span class="tip-copy" id="'+esc(id)+'" hidden>'+esc(copy)+'</span>';
export async function api(path, body) {
  const response = await fetch(siteUrl(path), body === undefined ? {} : { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
  const data = await response.json();
  const error = responseError(data, response.ok);
  if (error) throw error;
  return data;
}
export function healthCheckRequest({ riskProfile, portfolio, taskId = null, sessionId = null }) {
  return {
    contract_version: "investment-agent.v1",
    request_id: "req-" + (globalThis.crypto?.randomUUID?.() || Date.now() + "-" + Math.random().toString(16).slice(2)),
    operation: "PORTFOLIO_HEALTH_CHECK",
    context: { actor: "agent", environment: "demo", data_mode: "SYNTHETIC_REPLAY", task_id: taskId, session_id: sessionId },
    input: { risk_profile: riskProfile, portfolio }
  };
}
export function toast(message) { $("#status").textContent = message; clearTimeout(toast.timer); toast.timer = setTimeout(() => $("#status").textContent = "", 5500); }
export function downloadLink(url) {
  const anchor = document.createElement("a");
  anchor.href = siteUrl(url); anchor.download = ""; anchor.hidden = true;
  document.body.append(anchor); anchor.click(); anchor.remove();
}
document.addEventListener("click",event=>{
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
if(getComputedStyle(document.body).getPropertyValue("--product-shell").trim()!=="ready"){
  const warning=document.createElement("p");
  warning.id="asset-warning";warning.className="notice";warning.setAttribute("role","alert");
  warning.textContent="新版样式未加载。请停止旧启动窗口，重新运行 npm start，然后刷新页面。";
  document.querySelector("main")?.prepend(warning);
}
export function chart(series, labels) {
  const colors = ["#245b49","#b67845","#798d70","#404f71"];
  const values = series.flatMap(s => s.values), low = Math.min(0, ...values), high = Math.max(1, ...values);
  const y = value => 185 - (value-low)/(high-low)*145;
  const x = i => 60 + i / Math.max(1,labels.length-1)*660;
  return '<svg class="chart" viewBox="0 0 780 230" role="img" aria-label="数据走势"><line x1="60" x2="720" y1="'+y(0)+'" y2="'+y(0)+'" stroke="#bdcbbb" stroke-dasharray="4 4"/>' +
    [low,(low+high)/2,high].map(v => '<text x="2" y="'+y(v)+'">'+Math.round(v).toLocaleString("zh-CN")+'</text>').join("") +
    series.map((s,i) => '<polyline fill="none" stroke="'+colors[i]+'" stroke-width="3" points="'+s.values.map((v,j)=>x(j)+","+y(v)).join(" ")+'"/>').join("") +
    labels.filter((_,i)=>i===0||i===labels.length-1||i===Math.floor(labels.length/2)).map((l,i,a)=>'<text text-anchor="middle" x="'+(60+i/Math.max(1,a.length-1)*660)+'" y="216">'+esc(l)+'</text>').join("") +
    '</svg><div class="legend">'+series.map((s,i)=>'<span><i class="dot" style="background:'+colors[i]+'"></i>'+esc(s.name)+'</span>').join("")+'</div>';
}
