"""Conversation orchestration, deterministic bookkeeping and optional model review.

Every monetary mutation here changes a user-reported local record only. No
banking, brokerage, approval or execution endpoint is available to this module.
"""
from __future__ import annotations
import copy
import csv
import io
import json
import re
import uuid
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from .journal_parser import extract, amounts, number, split_clauses, SHANGHAI
from . import core_client

LABELS = {'income':'收入','expense':'生活','subscription':'订阅','investment':'投资','coupon':'优惠'}
STATUS = {'recorded':'已记录','plan':'计划，未执行','review':'待核对','request':'待查优惠'}
BUDGET_LABELS = {'opening':'月初可用现金','essentials':'本月剩余必要开支','buffer':'应急预留'}
PREFERENCE_LABELS = {
    'workflow': {'record_only':'只整理账本','budget_coach':'优先控制预算','investment_coach':'优先看投资安排'},
    'response_style': {'brief':'简短反馈','detailed':'详细解释'},
    'memory_policy': {'important_only':'只记重点','never':'不进入重点记忆','remember_default':'按重点记忆'},
}


def now():
    return datetime.now(SHANGHAI).isoformat()


def money(cents, currency='CNY'):
    return ('¥' if currency == 'CNY' else 'US$') + f'{cents/100:,.2f}' if cents is not None else '待补充'


def summary(state):
    month = now()[:7]
    rows = [r for r in state['records'] if r['occurred_on'].startswith(month)]
    totals = {}
    for row in rows:
        if row['amount_cents'] is None or row['status'] not in ('recorded','plan'):
            continue
        total = totals.setdefault(row['currency'], dict(income=0, expense=0, investment=0, proceeds=0, planned=0))
        if row['status'] == 'plan':
            if row['direction'] == 'out': total['planned'] += row['amount_cents']
        elif row['kind'] == 'income': total['income'] += row['amount_cents']
        elif row['kind'] in ('expense','subscription'): total['expense'] += row['amount_cents']
        elif row['kind'] == 'investment': total['proceeds' if row['direction']=='in' else 'investment'] += row['amount_cents']
    cny = totals.get('CNY', dict(income=0,expense=0,investment=0,proceeds=0,planned=0))
    budget = state['budgets'].get(month, {})
    missing = [field for field in BUDGET_LABELS if field not in budget]
    available = None if missing else budget['opening']+cny['income']+cny['proceeds']-cny['expense']-cny['investment']-cny['planned']-budget['essentials']-budget['buffer']
    return {'month':month,'totals':totals,'budget':budget,'missing':missing,'available_cents':available,
            'foreign_currency_unconverted':any(c!='CNY' for c in totals),'review_count':sum(r['status']=='review' for r in rows)}


def public_state(state):
    result = {key:copy.deepcopy(state[key]) for key in ('version','threads','records','budgets','profile')}
    result['summary'] = summary(state)
    result['memories'] = [copy.deepcopy(r) for r in state['records'] if state['profile'].get('memory_policy') != 'never' and r.get('remember',True) and r['status']!='review' and (r['kind']=='investment' or r['attention']=='high')]
    result['memories'].sort(key=lambda r:r['occurred_on'],reverse=True)
    return result


def refresh_salary_plans(state, source_id):
    source=next((r for r in state['records'] if r['id']==source_id),None)
    updated=[]
    for row in state['records']:
        if row.get('ratio_source_id')!=source_id:continue
        if source and source['status']=='recorded':
            row['amount_cents']=int((Decimal(source['amount_cents'])*Decimal(str(row['ratio']))/100).quantize(Decimal('1'),rounding=ROUND_HALF_UP))
            row['currency']=source['currency'];row['status']='plan'
            row['notes']=['随来源工资更新比例计划；仍未执行。']
        else:
            row['amount_cents']=None;row['status']='review';row['notes']=['来源工资已移除或待核对，请重新补充计划金额。']
        row['updated_at']=now();updated.append(row['id'])
    return updated


def resolve_salary_plans(state):
    updated=[]
    for row in state['records']:
        if row.get('ratio_base')!='salary' or row['amount_cents'] is not None or row.get('followup_status')!='plan' or not row.get('ratio') or not 0<row['ratio']<=100:continue
        salaries=[r for r in state['records'] if r['category']=='工资' and r['status']=='recorded' and r['amount_cents'] is not None and r['occurred_on'][:7]==row['occurred_on'][:7]]
        if len(salaries)==1:
            row['ratio_source_id']=salaries[0]['id']
            updated.extend(refresh_salary_plans(state,salaries[0]['id']))
    return list(dict.fromkeys(updated))


