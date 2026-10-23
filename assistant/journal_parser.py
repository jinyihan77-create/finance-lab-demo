"""Stateless, conservative extraction for the local life/finance journal.

No model, account, approval, trade, or shared memory is accessed here. Values
are user reports, never bank receipts. Uncertain clauses remain review items.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

SHANGHAI = timezone(timedelta(hours=8), "Asia/Shanghai")
NUMBER = r"(?:\d+(?:,\d{3})*(?:\.\d+)?[万千]?|[零一二两三四五六七八九十百千万]+)"
MONEY = re.compile(rf"(?P<prefix>[$￥¥])?\s*(?P<num>{NUMBER})\s*(?P<unit>美元|美金|人民币|元|块钱|块|USD|CNY)?", re.I)
KINDS = {"income": "收入", "expense": "生活", "subscription": "订阅", "investment": "投资", "coupon": "优惠", "note": "待整理"}


def number(value: str) -> Decimal:
    value = value.replace(",", "")
    if re.match(r"\d", value):
        scale = 10000 if value.endswith("万") else 1000 if value.endswith("千") else 1
        return Decimal(value.rstrip("万千")) * scale
    digits = dict(zip("零一二两三四五六七八九", [0, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9]))
    total = section = current = 0
    for char in value:
        if char in digits:
            current = digits[char]
        elif char == "万":
            total += (section + current) * 10000
            section = current = 0
        else:
            section += (current or 1) * {"十": 10, "百": 100, "千": 1000}[char]
            current = 0
    return Decimal(total + section + current)


def amounts(clause: str) -> list[tuple[int, str]]:
    # Dates, percentages, units of shares and coupon face values aren't payments.
    clean = re.sub(r"\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}月\d{1,2}日|\d{1,2}:\d{2}", "", clause)
    clean = re.sub(rf"{NUMBER}\s*[%％]|百分之{NUMBER}", "", clean)
    actual = re.search(r"(?:实付|实际支付|实际花了|到手)(.+)", clean)
    if actual:
        clean = actual.group(1)
    found = []
    for match in MONEY.finditer(clean):
        tail = clean[match.end():]
        before = clean[max(0, match.start()-6):match.start()]
        if re.match(r"\s*(?:股|份|个月|月|年|天|日|笔|次|折|%|％)", tail):
            continue
        explicit = match["unit"] or match["prefix"]
        # Bare values need an immediate money verb (not 一下、一点、一顿).
        if not explicit and not re.search(r"(?:工资|薪水|收入|到账|花了|花费|用了|支付|买入|卖出|买了|扣了|扣款|赚了|退款|退了)(?:是|了|我|共|总共|多少)?\s*$", before):
            continue
        if not explicit and not re.match(r"\d", match["num"]):
            continue
        try:
            value = number(match["num"])
            if value < 0 or value > 1000000000:
                continue
            cents = int((value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        except (InvalidOperation, KeyError):
            continue
        currency = "USD" if match["prefix"] == "$" or (match["unit"] or "").upper() in ("USD", "美元", "美金") else "CNY"
        found.append((cents, currency))
    return found


def event_date(clause: str, now: datetime, inherited: str) -> tuple[str, bool]:
    today = now.date()
    full = re.search(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", clause)
    md = re.search(r"(\d{1,2})月(\d{1,2})日?", clause)
    try:
        if full:
            return datetime(*map(int, full.groups())).date().isoformat(), True
        if md:
            return datetime(today.year, *map(int, md.groups())).date().isoformat(), True
    except ValueError:
        return inherited, False
    for word, delta in (("大前天", -3), ("前天", -2), ("昨天", -1), ("今天", 0), ("明天", 1), ("后天", 2)):
        if word in clause:
            return (today + timedelta(days=delta)).isoformat(), True
    if re.search(r"上[个月周年]|下[个月周年]|以前|前几天|最近|每月|每个月", clause):
        return inherited, False
    return inherited, True


def split_clauses(text):
    # Preserve decimals and comma thousands separators when splitting prose.
    separated = re.sub(r"(?<=\d),(?=\d{3}(?:\D|$))", "", text)
    separated = re.sub(r"(?:然后|另外|而且|同时|以及)", "；", separated)
    # A new subject after a complete monetary unit is a new event, even in dictation.
    separated = re.sub(r'(美元|美金|人民币|块钱|元|块)(\s*)(?=(?:今天|中午|晚上)?(?:工资|午饭|晚饭|打车|房租|订阅|买衣服|计划|打算))',r'\1；',separated)
    return [c.strip() for c in re.split(r"[，,；;。！？!?\n]+", separated) if c.strip()]


def extract(text: str, now: datetime | None = None) -> dict:
    if not isinstance(text, str) or not text.strip() or len(text) > 6000:
        raise ValueError("请输入 1–6000 字的内容。")
    now = (now or datetime.now(SHANGHAI)).astimezone(SHANGHAI)
    text = text.strip()
    clauses = split_clauses(text)
    records, unclassified = [], []
    date = now.date().isoformat()
    unsafe = bool(re.search(r"忽略.{0,8}(规则|指令)|绕过.{0,8}(确认|风控)|无需确认|自动执行|system\s*:", text, re.I))
    hypothetical = bool(re.search(r"^(?:假设|举个例子|例如|比如说|比如)", text))
    for clause in clauses:
        date, date_known = event_date(clause, now, date)
        kind, title, category = "note", "待补充事项", "其他"
        if re.search(r"优惠券|找券|搜券|领券", clause) and re.search(r"找|搜索|搜一下|推荐|领券|有没有", clause):
            kind = "coupon"
            category = "餐饮" if re.search(r"饭|餐|外卖|吃", clause) else "购物" if re.search(r"衣服|衣|购物|鞋", clause) else "待补充"
            platform = next((p for p in ("美团", "饿了么", "淘宝", "京东", "抖音", "拼多多") if p in clause), "待选择平台")
            title = ("猪脚饭" if "猪脚饭" in clause else category) + "优惠 · " + platform
        elif re.search(r"纳斯达克|标普|基金|股票|持仓|定投|买入|卖出|投资", clause):
            kind, category = "investment", "投资"
            asset = next((p for p in ("纳斯达克", "标普500", "标普", "基金", "股票") if p in clause), "投资")
            title = asset + ("卖出记录" if re.search(r"卖出|赎回", clause) else "投资记录")
        elif re.search(r"订阅|会员|续费|GPT|Netflix|Spotify", clause, re.I):
            kind, category = "subscription", "订阅"
            title = "GPT Pro 订阅" if re.search(r"GPT.*PRO", clause, re.I) else "GPT 订阅" if re.search(r"GPT", clause, re.I) else "会员订阅"
        elif re.search(r"工资|薪水|发薪|收入|奖金|报销|退款|退了", clause):
            kind, category = "income", "工资" if re.search(r"工资|薪水|发薪", clause) else "其他收入"
            title = "工资到账" if category == "工资" else "收入记录"
        elif re.search(r"花了|花费|实付|支付|用了|买了|扣了|扣款|吃饭|午饭|晚饭|约会|打车|房租", clause):
            kind = "expense"
            category = "餐饮" if re.search(r"饭|餐|吃", clause) else "购物" if re.search(r"衣服|衣|买了|鞋", clause) else "交通" if re.search(r"打车|地铁|公交", clause) else "住房" if "房租" in clause else "生活"
            title = category + "支出"
        else:
            # No personal relationship details, names or emotional text persisted.
            if re.search(r"\d|钱|买|消费|余额|资产", clause):
                unclassified.append("有一段信息尚未识别，请拆成一件事并补充金额、日期或币种。")
            continue
        values = amounts(clause)
        ratio = re.search(r"(\d+(?:\.\d+)?)\s*[%％]|百分之([零一二两三四五六七八九十百]+)", clause)
        percent = float(Decimal(ratio[1]) if ratio and ratio[1] else number(ratio[2])) if ratio else None
        status, reasons = "recorded", []
        cents, currency = values[0] if len(values) == 1 else (None, "CNY")
        if kind == "coupon":
            status, cents = "request", None
            reasons.append("需补充所在城市、平台与适用条件；尚未查询或领取优惠券。")
        else:
            planned = bool(re.search(r"打算|准备|计划|想|将|会把|会拿|要买|要投|帮我|我要|定投(?!了)|每月", clause))
            negated = bool(re.search(r"没买|没有|还没|未成交|没花|没付|不买|没到账|取消|不要|不会", clause))
            uncertain = bool(re.search(r"可能|大概|差不多|不到|超过|至少|最多|如果|假设|比如|例如|朋友|同事|他说|她说|听说|[-−]\s*\d", clause))
            if not re.search(r"实付|实际支付|实际花了", clause) and re.search(r"原价|满\d|减\d|优惠券|抵扣", clause):
                uncertain = True
            if kind == "investment" and percent is not None:
                planned = True
            if len(values) != 1:
                reasons.append("请补充实际金额和币种。" if not values else "出现多个金额，请核对实际支付金额；可写“实付 18 元”。")
            if planned:
                status = "plan"
                title = title.replace("记录", "计划").replace("到账", "计划")
            if negated or uncertain or hypothetical or unsafe:
                status = "review"
                reasons.append("含否定、假设、转述或不确定表达，请核对是否本人已发生的收支。")
            if not date_known:
                reasons.append("日期不明确，请修改为具体发生日期。")
                status = "review"
            if re.search(r"欧元|港币|港元|日元|英镑|澳元|加元|EUR|HKD|JPY|GBP", clause, re.I):
                cents, currency, status = None, "CNY", "review"
                reasons.append("暂不支持该币种，请核对实际人民币或美元结算金额后再记录。")
            if kind == "investment" and not planned and not re.search(r"买了|买入|卖出|赎回|投了|定投了|投入|花了", clause):
                status = "review"
                reasons.append("持仓余额不是本次资金流动，请核对是否发生买入或卖出。")
            if kind == "income" and not planned and not re.search(r"到账|发了.*工资|发工资|工资发了|收到|收到了|退了|退款了|报销了|收入了|今天收入", clause):
                status = "review"
                reasons.append("收入标准不等于已经到账，请核对是否是本次实际收入。")
            if kind == "subscription" and not planned and not re.search(r"花了|花费|用了|实付|支付|扣款|扣了|订阅了|开通了|续费了|充值了", clause):
                status = "review"
                reasons.append("会员标价不等于已经支付，请核对是否实际扣款。")
            if date > now.date().isoformat() and status == "recorded":
                status = "plan"
            if reasons and status == "recorded":
                status = "review"
            if kind == "investment":
                reasons.append("仅保存自述投资流水或计划；未对账，未更新真实持仓，未发起交易。")
        records.append({"id": uuid.uuid4().hex, "kind": kind, "category": category,
                        "title": title, "amount_cents": cents, "currency": currency,
                        "status": status, "occurred_on": date, "recorded_at": now.isoformat(),
                        "source": "user_report", "confidence": "needs_review" if status == "review" else "explicit_rule",
                        "ratio": percent if kind == "investment" else None,
                        "ratio_base": "salary" if kind == "investment" and "工资" in clause else None,
                        "direction": "in" if kind == "income" or (kind == "investment" and re.search(r"卖出|赎回", clause)) else "out",
                        "notes": reasons})
        if kind=='expense':
            meal=next((label for label in ('早餐','午饭','晚饭') if re.search({'早餐':r'早餐|早饭','午饭':r'午饭|午餐|中午','晚饭':r'晚饭|晚餐|晚上'}[label],clause)),None)
            if meal:records[-1]['meal']=meal
        if kind!='coupon' and not (negated or uncertain or hypothetical or unsafe) and date_known and not re.search(r'欧元|港币|港元|日元|英镑|澳元|加元|EUR|HKD|JPY|GBP',clause,re.I):
            if planned:records[-1]['followup_status']='plan'
            elif re.search(r'到账|实付|实际支付|花了|花费|支付了|订阅了|开通了|买入了|卖出了',clause):records[-1]['followup_status']='recorded'
    salaries = [r for r in records if r["category"] == "工资" and r["status"] == "recorded" and r["amount_cents"] is not None]
    for row in records:
        if row["ratio"] is not None:
            if not 0 < row["ratio"] <= 100:
                row["status"] = "review"
                row["notes"].append("比例应大于 0 且不超过 100%，请核对。")
            eligible = [s for s in salaries if s["occurred_on"][:7] == row["occurred_on"][:7]]
            if row["ratio_base"] == "salary" and len(eligible) == 1 and 0 < row["ratio"] <= 100 and row["status"] == "plan":
                if row["amount_cents"] is None:
                    row["amount_cents"] = int((Decimal(eligible[0]["amount_cents"]) * Decimal(str(row["ratio"])) / 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
                    row["currency"] = eligible[0]["currency"]
                    row["notes"] = [n for n in row["notes"] if not n.startswith("请补充实际金额")]
                    row["notes"].append(f"按本段已记录工资的 {row['ratio']:g}% 计算；这是计划金额。")
            elif row["amount_cents"] is None:
                row["notes"].append("百分比基数尚未明确，请补充工资或计划金额。")
                row["status"] = "review"
        if row["status"] == "plan" and row["amount_cents"] is None:
            row["status"] = "review"
        row["attention"] = "high" if row["kind"] == "investment" or (row["amount_cents"] or 0) >= (100000 if row["currency"] == "CNY" else 20000) else "normal"
    return {"version": "journal.v1", "engine": "local_rules", "as_of": now.isoformat(),
            "records": records, "unclassified": list(dict.fromkeys(unclassified)),
            "empathetic": "听起来今天挺累的，先把能确定的账理清，其他事可以慢慢来。" if re.search(r"烦|累|难受|天气.*不好|不开心", text) else "我把这段话里能确定的事情整理好了。",
            "blocked_execution": unsafe,
            "disclaimer": "规则识别试用版；仅为自述记录，不是账户余额或成交回执。"}
