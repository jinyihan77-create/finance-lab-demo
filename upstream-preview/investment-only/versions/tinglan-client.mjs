export const messages = {
  UNCONFIGURED: '安全 AI 入口待团队管理员配置；本次没有发送模型请求。',
  AUTHENTICATION_REQUIRED: '请先打开团队安全工作台并登录获准的账号。',
  INVALID_REVIEW_INPUT: '请完整填写投资金额、期限、风险偏好、目标和问题，并确认资料范围。',
  RATE_LIMITED: '请求频率或测试额度已达上限，请稍后重试或联系管理员。',
  MODEL_TIMEOUT: 'AI 分析超时，本次没有取得结果。请勿连续重复提交。',
  MODEL_NOT_CONFIGURED: '团队尚未启用百炼或调用预算，请联系管理员。',
  MODEL_INVALID_RESPONSE: 'AI 返回格式或模型身份不符合要求，本次结果未采用。',
  SERVICE_UNAVAILABLE: 'AI 后端不可用或网络连接失败，请检查登录与网络后重试。',
  MODEL_PROVIDER_ERROR: '模型服务鉴权失败、限流或暂时不可用，请联系管理员。'
};
export function buildInput(values, id) {
  const horizon = Number(values.horizon), drawdown = values.drawdown === '' || values.drawdown === undefined ? null : Number(values.drawdown), text = String(values.text || '').trim();
  const amount = Number(values.amount), goal = String(values.goal || '').trim();
  const risks = { low: '低', medium_low: '中低', medium: '中', high: '高' };
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 36500 || (drawdown !== null && (!Number.isFinite(drawdown) || drawdown <= 0 || drawdown > 100)) ||
      !Number.isFinite(amount) || amount <= 0 || amount > 100000000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001 ||
      !Object.hasOwn(risks, values.risk) || !goal || goal.length > 200 || !['sample','self_reported'].includes(values.inputMode) ||
      !['low','medium','high'].includes(values.liquidity) || !text || text.length > 1500 || values.consent !== true) throw new Error('INVALID_REVIEW_INPUT');
  const synthetic = values.inputMode === 'sample';
  // Use the existing text contract; never invent new shared risk-profile fields.
  const supplied = '资料来源：' + (synthetic ? '虚构示例' : '用户自述、未经账户核验') + '\n投资金额：' + amount + ' 元人民币\n投资期限：' + horizon +
    ' 天\n自述风险偏好：' + risks[values.risk] + '\n最大可承受回撤：' + (drawdown === null ? '未提供，不能由风险偏好推算' : drawdown + '%') + '\n投资目标：' + goal + '\n用户问题：' + text;
  return { schema_version: 'model-review.v1', kind: 'combined', text: supplied, source: 'tinglan-ui', data_mode: synthetic ? 'SYNTHETIC_REPLAY' : 'LIVE', execution_mode: 'PAPER',
    capability: 'REVIEW_ONLY', memory_consent: false, allow_rule_fallback: false, idempotency_key: id,
    context: { synthetic, risk_profile: { investment_horizon_days: horizon, ...(drawdown === null ? {} : { max_drawdown: drawdown / 100 }), liquidity_need: values.liquidity }, market_data_available: false } };
}
export function readResult(data, modelName) {
  const model = data?.model?.model_response, p = model?.proposal;
  if (!['qwen3.8-flash','qwen3.8-max'].includes(modelName) || data?.model?.source !== 'model' || data.status !== 'PENDING_RISK' || model?.call_succeeded !== true || model.model !== modelName ||
      data.execution?.execution_allowed !== false || typeof p?.summary !== 'string' || !p.summary.trim() || typeof p.action_reason !== 'string' ||
      !Array.isArray(p.evidence) || !p.evidence.every(x => typeof x === 'string') || !Array.isArray(p.missing_information) ||
      !p.missing_information.every(x => typeof x === 'string') || typeof data.run_id !== 'string' || !data.audit?.audit_id) throw new Error('MODEL_INVALID_RESPONSE');
  let raw;
  try { raw = JSON.parse(model.raw_text); } catch { throw new Error('MODEL_INVALID_RESPONSE'); }
  if (raw.summary !== p.summary || raw.action_reason !== p.action_reason) throw new Error('MODEL_INVALID_RESPONSE');
  if (!['资金配置思路','投资期限与流动性建议','适合进一步研究的资产类别','主要风险及注意事项'].every(title => p.action_reason.includes(title))) throw new Error('MODEL_INVALID_RESPONSE');
  return { summary: p.summary, reason: p.action_reason, evidence: p.evidence.join('；') || '未返回证据，请核实来源。', raw: model.raw_text,
    missing: p.missing_information.join('；') || '请继续核实输入资料与适用条件。', model: model.model,
    tokens: Number.isSafeInteger(model.usage?.total_tokens) ? model.usage.total_tokens : null, runId: data.run_id, auditId: data.audit.audit_id };
}
export async function analyze(config, body, fetchImpl, base = location.href) {
  if (!config?.endpoint || !['CLOUDFLARE_ACCESS','SESSION'].includes(config.mode) || !['qwen3.8-flash','qwen3.8-max'].includes(config.model)) throw new Error('UNCONFIGURED');
  const endpoint = new URL(config.endpoint, base);
  if (endpoint.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(endpoint.hostname)) throw new Error('UNCONFIGURED');
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/api/review') throw new Error('UNCONFIGURED');
  try {
    const response = await fetchImpl(endpoint.href, { method: 'POST', credentials: 'include', redirect: 'error',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(35000) });
    if (response.status === 401 || response.status === 403) throw new Error('AUTHENTICATION_REQUIRED');
    if (response.status === 429) throw new Error('RATE_LIMITED');
    if (response.status === 504) throw new Error('MODEL_TIMEOUT');
    let data;
    try { data = await response.json(); } catch { throw new Error('MODEL_INVALID_RESPONSE'); }
    if (!response.ok) throw new Error(messages[data.error?.code] ? data.error.code : 'SERVICE_UNAVAILABLE');
    return readResult(data, config.model);
  } catch (error) {
    if (['TimeoutError', 'AbortError'].includes(error.name)) throw new Error('MODEL_TIMEOUT');
    if (messages[error.message]) throw error;
    throw new Error('SERVICE_UNAVAILABLE');
  }
}
