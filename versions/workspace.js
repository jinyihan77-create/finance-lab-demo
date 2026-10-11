import { initArchiveWorkbench } from './archive.js';
import { $, esc, api, toast, feedback, busy } from "./common.js";

const TIER_TEXT = {
  green: "绿色权限 · 自动执行",
  yellow: "黄色权限 · 明确确认",
  red: "红色权限 · 强验证",
  blocked: "已拦截",
};
const STATUS_TEXT = {
  done: "已完成",
  pending_confirmation: "等待确认",
  blocked: "已拦截",
  scheduled: "已排期",
  delegated: "已转交",
};
const NODE_STATUS_TEXT = {
  done: "已完成", pending: "待执行", blocked: "已拦截", scheduled: "已排期", skipped: "已跳过",
};

// —— 演示模式下的静态说明（仅元信息，不模拟执行结果）——
const STATIC_SCENARIOS = [
  { key: "bill", name: "账单分析", icon: "📊", desc: "消费分类统计、异常交易识别、月度/年度账单报告", tier_note: "绿（自动执行）", examples: ["这个月账单分析", "帮我看看有没有异常交易"] },
  { key: "transfer", name: "智能转账", icon: "💸", desc: "按人名/手机号转账、备注、定时转账、AA 收款", tier_note: "日累计≤1000 黄（确认）｜>1000 红（强验证）", examples: ["给陈大黄转500元备注聚餐", "给林粹转5000"] },
  { key: "card", name: "卡片管理", icon: "💳", desc: "卡查询、额度调整、交易限制、锁卡解锁、挂失", tier_note: "查询绿｜调整/锁卡黄｜挂失红（强验证）", examples: ["尾号8888的卡挂失", "锁一下尾号8888的信用卡"] },
  { key: "subscription", name: "订阅/代扣管理", icon: "🔁", desc: "自动识别订阅扣费、续费提醒、一键取消订阅", tier_note: "查询绿｜取消黄（确认）", examples: ["我有哪些订阅？", "取消健身房会员"] },
  { key: "wealth", name: "理财操作", icon: "🏦", desc: "组合体检、产品推荐与对比、风险评估、申赎（深度旗舰）", tier_note: "绿/红（申赎强验证）", examples: ["平安银行卖出 30%"] },
  { key: "cross_scene", name: "跨场景联动", icon: "🎂", desc: "检测「爱人生日」→ 锁定活期 → 生日前 2 天订花与蛋糕", tier_note: "计划绿｜锁定资金黄（确认）", examples: ["我爱人10月25日生日，锁定1000元活期"] },
];
const STATIC_TIERS = [
  { tier: "green", label: "绿色权限", items: "余额/交易记录查询、账单分析、订阅与续费查询、卡片状态查询、理财收益查询", policy: "确认意图后自动执行，无需二次确认" },
  { tier: "yellow", label: "黄色权限", items: "小额转账（日累计≤1000元）、订阅取消、额度/限额调整、锁卡解锁", policy: "执行前展示操作详情并获得明确确认" },
  { tier: "red", label: "红色权限", items: "大额转账（日累计>1000元）、卡片挂失/解挂、理财产品申赎", policy: "须通过人脸识别、短信验证码或 U 盾等多因子认证" },
];

let overview = null;
let lastResult = null;

const tierBadge = (tier, label) =>
  `<span class="tier-badge tier-${esc(tier || "green")}">${esc(label || TIER_TEXT[tier] || tier)}</span>`;

async function boot() {
  try {
    overview = await api("/api/scenarios/boot");
    renderStrip(overview);
    renderScenarios(overview.scenarios || []);
    renderTiers(overview.tier_matrix || []);
    renderBreaker(overview.breaker || {});
    renderExamples(overview.scenarios || []);
    $("#conn-stamp").textContent = "真链路已连接 · 团队后端";
    $("#backend-notice").hidden = true;
    $("#run").disabled = false;
  } catch (error) {
    overview = null;
    $("#conn-stamp").textContent = "演示模式 · 后端未连接";
    $("#backend-notice").hidden = false;
    $("#run").disabled = true;
    renderScenarios(STATIC_SCENARIOS, true);
    renderTiers(STATIC_TIERS, true);
    renderExamples(STATIC_SCENARIOS, true);
    renderBreaker({ locked: false, consecutive_failures: 0 }, true);
    $("#account-strip").innerHTML = `<span>账户状态未连接</span><span>真链路开启后展示余额与账户状态</span>`;
    feedback("#run-feedback", "团队后端未连接：请运行 python web/launch.py（127.0.0.1:8765）后刷新本页。", "error");
  }
}

function fmtYuan(value) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(Number(value || 0));
}

