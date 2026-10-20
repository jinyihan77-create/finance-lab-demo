export const allocationColors = ['#ff7a1a', '#ffb06a', '#bd8a67', '#777778', '#d0ccc7'];

export function allocationView(snapshot) {
  const rows = snapshot.positions.map(position => ({
    label: position.name,
    value: position.market_value,
    weight: snapshot.total_value > 0 ? position.market_value / snapshot.total_value : 0
  }));
  rows.push({ label: '现金储备', value: snapshot.cash, weight: snapshot.total_value > 0 ? snapshot.cash / snapshot.total_value : 0 });
  let offset = 0;
  return rows.map((row, index) => {
    const start = offset;
    offset += row.weight * 100;
    return { ...row, color: allocationColors[index % allocationColors.length], start, end: offset };
  });
}

export function chartDomain(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { low: 0, high: 1 };
  const min = Math.min(...finite), max = Math.max(...finite);
  const padding = Math.max((max - min) * 0.12, Math.abs(max) * 0.03, 0.1);
  return { low: Math.min(0, min - padding), high: Math.max(0, max + padding) };
}

export function userError(error) {
  if (error?.name === 'SyntaxError') return 'JSON 格式不正确，请检查逗号、引号和括号后重试。';
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return '请求超时，请检查连接后重试。输入内容已保留。';
  if (error instanceof TypeError) return '暂时无法连接服务，请检查连接后重试。';
  return error?.message || '操作未完成，请稍后重试。';
}
