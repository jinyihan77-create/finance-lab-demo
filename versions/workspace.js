import { initArchiveWorkbench } from './archive.js';
import { $, esc, api, toast, feedback, busy, smoothScrollTo } from "./common.js";

const TIER_TEXT = {
  green: "绿色权限 · 自动执行",
  yellow: "黄色权限 · 需确认",
  red: "红色权限 · 强验证",
  blocked: "已拦截",
};
const STATUS_TEXT = {
  done: "已完成",
  pending_confirmation: "等你确认",
  blocked: "已拦截",
  scheduled: "已排期",
  delegated: "已转交",
};
const NODE_STATUS_TEXT = {
  done: "已完成", pending: "待执行", blocked: "已拦截", scheduled: "已排期", skipped: "已跳过",
};

// 旧演示姓名兜底清洗（后端已换真实人名，这里防历史状态串进来）
const NAME_MAP = { "陈大黄": "王芳", "林粹": "李明", "邹昕成": "张伟", "陆小果": "刘洋" };
const cleanText = (value) => {
  let text = value === null || value === undefined ? "" : String(value);
  for (const [from, to] of Object.entries(NAME_MAP)) text = text.split(from).join(to);
  return text;
};

// 一键任务：点击即执行（主 4 张 + 更多折叠）
const QUICK_MAIN = [
  { icon: "📊", label: "查账单", question: "这个月账单分析" },
  { icon: "🔁", label: "查订阅", question: "我有哪些订阅？" },
  { icon: "💸", label: "转账（演示）", question: "给王芳转500元备注聚餐" },
  { icon: "🛡️", label: "挂失（演示）", question: "尾号8888的卡挂失" },
];
const QUICK_MORE = [
  { icon: "⚠️", label: "有没有异常交易", question: "帮我看看有没有异常交易" },
  { icon: "💰", label: "账户还有多少钱", question: "查询账户余额", local: "balance" },
  { icon: "💳", label: "我的卡什么状态", question: "查询我的银行卡" },
  { icon: "🎂", label: "给爱人备生日", question: "我爱人10月25日生日，锁定1000元活期" },
];

// 账单来源指引
const SOURCE_GUIDES = {
  alipay: {
    title: "在支付宝里看账单",
    steps: [
      "打开支付宝 → 右下角「我的」→「账单」",
      "右上角「···」→「开具交易流水证明」或「导出账单」→ 选时间范围 → 邮箱接收或保存文件",
      "拿到 CSV/PDF 后：点下方「选择账单文件」，或直接截图看流水",
    ],
  },
  wechat: {
    title: "在微信里看账单",
    steps: [
      "打开微信 → 「我」→「服务」→「钱包」→「账单」",
      "右上角「常见问题」→「下载账单」→ 选时间范围 → 填写邮箱接收",
      "拿到文件后：点下方「选择账单文件」，或直接截图看流水",
    ],
  },
  bank: {
    title: "在银行 App 里看流水",
    steps: [
      "打开你常用的银行 App（招行、工行、建行等）",
      "首页或「我的」→「交易明细 / 流水查询」→ 选择近三个月",
      "点「导出」保存为 Excel/CSV：点下方「选择账单文件」，或直接截图看流水",
    ],
  },
  file: {
    title: "直接把文件给我",
    steps: [
      "把银行/支付宝/微信导出的 CSV、Excel 或 JSON 文件保存到手机或电脑",
      "点下方「选择账单文件」，我本地解析给你看（数据不上传服务器）",
      "格式不确定也没关系，点「分析演示账单」可以先看效果",
    ],
  },
};

let overview = null;
let lastResult = null;
let running = false;
const IS_PAGES = /github\.io$/.test(location.hostname);

// 公开 Pages 版：无真后端、无同源代理——隐藏本地专属入口，改外链
if (IS_PAGES) {
  document.querySelectorAll('.sidebar a[href="/compare"], .sidebar a[href="/evidence"]').forEach(a => a.remove());
  const notice = $("#backend-notice");
  if (notice) notice.innerHTML = `<p><b>这是公开演示版。</b>银行六场景与理财旗舰在公开环境为演示模式（数据与结论均已标注）；现场验收请使用本地真链路版（团队后端 + 演示服务）。</p>`;
}

// ---------- 视图切换（顶部导航栏） ----------
function switchView(name) {
  document.querySelectorAll(".console-view").forEach(v => v.classList.toggle("is-active", v.dataset.view === name));
  document.querySelectorAll(".console-tab").forEach(t => t.classList.toggle("is-active", t.dataset.viewBtn === name));
  if (name === "brief") loadBrief();
  if (name === "risk") {
    if (IS_PAGES) {
      // 公开版没有同源代理：展示外链卡片，不加载 iframe
      const fallback = $("#risk-fallback");
      const wrap = document.querySelector(".risk-frame-wrap");
      if (fallback) fallback.hidden = false;
      if (wrap) wrap.style.display = "none";
      return;
    }
    const frame = $("#risk-frame");
    if (frame && !frame.dataset.loaded) {
      frame.dataset.loaded = "1";
      frame.src = "/risk";
      // 同源代理：注入统一皮肤，风控工作台与整站视觉一致
      frame.addEventListener("load", () => {
        try {
          const doc = frame.contentDocument;
          if (!doc) return;
          if (!doc.querySelector('link[data-risk-skin]')) {
            const link = doc.createElement("link");
            link.rel = "stylesheet";
            link.href = "/versions/risk-skin.css";
            link.dataset.riskSkin = "1";
            doc.head.appendChild(link);
          }
          // 上游文案含内部协作措辞（如"队友在线"），统一清洗为中性表达
          const scrub = () => {
            const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
            const nodes = [];
            let node;
            while ((node = walker.nextNode())) {
              if (/队友/.test(node.nodeValue)) nodes.push(node);
            }
            nodes.forEach(n => {
              n.nodeValue = n.nodeValue.replace(/队友在线/g, "在线").replace(/队友/g, "协作");
            });
          };
          scrub();
          new MutationObserver(scrub).observe(doc.body, { childList: true, subtree: true, characterData: true });
        } catch (_) { /* 注入失败不影响功能 */ }
      });
    }
  }
  window.scrollTo(0, 0);
}
document.querySelectorAll("[data-view-btn]").forEach(btn => {
  btn.addEventListener("click", () => switchView(btn.dataset.viewBtn));
});
document.querySelectorAll('.section-nav a[data-view]').forEach(a => {
  a.addEventListener("click", (event) => { event.preventDefault(); switchView(a.dataset.view); });
});