def _budget_input(text):
    result = {}
    patterns = {'opening':r'月初(?:可用)?(?:现金|余额|有)', 'essentials':r'(?:本月|这个月)?(?:剩余|还需|还要|还需要)(?:必要)?(?:开支|支出|生活费|花)', 'buffer':r'(?:应急(?:金|预留)?|备用金)(?:留|预留|保留)?'}
    for key, pattern in patterns.items():
        found = re.search(pattern+r'\s*(?:是|为|有|留|还要|还需)?\s*('+r'\d+(?:\.\d+)?[万千]?|[零一二两三四五六七八九十百千万]+'+r')\s*(元|块|人民币)?',text)
        if found and not re.search(r'可能|大概|假设|如果|不是|美元|美金|欧元|港币',text):
            result[key]=int(number(found[1])*100)
    return result


def _profile_input(text):
    result={}
    if re.search(r'朋友|同事|他说|她说|假设|如果',text):return result
    horizon=re.search(r'(\d+|[一二两三四五六七八九十]+)\s*(年|个月|天)(?:内|后|不用|不动|不急|期限)?',text)
    if horizon and re.search(r'投资|期限|闲钱|不用|不动|不急',text):result['horizon']=horizon[0]
    risk=re.search(r'中低风险|低风险|中高风险|高风险|稳健|保守|激进',text)
    if risk and not re.search(r'不|别|拒绝|不能',re.split(r'[，,。；;]',text[:risk.start()])[-1]):result['risk_preference']=risk[0]
    return result


def _preference_input(text):
    """Extract user-level working preferences without treating them as money facts."""
    result = {}
    clauses=re.split(r'[，,。；;！!\n]',text)
    if len(clauses)>1:
        for clause in clauses:result.update(_preference_input(clause))
        return result
    if re.search(r'朋友|同事|他说|她说|假设|如果',text):return result
    if re.search(r'不想|不希望|不打算|不是只|不要控制|不以',text):return result
    if re.search(r'只(?:想|要)?记账|只整理账|不要分析|不用(?:投资)?建议|不需要(?:投资)?建议', text):
        result['workflow'] = 'record_only'
    elif re.search(r'帮我管预算|(?:想|要|帮我)控制开支|(?:想|要|帮我)省钱|(?:关注|想管好)生活预算|预算优先', text):
        result['workflow'] = 'budget_coach'
    elif re.search(r'(?:想|要|关注)长期(?:稳健)?投资|投资为主|重点看投资|关注持仓|投资安排优先', text):
        result['workflow'] = 'investment_coach'
    if re.search(r'简短一点|少说一点|别说太多|一句话就好|只给结论', text) and not re.search(r'不要简短|不用简短',text):
        result['response_style'] = 'brief'
    elif re.search(r'详细一点|解释清楚|多讲一点|展开说', text):
        result['response_style'] = 'detailed'
    if re.search(r'(?:以后|之后|平时|默认).{0,8}(?:只记重点|只记大额|重要的才记)', text):
        result['memory_policy'] = 'important_only'
    elif re.search(r'(?:以后|之后|平时|默认).{0,8}(?:不要记住|不进入记忆)', text):
        result['memory_policy'] = 'never'
    elif re.search(r'(?:以后|之后|平时|默认).{0,8}(?:按重点记|恢复重点记忆)', text):
        result['memory_policy'] = 'remember_default'
    return result


def _message_intents(text, rows=None):
    """Diagnostic intent tags; response routing is evaluated separately."""
    intents = []
    rows = rows or []
    if rows or re.search(r'工资|收入|花了|实付|支付|会员|订阅|到账', text): intents.append('record')
    if re.search(r'预算|余量|生活成本|缩减开支|花了多少|收支', text): intents.append('budget')
    if re.search(r'投资|持仓|组合|基金|纳斯达克|定投|收益|风险', text): intents.append('investment')
    if re.search(r'记住|记忆|忘记|保存', text): intents.append('memory')
    if re.search(r'优惠券|找券|搜券|领券', text): intents.append('coupon')
    if re.search(r'简短|详细|只记账|只整理|以后不要记住|只记重点', text): intents.append('preference')
    if re.search(r'分析|评估|建议|该不该|能不能投|适不适合', text): intents.append('analysis')
    return intents or ['conversation']


def _preference_summary(profile):
    labels = []
    for key, value in profile.items():
        label = PREFERENCE_LABELS.get(key, {}).get(value)
        if label: labels.append(label)
    return '、'.join(labels)


