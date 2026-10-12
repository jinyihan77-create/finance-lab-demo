import { initArchiveWorkbench } from './archive.js';
import { $, esc, api, toast, feedback, busy } from "./common.js";

const TIER_TEXT = { green: "绿色权限 · 自动执行", red: "红色权限 · 强验证" };
const NODE_STATUS_TEXT = { done: "通过", pending: "待执行", blocked: "未通过", scheduled: "已排期", skipped: "已跳过" };
const EXAMPLES = ["平安银行卖出30%", "申购沪深300指数基金", "帮我看下组合要不要调整"];

let lastResult = null;
let running = false;
let approvals = [];
const IS_PAGES = /github\.io$/.test(location.hostname);

const DEMO_WEALTH = {
  queued: false, engine: "公开演示数据", data_tag: "公开演示数据",
  recommendation: {
    action: "卖出", symbol: "000001", name: "平安银行", quantity: 1500, price: 10.5, amount: 15750,
    reason: "用户要求减持 平安银行 约 30%（公开演示样例）",
    evidence: ["公开演示版展示固定样例", "不接真后端、不构成投资建议"],
    risk_impact: "减持后释放约 15,750 元",
  },
  gate: { passed: true, checks: [
    { name: "操作类型有效性", passed: true, detail: "操作 卖出" },
    { name: "交易量有效性", passed: true, detail: "1,500 股 ≤ 持仓 5,000 股" },
    { name: "权限分级判定", passed: true, detail: "红色权限 · 需强验证" },
  ] },
  whatif: {
    verdict: "执行后 1 项改善、1 项恶化、3 项无变化，风险评分 -1.7 分，效果中性，可结合个人判断。",
    deltas: [{ metric: "最大行业集中度", before: 50.0, after: 45.0 }],
    caveats: ["公开演示数据，未计入手续费、印花税", "不构成对未来收益的判断"],
  },
  plan: { nodes: [
    { id: "validate", label: "校验输入与权限", tool: "intent_router", status: "done" },
    { id: "market", label: "读取持仓与行情", tool: "market_fetcher", status: "done" },
    { id: "gate", label: "风控闸门", tool: "risk_gate", status: "done" },
    { id: "confirm", label: "强验证与用户确认", tool: "approval_manager", status: "done" },
  ] },
  risk_alert: "公开演示数据 · 不构成投资建议",
  assistant_message: "公开演示版：展示理财旗舰完整链路（体检 → 风控闸门 → 情景推演 → 确认），数据为固定样例。",
};

const tierBadge = (tier, label) =>
  `<span class="tier-badge tier-${esc(tier || "green")}">${esc(label || TIER_TEXT[tier] || tier)}</span>`;

async function boot() {
  if (IS_PAGES) {
    $("#conn-stamp").textContent = "公开演示版 · 固定样例";
    $("#example-chips").innerHTML = EXAMPLES.map(ex =>
      `<button type="button" class="example-chip" data-example="${esc(ex)}">${esc(ex)}</button>`).join("");
    document.querySelectorAll(".example-chip").forEach(chip => {
      chip.addEventListener("click", () => { $("#question").value = chip.dataset.example; $("#run").disabled = false; runReview(); });
    });
    $("#run").disabled = !$("#question").value.trim();
    return;
  }
  try {
    await api("/api/bootstrap");
    $("#conn-stamp").textContent = "真链路已连接 · 团队后端";
  } catch (_) {
    $("#conn-stamp").textContent = "演示模式 · 后端未连接";
  }
  $("#example-chips").innerHTML = EXAMPLES.map(ex =>
    `<button type="button" class="example-chip" data-example="${esc(ex)}">${esc(ex)}</button>`).join("");
  document.querySelectorAll(".example-chip").forEach(chip => {
    chip.addEventListener("click", () => { $("#question").value = chip.dataset.example; $("#run").disabled = false; runReview(); });
  });
  await refreshApprovals();
  $("#run").disabled = !$("#question").value.trim();
}

$("#check-form").addEventListener("submit", (event) => {
  event.preventDefault();
  runReview();
});
$("#question").addEventListener("input", () => {
  $("#run").disabled = !$("#question").value.trim();
});

async function runReview() {
  const question = $("#question").value.trim();
  if (!question || running) return;
  running = true;
  $("#run").disabled = true;
  $("#result-anchor").hidden = true;
  $("#results").hidden = false;
  $("#result-metrics").innerHTML = `<article class="metric"><small>状态</small><strong>正在体检…</strong><small>${esc(question)}</small></article>`;
  try {
    let data;
    if (IS_PAGES) {
      data = DEMO_WEALTH;
    } else {
      data = await api("/api/review", { question });
    }
    lastResult = data;
    renderReview(data);
    await refreshApprovals();
    toast(IS_PAGES ? "公开演示数据：已展示固定样例。" : (data.queued ? "体检完成，建议已进入待确认（红色权限）。" : "体检完成，结果在下面。"));
  } catch (error) {
    $("#verdict-title").textContent = "出了点问题";
    $("#verdict-copy").textContent = error.message;
    feedback("#run-feedback", error.message, "error");
    toast(error.message);
  } finally {
    running = false;
    $("#run").disabled = !$("#question").value.trim();
  }
}

