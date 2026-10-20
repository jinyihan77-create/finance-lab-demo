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
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from .journal_parser import extract, amounts, number, SHANGHAI
from . import core_client

LABELS = {'income':'收入','expense':'生活','subscription':'订阅','investment':'投资','coupon':'优惠'}
STATUS = {'recorded':'已记录','plan':'计划，未执行','review':'待核对','request':'待查优惠'}
BUDGET_LABELS = {'opening':'月初可用现金','essentials':'本月剩余必要开支','buffer':'应急预留'}


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
    result['memories'] = [copy.deepcopy(r) for r in state['records'] if r.get('remember',True) and r['status']!='review' and (r['kind']=='investment' or r['attention']=='high')]
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
    horizon=re.search(r'(\d+|[一二两三四五六七八九十]+)\s*(年|个月|天)(?:内|后|不用|不动|不急|期限)?',text)
    if horizon and re.search(r'投资|期限|闲钱|不用|不动|不急',text):result['horizon']=horizon[0]
    risk=re.search(r'中低风险|低风险|中高风险|高风险|稳健|保守|激进',text)
    if risk:result['risk_preference']=risk[0]
    return result


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
            answer.update(id=uuid.uuid4().hex,role='assistant',created_at=now())
            thread['messages'].extend([user,answer])
            state['requests'][request_id]={'text':text,'thread_id':thread_id}
            self.store.save(session,state)
            return {'state':public_state(state),'thread_id':thread_id}

    def respond(self,state,thread,text,selected=None):
        answer={'text':'','record_ids':[],'actions':[],'engine':'local_rules','model':None}
        if re.search(r'忽略.{0,8}(规则|指令)|绕过.{0,8}(确认|风控)|无需确认|system\s*:',text,re.I):
            answer['text']='可以帮你整理和检查，但不会跳过资金确认。这段话尚未写入账本。'
            return answer
        if re.search(r'(?:帮我|现在|直接).{0,8}(?:转账|转给|付款|下单|买入|卖出)|给.{1,12}转\d',text):
            answer['text']='这涉及资金操作。我可以帮你整理意图和检查风险；当前对话入口尚未接通交易确认与执行，资金没有发生变化。'
            answer['actions']=[{'kind':'ask','label':'先检查风险','text':'帮我分析这笔资金安排的风险'}]
            return answer
        pending=thread.get('pending')
        if re.search(r'先不|暂不|不用了|取消追问',text):
            thread['pending']=None;answer['text']='好，先保留目前已经确定的记录。需要时再继续补充。';return answer
        edit_followup=bool(re.fullmatch(r'(?:已支付|已发生|实付|到账|实际花了|计划)?\s*\d+(?:\.\d+)?\s*(?:元|块|美元|美金)?[。.]?',text) or re.search(r'改成|改为|记错|其实|已经支付|已经到账|已经发生',text))
        if selected or (pending and pending['kind']=='edit' and edit_followup):
            row=next((r for r in state['records'] if r['id']==(selected or pending['id'])),None)
            if row:
                parsed=amounts(text)
                if not parsed and re.fullmatch(r'\d+(?:\.\d+)?',text):parsed=amounts(text+('美元' if row['currency']=='USD' else '元'))
                status_reply = re.fullmatch(r'(?:已经|已|是)?(?:支付|付过|发生|到账)了?[。！]?',text)
                if (len(parsed)==1 or (status_reply and row['amount_cents'] is not None)) and not re.search(r'可能|大概|没花|未付|不是|假设|如果|[-−]\s*\d|欧元|港币|日元|英镑',text):
                    if parsed:row['amount_cents'],row['currency']=parsed[0]
                    if '计划' in text: row['status']='plan'
                    elif status_reply or re.search(r'已支付|已发生|实付|到账|实际花|确实花',text):row['status']='recorded'
                    if row['occurred_on']>now()[:10] and row['status']=='recorded':row['status']='plan'
                    # An explicit plan amount replaces the earlier salary formula.
                    if row['kind']=='investment':
                        row.pop('ratio_source_id',None);row['ratio']=None;row['ratio_base']=None
                    row['updated_at']=now();row['confidence']='user_checked'
                    row['notes']=['已按你的补充修改；属于自述记录，尚未与账户对账。']
                    row['attention']='high' if row['kind']=='investment' or row['amount_cents']>=(100000 if row['currency']=='CNY' else 20000) else 'normal'
                    thread['pending']={'kind':'edit','id':row['id']} if row['status']=='review' else None;answer['record_ids']=[row['id']]
                    updated=refresh_salary_plans(state,row['id'])
                    answer['record_ids'].extend(updated)
                    answer['text']=f'已把{row["title"]}更新为 {money(row["amount_cents"],row["currency"])}。'+('还需说明已支付还是计划，才能计入对应统计。' if row['status']=='review' else '相关统计也一起更新了。')
                    if updated:answer['text']+='关联的工资比例计划也重新计算了。'
                    return answer
                thread['pending']={'kind':'edit','id':row['id']}
                answer['text']=f'你想怎样修改“{row["title"]}”？可以直接说“实付 28 元”或“计划 3000 元”。';return answer
        # Natural correction resolves exactly one target, never all similar entries.
        if re.search(r'其实|改成|改为|记错',text):
            kind='subscription' if re.search(r'会员|订阅|GPT',text,re.I) else 'income' if '工资' in text else 'expense' if re.search(r'饭|餐',text) else 'investment' if re.search(r'投资|基金|纳斯达克',text) else None
            candidates=[r for r in state['records'] if r['kind']==kind and r['occurred_on']==now()[:10]]
            if len(candidates)==1:return self.respond(state,thread,text,candidates[0]['id'])
            if candidates:
                answer['text']='找到几条相似记录。点开账本，在对应那一笔上点“修改”，再告诉我要改什么。'
                answer['actions']=[{'kind':'panel','label':'选择要修改的记录','panel':'ledger'}];return answer
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
        if re.fullmatch(r'忘记我的投资偏好[。！]?',text):
            state['profile']={};answer['text']='已移除投资偏好，之后分析不会继续引用。原始对话仍保留。';return answer
        if not wants_analysis and not budget and re.search(r'花了多少|收支|账单|账本|本月.*(花|收入)|还有多少钱|生活余量|预算',text) and not amounts(text):
            s=summary(state)
            if not s['totals']:answer['text']='还没有可汇总的收支。直接告诉我一笔已经发生的收入或支出就可以开始。'
            else:
                answer['text']='按本月已记录的项目：\n'+'\n'.join(f'{c}：收入 {money(t["income"],c)}，生活与订阅 {money(t["expense"],c)}，待执行流出计划 {money(t["planned"],c)}。' for c,t in s['totals'].items())+'\n这是已记录收支，不是总资产或账户余额。'
                self.add_budget_question(state,thread,answer,ask='预算' in text or '余量' in text)
            if not s['totals'] and ('预算' in text or '余量' in text):self.add_budget_question(state,thread,answer)
            answer['actions']=[{'kind':'panel','label':'展开账本','panel':'ledger'}];return answer
        if re.search(r'记住了什么|记忆|忘掉|忘记',text):
            answer['text']='重要的投资计划和大额事项会整理到记忆里。你可以查看来源，或点“忘记”停止使用这条摘要，原始账本仍保留。'
            answer['actions']=[{'kind':'panel','label':'查看记忆','panel':'memory'}];return answer
        if not wants_analysis and re.search(r'持仓|组合',text) and not re.search(r'买入|卖出|花了|买了|投了|\d',text):
            answer['text']='目前没有经过对账的真实持仓。告诉我你持有哪些标的、份额或市值，我会先整理为待核对资料；有了依据再分析。'
            answer['actions']=[{'kind':'panel','label':'查看投资记录','panel':'investment'}];return answer
        # Contextual salary ratios can use a unique already recorded salary this month.
        # Exclude questions and budget-only clauses from cash flow extraction.
        pieces=re.split(r'[，；;。！？!?\n]+',text)
        facts='；'.join(p for p in pieces if not _budget_input(p) and not re.search(r'分析|评估|该不该|能不能|适不适合|怎么投|如何投|会不会|多少钱|花了多少',p))
        parsed=extract(facts or '继续整理')
        rows=parsed['records']
        for row in rows:
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
        answer['record_ids']=[r['id'] for r in rows]
        if rows:
            actual=sum(r['status']=='recorded' for r in rows);plans=sum(r['status']=='plan' for r in rows);review=sum(r['status']=='review' for r in rows)
            lead=answer['text']+'\n' if answer['text'] else ''
            result='，'.join(s for s in [f'记下了 {actual} 笔已发生收支' if actual else '',f'{plans} 项投资或消费计划单独放好' if plans else '',f'{review} 项需要核对，暂不计入金额' if review else ''] if s)
            answer['text']=lead+(parsed['empathetic']+'\n' if re.search(r'烦|累|难受',text) else '')+result+('。' if result else '')
            if any(r['kind']=='coupon' for r in rows):answer['text']+='\n优惠需求已整理好；目前尚未连接优惠平台，不能确认有券或已领券。'
            answer['actions']=[{'kind':'panel','label':'查看整理结果','panel':'ledger'}]
            review_rows=[r for r in rows if r['status']=='review' and r['amount_cents'] is None and r['kind']!='investment']
            if review_rows:
                thread['pending']={'kind':'edit','id':review_rows[0]['id']}
                answer['text']+=f'\n先补一件事：“{review_rows[0]["title"]}”实际花了多少？直接回复“实付 28 元”即可。'
            elif not wants_analysis and not (thread.get('pending') and thread['pending']['kind']=='edit') and (plans or budget or any(r['attention']=='high' and r['status'] in ('recorded','plan') for r in rows) or (actual and not summary(state)['missing'])):
                self.add_budget_question(state,thread,answer)
            if any(r['kind']=='investment' or r['attention']=='high' for r in rows) and not wants_analysis:
                answer['actions'].append({'kind':'ask','label':'看看资金安排','text':'结合已记录的信息，帮我分析生活与投资安排'})
        elif budget:
            self.add_budget_question(state,thread,answer)
            answer['actions']=[{'kind':'panel','label':'查看生活余量','panel':'overview'}]
        elif profile:
            answer['text']='已记下你补充的偏好。需要时可以直接说“结合这些信息帮我分析”。'
        else:answer['text']=parsed['empathetic']+'\n你可以直接说今天的一笔开销、投资打算，或让我看看本月的收支。'
        if parsed['unclassified'] and not (budget and re.fullmatch(r'\s*\d+(?:\.\d+)?\s*(?:元|块|人民币)?\s*[。.]?',text)):
            answer['text']+='\n有一部分金额或事项还没有识别清楚，可以再单独说一句，我会继续整理。'
        if wants_analysis:
            if not rows and not budget:answer['text']=''
            self.analyze(state,answer,text)
        return answer

    def analyze(self,state,answer,text):
        # Only summaries and the explicit question are sent; forgotten memories
        # remain in accounting totals but are not quoted as remembered preferences.
        context={'records':[{'title':r['title'],'amount_cents':r['amount_cents'],'currency':r['currency'],'status':r['status'],'date':r['occurred_on']} for r in state['records'][-30:] if r.get('remember',True)],'budget':summary(state),'preferences':state['profile']}
        question='用户的问题：'+text+'\n以下为用户自述资料，尚未对账，不是实时账户或行情：'+json.dumps(context,ensure_ascii=False)+'\n用自然中文简短回答，只分析和追问缺失信息，不执行交易，不把投资计划当成持仓。不要编造市场行情和收益。'
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

    def export(self,session):
        state=self.store.load(session);out=io.StringIO();writer=csv.writer(out)
        writer.writerow(['发生日期','事项','分类','金额','币种','状态','来源'])
        for r in sorted(state['records'],key=lambda x:x['occurred_on'],reverse=True):
            cells=[r['occurred_on'],r['title'],LABELS.get(r['kind'],'其他'),'' if r['amount_cents'] is None else f'{r["amount_cents"]/100:.2f}',r['currency'],STATUS[r['status']],'用户自述，未对账']
            writer.writerow(["'"+str(v) if re.match(r'^\s*[=+@-]',str(v)) else v for v in cells])
        return ('\ufeff'+out.getvalue()).encode('utf-8')