const tierBadge = (tier, label) =>
  `<span class="tier-badge tier-${esc(tier || "green")}">${esc(label || TIER_TEXT[tier] || tier)}</span>`;

// ---------- 初始化 ----------
async function boot() {
  try {
    overview = await api("/api/scenarios/boot");
    renderStrip(overview);
    renderTiers(overview.tier_matrix || []);
    renderBreaker(overview.breaker || {});
    renderExamples(overview.scenarios || []);
    $("#conn-stamp").textContent = "真链路已连接 · 团队后端";
    $("#backend-notice").hidden = true;
    $("#run").disabled = false;
    try {
      await refreshWealthApprovals();
      const pendingData = await api("/api/scenarios/pending");
      bankingPendings = (pendingData && pendingData.pending) || [];
      renderPending(bankingPendings);
    } catch (_) { /* 待确认读取失败不影响主体 */ }
  } catch (error) {
    overview = null;
    $("#conn-stamp").textContent = IS_PAGES ? "公开演示版 · 演示数据" : "演示模式 · 后端未连接";
    $("#backend-notice").hidden = false;
    $("#run").disabled = false; // 公开版走内置演示数据引擎，输入与卡片都可用
    renderTiers(STATIC_TIERS, true);
    renderBreaker({ locked: false, consecutive_failures: 0 }, true);
    renderExamples([]);
    $("#account-strip").innerHTML = `<span>账户状态未连接</span><span>真链路开启后展示余额与账户状态</span>`;
  }
  renderQuickTasks();
}

const STATIC_TIERS = [
  { tier: "green", label: "绿色权限", items: "查询类：余额、账单、订阅、卡片状态", policy: "确认意图后自动执行" },
  { tier: "yellow", label: "黄色权限", items: "小额转账（日累计≤1000）、取消订阅、锁卡", policy: "执行前等你点头确认" },
  { tier: "red", label: "红色权限", items: "大额转账、卡片挂失、理财申赎", policy: "需要短信+人脸强验证（演示 Mock）" },
];

function fmtYuan(value) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(Number(value || 0));
}

function renderStrip(data) {
  const cards = (data.cards || []).filter(c => c.status !== "lost").length;
  const subs = (data.subscriptions || []).length;
  $("#account-strip").innerHTML = [
    `<span>可用余额 <b>${fmtYuan(data.balance)}</b></span>`,
    `<span>今日已转 <b>${fmtYuan(data.daily_cumulative)}</b></span>`,
    `<span>卡片 <b>${cards}</b> 张</span>`,
    `<span>订阅 <b>${subs}</b> 个</span>`,
    `<span class="small muted">演示账户 · 未发生真实资金转移</span>`,
  ].join("");
}

function renderQuickTasks() {
  const card = t => `
    <button type="button" class="quick-card" data-question="${esc(t.question)}"${t.local ? ` data-local="${esc(t.local)}"` : ""}>
      <span class="quick-icon">${t.icon}</span>
      <b>${esc(t.label)}</b>
    </button>`;
  $("#quick-grid").innerHTML = QUICK_MAIN.map(card).join("");
  $("#quick-more-grid").innerHTML = QUICK_MORE.map(card).join("");
  document.querySelectorAll(".quick-card").forEach(card => {
    card.addEventListener("click", () => runQuestion(card.dataset.question, card, card.dataset.local || null));
  });
}

const STATIC_SCENARIOS = [
  { key: "transfer", name: "智能转账", icon: "💸", desc: "按人名/手机号转账、备注、AA 收款", tier_note: "日累计≤1000 黄（确认）｜>1000 红（强验证）", examples: ["给王芳转500元备注聚餐"] },
  { key: "bill", name: "账单分析", icon: "📊", desc: "消费分类统计、异常交易识别、账单报告", tier_note: "绿（自动执行）", examples: ["这个月账单分析"] },
  { key: "wealth", name: "理财操作", icon: "🏦", desc: "组合体检、方案对比、风险评估（深度旗舰）", tier_note: "绿/红（申赎强验证）", examples: ["平安银行卖出 30%"] },
  { key: "card", name: "卡片管理", icon: "💳", desc: "卡查询、额度调整、锁卡解锁、挂失", tier_note: "查询绿｜调整/锁卡黄｜挂失红", examples: ["尾号8888的卡挂失"] },
  { key: "subscription", name: "订阅/代扣", icon: "🔁", desc: "识别订阅扣费、续费提醒、取消订阅", tier_note: "查询绿｜取消黄（确认）", examples: ["我有哪些订阅？"] },
  { key: "cross_scene", name: "跨场景联动", icon: "🎂", desc: "生日提醒 → 锁定资金 → 提前订花订蛋糕", tier_note: "计划绿｜锁定资金黄（确认）", examples: ["我爱人10月25日生日，锁定1000元活期"] },
];

function renderTiers(tiers, isStatic) {
  $("#tier-matrix").innerHTML = tiers.map(t => `
    <article class="tier-card tier-${esc(t.tier)}">
      <div class="row"><h3>${esc(t.label)}</h3>${tierBadge(t.tier, t.label)}</div>
      <p><b>覆盖：</b>${esc(t.items)}</p>
      <p class="small muted"><b>策略：</b>${esc(t.policy)}</p>
    </article>`).join("") + (isStatic ? `<p class="small muted">以上为静态说明；接入真链路后由 tiers.py 唯一权威决定。</p>` : "");
}