function renderStrip(data) {
  const cards = (data.cards || []).filter(c => c.status !== "lost").length;
  const subs = (data.subscriptions || []).length;
  $("#account-strip").innerHTML = [
    `<span>可用余额 <b>${fmtYuan(data.balance)}</b></span>`,
    `<span>今日累计转账 <b>${fmtYuan(data.daily_cumulative)}</b></span>`,
    `<span>卡片 <b>${cards}</b> 张</span>`,
    `<span>订阅 <b>${subs}</b> 个</span>`,
    `<span class="small muted">演示账户 · 未发生真实资金转移</span>`,
  ].join("");
}

function renderScenarios(scenarios, isStatic) {
  $("#scenario-grid").innerHTML = scenarios.map(s => `
    <article class="scenario-card${isStatic ? " is-static" : ""}">
      <div class="card-top"><span class="feature-icon">${esc(s.icon || "")}</span><span class="terminal-label">${esc((s.key || "").toUpperCase())}</span></div>
      <h3>${esc(s.name)}</h3>
      <p>${esc(s.desc)}</p>
      <p class="small muted">${esc(s.tier_note)}</p>
    </article>`).join("") + (isStatic ? `<p class="small muted">以上为静态能力说明；接入真链路后由后端实时提供。</p>` : "");
}

function renderTiers(tiers, isStatic) {
  $("#tier-matrix").innerHTML = tiers.map(t => `
    <article class="tier-card tier-${esc(t.tier)}">
      <div class="row"><h3>${esc(t.label)}</h3>${tierBadge(t.tier, t.label)}</div>
      <p><b>覆盖：</b>${esc(t.items)}</p>
      <p class="small muted"><b>策略：</b>${esc(t.policy)}</p>
    </article>`).join("") + (isStatic ? `<p class="small muted">以上为静态权限说明；接入真链路后由 tiers.py 唯一权威决定。</p>` : "");
}

function renderExamples(scenarios) {
  const chips = scenarios.flatMap(s => (s.examples || []).slice(0, 1).map(ex => ({ ex, note: s.tier_note })));
  $("#example-chips").innerHTML = chips.slice(0, 6).map(c =>
    `<button type="button" class="example-chip" data-example="${esc(c.ex)}" title="${esc(c.note)}">${esc(c.ex)}</button>`).join("");
  document.querySelectorAll(".example-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      $("#question").value = chip.dataset.example;
      $("#run").disabled = false;
      $("#question").focus();
    });
  });
}

function renderBreaker(breaker, isStatic) {
  const box = $("#breaker-box");
  if (!breaker || (!breaker.locked && !breaker.events?.length)) {
    box.innerHTML = `<p class="small muted">熔断状态：正常（连续安全事件 ${breaker?.consecutive_failures ?? 0}/${breaker?.threshold ?? 3}）。${
      isStatic ? "静态说明：接入真链路后实时展示。" : "红色强验证失败会累计安全事件，连续 3 次即锁定资金执行链路。"}</p>`;
    return;
  }
  const lockNote = breaker.locked
    ? `<p class="small danger"><b>⛔ 熔断锁定中：</b>${esc(breaker.reason || "连续安全事件超过阈值")}（锁定于 ${esc(breaker.locked_at || "—")}）。查询类仍可用，资金执行需人工恢复。</p>`
    : `<p class="small muted">连续安全事件 ${breaker.consecutive_failures}/${breaker.threshold}。再失败 ${Math.max(0, breaker.threshold - breaker.consecutive_failures)} 次将锁定资金执行链路。</p>`;
  box.innerHTML = lockNote
    + (breaker.locked ? `<button id="breaker-reset" class="secondary">人工确认恢复</button>` : "")
    + `<details class="compact-detail"><summary>安全事件记录</summary>${(breaker.events || []).slice().reverse().map(e =>
      `<p class="small">${esc(String(e.timestamp || e.ts || ""))} · ${esc(String(e.kind || e.type || e.reason || ""))}</p>`).join("") || `<p class="small muted">暂无事件。</p>`}</details>`;
  const resetBtn = $("#breaker-reset");
  if (resetBtn) resetBtn.addEventListener("click", async () => {
    if (!window.confirm("人工恢复将解除资金执行锁定。确定恢复吗？（该动作会进入审计）")) return;
    await busy(resetBtn, "恢复中…", async () => {
      try { const res = await api("/api/breaker/reset", {}); toast(res.message || "已恢复。"); await refreshSidebarState(); }
      catch (error) { toast(error.message); }
    });
  });
}

