import { buildInput, analyze, messages } from './tinglan-client.mjs';
const form = document.querySelector('#tinglan-form'), status = document.querySelector('#tinglan-status'), output = document.querySelector('#tinglan-result');
const button = form.querySelector('button[type=submit]');
let config = null, pending = null;
const show = (text, failed = false) => { status.textContent = text; status.setAttribute('role', failed ? 'alert' : 'status'); };
try {
  const response = await window.tinglanFetch(new URL('../tinglan-config.json', import.meta.url), { cache: 'no-store' });
  if (response.ok) config = await response.json();
} catch { /* An unavailable configuration must not trigger model traffic. */ }
if (!config?.endpoint) show('Demo 预览 · ' + messages.UNCONFIGURED);
else show('Live AI 待验证 · 提交后核验登录并调用 ' + config.model + '，当前尚未请求模型。');
if (config?.mode === 'SESSION') {
  const login = document.querySelector('#share-login'), logout = document.querySelector('#share-logout'), hint = document.querySelector('#share-login-status');
  const setAuthenticated = value => { login.hidden = value; logout.hidden = !value; form.hidden = !value; output.hidden = true; };
  setAuthenticated(false);
  try { const response = await window.tinglanFetch('/api/session', { cache:'no-store', credentials:'same-origin' }); const session = await response.json();setAuthenticated(response.ok && session.authenticated === true); } catch { show('无法核验分享会话，请检查网络。',true); }
  login.addEventListener('submit',async event => {
    event.preventDefault(); const submit = login.querySelector('button'); submit.disabled = true; hint.textContent = '正在验证访问口令…';
    try { const response = await window.tinglanFetch('/api/session', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'},body:JSON.stringify({code:login.elements.code.value}),signal:AbortSignal.timeout(10000) });
      if (!response.ok) { hint.textContent = response.status === 429 ? '登录尝试过多，请十分钟后再试。' : '访问口令无效或服务尚未配置。';return; }
      login.reset();setAuthenticated(true);show('已进入受保护的真实 AI 工作台。提交后调用 Qwen3.8，当前尚未请求模型。');
    } catch { hint.textContent = '登录网络失败，请重试。'; } finally { submit.disabled=false; }
  });
  logout.addEventListener('click',async()=>{try { const response=await window.tinglanFetch('/api/session',{method:'DELETE',credentials:'same-origin'});if(!response.ok)throw new Error();setAuthenticated(false);show('已退出分享会话。'); }catch{show('退出失败，请重试。',true);}});
  login.querySelector('button').disabled=false;
}
else form.hidden=false;
button.disabled = false;
form.addEventListener('input', () => { output.hidden = true; pending = null; show('输入已改变，请重新提交分析。'); });
form.addEventListener('submit', async event => {
  event.preventDefault(); if (button.disabled) return;
  output.hidden = true;
  let body;
  try {
    const values = Object.fromEntries(new FormData(form)); values.consent = form.elements.consent.checked;
    pending ??= crypto.randomUUID(); body = buildInput(values, pending);
  } catch (error) { show(messages[error.message] || messages.INVALID_REVIEW_INPUT, true); return; }
  button.disabled = true; form.setAttribute('aria-busy', 'true');
  form.querySelectorAll('input,select,textarea').forEach(node => { node.disabled = true; });
  show('正在核验权限并请求 AI 分析，请稍候…');
  const started = performance.now();
  try {
    const result = await analyze(config, body, window.tinglanFetch);
    for (const key of ['summary','reason','evidence','missing','raw']) output.querySelector('[data-result=' + key + ']').textContent = result[key];
    output.querySelector('[data-result=meta]').textContent = 'Live AI 模型返回 · ' + result.model + ' · ' + ((performance.now() - started) / 1000).toFixed(2) + ' 秒 · ' + (result.tokens === null ? '用量未返回' : result.tokens + ' tokens');
    output.querySelector('[data-result=trace]').textContent = '运行编号：' + result.runId + '\n审计编号：' + result.auditId;
    output.hidden = false; show('AI 分析已返回，等待风险复核；未执行交易。');
  } catch (error) { show(messages[error.message] || messages.SERVICE_UNAVAILABLE, true); }
  finally { button.disabled = false; form.removeAttribute('aria-busy'); form.querySelectorAll('input,select,textarea').forEach(node => { node.disabled = false; }); }
});
