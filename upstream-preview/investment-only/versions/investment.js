import { initArchiveWorkbench } from './archive.js';
import { $, esc, money, pct, api, toast, downloadLink, chart, today, tip, feedback } from "./common.js";
import { allocationView, userError } from './ui-model.mjs';
import { dateStatus, planComparison } from "./presentation.mjs";
let result, inputVersion = 0;
const names = { CURRENT:"当前组合", A:"A 保持或最小动作", B:"B 温和调整", C:"C 风险优先" };
const planCopy = { A:"保留当前配置", B:"适度降低集中度", C:"降低高波动资产权重" };
function invalidate() {
  inputVersion++;
  $('#analysis-anchor').hidden = false;
  document.querySelector('.section-nav a[href="#result-summary"]')?.setAttribute('href','#input-panel');
  $('#journey-evidence').classList.remove('active');
  $('#journey-analysis').classList.remove('active');
  feedback('#run-feedback', '');
  if (result) { result=null; $("#results").hidden=true; $("#input-changed").hidden=false; }
}
async function init() {
  $('#retry-load').hidden = true; $('#load-error').hidden = true;
  $('#portfolio-total').textContent = ''; $('#portfolio-total').classList.add('archive-skeleton'); $('#portfolio-total').setAttribute('aria-busy','true');
  const data=await api("/api/demo/portfolio"), p=data.output.snapshot;
  const raw={portfolio_id:p.portfolio_id,as_of:p.as_of,cash:p.cash,positions:p.positions.map(({instrument_id,type,quantity,price,name,sector})=>({instrument_id,type,quantity,price,name,sector}))};
  $("#portfolio-json").value=JSON.stringify(raw,null,2);
  renderHoldings(p); $("#run").disabled=false;
}
function renderHoldings(p) {
  const dated=dateStatus(p.as_of,today());
  const palette=['#eee5d8','#b9ac9a','#8b8074','#655f58','#dad4cc'];
  const allocation = allocationView(p).map((item,index)=>({...item,color:palette[index%palette.length]}));
  $('#portfolio-total').classList.remove('archive-skeleton'); $('#portfolio-total').removeAttribute('aria-busy');
  $('#portfolio-total').textContent = money(p.total_value * 100);
  $('#overview-numbers').innerHTML = [['现金储备',money(p.cash*100)],['持仓标的',p.positions.length+' 个'],['现金占比',pct(p.cash_weight)]].map(([label,value])=>'<div><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong></div>').join('');
  $('#allocation-count').textContent = allocation.filter(item=>item.weight>0).length;
  $('#allocation-donut').style.background = 'conic-gradient('+allocation.map(item=>item.color+' '+item.start+'% '+item.end+'%').join(',')+')';
  $('#allocation-donut').setAttribute('aria-label', allocation.map(item=>item.label+' '+pct(item.weight)).join('，'));
  $('#allocation-legend').innerHTML = allocation.map(item=>'<li><i class="dot" style="background:'+item.color+'"></i><span>'+esc(item.label)+'</span><b>'+pct(item.weight)+'</b></li>').join('');
  $("#portfolio-stamp").textContent="演示组合 "+money(p.total_value*100);
  $("#portfolio-health").innerHTML='<span>基准日 '+esc(p.as_of.slice(0,10))+'</span><span class="date-warning">'+esc(dated.label)+'</span><span>固定虚构价格 · 不自动更新</span>';
  $("#holdings").innerHTML='<div class="table-wrap"><table><thead><tr><th>证券</th><th class="num">市值</th><th class="num">占比</th></tr></thead><tbody>'+
    p.positions.map(p=>'<tr><td>'+esc(p.name)+'<small>'+esc(p.instrument_id)+'</small></td><td class="num">'+money(p.market_value*100)+'</td><td class="num">'+pct(p.weight)+'</td></tr>').join("")+
    '<tr><td>现金</td><td class="num">'+money(p.cash*100)+'</td><td class="num">'+pct(p.cash_weight)+'</td></tr></tbody></table></div>';
}
$("#check-form").addEventListener("input",invalidate);
$("#demo-profile").onclick=()=>{ invalidate(); $("#horizon").value=365;$("#drawdown").value=10;$("#liquidity").value="medium";toast("已填入虚构偏好，可修改。"); };
$("#check-form").onsubmit=async event=>{
  event.preventDefault();const version=inputVersion;$("#run").disabled=true;$("#results").hidden=true;$("#input-changed").hidden=true;$("#run").textContent="正在诊断…";
  $('#run').setAttribute('aria-busy','true');
  $('#journey-analysis').classList.add('active');
  feedback('#run-feedback','正在校验持仓、计算风险并比较三条路径…');
  try {
    const next=await api("/api/health-check/run",{risk_profile:{investment_horizon_days:Number($("#horizon").value),max_drawdown:Number($("#drawdown").value)/100,liquidity_need:$("#liquidity").value},portfolio:JSON.parse($("#portfolio-json").value)});
    if(version!==inputVersion) { $("#input-changed").hidden=false; return toast("输入已改变，请重新检查。"); }
    if(next.task_state.status!=="HANDOFF_REQUIRED")throw new Error(next.task_state.error_state?.reasons?.join("；")||"请补齐有效的持仓与风险信息。");
    result=next; const a=result.artifacts,m=a.health_report.metrics,s=a.simulation,view=planComparison(s.comparisons);
    if(!view.best||!view.baseline)throw new Error("模拟缺少有效结果，暂不展示结论。");
    renderHoldings(a.portfolio_snapshot);
    $("#risk-metrics").innerHTML=[[tip("演示区间收益","tip-demo-return","只是在这段虚构历史数据上算出的结果，不是你的真实账户收益。"),pct(view.baseline.metrics.cumulative_return),"同一配置的历史模拟"],[tip("历史最大回撤","tip-max-drawdown","从高点跌到低点，曾经出现过的最大跌幅。数值越接近 0，跌得越少。"),pct(m.max_drawdown),"负数越接近 0，回撤越小"],[tip("现金占比","tip-cash-weight","组合里暂时没有买入证券、留在现金里的比例。") ,pct(a.portfolio_snapshot.cash_weight),"不参与证券集中度"]].map(v=>'<article class="metric"><small>'+v[0]+'</small><strong>'+v[1]+'</strong><small>'+v[2]+'</small></article>').join("");
    $("#findings").innerHTML='<p>最大证券仓位 <b>'+esc(a.health_report.concentration.largest_instrument)+'</b>，占 <b>'+pct(a.health_report.concentration.top_1)+'</b>。</p><p class="small">短样本年化波动率 '+pct(m.annualized_volatility)+'。</p>'+
      a.health_report.hidden_clusters.map(c=>'<p class="small">'+esc(c.instruments.join(" / "))+' · 相关系数 '+c.correlation.toFixed(3)+'</p>').join("");
    $("#verdict-title").textContent=names[view.best.plan_id]+" · 样本内回撤较小";
    $("#verdict-copy").textContent="相较当前组合，回撤"+(view.improvementPoints>=0?"减少 ":"增加 ")+Math.abs(view.improvementPoints).toFixed(2)+" 个百分点；需换手 "+pct(view.best.turnover)+"。仅作历史比较。";
    $("#verdict-evidence").innerHTML=[
      "当前组合最大单项仓位为 "+a.health_report.concentration.largest_instrument+"，占 "+pct(a.health_report.concentration.top_1)+"。",
      "三条路径使用同一段价格数据、同一起始资金和同一费用口径。",
      names[view.best.plan_id]+"在这段样本中的最大回撤为 "+pct(view.best.metrics.max_drawdown)+"，换手率为 "+pct(view.best.turnover)+"。",
      "这只是固定样例比较，没有使用真实交易记录，也没有自动执行交易。"
    ].map(item=>"<li>"+esc(item)+"</li>").join("");
    $("#verdict-tag").textContent="非个性化推荐";
    $("#comparison").innerHTML='<div class="plan-grid">'+view.plans.map(c=>{
      const index=s.comparisons.findIndex(item=>item.plan_id===c.plan_id),d=s.scenarios[index].distribution;
      const proposal=a.candidates.find(item=>item.plan_id===c.plan_id);
      return '<article class="plan-card'+(c.plan_id===view.best.plan_id?' highlighted':'')+'"><p class="section-kicker">'+(c.plan_id===view.best.plan_id?'样本内回撤较小':'固定规则示例')+'</p><h3>'+esc(names[c.plan_id])+'</h3><p class="plan-meta">'+planCopy[c.plan_id]+'</p><div class="row"><span><small>区间收益</small><strong>'+pct(c.metrics.cumulative_return)+'</strong></span><span><small>最大回撤</small><strong>'+pct(c.metrics.max_drawdown)+'</strong></span></div><p class="small">换手率 '+pct(c.turnover)+'</p><details><summary>查看路径 '+esc(c.plan_id)+' 的细节</summary><p class="small">20 日情景 P10 / P50 / P90：'+[d.p10,d.p50,d.p90].map(pct).join(" / ")+'。仅演示重采样机制，不是未来预测。</p><ul class="weight-list">'+Object.entries(proposal?.target_weights||{}).map(([id,value])=>'<li>'+esc(id)+' <b>'+pct(value)+'</b></li>').join("")+'</ul></details></article>';
    }).join("")+'</div>';
    $("#investment-chart").innerHTML=chart(s.comparisons.map(c=>({name:names[c.plan_id],values:c.curve.map(p=>Number(((p.value-1)*100).toFixed(4)))})),s.comparisons[0].curve.map(p=>p.date.slice(5)));
    $("#weights").innerHTML='<div class="table-wrap"><table><thead><tr><th>标的</th>'+a.candidates.map(c=>'<th>'+esc(c.plan_id)+'</th>').join("")+'</tr></thead><tbody>'+[...new Set(a.candidates.flatMap(c=>Object.keys(c.target_weights)))].map(id=>'<tr><td>'+esc(id)+'</td>'+a.candidates.map(c=>'<td>'+pct(c.target_weights[id]||0)+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';
    $("#assumptions").textContent=s.comparisons[0].curve.length+" 个价格观测。统一起始资金 "+money(s.assumptions.initial_capital*100)+"；单向换手 × "+pct(s.transaction_cost_rate)+" 扣费；2,000 条联合收益区块重采样路径、固定种子、20 个交易日情景。年化系数 252、无风险利率 2%。";
    $("#task-status").textContent=result.task_state.stage+" · 等待团队风控接入";
    $("#evidence").textContent=JSON.stringify({task_state:result.task_state,tool_results:result.tool_results},null,2);
    // Audit loading must not hide a valid result or overwrite a newer run.
    api("/api/audit/"+encodeURIComponent(next.task_state.task_id)).then(audit=>{
      if(result===next&&version===inputVersion)$("#evidence").textContent=JSON.stringify({task_state:next.task_state,tool_results:next.tool_results,audit},null,2);
    }).catch(()=>{
      if(result===next&&version===inputVersion)$("#evidence").textContent+="\n完整运行记录暂未读取成功，可重新检查后再试。";
    });
    $('#analysis-anchor').hidden=true; $('#journey-evidence').classList.add('active');
    document.querySelector('.section-nav a[data-health-link]')?.setAttribute('href','#result-summary');
    feedback('#run-feedback','分析完成，已保留本次偏好和持仓。','success');
    $("#results").hidden=false;$("#input-panel").open=false;$("#result-summary").scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:"start"});toast("分析完成。展开方案可查看细节。");
  }catch(error){ result=null; $('#journey-analysis').classList.remove('active'); feedback('#run-feedback',userError(error),'error');toast(userError(error)); }
  finally{$("#run").disabled=false;$("#run").textContent="开始健康检查 →";$('#run').removeAttribute('aria-busy');}
};
$("#export").onclick=()=>{if(result)downloadLink("/api/task/"+encodeURIComponent(result.task_state.task_id)+"/export");};
async function loadPortfolio() {
  try { await init(); }
  catch(error) {
    $('#portfolio-total').classList.remove('archive-skeleton'); $('#portfolio-total').removeAttribute('aria-busy'); $('#portfolio-total').textContent = '暂不可用'; $('#portfolio-stamp').textContent = '数据读取失败';
    $('#portfolio-health').textContent = '暂未取得数据，点击下方按钮重试。';
    $('#overview-numbers').textContent = '组合数据未加载。'; $('#allocation-legend').textContent = '暂无可展示数据。';
    $('#load-error').hidden=false; $('#load-error').textContent='数据读取失败：'+error.message;
    $('#retry-load').hidden=false; $('#run').disabled=true;
  }
}
$('#retry-load').onclick = loadPortfolio;
loadPortfolio();

initArchiveWorkbench();