def requested_records(state,text):
    """Queries use explicit period/category; they never create transactions."""
    today=datetime.now(SHANGHAI).date()
    if '昨天' in text:period=(today-timedelta(days=1)).isoformat();label='昨天'
    elif '今天' in text:period=today.isoformat();label='今天'
    elif '上个月' in text or '上月' in text:period=(today.replace(day=1)-timedelta(days=1)).isoformat()[:7];label='上个月'
    else:period=today.isoformat()[:7];label='本月'
    kind='subscription' if re.search(r'订阅|会员',text) else 'investment' if re.search(r'投资|基金|纳斯达克',text) else None
    category='餐饮' if re.search(r'餐饮|吃饭|午饭|晚饭',text) else '交通' if re.search(r'打车|交通',text) else None
    rows=[r for r in state['records'] if r['occurred_on'].startswith(period) and (not kind or r['kind']==kind) and (not category or r['category']==category)]
    return rows,label,kind,category


def fact_clause(text):
    # Keep facts sharing a clause with a preference (common in speech dictation).
    controls=[r'(?:我|以后|之后|平时|默认)?(?:只(?:想|要)?记账|只整理账(?:本)?|不要分析|不用(?:投资)?建议|不需要(?:投资)?建议)',
              r'(?:回答)?(?:简短一点|少说一点|别说太多|一句话就好|只给结论|详细一点|解释清楚|多讲一点|展开说)',
              r'(?:这次|这条|这一笔|这段|以后|之后|平时|默认).{0,4}(?:不要记住|别记住|不进(?:入)?记忆|只记重点|只记大额|按重点记|恢复重点记忆)',
              r'(?:我)?(?:帮我管预算|(?:想|要|帮我)控制开支|(?:想|要|帮我)省钱|预算优先|投资为主|重点看投资|关注持仓|投资安排优先|(?:想|要|关注)长期(?:稳健)?投资)']
    for pattern in controls:text=re.sub(pattern,'',text)
    text=re.split(r'(?:请|再|帮我|请帮我)?(?:分析|评估|给.{0,3}建议|看看.{0,5}风险)',text,maxsplit=1)[0]
    if _profile_input(text) and not amounts(text):return ''
    return text