async function refreshSidebarState() {
  try {
    const [bootData, pendingData, auditData] = await Promise.all([
      api("/api/scenarios/boot"), api("/api/scenarios/pending"), api("/api/audit"),
    ]);
    overview = bootData;
    renderStrip(bootData);
    renderBreaker(bootData.breaker || {});
    renderPending((pendingData && pendingData.pending) || []);
    renderAudit(auditData.entries || []);
  } catch (error) { toast("状态刷新失败：" + error.message); }
}

// —— 任务发起 ——
$("#task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = $("#question").value.trim();
  if (!question) return;
  await busy($("#run"), "正在规划…", async () => {
    try {
      lastResult = null;
      $("#input-changed").hidden = true;
      const res = await api("/api/scenarios/run", { question });
      renderRun(res);
      $("#result-anchor").hidden = true;
      $("#results").hidden = false;
      $("#start-panel").open = false;
      $("#journey-analysis").classList.add("active");
      $("#result-summary").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
      feedback("#run-feedback", res.delegated ? "理财请求已转交旗舰闭环。" : "任务已执行，结论与回执见下。", "success");
    } catch (error) {
      feedback("#run-feedback", error.message, "error");
      toast(error.message);
    }
  });
});
$("#question").addEventListener("input", () => {
  $("#run").disabled = !$("#question").value.trim();
  if (lastResult) {
    $("#input-changed").hidden = false;
    $("#results").hidden = true;
    $("#result-anchor").hidden = false;
    lastResult = null;
  }
});

function renderRun(res) {
  const r = res.result || {};
  lastResult = res;
  const tier = r.tier || "green";
  $("#result-metrics").innerHTML = [
    ["场景", esc(r.scenario_label || r.scenario || "—"), "由闭集路由判定"],
    ["权限", TIER_TEXT[tier] || tier, "由确定性闸门决定"],
    ["状态", STATUS_TEXT[r.status] || r.status || "—", r.status === "pending_confirmation" ? "等待你的确认" : "已收口"],
    ["熔断事件", String((res.breaker || {}).consecutive_failures ?? 0) + " 次", (res.breaker || {}).locked ? "当前锁定中" : "安全"],
  ].map(m => `<article class="metric"><small>${m[0]}</small><strong>${m[1]}</strong><small>${esc(m[2])}</small></article>`).join("");

  $("#verdict-title").textContent = `${r.scenario_label || r.scenario || "任务"} · ${STATUS_TEXT[r.status] || r.status || "已执行"}`;
  $("#verdict-copy").textContent = r.message || "";
  const tag = $("#verdict-tag");
  tag.textContent = TIER_TEXT[tier] || tier;
  tag.className = `verdict-tag tier-text-${esc(tier)}`;

  const nodes = (r.plan && r.plan.nodes) || [];
  $("#dag-list").innerHTML = nodes.length
    ? `<ol class="dag-list">${nodes.map((n, i) => `
      <li class="dag-node node-${esc(n.status || "pending")}">
        <span class="dag-index">${String(i + 1).padStart(2, "0")}</span>
        <div><b>${esc(n.label)}</b><small class="terminal-label">${esc(n.tool || "")}</small></div>
        <span class="dag-status">${esc(NODE_STATUS_TEXT[n.status] || n.status || "待执行")}</span>
      </li>`).join("")}</ol>`
    : `<p class="small muted">该请求未生成任务节点（可能被拦截或超出银行场景）。</p>`;
  const intent = r.intent || {};
  $("#intent-note").textContent = intent.blocked
    ? "该请求在入口被拦截，未进入任何场景执行。"
    : `意图：${intent.label || intent.name || "—"}${intent.question ? "（原话已保留在审计中）" : ""}`;

  $("#evidence-data").innerHTML = renderEvidence(r.data);
  $("#evidence").textContent = JSON.stringify({
    scenario: r.scenario, intent: r.intent, plan: r.plan, tier: r.tier, status: r.status, data: r.data,
  }, null, 2);

  renderPending(res.pending || []);
  renderBreaker(res.breaker || {});
}

function renderEvidence(data) {
  if (!data || !Object.keys(data).length) return `<p class="small muted">本任务没有附加业务数据（如越界或拦截请求）。</p>`;
  const rows = [];
  for (const [key, value] of Object.entries(data)) {
    const display = value === null || value === undefined ? "—"
      : typeof value === "object" ? JSON.stringify(value) : String(value);
    rows.push(`<div class="evidence-row"><dt>${esc(key)}</dt><dd>${esc(display)}</dd></div>`);
  }
  return `<dl class="evidence-dl">${rows.join("")}</dl>`;
}