function renderReview(data) {
  const rec = data.recommendation || {};
  const gate = data.gate || {};
  const whatif = data.whatif || {};
  const tier = data.queued ? "red" : "green";

  $("#result-metrics").innerHTML = [
    ["建议", `${rec.action || "—"} ${rec.name || rec.symbol || ""} ${rec.quantity ?? ""} 股`, rec.amount ? `约 ¥${Number(rec.amount).toLocaleString("zh-CN")}` : ""],
    ["权限", TIER_TEXT[tier] || tier, data.queued ? "待确认面板等你点头" : "已自动执行"],
    ["风控闸门", gate.passed === false ? "已拦截" : "通过", `${(gate.checks || []).length} 项确定性检查`],
  ].map(m => `<article class="metric"><small>${m[0]}</small><strong>${esc(m[1])}</strong><small>${esc(m[2])}</small></article>`).join("");

  $("#verdict-title").textContent = `${rec.action || "建议"} ${rec.name || rec.symbol || ""} ${rec.quantity ?? ""} 股${data.queued ? " · 等待你确认" : " · 已执行"}`;
  $("#verdict-copy").textContent = data.assistant_message || rec.reason || "";
  const tag = $("#verdict-tag");
  tag.textContent = TIER_TEXT[tier] || tier;
  tag.className = `verdict-tag tier-text-${esc(tier)}`;

  const nodes = (data.plan && data.plan.nodes) || [];
  const gateChecks = (gate.checks || []).map((c, i) => ({
    id: `gate-${i}`, label: c.name, tool: c.detail || "", status: c.passed ? "done" : "blocked",
  }));
  const allNodes = nodes.length ? nodes : gateChecks;
  $("#dag-list").innerHTML = `<ol class="dag-list">${allNodes.map((n, i) => `
    <li class="dag-node node-${esc(n.status || "pending")}">
      <span class="dag-index">${String(i + 1).padStart(2, "0")}</span>
      <div><b>${esc(n.label)}</b></div>
      <span class="dag-status">${esc(NODE_STATUS_TEXT[n.status] || n.status || "待执行")}</span>
    </li>`).join("")}</ol>`;
  $("#intent-note").textContent = [
    data.risk_alert || "",
    whatif.verdict || "",
    data.data_tag || "",
  ].filter(Boolean).join(" · ");

  $("#evidence-data").innerHTML = `<dl class="evidence-dl">${[
    `<div class="evidence-row"><dt>操作</dt><dd>${esc(`${rec.action || "操作"} ${rec.name || rec.symbol || ""} ${rec.quantity ?? ""} 股${rec.price ? " @ ¥" + Number(rec.price).toFixed(2) : ""}${rec.amount ? "（约 ¥" + Number(rec.amount).toLocaleString("zh-CN") + "）" : ""}`)}</dd></div>`,
    `<div class="evidence-row"><dt>依据</dt><dd>${esc((rec.evidence || []).join("；") || "—")}</dd></div>`,
    `<div class="evidence-row"><dt>风险影响</dt><dd>${esc(rec.risk_impact || "—")}</dd></div>`,
    whatif.verdict ? `<div class="evidence-row"><dt>情景推演</dt><dd>${esc(whatif.verdict)}</dd></div>` : "",
    (whatif.deltas || []).slice(0, 3).map(d => `<div class="evidence-row"><dt>${esc(d.metric || "")}</dt><dd>${esc(String(d.before ?? "—"))} → ${esc(String(d.after ?? "—"))}</dd></div>`).join(""),
    (data.next_actions || []).length ? `<div class="evidence-row"><dt>下一步</dt><dd>${esc(data.next_actions.join("；"))}</dd></div>` : "",
    `<div class="evidence-row"><dt>说明</dt><dd>${esc((whatif.caveats || []).join("；") || "—")}</dd></div>`,
  ].join("")}</dl>`;
}

// ---------- 待确认（理财审批 /api/decide） ----------
async function refreshApprovals() {
  if (IS_PAGES) { approvals = []; renderPending(); return; }
  try {
    const data = await api("/api/approvals");
    approvals = (data && data.approvals) || [];
  } catch (_) { approvals = []; }
  renderPending();
}

function renderPending() {
  $("#pending-count").textContent = String(approvals.length);
  const list = $("#pending-list");
  if (!approvals.length) {
    list.innerHTML = `<p class="small muted">暂无。申赎类建议通过风控后会在这里等你确认。</p>`;
    return;
  }
  list.innerHTML = approvals.map(a => `
    <article class="pending-item tier-red">
      <div class="row"><h3>${esc(a.action || "操作")}：${esc(a.name || a.symbol || "")} ${a.quantity ?? ""} 股 @ ¥${Number(a.price ?? 0).toFixed(2)}（约 ¥${Number(a.amount ?? 0).toLocaleString("zh-CN")}）</h3>${tierBadge("red", "红色权限 · 强验证")}</div>
      <p class="small muted">理财旗舰 · ${esc(a.created_at || "")}</p>
      <div class="verify-row">
        <button class="primary" data-confirm="${esc(a.id)}">✓ 一键完成强验证（演示）</button>
        <button class="subtle" data-cancel="${esc(a.id)}">拒绝</button>
      </div>
      <p class="small muted">演示环境：纸交易模拟，不会真的扣款、发短信或做实名认证；确认与拒绝都会进审计。</p>
    </article>`).join("");
  list.querySelectorAll("[data-confirm]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await busy(btn, "提交中…", async () => {
        try {
          const res = await api("/api/decide", { id: btn.dataset.confirm, approved: true, verification: { sms_code: "888888", face_verified: true } });
          toast(res.message || "已确认执行（纸交易）。");
          await refreshApprovals();
        } catch (error) { toast(error.message); await refreshApprovals(); }
      });
    });
  });
  list.querySelectorAll("[data-cancel]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!window.confirm("拒绝后该操作不会执行。确定拒绝吗？")) return;
      await busy(btn, "提交中…", async () => {
        try {
          const res = await api("/api/decide", { id: btn.dataset.cancel, approved: false });
          toast(res.message || "已拒绝。");
          await refreshApprovals();
        } catch (error) { toast(error.message); }
      });
    });
  });
}

boot();
initArchiveWorkbench();
