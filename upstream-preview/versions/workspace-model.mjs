// UI projections only. These labels never grant server permissions.
export const labels = Object.freeze({
  WAITING_INPUT: "等待补充资料", WAITING_APPROVAL: "等待审批", BLOCKED: "已阻断",
  ERROR: "处理失败", UNKNOWN: "执行结果待核查", SUCCEEDED: "已取得完成回执",
  NOT_EXECUTED: "尚未执行", WAITING_RISK: "等待 Risk 审核", RUNNING: "正在分析", NOT_CONNECTED: "待接入"
});
// Presentation vocabulary only; REVIEW is not an execution permission.
export function riskLabel(state) {
  return ({NOT_CONNECTED:"风控服务未连接",REQUIRED:"风控服务未连接",REVIEW:"等待风险审核",RUNNING:"审核进行中",ALLOW:"审核通过",BLOCK:"审核阻断",ERROR:"审核错误"})[state] || "风险状态待核验";
}
export function responseError(data, ok = true) {
  if (!ok || data?.status === "error" || data?.error) {
    const error = new Error(data?.error?.message || "服务请求失败，未生成成功结果。");
    error.code = data?.error?.code || "REQUEST_FAILED";
    error.recovery = data?.error?.recovery || data?.recovery || "";
    error.payload = data;
    return error;
  }
  return null;
}
export function assertHealthResponse(data) {
  const t = data?.task_state;
  if (data?.contract_version !== "investment-agent.v1" || data.operation !== "PORTFOLIO_HEALTH_CHECK" ||
      !t?.task_id || data.trace?.task_id !== t.task_id || data.trace?.request_id !== data.request_id ||
      data.trace?.session_id !== t.session_id) throw new Error("响应契约或任务关联不匹配，结果未采用。");
  if (data.risk_handoff && (data.risk_handoff.task_id !== t.task_id || data.risk_handoff.session_id !== t.session_id))
    throw new Error("Risk 交接不属于当前任务，结果未采用。");
  if (t.status === "HANDOFF_REQUIRED") {
    const a = data.artifacts, s = a?.simulation, m = a?.health_report?.metrics;
    if (!a?.portfolio_snapshot || !a?.health_report?.concentration || !Array.isArray(a?.candidates) ||
        !Array.isArray(s?.comparisons) || !Array.isArray(s?.scenarios) ||
        !Number.isFinite(m?.max_drawdown) || !Number.isFinite(m?.annualized_volatility))
      throw new Error("组合分析响应不完整，未显示成功。");
  }
  return data;
}
export function provenance(data, verifiedLive = false) {
  const mode = data?.data_mode || data?.context?.data_mode || data?.trace?.data_mode;
  if (["SYNTHETIC_REPLAY", "FIXTURE", "DEMO"].includes(mode)) return "DEMO / FIXTURE";
  // Live provenance must be supplied by a verified integration, not a success flag.
  return verifiedLive && mode === "LIVE" ? "LIVE" : "来源待核验";
}
export function executionView(execution, taskId) {
  if (!execution) return { state: "NOT_CONNECTED", text: "尚无 PAPER 执行回执，账本未改变。" };
  if (execution.status === "UNKNOWN") return { state: "UNKNOWN", text: "结果暂不可确认。先核查原任务与回执，不要重复提交交易。" };
  if (execution.status === "BLOCKED") return { state: "BLOCKED", text: "执行被服务端阻断。" };
  if (execution.status === "ERROR" || execution.status === "FAILED") return { state: "ERROR", text: "执行失败；尚无完成证据。" };
  const r = execution.receipt;
  if (["SUCCEEDED", "SIMULATED"].includes(execution.status)) {
    if (!r || r.task_id !== taskId || !r.execution_id)
      return { state: "UNKNOWN", text: "完成状态缺少可关联回执。请核查，不能据此更新账本。" };
    if (r.side_effects === false) return { state: "SUCCEEDED", text: "后端已生成无副作用模拟回执；未发生交易，未改变 PAPER 账本。" };
    return { state: "SUCCEEDED", text: "后端已返回本任务完成回执。账本仍以服务端账本查询为准。" };
  }
  if (execution.status === 'WAITING_APPROVAL') return { state:'WAITING_APPROVAL', text:'等待本人确认或审批；未执行。' };
  if (['READY', 'NOT_STARTED', 'PENDING'].includes(execution.status)) return { state:'NOT_EXECUTED', text:'审批与执行分开记录；当前没有成交回执。' };
  return { state:'UNKNOWN', text:'无法识别执行状态，请核查原任务，不要重复交易。' };
}
export function healthTask(data) {
  const t = data.task_state, h = data.risk_handoff;
  const state = t.status === "WAITING_INPUT" ? "WAITING_INPUT" :
    ["ERROR", "FAILED"].includes(t.status) ? "ERROR" :
    t.status === "BLOCKED" ? "BLOCKED" : t.status === "HANDOFF_REQUIRED" ? "WAITING_RISK" : "UNKNOWN";
  return {
    taskId: t.task_id, sourceTaskId: t.task_id, state,
    // Core only supplies a read-only handoff, not a verified Risk decision.
    risk: "NOT_CONNECTED",
    reason: h ? "当前仅取得诊断交接记录，风控服务尚未连接；没有正式风险审核结论。" : "尚无风险交接记录；风控服务未连接。",
    readOnly: true, canExecute: false,
    approval: "NOT_CONNECTED", execution: executionView(null, t.task_id),
    missing: t.missing_fields || [], audit: data.audit_evidence
  };
}
export function auditEvents(audit, taskId) {
  if (!audit || audit.task_id !== taskId || !Array.isArray(audit.events) ||
      audit.events.some(e => e.task_id !== taskId)) throw new Error("审计响应与当前任务不匹配。");
  return audit.events;
}