// —— 待确认事项 ——
function renderPending(items) {
  $("#pending-count").textContent = String(items.length);
  const list = $("#pending-list");
  if (!items.length) {
    list.innerHTML = `<p class="small muted">暂无待确认事项。发起一笔转账或卡片挂失试试。</p>`;
    $("#journey-evidence").classList.remove("active");
    $("#journey-evidence").setAttribute("aria-disabled", "true");
    return;
  }
  $("#journey-evidence").classList.add("active");
  $("#journey-evidence").removeAttribute("aria-disabled");
  list.innerHTML = items.map(p => `
    <article class="pending-item tier-${esc(p.tier || "yellow")}">
      <div class="row"><h3>${esc(p.message || "待确认操作")}</h3>${tierBadge(p.tier, p.tier === "red" ? "红色权限 · 强验证" : "黄色权限 · 确认")}</div>
      <p class="small muted">${esc(p.scenario || "")} · ${esc(p.created_at || "")} · 确认或拒绝都会进入审计</p>
      ${p.tier === "red" ? `
        <div class="verify-row">
          <label class="field"><span class="term-label">短信验证码（演示 Mock，任意 6 位数字）</span><input type="text" maxlength="6" inputmode="numeric" placeholder="6 位短信码" data-sms="${esc(p.id)}"></label>
          <label class="checkline"><input type="checkbox" data-face="${esc(p.id)}"><span>完成人脸识别（演示 Mock）</span></label>
          <button class="primary" data-confirm="${esc(p.id)}" data-red="1">强验证并执行</button>
        </div>`
        : `<div class="verify-row"><button class="primary" data-confirm="${esc(p.id)}">确认执行</button></div>`}
      <button class="subtle" data-cancel="${esc(p.id)}">拒绝该操作</button>
    </article>`).join("");
  list.querySelectorAll("[data-confirm]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.confirm;
      const verification = btn.dataset.red === "1" ? {
        sms_code: (list.querySelector(`[data-sms="${CSS.escape(id)}"]`) || {}).value || "",
        face_verified: !!(list.querySelector(`[data-face="${CSS.escape(id)}"]`) || {}).checked,
      } : undefined;
      await busy(btn, "提交中…", async () => {
        try {
          const res = await api("/api/scenarios/confirm", verification ? { id, verification } : { id });
          toast(res.message || "已确认。");
          await refreshSidebarState();
          if (res.breaker && res.breaker.locked) {
            $("#breaker-box").scrollIntoView({ behavior: "smooth", block: "start" });
          }
        } catch (error) {
          toast(error.message);
          await refreshSidebarState();
        }
      });
    });
  });
  list.querySelectorAll("[data-cancel]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!window.confirm("拒绝后该操作不会执行，并会进入审计。确定拒绝吗？")) return;
      await busy(btn, "提交中…", async () => {
        try {
          const res = await api("/api/scenarios/cancel", { id: btn.dataset.cancel });
          toast(res.message || "已拒绝。");
          await refreshSidebarState();
        } catch (error) { toast(error.message); }
      });
    });
  });
}

// —— 审计 ——
function renderAudit(entries) {
  const box = $("#audit-list");
  if (!entries.length) { box.innerHTML = `<p class="small muted">暂无审计记录。发起一次任务后再来看。</p>`; return; }
  const shown = entries.slice(-12).reverse();
  box.innerHTML = `<div class="audit-list">${shown.map(e => `
    <div class="audit-row">
      <span class="audit-dot ${e.result === "failure" ? "is-failure" : e.result === "pending" ? "is-pending" : ""}"></span>
      <div class="audit-main">
        <b>${esc(e.label || e.action || "审计事件")}</b>
        <span class="chip-chip ${e.result === "failure" ? "chip-red" : e.result === "pending" ? "chip-amber" : "chip-green"}">${e.result === "failure" ? "失败" : e.result === "pending" ? "待处理" : "成功"}</span>
        <p class="small muted">${esc(String(e.timestamp || e.ts || ""))} · ${esc(String(e.user_id || e.user || "demo_user"))}</p>
      </div>
      <details class="raw"><summary>原始记录</summary><pre>${esc(JSON.stringify(e, null, 2))}</pre></details>
    </div>`).join("")}</div>`;
}
$("#refresh-audit").addEventListener("click", async () => {
  await busy($("#refresh-audit"), "读取中…", async () => {
    try { const data = await api("/api/audit"); renderAudit(data.entries || []); }
    catch (error) { toast(error.message); }
  });
});

async function initAudit() {
  try { const data = await api("/api/audit"); renderAudit(data.entries || []); }
  catch (_) { $("#audit-list").innerHTML = `<p class="small muted">审计暂未读取（${window.FinanceLab ? window.FinanceLab.mode : "未知模式"}）。</p>`; }
}

boot();
initAudit();
initArchiveWorkbench();