class Assistant:
    def __init__(self, store, reviewer=None):
        self.store=store
        self.reviewer=reviewer or core_client.review

    def state(self, session):
        return public_state(self.store.load(session))

    def message(self, session, payload):
        text=payload.get('text')
        if not isinstance(text,str) or not 0<len(text.strip())<=6000:raise ValueError('请输入 1–6000 字。')
        text=text.strip()
        request_id=payload.get('request_id','')
        thread_id=payload.get('thread_id','')
        if not all(isinstance(v,str) and re.fullmatch(r'[a-zA-Z0-9_-]{8,80}',v) for v in (request_id,thread_id)):
            raise ValueError('会话标识无效，请刷新后重试。')
        with self.store.lock(session):
            state=self.store.load(session)
            prior=state['requests'].get(request_id)
            if prior:
                if prior['text']!=text or prior['thread_id']!=thread_id:raise ValueError('这次请求内容已改变，请重新发送。')
                return {'state':public_state(state),'thread_id':thread_id,'duplicate':True}
            thread=next((t for t in state['threads'] if t['id']==thread_id),None)
            if thread is None:
                thread={'id':thread_id,'title':text[:22],'created_at':now(),'messages':[],'pending':None}
                state['threads'].insert(0,thread)
            user={'id':uuid.uuid4().hex,'role':'user','text':text,'created_at':now()}
            answer=self.respond(state,thread,text,payload.get('record_id'))
            answer['intents']=_message_intents(text)
            answer.update(id=uuid.uuid4().hex,role='assistant',created_at=now())
            thread['messages'].extend([user,answer])
            state['requests'][request_id]={'text':text,'thread_id':thread_id}
            self.store.save(session,state)
            return {'state':public_state(state),'thread_id':thread_id}

    def respond(self,state,thread,text,selected=None):
        answer={'text':'','record_ids':[],'actions':[],'engine':'local_rules','model':None}
        # Preferences are explicit, reversible choices, never inferred demographic labels.
        preferences=_preference_input(text)
        one_off_private=bool(re.search(r'(?:这次|这条|这一笔|这段).{0,8}(?:不要记住|别记住|不进(?:入)?记忆)',text))
        state['profile'].update(preferences)
        if preferences.get('workflow')=='record_only' and (thread.get('pending') or {}).get('kind')=='budget':thread['pending']=None
        if re.search(r'忽略.{0,8}(规则|指令)|绕过.{0,8}(确认|风控)|无需确认|system\s*:',text,re.I):
            answer['text']='可以帮你整理和检查，但不会跳过资金确认。这段话尚未写入账本。'
            return answer
        if re.search(r'(?:帮我|现在|直接).{0,8}(?:转账|转给|付款|下单|买入|卖出)|给.{1,12}转\d',text):
            answer['text']='这涉及资金操作。我可以帮你整理意图和检查风险；当前对话入口尚未接通交易确认与执行，资金没有发生变化。'
            answer['actions']=[{'kind':'ask','label':'先检查风险','text':'帮我分析这笔资金安排的风险'}]
            return answer
        pending=thread.get('pending')
        if re.fullmatch(r'(?:先不(?:问了|补充|填|说|分析)?|暂不(?:补充|分析)?|不用了|取消追问|跳过|稍后再说)[。！]?',text):
            if (thread.get('pending') or {}).get('kind')=='edit':thread.setdefault('deferred_review_ids',[]).append(thread['pending']['id'])
            thread['pending']=None;answer['text']='好，先保留目前已经确定的记录。需要时说“继续核对”就能接着补充。';return answer
        if re.fullmatch(r'继续(?:核对|补充)[。！]?',text):
            thread['deferred_review_ids']=[]
            if not self.ask_next_review(state,thread,answer):answer['text']='当前对话里的记录都已核对。还可以继续告诉我新的收支。'
            return answer
        if re.fullmatch(r'(?:请|帮我)?(?:打开|查看|展开|看看|导出)(?:我的|本月|全部)?(?:生活账本|账本|投资计划|投资记录|记忆|重点记忆|订阅)[。！]?',text):
            panel='investment' if '投资' in text else 'memory' if '记忆' in text else 'ledger'
            answer['text']='可以在这里查看整理结果。计划和待核对项目都标有状态。'
            answer['actions']=[{'kind':'panel','label':'展开资料','panel':panel}]
            if '导出' in text:
                if panel=='memory':answer['text']='重点记忆请在面板查看；表格可导出账本或投资记录。'
                else:
                    answer['text']='表格已按当前记录准备好，点下方下载，用 Excel 打开即可。'
                    answer['actions']=[{'kind':'download','label':'下载投资表格' if panel=='investment' else '下载账本表格','href':'/api/assistant/export'+('?scope=investment' if panel=='investment' else '')}]
            return answer
        if re.match(r'(?:请|帮我)?删除',text):
            answer['text']='请在账本里找到对应记录，点击“删除”并确认。删除后统计会更新，原始对话仍保留。'
            answer['actions']=[{'kind':'panel','label':'选择要删除的记录','panel':'ledger'}];return answer
        edit_followup=bool(re.fullmatch(r'(?:已支付|已发生|实付|到账|实际花了|计划)?\s*[\d零一二两三四五六七八九十百千万]+(?:\.\d+)?\s*(?:元|块|美元|美金)?[。.]?',text) or re.fullmatch(r'(?:已经|已|是)?(?:支付|付过|发生|到账)了?[。！]?',text) or re.fullmatch(r'(?:只是|是|还只是)?计划[。！]?',text) or re.search(r'改成|改为|记错|其实|已经支付|已经到账|已经发生',text))
        if selected or (pending and pending['kind']=='edit' and edit_followup and not re.search(r'工资|会员|订阅|GPT|午饭|晚饭|餐饮|基金|纳斯达克|房租|打车',text,re.I)):
            row=next((r for r in state['records'] if r['id']==(selected or pending['id'])),None)
            if row:
                parsed=amounts(text)
                correction=re.search(r'(?:改成|改为|更正为)\s*([\d零一二两三四五六七八九十百千万]+(?:\.\d+)?)\s*$',text)
                if correction and not parsed:parsed=amounts(correction[1]+('美元' if row['currency']=='USD' else '元'))
                if not parsed and re.fullmatch(r'[\d零一二两三四五六七八九十百千万]+(?:\.\d+)?',text):parsed=amounts(text+('美元' if row['currency']=='USD' else '元'))
                status_reply = re.fullmatch(r'(?:已经|已|是)?(?:支付|付过|发生|到账)了?[。！]?',text)
                plan_reply = re.fullmatch(r'(?:只是|是|还只是)?计划[。！]?',text)
                if (len(parsed)==1 or ((status_reply or plan_reply) and row['amount_cents'] is not None)) and not re.search(r'可能|大概|没花|未付|不是|假设|如果|[-−]\s*\d|欧元|港币|日元|英镑',text):
                    if parsed:row['amount_cents'],row['currency']=parsed[0]
                    if '计划' in text: row['status']='plan'
                    elif status_reply or re.search(r'已支付|已发生|实付|到账|实际花|确实花',text):row['status']='recorded'
                    elif row['status']=='review' and row.get('followup_status') in ('recorded','plan') and row['amount_cents'] is not None:
                        row['status']=row['followup_status']
                    if row['occurred_on']>now()[:10] and row['status']=='recorded':row['status']='plan'
                    # An explicit plan amount replaces the earlier salary formula.
                    if row['kind']=='investment':
                        row.pop('ratio_source_id',None);row['ratio']=None;row['ratio_base']=None
                    row['updated_at']=now();row['confidence']='user_checked'
                    row['notes']=['已按你的补充修改；属于自述记录，尚未与账户对账。']
                    row['attention']='high' if row['kind']=='investment' or row['amount_cents']>=(100000 if row['currency']=='CNY' else 20000) else 'normal'
                    thread['pending']={'kind':'edit','id':row['id']} if row['status']=='review' else None;answer['record_ids']=[row['id']]
                    updated=list(dict.fromkeys(refresh_salary_plans(state,row['id'])+resolve_salary_plans(state)))
                    answer['record_ids'].extend(updated)
                    answer['text']=f'已把{row["title"]}更新为 {money(row["amount_cents"],row["currency"])}。'+('还需说明已支付还是计划，才能计入对应统计。' if row['status']=='review' else '相关统计也一起更新了。')
                    if updated:answer['text']+='关联的工资比例计划也重新计算了。'
                    if row['status']!='review':self.ask_next_review(state,thread,answer,exclude=row['id'])
                    return answer
                thread['pending']={'kind':'edit','id':row['id']}
                answer['text']=f'你想怎样修改“{row["title"]}”？可以直接说“实付 28 元”或“计划 3000 元”。';return answer
        # Natural correction resolves exactly one target, never all similar entries.
        if re.search(r'其实|改成|改为|记错|更正为',text):
            kind='subscription' if re.search(r'会员|订阅|GPT',text,re.I) else 'income' if '工资' in text else 'expense' if re.search(r'饭|餐|打车|房租|衣服',text) else 'investment' if re.search(r'投资|基金|纳斯达克',text) else None
            period=(datetime.now(SHANGHAI).date()-timedelta(days=1)).isoformat() if '昨天' in text else now()[:10]
            candidates=[r for r in state['records'] if r['kind']==kind and r['occurred_on']==period]
            meal=next((label for label in ('早餐','午饭','晚饭') if label in text),None)
            if meal and any(r.get('meal')==meal for r in candidates):candidates=[r for r in candidates if r.get('meal')==meal]
            if re.search(r'上一笔|最后一笔|刚才那笔',text):
                thread_rows=[r for r in state['records'] if r.get('thread_id')==thread['id']]
                candidates=thread_rows[-1:]
            if len(candidates)==1:return self.respond(state,thread,text,candidates[0]['id'])
            if candidates:
                answer['text']='找到几条相似记录，先选中要改的那一笔，再告诉我金额。'
                answer['actions']=[{'kind':'edit','label':f'{r.get("meal",r["title"])} · {money(r["amount_cents"],r["currency"])}','id':r['id']} for r in candidates[-5:]];return answer
            answer['text']='还不能确定你要修改哪笔。可以说“昨天午饭改成28元”，或从账本选中记录。'
            answer['actions']=[{'kind':'panel','label':'选择记录','panel':'ledger'}];return answer
        budget=_budget_input(text)
        if pending and pending['kind']=='budget' and not budget:
            parsed=amounts(text)
            if not parsed and re.fullmatch(r'\d+(?:\.\d+)?',text):parsed=amounts(text+'元')
            if len(parsed)==1 and parsed[0][1]=='CNY' and re.fullmatch(r'(?:是|有)?\s*\d+(?:\.\d+)?\s*(?:元|块|人民币)?\s*[。.]?',text):
                budget[pending['field']]=parsed[0][0]
        if budget:
            state['budgets'].setdefault(now()[:7],{}).update(budget)
            thread['pending']=None
            answer['text']='已记下'+ '、'.join(f'{BUDGET_LABELS[k]} {money(v)}' for k,v in budget.items())+'。'
        profile=_profile_input(text)
        state['profile'].update(profile)
        wants_analysis=bool(re.search(r'分析|评估|给.{0,3}建议|有.{0,3}风险|风险.{0,3}(吗|如何|多大)|能不能投|该不该|适不适合|怎么投|如何投',text))
        if re.search(r'不要分析|不用分析|不需要(?:分析|投资建议)|只(?:想|要)?记账|只整理账',text):wants_analysis=False
        if re.fullmatch(r'忘记我的(?:投资偏好|偏好|需求偏好)[。！]?',text):
            state['profile']={};answer['text']='已移除偏好，之后不会继续引用。原始对话仍保留。';return answer
        if not preferences and not wants_analysis and not budget and re.search(r'花了多少|收支|账单|账本|本月.*(花|收入)|还有多少钱|生活余量|预算',text) and not amounts(text):
            query_rows,period,kind,category=requested_records(state,text)
            if kind or category or re.search(r'今天|昨天|上个月|上月',text):
                recorded=[r for r in query_rows if r['status']=='recorded' and r['amount_cents'] is not None]
                amounts_by_currency={}
                for r in recorded:
                    key=(r['currency'],r['direction']);amounts_by_currency[key]=amounts_by_currency.get(key,0)+r['amount_cents']
                answer['text']=period+(LABELS.get(kind,'') if kind else category or '')+'已记录：\n'+ ('\n'.join(f'{"收入" if direction=="in" else "支出"} {money(v,c)}' for (c,direction),v in amounts_by_currency.items()) if recorded else '还没有已确认的收支。')
                answer['text']+='\n计划和待核对项不计入；这不是完整账户余额。'
                answer['record_ids']=[r['id'] for r in query_rows]
                answer['actions']=[{'kind':'panel','label':'查看记录','panel':'investment' if kind=='investment' else 'ledger'}];return answer
            s=summary(state)
            if not s['totals']:answer['text']='还没有可汇总的收支。直接告诉我一笔已经发生的收入或支出就可以开始。'
            else:
                answer['text']='按本月已记录的项目：\n'+'\n'.join(f'{c}：收入 {money(t["income"],c)}，生活与订阅 {money(t["expense"],c)}，待执行流出计划 {money(t["planned"],c)}。' for c,t in s['totals'].items())+'\n这是已记录收支，不是总资产或账户余额。'
                self.add_budget_question(state,thread,answer,ask='预算' in text or '余量' in text)
            if not s['totals'] and ('预算' in text or '余量' in text):self.add_budget_question(state,thread,answer)
            answer['actions']=[{'kind':'panel','label':'展开账本','panel':'ledger'}];return answer
        if not preferences and not one_off_private and not amounts(text) and re.search(r'记住了什么|记忆|忘掉|忘记',text):
            answer['text']='重要的投资计划和大额事项会整理到记忆里。你可以查看来源，或点“忘记”停止使用这条摘要，原始账本仍保留。'
            answer['actions']=[{'kind':'panel','label':'查看记忆','panel':'memory'}];return answer
        if not wants_analysis and re.search(r'持仓|组合',text) and not re.search(r'买入|卖出|花了|买了|投了|\d',text):
            answer['text']='目前没有经过对账的真实持仓。告诉我你持有哪些标的、份额或市值，我会先整理为待核对资料；有了依据再分析。'
            answer['actions']=[{'kind':'panel','label':'查看投资记录','panel':'investment'}];return answer
        # Contextual salary ratios can use a unique already recorded salary this month.
        # Exclude questions and budget-only clauses from cash flow extraction.
        pieces=split_clauses(text)
        facts='；'.join(fact_clause(p) for p in pieces if not _budget_input(p) and not re.search(r'分析|评估|该不该|能不能|适不适合|怎么投|如何投|会不会|多少钱|花了多少',fact_clause(p)))
        parsed=extract(facts or '继续整理')
        rows=parsed['records']
        for row in rows:
            row['thread_id']=thread['id']
            row['remember']=not one_off_private and state['profile'].get('memory_policy')!='never'
            if row.get('ratio_base')=='salary' and row['amount_cents'] is None and row.get('ratio') and 0<row['ratio']<=100:
                salaries=[r for r in state['records'] if r['category']=='工资' and r['status']=='recorded' and r['occurred_on'][:7]==row['occurred_on'][:7]]
                if len(salaries)==1 and re.search(r'打算|计划|准备|拿工资|工资的',text) and not re.search(r'如果|假设|可能|不|朋友|同事',text):
                    salary=salaries[0];row['amount_cents']=int((Decimal(salary['amount_cents'])*Decimal(str(row['ratio']))/100).quantize(Decimal('1'),rounding=ROUND_HALF_UP));row['currency']=salary['currency'];row['status']='plan';row['notes']=['按本月已记录工资计算，仅为未执行计划。'];row['title']=row['title'].replace('记录','计划')
            if any(all(r.get(k)==row.get(k) for k in ('kind','title','amount_cents','currency','occurred_on')) and r['status']!='review' for r in state['records']):
                row['status']='review';row['notes'].append('可能重复，核对后才计入统计。')
            if row.get('ratio_base')=='salary' and row['status']=='plan' and any('按本段已记录工资' in n or '按本月已记录工资' in n for n in row['notes']):
                sources=[r for r in state['records'] if r['category']=='工资' and r['status']=='recorded' and r['occurred_on'][:7]==row['occurred_on'][:7]]
                if len(sources)==1:row['ratio_source_id']=sources[0]['id']
            state['records'].append(row)
        resolved=resolve_salary_plans(state)
        answer['record_ids']=list(dict.fromkeys([r['id'] for r in rows]+resolved))
        if rows:
            actual=sum(r['status']=='recorded' for r in rows);plans=sum(r['status']=='plan' for r in rows);review=sum(r['status']=='review' for r in rows)
            lead=answer['text']+'\n' if answer['text'] else ''
            result='，'.join(s for s in [f'记下了 {actual} 笔已发生收支' if actual else '',f'{plans} 项投资或消费计划单独放好' if plans else '',f'{review} 项需要核对，暂不计入金额' if review else ''] if s)
            answer['text']=lead+(parsed['empathetic']+'\n' if re.search(r'烦|累|难受',text) else '')+result+('。' if result else '')
            if any(r['kind']=='coupon' for r in rows):answer['text']+='\n优惠需求已整理好；目前尚未连接优惠平台，不能确认有券或已领券。'
            answer['actions']=[{'kind':'panel','label':'查看整理结果','panel':'ledger'}]
            if not wants_analysis and self.ask_next_review(state,thread,answer):pass
            elif not wants_analysis and not (thread.get('pending') and thread['pending']['kind']=='edit') and (plans or budget or state['profile'].get('workflow')=='budget_coach' or any(r['attention']=='high' and r['status'] in ('recorded','plan') for r in rows) or (actual and not summary(state)['missing'])):
                self.add_budget_question(state,thread,answer)
            if state['profile'].get('workflow')!='record_only' and any(r['kind']=='investment' or r['attention']=='high' for r in rows) and not wants_analysis:
                answer['actions'].append({'kind':'ask','label':'看看资金安排','text':'结合已记录的信息，帮我分析生活与投资安排'})
        elif budget:
            self.add_budget_question(state,thread,answer)
            answer['actions']=[{'kind':'panel','label':'查看生活余量','panel':'overview'}]
        elif profile or preferences:
            answer['text']='已按你的需求调整：'+(_preference_summary(state['profile']) or '记下投资期限和风险偏好')+'。随时可以改口或让我忘记。'
            answer['actions']=[{'kind':'panel','label':'查看我的偏好','panel':'memory'}]
            if preferences.get('workflow')=='budget_coach':self.add_budget_question(state,thread,answer)
            elif preferences.get('workflow')=='investment_coach' and not state['profile'].get('horizon'):
                answer['text']+='\n这笔投资的钱，预计多久不用？比如“闲钱三年不用”。'
        else:answer['text']=parsed['empathetic']+'\n你可以直接说今天的一笔开销、投资打算，或让我看看本月的收支。'
        if parsed['unclassified'] and not (budget and re.fullmatch(r'\s*\d+(?:\.\d+)?\s*(?:元|块|人民币)?\s*[。.]?',text)):
            answer['text']+='\n有一部分金额或事项还没有识别清楚，可以再单独说一句，我会继续整理。'
        if wants_analysis:
            if not rows and not budget:answer['text']=''
            self.analyze(state,answer,text)
        if one_off_private:answer['text']+='\n这次的记录不进入重点记忆；账本和原始对话仍保留。'
        if any(i not in [r['id'] for r in rows] for i in resolved):answer['text']+='\n之前缺少工资基数的投资计划已按本月工资补齐，仍未执行。'
        if rows and state['profile'].get('response_style')=='detailed':
            answer['text']+='\n'+ '\n'.join(f'{r["title"]}：{money(r["amount_cents"],r["currency"])}，{STATUS[r["status"]]}。' for r in rows)
        return answer

    def ask_next_review(self,state,thread,answer,exclude=None):
        pending=thread.get('pending') or {}
        ids={i for m in thread.get('messages',[]) for i in m.get('record_ids',[])}
        candidates=[r for r in state['records'] if r['status']=='review' and r['kind']!='coupon' and r['id']!=exclude and r['id'] not in thread.get('deferred_review_ids',[]) and (r.get('thread_id')==thread['id'] or r['id'] in ids)]
        if pending.get('kind')=='edit':candidates.sort(key=lambda r:r['id']!=pending['id'])
        if not candidates:
            if pending.get('kind')=='edit':thread['pending']=None
            return False
        row=candidates[0];thread['pending']={'kind':'edit','id':row['id']}
        question=(f'“{row["title"]}”金额是多少？' if row['amount_cents'] is None else f'“{row["title"]}” {money(row["amount_cents"],row["currency"])} 是已发生，还是计划？')
        answer['text']+='\n先核对一件事：'+question+' 可以直接回复，也可以说“跳过”。'
        return True

    def analyze(self,state,answer,text):
        # Only summaries and the explicit question are sent; forgotten memories
        # remain in accounting totals but are not quoted as remembered preferences.
        context={'records':[{'title':r['title'],'amount_cents':r['amount_cents'],'currency':r['currency'],'status':r['status'],'date':r['occurred_on']} for r in state['records'][-30:] if r.get('remember',True) and state['profile'].get('memory_policy')!='never'],'budget':summary(state),'preferences':state['profile']}
        style='详细解释依据，给出计算范围和最多三条建议' if state['profile'].get('response_style')=='detailed' else '先给简短结论，最多一条必要追问'
        question='用户的问题：'+text+'\n以下为用户自述资料，尚未对账，不是实时账户或行情：'+json.dumps(context,ensure_ascii=False)+'\n'+style+'；以用户明确选择的需求为优先，不根据收入推断身份或风险偏好。只分析，不执行交易，不把投资计划当成持仓。不要编造市场行情和收益。'
        if not summary(state)['missing']:
            self.add_budget_question(state,{},answer,ask=False)
        prefix=answer['text']+'\n\n' if answer['text'] else ''
        try:
            model=self.reviewer(question,scenario='GENERAL_REVIEW',data_mode='LIVE')
            reason=(model.get('recommendation') or {}).get('reason')
            if not model.get('model',{}).get('call_succeeded') or not isinstance(reason,str) or not reason.strip():
                raise core_client.CoreAgentError('模型尚未返回可用结果')
            try:
                details=json.loads(model['model'].get('raw_text') or '{}')
                brief=details.get('summary') if isinstance(details,dict) else None
                if isinstance(brief,str) and brief.strip() and brief.strip()!=reason.strip():reason=brief+'\n'+reason
            except (ValueError,TypeError):pass
            answer.update(text=prefix+reason+'\n\n这是分析结果，资金未变动；正式风控与执行尚未完成。',engine='core-agent',model={'name':model['model'].get('name'),'run_id':model.get('run_id'),'status':model.get('workflow_status'),'execution_allowed':False})
        except (core_client.CoreAgentError,ValueError,TypeError) as exc:
            answer.update(text=prefix+'分析服务暂时没有返回有效结果，当前没有生成投资结论。已保存的记录不会丢失，可以稍后重试。',engine='model_unavailable')
            answer['model']={'status':'unavailable','http_status':getattr(exc,'status_code',None),'execution_allowed':False}
            # Retry only analysis, never replay the financial statements as new entries.
            answer['actions'].append({'kind':'ask','label':'重新分析','text':'结合已记录的信息，帮我分析生活与投资安排'})

    def add_budget_question(self,state,thread,answer,ask=True):
        s=summary(state)
        if state['profile'].get('workflow')=='record_only':ask=False
        if s['missing'] and ask:
            field=s['missing'][0];thread['pending']={'kind':'budget','field':field}
            answer['text']+='\n'+{'opening':'为了看清生活费会不会紧张，你月初有多少可用现金？先不用算刚到账的工资。','essentials':'这个月还需要留多少必要开支，比如房租、吃饭和交通？','buffer':'你希望另外保留多少应急金？'}[field]
        elif s['available_cents'] is not None:
            amount=s['available_cents']
            answer['text']+=('\n按已记人民币收支和你的预留，计划后有 '+money(-amount)+' 的缺口。可以先缓一缓新增投资，或看看哪些可选开支能推迟。' if amount<0 else '\n按已记人民币收支，计划和预留之后还有 '+money(amount)+' 的余量。')
        if s['foreign_currency_unconverted']:answer['text']+='\n外币支出尚未折算，未包含在人民币余量中。'

    def change(self,session,payload):
        action=payload.get('action');record_id=payload.get('id')
        if action not in ('delete','forget'):raise ValueError('不支持的操作。')
        with self.store.lock(session):
            state=self.store.load(session);row=next((r for r in state['records'] if r['id']==record_id),None)
            if not row:raise ValueError('记录不存在。')
            if action=='delete':state['records']=[r for r in state['records'] if r['id']!=record_id]
            else:row['remember']=False
            if action=='delete':refresh_salary_plans(state,record_id)
            # Avoid resurrecting deleted values through stale financial assistant messages.
            for thread in state['threads']:
                for msg in thread['messages']:
                    if record_id in msg.get('record_ids',[]):
                        msg['text']='这段归档结果已更新，请以当前账本为准。';msg['record_ids']=[i for i in msg['record_ids'] if action!='delete' or i!=record_id]
                if thread.get('pending',{} ) and thread['pending'].get('id')==record_id:thread['pending']=None
            self.store.save(session,state);return {'state':public_state(state)}

    def export(self,session,scope='all'):
        if scope not in ('all','investment'):raise ValueError('不支持的导出范围。')
        state=self.store.load(session);out=io.StringIO();writer=csv.writer(out)
        writer.writerow(['发生日期','事项','分类','金额','币种','状态','来源'])
        for r in sorted(state['records'],key=lambda x:x['occurred_on'],reverse=True):
            if scope=='investment' and r['kind']!='investment':continue
            cells=[r['occurred_on'],r['title'],LABELS.get(r['kind'],'其他'),'' if r['amount_cents'] is None else f'{r["amount_cents"]/100:.2f}',r['currency'],STATUS[r['status']],'用户自述，未对账']
            writer.writerow(["'"+str(v) if re.match(r'^\s*[=+@-]',str(v)) else v for v in cells])
        return ('\ufeff'+out.getvalue()).encode('utf-8')
