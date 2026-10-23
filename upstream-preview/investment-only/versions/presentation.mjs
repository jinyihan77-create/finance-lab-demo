// Pure view models: no API calls, storage, recommendations or trade execution.
const DAY = 86400000;
function dateMillis(value) {
  if (typeof value !== "string") return null;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const time = Date.parse(day + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day ? time : null;
}
export function dateStatus(asOf, observedOn) {
  const source = dateMillis(asOf), now = dateMillis(observedOn);
  if (source === null || now === null) return { kind: "unknown", ageDays: null, label: "日期待核对" };
  const ageDays = Math.round((now - source) / DAY);
  return { kind: ageDays < 0 ? "future" : ageDays === 0 ? "same-day" : "dated", ageDays,
    label: ageDays < 0 ? "基准日期晚于今日" : ageDays === 0 ? "截至今日 · 非实时" : "距今日 " + ageDays + " 天 · 非实时" };
}
export function planComparison(comparisons) {
  const valid = item => item && Number.isFinite(item.metrics?.max_drawdown) &&
    item.metrics.max_drawdown <= 0 && Number.isFinite(item.metrics?.cumulative_return) &&
    Number.isFinite(item.turnover) && item.turnover >= 0;
  const baseline = comparisons.find(item => item.plan_id === "CURRENT" && valid(item)) || null;
  const plans = comparisons.filter(item => ["A", "B", "C"].includes(item.plan_id) && valid(item));
  const best = plans.reduce((chosen, item) => !chosen ||
    item.metrics.max_drawdown > chosen.metrics.max_drawdown ||
    (item.metrics.max_drawdown === chosen.metrics.max_drawdown && item.turnover < chosen.turnover) ? item : chosen, null);
  return { baseline, plans, best,
    improvementPoints: baseline && best ? (best.metrics.max_drawdown - baseline.metrics.max_drawdown) * 100 : null };
}
const key = bill => bill.channel + ":" + bill.id;
export function priorityBills(bills) {
  // Pending items first, then earlier dates; the complete list remains available.
  return [...bills].sort((a, b) => Number(a.status === "settled") - Number(b.status === "settled") ||
    a.due_on.localeCompare(b.due_on) || key(a).localeCompare(key(b)));
}
export function merchantOverview(state) {
  const { ledger, forecast } = state;
  const pending = ledger.bills.filter(bill => bill.status === "pending");
  const unconfirmed = pending.filter(bill => bill.kind === "income" && bill.due_on <= ledger.as_of);
  const nextPayment = priorityBills(pending.filter(bill => bill.kind === "expense"))[0] || null;
  // Include the opening balance. A negative opening balance is not a future risk.
  const gap = ledger.balance_cents < 0 ? { date: ledger.as_of, expected_cents: ledger.balance_cents, opening: true } :
    forecast.days.find(day => day.expected_cents < 0) || null;
  const conservativeGap = ledger.balance_cents < 0 ? { date: ledger.as_of } :
    forecast.days.find(day => day.conservative_cents < 0) || null;
  return { unconfirmed, nextPayment, gap, conservativeGap, pendingCount: pending.length,
    scenario: forecast.delay_days === 0 ? "按预计日期到账" : "到账延迟 " + forecast.delay_days + " 天" };
}