function renderBreaker(breaker, isStatic) {
  const box = $("#breaker-box");
  if (!breaker || (!breaker.locked && !breaker.events?.length)) {
    box.innerHTML = `<p class="small muted">熔断状态：正常（连续安全事件 ${breaker?.consecutive_failures ?? 0}/${breaker?.threshold ?? 3}）。${
      isStatic ? "静态说明。" : "强验证连续失败 3 次会锁定资金执行，需人工恢复。"}</p>`;
    return;
  }
  const lockNote = breaker.locked
    ? `<p class="small danger"><b>⛔ 熔断锁定中：</b>${esc(breaker.reason || "连续安全事件超过阈值")}。查询仍可用，资金执行需人工恢复。</p>`
    : `<p class="small muted">连续安全事件 ${breaker.consecutive_failures}/${breaker.threshold}，再失败 ${Math.max(0, breaker.threshold - breaker.consecutive_failures)} 次将锁定资金执行。</p>`;
  box.innerHTML = lockNote
    + (breaker.locked ? `<button id="breaker-reset" class="secondary">人工确认恢复</button>` : "")
    + `<details class="compact-detail"><summary>安全事件记录</summary>${(breaker.events || []).slice().reverse().map(e =>
      `<p class="small">${esc(String(e.timestamp || e.ts || ""))} · ${esc(String(e.kind || e.type || e.reason || ""))}</p>`).join("") || `<p class="small muted">暂无事件。</p>`}</details>`;
  const resetBtn = $("#breaker-reset");
  if (resetBtn) resetBtn.addEventListener("click", async () => {
    if (!window.confirm("人工恢复将解除资金执行锁定。确定恢复吗？")) return;
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
    await refreshWealthApprovals();
    bankingPendings = (pendingData && pendingData.pending) || [];
    renderPending(bankingPendings);
    renderAudit(auditData.entries || []);
  } catch (error) { toast("状态刷新失败：" + error.message); }
}

// ---------- 公开演示数据引擎（无后端时可用，全部结果标注演示数据） ----------
let demoPending = [];
const DEMO_TAG = "【公开演示数据】";

const DEMO_BILL_DATA = {
  period: "2026-10", total_spend: 17559.7, transaction_count: 28,
  by_category: { "购物": 13665.5, "居住": 986.1, "餐饮": 866.6, "交通": 697.5, "医疗": 576.5, "娱乐": 385.0, "教育": 277.0, "通讯": 100.0 },
  top_merchants: [
    { merchant: "名表专柜", amount: 8600.0 }, { merchant: "新商户数码", amount: 3200.0 },
    { merchant: "京东商城", amount: 1299.0 }, { merchant: "海底捞", amount: 486.0 },
    { merchant: "体检中心", amount: 480.0 }, { merchant: "山姆会员店", amount: 458.5 },
  ],
  anomalies: [
    { rule: "large_amount", severity: "warning", detail: "名表专柜 单笔支出 8,600 元（≥5000），请确认是否为本人消费" },
    { rule: "overseas", severity: "info", detail: "Amazon US（US）境外商户交易" },
    { rule: "night", severity: "info", detail: "凌晨便利店 凌晨 02:00 消费，若非常规作息请留意" },
    { rule: "duplicate", severity: "warning", detail: "视频会员 在 2026-10-10 出现 2 笔相同金额 25.00 元的扣款，疑似重复扣费" },
    { rule: "new_merchant", severity: "info", detail: "首次出现的商户 新商户数码 单笔 3,200 元，请确认交易真实性" },
  ],
  insights: ["购物类支出占比最高（78%），其中含两笔大额消费，建议核对。", "存在疑似重复扣费（视频会员），可在「待确认」发起取消。"],
  generated_at: "2026-10-12T09:00:00",
};
const DEMO_SUBS = [
  { sub_id: "sub_超燃健身_199", merchant: "超燃健身", amount: 199.0, cadence: "monthly", next_charge_at: "2026-11-01", status: "active", due_soon: false },
  { sub_id: "sub_云音乐VIP_15", merchant: "云音乐VIP", amount: 15.0, cadence: "monthly", next_charge_at: "2026-11-03", status: "active", due_soon: false },
  { sub_id: "sub_云盘Pro_68", merchant: "云盘Pro", amount: 68.0, cadence: "monthly", next_charge_at: "2026-11-05", status: "active", due_soon: false },
  { sub_id: "sub_咖啡月卡_88", merchant: "咖啡月卡", amount: 88.0, cadence: "monthly", next_charge_at: "2026-10-20", status: "active", due_soon: true },
  { sub_id: "sub_杂志订阅_30", merchant: "杂志订阅", amount: 30.0, cadence: "monthly", next_charge_at: "2026-10-22", status: "active", due_soon: true },
];
const DEMO_CARDS = [
  { last4: "8888", bank: "平安银行", card_type: "信用卡", status: "normal", credit_limit: 50000, daily_txn_limit: 20000 },
  { last4: "6666", bank: "招商银行", card_type: "借记卡", status: "normal", credit_limit: 0, daily_txn_limit: 50000 },
  { last4: "1234", bank: "工商银行", card_type: "信用卡", status: "locked", credit_limit: 30000, daily_txn_limit: 10000 },
  { last4: "5555", bank: "建设银行", card_type: "借记卡", status: "normal", credit_limit: 0, daily_txn_limit: 20000 },
  { last4: "0000", bank: "交通银行", card_type: "信用卡", status: "normal", credit_limit: 80000, daily_txn_limit: 30000 },
];

function demoPlan(scenario, nodes) {
  return { intent: scenario, nodes: (nodes || []).map((n, i) => ({ id: `n${i}`, label: n, tool: "demo_tool", depends_on: [], status: "done" })) };
}
function demoResult(scenario, label, tier, status, message, data, planNodes) {
  return {
    demo: true,
    delegated: false,
    result: {
      scenario, scenario_label: label, intent: { name: scenario, label },
      plan: demoPlan(scenario, planNodes || ["校验输入", "确定性检查", "执行"]),
      tier, tier_label: TIER_TEXT[tier], status, message, data,
    },
    pending: [...demoPending],
    breaker: { locked: false, consecutive_failures: 0, threshold: 3 },
  };
}
function runDemoTask(question) {
  const q = String(question || "");
  const has = (...words) => words.some(w => q.includes(w));
  if (has("账单", "异常", "花了多少", "流水")) {
    const msg = has("异常") ? "近 30 天账单扫描完成：28 笔支出中发现 5 处需留意（大额、境外、深夜、重复扣费、新商户）。"
      : "2026-10 账单分析完成：共 28 笔支出，合计 17,559.70 元，标记 5 处需留意。";
    return demoResult("bill", "账单分析", "green", "done", DEMO_TAG + msg, DEMO_BILL_DATA, ["读取账单", "分类统计", "异常识别"]);
  }
  if (has("订阅")) {
    return demoResult("subscription", "订阅/代扣管理", "green", "done",
      DEMO_TAG + `识别出 ${DEMO_SUBS.length} 个生效中的订阅/代扣，其中 2 个即将续费。`,
      { subscriptions: DEMO_SUBS, due_soon: DEMO_SUBS.filter(s => s.due_soon) }, ["扫描流水", "识别重复扣款", "续费提醒"]);
  }
  if (has("卡") && has("挂失")) {
    const item = { id: "demo_" + Date.now(), scenario: "card", tier: "red", created_at: new Date().toISOString().slice(0, 19), message: "尾号 8888 挂失并立即冻结卡片（不可撤销，需强验证）。" };
    demoPending.push(item);
    return demoResult("card", "卡片管理", "red", "pending_confirmation",
      DEMO_TAG + "已生成挂失请求：尾号 8888 挂失并立即冻结卡片（不可撤销，需强验证）。",
      { operation: "loss_report", card: DEMO_CARDS[0], gate_checks: [{ name: "卡片存在性", passed: true }] },
      ["定位卡片", "权限判定", "强验证"]);
  }
  if (has("卡", "银行卡")) {
    return demoResult("card", "卡片管理", "green", "done",
      DEMO_TAG + `您名下共 ${DEMO_CARDS.length} 张卡：` + DEMO_CARDS.map(c => `尾号 ${c.last4}（${c.bank} ${c.card_type}，${c.status === "normal" ? "正常" : "已锁"}）`).join("；") + "。",
      { operation: "list", cards: DEMO_CARDS }, ["定位卡片", "状态读取"]);
  }
  if (has("转账", "转 500", "转500", "王芳")) {
    const item = { id: "demo_" + Date.now(), scenario: "transfer", tier: "yellow", created_at: new Date().toISOString().slice(0, 19), message: "向 王芳 转账 500.00 元（备注：聚餐）。" };
    demoPending.push(item);
    return demoResult("transfer", "智能转账", "yellow", "pending_confirmation",
      DEMO_TAG + "转账请求已就绪：向 王芳 转账 500.00 元（备注：聚餐），权限级别：黄色 · 需确认。",
      { request: { payee: "王芳", amount: 500, memo: "聚餐" }, gate_checks: [{ name: "收款人核验", passed: true }, { name: "限额检查", passed: true }] },
      ["收款人核验", "风控闸门", "用户确认"]);
  }
  if (has("生日", "爱人", "纪念日")) {
    const item = { id: "demo_" + Date.now(), scenario: "cross_scene", tier: "yellow", created_at: new Date().toISOString().slice(0, 19), message: "跨场景计划：爱人 2026-10-25 生日，锁定 1,000 元活期并提前 2 天订花与蛋糕。" };
    demoPending.push(item);
    return demoResult("cross_scene", "跨场景联动", "yellow", "pending_confirmation",
      DEMO_TAG + "已生成跨场景联动计划：爱人 2026-10-25 生日。锁定 1,000 元活期，生日前 2 天订花和蛋糕。",
      { plan: { plan_id: "demo-plan" } }, ["生日识别", "资金锁定", "外部订购"]);
  }
  if (has("余额", "多少钱", "还有多少")) {
    return demoResult("transfer", "余额查询", "green", "done",
      DEMO_TAG + "账户可用余额 ¥25,680.50；今日已累计转账 ¥0.00。",
      { balance: 25680.5, daily_cumulative: 0 }, ["读取余额"]);
  }
  if (has("卖出", "申购", "赎回", "理财", "基金", "股票")) {
    return demoResult("wealth", "理财操作", "green", "done",
      DEMO_TAG + "已生成理财建议（公开演示）：卖出 平安银行 1,500 股，约 ¥15,750。公开版不接真后端，仅作演示。",
      { recommendation: { action: "卖出", symbol: "000001", name: "平安银行", quantity: 1500, price: 10.5, amount: 15750, reason: "用户要求减持 30%" } },
      ["组合体检", "风控闸门", "情景推演"]);
  }
  return demoResult("bill", "账单分析", "green", "done",
    DEMO_TAG + "公开演示版支持：账单分析、异常交易、订阅、余额、卡片、转账、挂失、生日联动。试试点上方卡片。",
    {}, ["读取输入"]);
}

// ---------- 任务执行（一键入口） ----------
async function runQuestion(question, sourceCard, localAction) {
  if (!question || running) return;
  const trimmed = String(question).trim();
  $("#question").value = trimmed;
  if (overview === null) { $("#run").disabled = false; }
  const sourceHint = detectSourcePhrase(trimmed);
  // 记录已有待办，用于结果页只展示本次任务新产生的确认按钮
  knownPendingIds = new Set([
    ...(bankingPendings || []).map(p => p.id),
    ...wealthApprovals.map(a => a.id),
  ]);
  inlineReceipt = null;
  $("#inline-pending") && ($("#inline-pending").innerHTML = "");
  running = true;
  if (sourceCard) sourceCard.classList.add("is-busy");
  lastResult = null;
  $("#result-anchor").hidden = true;
  $("#results").hidden = false;
  $("#result-metrics").innerHTML = `<article class="metric"><small>状态</small><strong>正在处理…</strong><small>${esc(trimmed)}</small></article>`;
  switchView(sourceHint ? "bills" : "results");
  try {
    let res;
    if (overview === null) {
      // 公开演示版：内置演示数据引擎，保证每个入口都有结果
      res = runDemoTask(localAction === "balance" ? "账户还有多少钱" : trimmed);
    } else if (localAction === "balance") {
      res = await localBalance();
    } else {
      res = await api("/api/scenarios/run", { question: trimmed });
    }
    lastResult = res;
    if (res.delegated) {
      // 理财请求 → 走你自己的理财旗舰闭环（/api/review），结果完整渲染
      const wealth = await api("/api/review", { question: trimmed });
      lastResult = wealth;
      await renderWealth(wealth);
      switchView("results");
      toast(wealth.queued ? "理财建议已生成并进入待确认（红色权限）。" : "理财诊断完成，结果在下面。");
    } else {
      renderRun(res);
      if (sourceHint) {
        toast("已用演示账单跑了一次分析，结果在「结果」页；账单指引就在本页。");
      } else {
        toast("已完成，结果在下面。");
        switchView("results");
      }
    }
  } catch (error) {
    $("#result-metrics").innerHTML = "";
    $("#verdict-title").textContent = "出了点问题";
    $("#verdict-copy").textContent = error.message;
    feedback("#run-feedback", error.message, "error");
    toast(error.message);
  } finally {
    running = false;
    if (sourceCard) sourceCard.classList.remove("is-busy");
  }
}

// 余额查询：直接读后端账户状态（boot 数据，不走场景路由）
async function localBalance() {
  const bootData = overview ? overview : await api("/api/scenarios/boot");
  overview = bootData;
  renderStrip(bootData);
  return {
    delegated: false,
    result: {
      scenario: "transfer", scenario_label: "余额查询",
      intent: { name: "transfer", label: "余额查询" },
      plan: { intent: "transfer", nodes: [
        { id: "validate", label: "校验输入与权限", tool: "intent_router", depends_on: [], status: "done" },
        { id: "balance", label: "读取账户余额", tool: "balance_query", depends_on: ["validate"], status: "done" },
      ] },
      tier: "green", status: "done",
      message: `账户可用余额 ${fmtYuan(bootData.balance)}；今日已累计转账 ${fmtYuan(bootData.daily_cumulative)}。绿色权限：查询类自动执行。`,
      data: { balance: bootData.balance, daily_cumulative: bootData.daily_cumulative },
    },
    pending: [], breaker: bootData.breaker || {},
  };
}

$("#task-form").addEventListener("submit", (event) => {
  event.preventDefault();
  runQuestion($("#question").value);
});
$("#question").addEventListener("input", () => {
  $("#run").disabled = !$("#question").value.trim();
});

function renderExamples(scenarios) {
  const list = scenarios && scenarios.length ? scenarios : STATIC_SCENARIOS;
  const chips = list.flatMap(s => (s.examples || []).slice(0, 1)).slice(0, 3);
  $("#example-chips").innerHTML = chips.map(ex =>
    `<button type="button" class="example-chip" data-example="${esc(ex)}">${esc(ex)}</button>`).join("");
  document.querySelectorAll(".example-chip").forEach(chip => {
    chip.addEventListener("click", () => runQuestion(chip.dataset.example));
  });
}

function renderRun(res) {
  const r = res.result || {};
  if (r.scenario === "wealth") {
    // 理财结果统一走旗舰渲染（公开演示/真链路一致）
    renderWealth({ ...(r.data || {}), queued: false, engine: res.demo ? "公开演示数据" : (r.data || {}).engine || "规则引擎", risk_alert: res.demo ? DEMO_TAG : (r.data || {}).risk_alert });
    return;
  }
  const tier = r.tier || "green";
  $("#result-metrics").innerHTML = [
    ["场景", esc(cleanText(r.scenario_label || r.scenario || "—")), "由闭集路由判定"],
    ["权限", TIER_TEXT[tier] || tier, "由确定性闸门决定"],
    ["状态", STATUS_TEXT[r.status] || r.status || "—", r.status === "pending_confirmation" ? "下面等你确认" : "已收口"],
    ["熔断事件", String((res.breaker || {}).consecutive_failures ?? 0) + " 次", (res.breaker || {}).locked ? "当前锁定中" : "安全"],
  ].map(m => `<article class="metric"><small>${m[0]}</small><strong>${m[1]}</strong><small>${esc(m[2])}</small></article>`).join("");

  $("#verdict-title").textContent = cleanText(`${r.scenario_label || r.scenario || "任务"} · ${STATUS_TEXT[r.status] || r.status || "已执行"}`);
  $("#verdict-copy").textContent = cleanText(r.message || "");
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

  $("#evidence-data").innerHTML = r.scenario === "bill" ? renderBillEvidence(r.data) : renderEvidence(r.data);

  bankingPendings = res.pending || [];
  renderPending(bankingPendings);
  renderInlinePending();
  renderBreaker(res.breaker || {});
}

function renderEvidence(data) {
  if (!data || !Object.keys(data).length) return `<p class="small muted">本任务没有附加业务数据（如越界或拦截请求）。</p>`;
  const KEY_LABELS = {
    period: "期间", total_spend: "支出合计", transaction_count: "笔数", by_category: "分类支出",
    top_merchants: "主要商户", anomalies: "异常提示", insights: "洞察", generated_at: "生成时间",
    balance: "可用余额", daily_cumulative: "今日累计转账", cards: "卡片", subscriptions: "订阅",
    status: "状态", operation: "操作", card: "卡片信息", gate_checks: "闸门检查", new_limit: "新额度",
    plan: "计划", plan_id: "计划编号", message: "说明", contacts: "通讯录", request: "请求内容",
    target: "目标", amount: "金额", payee: "收款人", memo: "备注", payee_ok: "收款人核验",
    balance_sufficient: "余额充足", within_limit: "限额内", remaining_limit: "剩余限额",
    aa_items: "AA 分账", scheduled_at: "预约时间",
  };
  const rows = [];
  for (const [key, value] of Object.entries(data)) {
    const display = value === null || value === undefined ? "—"
      : typeof value === "object" ? JSON.stringify(value) : String(value);
    rows.push(`<div class="evidence-row"><dt>${esc(KEY_LABELS[key] || key)}</dt><dd>${esc(cleanText(display))}</dd></div>`);
  }
  return `<dl class="evidence-dl">${rows.join("")}</dl>`;
}

// 账单分析：精简支出记录视图（不铺原始字段名、不展示代码）
function renderBillEvidence(data) {
  data = data || {};
  const fmt = (v) => new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(Number(v || 0));
  const total = Number(data.total_spend || 0);
  const cats = Object.entries(data.by_category || {}).sort((a, b) => b[1] - a[1]);
  const merchants = (data.top_merchants || []).slice(0, 8);
  const anomalies = data.anomalies || [];
  const insights = data.insights || [];
  const sevText = { warning: "需留意", info: "提示", critical: "重要" };

  const catRows = cats.map(([name, amount]) => {
    const pct = total > 0 ? Math.round((Number(amount) / total) * 100) : 0;
    return `<div class="bill-cat-row"><span class="bill-cat-name">${esc(cleanText(name))}</span><span class="bill-cat-bar"><i style="width:${Math.max(4, pct)}%"></i></span><b>${fmt(amount)}</b><small>${pct}%</small></div>`;
  }).join("");

  const merchantRows = merchants.length
    ? `<ol class="bill-merchants">${merchants.map((m, i) =>
      `<li><span class="bill-rank">${i + 1}</span><span>${esc(cleanText(m.merchant || "—"))}</span><b>${fmt(m.amount)}</b></li>`).join("")}</ol>`
    : `<p class="small muted">暂无商户明细。</p>`;

  const anomalyRows = anomalies.length
    ? `<ul class="bill-anomalies">${anomalies.map(a =>
      `<li class="sev-${esc(a.severity || "info")}"><span class="sev-badge">${esc(sevText[a.severity] || "提示")}</span>${esc(cleanText(a.detail || ""))}</li>`).join("")}</ul>`
    : `<p class="small muted">本期没有标记异常的交易。</p>`;

  const insightLines = insights.length
    ? `<div class="bill-insights">${insights.map(t => `<p>${esc(cleanText(t))}</p>`).join("")}</div>`
    : "";

  return `
    <div class="bill-summary">
      <div class="bill-total">
        <div><small>本期支出合计</small><strong>${fmt(total)}</strong></div>
        <div><small>期间</small><strong>${esc(data.period || "—")}</strong></div>
        <div><small>笔数</small><strong>${Number(data.transaction_count || 0)} 笔</strong></div>
      </div>
      <div class="bill-section"><h3>分类支出</h3>${catRows || `<p class="small muted">暂无分类数据。</p>`}</div>
      <div class="bill-section"><h3>主要支出</h3>${merchantRows}</div>
      <div class="bill-section"><h3>异常提示</h3>${anomalyRows}</div>
      ${insightLines}
    </div>`;
}

// ---------- 理财旗舰闭环（/api/review + /api/decide） ----------
let bankingPendings = [];

async function renderWealth(data) {
  const rec = data.recommendation || {};
  const gate = data.gate || {};
  const whatif = data.whatif || {};
  const tier = data.queued ? "red" : "green";

  $("#result-metrics").innerHTML = [
    ["场景", "理财旗舰", "组合体检 → 风控闸门 → 情景推演"],
    ["建议", `${rec.action || "—"} ${rec.name || rec.symbol || ""} ${rec.quantity ?? ""} 股`, rec.amount ? `约 ¥${Number(rec.amount).toLocaleString("zh-CN")}` : ""],
    ["权限", TIER_TEXT[tier] || tier, data.queued ? "待确认页等你点头" : "已自动执行"],
  ].map(m => `<article class="metric"><small>${m[0]}</small><strong>${esc(m[1])}</strong><small>${esc(cleanText(m[2]))}</small></article>`).join("");

  $("#verdict-title").textContent = cleanText(`${rec.action || "建议"} ${rec.name || rec.symbol || ""} ${rec.quantity ?? ""} 股${data.queued ? " · 等待你确认" : " · 已执行"}`);
  $("#verdict-copy").textContent = cleanText(data.assistant_message || rec.reason || "");
  const tag = $("#verdict-tag");
  tag.textContent = TIER_TEXT[tier] || tier;
  tag.className = `verdict-tag tier-text-${esc(tier)}`;

  // 任务 DAG：理财闭环的 plan 节点 + 风控闸门检查
  const nodes = (data.plan && data.plan.nodes) || [];
  const gateChecks = (gate.checks || []).map((c, i) => ({
    id: `gate-${i}`, label: c.name, tool: c.detail || "", status: c.passed ? "done" : "blocked",
  }));
  const allNodes = nodes.length ? nodes : gateChecks;
  $("#dag-list").innerHTML = `<ol class="dag-list">${allNodes.map((n, i) => `
    <li class="dag-node node-${esc(n.status || "pending")}">
      <span class="dag-index">${String(i + 1).padStart(2, "0")}</span>
      <div><b>${esc(n.label)}</b><small class="terminal-label">${esc(n.tool || "")}</small></div>
      <span class="dag-status">${esc(NODE_STATUS_TEXT[n.status] || n.status || "待执行")}</span>
    </li>`).join("")}</ol>`;
  $("#intent-note").textContent = [
    data.risk_alert || "",
    whatif.verdict || "",
    data.data_tag || "",
  ].filter(Boolean).join(" · ");

  // 证据：建议依据 + 情景推演
  const evidenceHtml = [
    `<div class="evidence-row"><dt>操作</dt><dd>${esc(cleanText(JSON.stringify({ action: rec.action, symbol: rec.symbol, name: rec.name, quantity: rec.quantity, price: rec.price })))}</dd></div>`,
    `<div class="evidence-row"><dt>依据</dt><dd>${esc(cleanText((rec.evidence || []).join("；") || "—"))}</dd></div>`,
    `<div class="evidence-row"><dt>风险影响</dt><dd>${esc(cleanText(rec.risk_impact || "—"))}</dd></div>`,
    whatif.verdict ? `<div class="evidence-row"><dt>情景推演</dt><dd>${esc(cleanText(whatif.verdict))}</dd></div>` : "",
    (whatif.deltas || []).slice(0, 3).map(d => `<div class="evidence-row"><dt>${esc(d.metric || "")}</dt><dd>${esc(String(d.before ?? "—"))} → ${esc(String(d.after ?? "—"))}</dd></div>`).join(""),
    (data.next_actions || []).length ? `<div class="evidence-row"><dt>下一步</dt><dd>${esc(cleanText(data.next_actions.join("；")))}</dd></div>` : "",
    `<div class="evidence-row"><dt>说明</dt><dd>${esc(cleanText((whatif.caveats || []).join("；") || "—"))}</dd></div>`,
  ].join("");
  $("#evidence-data").innerHTML = `<dl class="evidence-dl">${evidenceHtml}</dl>`;

  renderPending(bankingPendings);
  renderBreaker(data.breaker || {});
  if (data.queued) {
    await refreshWealthApprovals();
    renderPending(bankingPendings);
  }
  renderInlinePending();
}

// ---------- 待确认（一键化，含理财旗舰审批） ----------
let wealthApprovals = [];
let knownPendingIds = new Set();
let inlineReceipt = null;

function showInlineReceipt(message) {
  inlineReceipt = message;
  const box = $("#inline-pending");
  if (box) box.innerHTML = `<div class="inline-receipt">✓ ${esc(cleanText(message))}</div>`;
}

async function confirmItem(id, type, red, sourceBtn) {
  if (String(id).startsWith("demo_")) {
    demoPending = demoPending.filter(p => p.id !== id);
    renderPending(bankingPendings);
    showInlineReceipt("已执行（公开演示数据，未发生真实资金变动）。");
    toast("已执行（公开演示数据，未发生真实资金变动）。");
    return;
  }
  await busy(sourceBtn, "提交中…", async () => {
    try {
      let res;
      if (type === "wealth") {
        res = await api("/api/decide", {
          id, approved: true,
          verification: red ? { sms_code: "888888", face_verified: true } : undefined,
        });
      } else {
        const verification = red ? { sms_code: "888888", face_verified: true } : undefined;
        res = await api("/api/scenarios/confirm", verification ? { id, verification } : { id });
      }
      const msg = cleanText(res.message || "已确认。");
      showInlineReceipt(msg);
      toast(msg);
      await refreshSidebarState();
    } catch (error) {
      showInlineReceipt("执行失败：" + error.message);
      toast(error.message);
      await refreshSidebarState();
    }
  });
}

async function cancelItem(id, type, sourceBtn) {
  if (String(id).startsWith("demo_")) {
    demoPending = demoPending.filter(p => p.id !== id);
    renderPending(bankingPendings);
    showInlineReceipt("已拒绝（公开演示数据）。");
    toast("已拒绝（公开演示数据）。");
    return;
  }
  if (!window.confirm("拒绝后该操作不会执行。确定拒绝吗？")) return;
  await busy(sourceBtn, "提交中…", async () => {
    try {
      let res;
      if (type === "wealth") {
        res = await api("/api/decide", { id, approved: false });
      } else {
        res = await api("/api/scenarios/cancel", { id });
      }
      const msg = cleanText(res.message || "已拒绝。");
      showInlineReceipt(msg);
      toast(msg);
      await refreshSidebarState();
    } catch (error) { toast(error.message); }
  });
}

function pendingItemHtml(p) {
  return `
    <article class="pending-item tier-${esc(p.tier || "yellow")}">
      <div class="row"><h3>${esc(cleanText(p.message || "待确认操作"))}</h3>${tierBadge(p.tier, p.tier === "red" ? "红色权限 · 强验证" : "黄色权限 · 确认")}</div>
      <p class="small muted">${p.type === "wealth" ? "理财旗舰" : esc(p.scenario || "")} · ${esc(p.created_at || "")}</p>
      <div class="verify-row">
        <button class="primary" data-confirm="${esc(p.id)}" data-type="${esc(p.type)}" data-red="${p.tier === "red" ? "1" : ""}">✓ ${p.tier === "red" ? "一键完成强验证（演示）" : "确认执行"}</button>
        <button class="subtle" data-cancel="${esc(p.id)}" data-type="${esc(p.type)}">拒绝</button>
      </div>
      <p class="small muted">演示环境：不会真的扣款、发短信或做实名认证。</p>
    </article>`;
}

// 结果页就地确认：先显示本次任务新产生的待办；确认/拒绝后原位显示回执
function renderInlinePending() {
  const box = $("#inline-pending");
  if (!box) return;
  const newItems = bankingPendings.filter(p => !knownPendingIds.has(p.id));
  const newWealth = overview === null ? [] : wealthApprovals
    .filter(a => !knownPendingIds.has(a.id))
    .map(a => ({
      type: "wealth", id: a.id, scenario: "wealth", tier: "red", created_at: a.created_at,
      message: `${a.action || "操作"}：${a.name || a.symbol || ""} ${a.quantity ?? ""} 股 @ ¥${Number(a.price ?? 0).toFixed(2)}（约 ¥${Number(a.amount ?? 0).toLocaleString("zh-CN")}）`,
    }));
  const all = [...newItems, ...newWealth];
  if (inlineReceipt) {
    showInlineReceipt(inlineReceipt);
    return;
  }
  if (!all.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="inline-pending-box">${all.map(pendingItemHtml).join("")}</div>`;
  box.querySelectorAll("[data-confirm]").forEach(btn => {
    btn.addEventListener("click", () => confirmItem(btn.dataset.confirm, btn.dataset.type, btn.dataset.red === "1", btn));
  });
  box.querySelectorAll("[data-cancel]").forEach(btn => {
    btn.addEventListener("click", () => cancelItem(btn.dataset.cancel, btn.dataset.type, btn));
  });
}

async function refreshWealthApprovals() {
  try {
    const data = await api("/api/approvals");
    wealthApprovals = (data && data.approvals) || [];
  } catch (_) { wealthApprovals = []; }
}

function renderPending(items) {
  let bankingItems = (items || []).map(p => ({ type: "scenario", ...p }));
  if (overview === null) {
    // 公开演示版：以内存演示队列为准
    bankingItems = bankingItems.filter(p => !String(p.id).startsWith("demo_"));
    bankingItems = bankingItems.concat(demoPending.map(p => ({ type: "scenario", ...p })));
  }
  const wealthItems = overview === null ? [] : wealthApprovals.map(a => ({
    type: "wealth", id: a.id, scenario: "wealth",
    tier: "red", created_at: a.created_at,
    message: `${a.action || "操作"}：${a.name || a.symbol || ""} ${a.quantity ?? ""} 股 @ ¥${Number(a.price ?? 0).toFixed(2)}（约 ¥${Number(a.amount ?? 0).toLocaleString("zh-CN")}）`,
  }));
  const all = [...bankingItems, ...wealthItems];
  $("#pending-count").textContent = String(all.length);
  const badge = $("#pending-badge");
  if (badge) { badge.hidden = all.length === 0; badge.textContent = String(all.length); }
  const list = $("#pending-list");
  if (!all.length) {
    list.innerHTML = `<p class="small muted">暂无。</p>`;
    return;
  }
  list.innerHTML = all.map(pendingItemHtml).join("");
  list.querySelectorAll("[data-confirm]").forEach(btn => {
    btn.addEventListener("click", () => confirmItem(btn.dataset.confirm, btn.dataset.type, btn.dataset.red === "1", btn));
  });
  list.querySelectorAll("[data-cancel]").forEach(btn => {
    btn.addEventListener("click", () => cancelItem(btn.dataset.cancel, btn.dataset.type, btn));
  });
}

// ---------- 审计 ----------
function renderAudit(entries) {
  const box = $("#audit-list");
  if (!entries.length) { box.innerHTML = `<p class="small muted">暂无审计记录。办一次业务后再来看。</p>`; return; }
  const shown = entries.slice(-12).reverse();
  box.innerHTML = `<div class="audit-list">${shown.map(e => `
    <div class="audit-row">
      <span class="audit-dot ${e.result === "failure" ? "is-failure" : e.result === "pending" ? "is-pending" : ""}"></span>
      <div class="audit-main">
        <b>${esc(cleanText(e.label || e.action || "审计事件"))}</b>
        <span class="chip-chip ${e.result === "failure" ? "chip-red" : e.result === "pending" ? "chip-amber" : "chip-green"}">${e.result === "failure" ? "失败" : e.result === "pending" ? "待处理" : "成功"}</span>
        <p class="small muted">${esc(String(e.timestamp || e.ts || ""))}</p>
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
$("#refresh-brief").addEventListener("click", async () => {
  await busy($("#refresh-brief"), "读取中…", async () => { await loadBrief(); });
});

// ---------- 账单来源引导 ----------
function showSourceGuide(source) {
  const guide = SOURCE_GUIDES[source];
  if (!guide) return;
  $("#source-guide").hidden = false;
  $("#source-guide").innerHTML = `
    <div class="source-guide">
      <b>${esc(guide.title)}</b>
      <ol>${guide.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol>
    </div>`;
  smoothScrollTo($("#source-guide").getBoundingClientRect().top + window.scrollY - 14);
}
function detectSourcePhrase(text) {
  const t = String(text || "");
  if (/(支付宝|微信|银行\s*app|银行app|哪个应用|哪里看|怎么看|怎么导出|流水在)/i.test(t)) {
    if (/支付宝/.test(t)) showSourceGuide("alipay");
    else if (/微信/.test(t)) showSourceGuide("wechat");
    else if (/银行/.test(t)) showSourceGuide("bank");
    else showSourceGuide("file");
    return true;
  }
  return false;
}
document.querySelectorAll(".source-card").forEach(card => {
  card.addEventListener("click", () => showSourceGuide(card.dataset.source));
});
$("#demo-bill-run").addEventListener("click", () => runQuestion("这个月账单分析", $("#demo-bill-run")));
$("#pick-file").addEventListener("click", () => $("#bill-file").click());
$("#bill-file").addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    renderCsvPreview(parseStatementFile(text), file.name);
  } catch (error) {
    renderCsvPreview({ error: "读不了这个文件：" + error.message }, file.name);
  }
  event.target.value = "";
});

function parseStatementFile(text) {
  const clean = text.replace(/^\uFEFF/, "").trim();
  if (!clean) return { error: "文件是空的。" };
  // JSON 数组
  try {
    const data = JSON.parse(clean);
    if (Array.isArray(data) && data.length) {
      const rows = data.slice(0, 200).map(r => (typeof r === "object" && r ? r : { 记录: String(r) }));
      return { rows };
    }
    if (Array.isArray(data)) return { error: "JSON 数组是空的。" };
  } catch (_) { /* 不是 JSON，按 CSV 处理 */ }
  const lines = clean.split(/\r?\n/).filter(l => l.trim());
  const delim = (lines[0].split(",").length >= lines[0].split("\t").length ? "," : "\t");
  const parsed = lines.map(l => l.split(delim).map(c => c.trim()));
  if (parsed.length < 2) return { error: "没解析出内容，请确认是账单导出的 CSV/JSON 文件。" };
  const header = parsed[0];
  const body = parsed.slice(1).filter(row => row.some(c => c));
  const rows = body.slice(0, 200).map(row => {
    const obj = {};
    header.forEach((h, i) => { obj[h || `列${i + 1}`] = row[i] ?? ""; });
    return obj;
  });
  return { rows, header };
}

function renderCsvPreview(result, filename) {
  const box = $("#csv-result");
  box.hidden = false;
  if (result.error) {
    box.innerHTML = `<div class="notice-note"><p>${esc(result.error)}</p></div>`;
    return;
  }
  const rows = result.rows;
  const keys = result.header || Object.keys(rows[0] || {});
  const amountKey = keys.find(k => /金额|支出|收入|交易金额/.test(k));
  let spent = null;
  if (amountKey) {
    const vals = rows.map(r => parseFloat(String(r[amountKey]).replace(/[,¥元\s]/g, ""))).filter(v => !Number.isNaN(v));
    spent = vals.filter(v => v < 0).reduce((a, b) => a + b, 0);
  }
  const stats = `<div class="row"><p class="small muted">文件：${esc(filename)} · 解析 ${rows.length} 条记录</p>${
    spent === null ? "" : `<p class="small"><b>支出合计 ${fmtYuan(Math.abs(spent))}</b></p>`}</div>`;
  const table = `<div class="table-wrap"><table><thead><tr>${keys.map(k => `<th>${esc(k)}</th>`).join("")}</tr></thead><tbody>${
    rows.slice(0, 50).map(r => `<tr>${keys.map(k => `<td>${esc(String(r[k] ?? ""))}</td>`).join("")}</tr>`).join("")
  }${rows.length > 50 ? `<tr><td colspan="${keys.length}" class="small muted">仅显示前 50 条</td></tr>` : ""}</tbody></table></div>`;
  box.innerHTML = stats + table
    + `<p class="small muted">本地解析预览：文件只在你的浏览器里读取，不上传服务器。解析规则是演示级识别，格式特殊时可能不完整。</p>`;
  smoothScrollTo(box.getBoundingClientRect().top + window.scrollY - 14);
}

// ---------- 今日简报 ----------
async function loadBrief() {
  const box = $("#brief-box");
  try {
    const data = await api("/api/brief");
    const lines = (data.lines || []).map(l => `<p class="brief-line">${esc(cleanText(l))}</p>`).join("");
    box.innerHTML = `<p class="small muted">生成时间：${esc(data.generated_at || "—")} · 演示数据</p>` + (lines || `<p class="small muted">简报暂无内容。</p>`);
  } catch (error) {
    box.innerHTML = `<p class="small muted">简报读取失败：${esc(error.message)}</p>`;
  }
}

// ---------- 启动 ----------
async function initAudit() {
  try { const data = await api("/api/audit"); renderAudit(data.entries || []); }
  catch (_) { $("#audit-list").innerHTML = `<p class="small muted">审计暂未读取。</p>`; }
}

boot();
initAudit();
initArchiveWorkbench();
