# Finance Lab · 生活与投资

一句长话就能开始的财务工作空间。主入口是对话；生活账本、投资计划、预算与重点记忆按需展开。缺失信息通过对话补充。

这是改造仓库 `jinyihan77-create/finance-lab-demo` 的 `codex/conversation-backend` 分支。本地工作目录为 `D:\finance-lab-conversation`，与同仓库其他改动隔离。

## 运行

需要 Python 3.10 或更新版本；后端只使用标准库。

```powershell
python serve.py --port 8877 --open
```

打开 <http://127.0.0.1:8877/>。也可以双击 `启动演示.bat`。请通过服务打开，不要双击 HTML：新入口需要会话与账本接口，单独发布到静态 GitHub Pages 不会提供后端。

试着输入：

> 今天工资到账12000元，打算拿工资的30%投纳斯达克。订阅GPT Pro花了200美元，中午吃饭实付18元。帮我找美团猪脚饭优惠券。今天真烦，天气也不好。

继续回复月初现金、剩余必要开支和应急金，或说“午饭其实实付28元”。整理结果可以修改、删除或导出 CSV，用 Excel 打开。

## 已实现与边界

- **对话入口**：新建与恢复会话、混合长句归档、逐项追问、自然语言纠错、断网保留草稿、请求去重。
- **财务记录**：收入、生活、订阅、投资计划、待查优惠；整数分记账，人民币和美元分开统计。计划不算成交，不自动更新真实持仓。修改工资会重算关联比例计划，删除工资会使关联计划等待核对。
- **生活余量**：根据用户自述的月初现金、已记流水、计划和必要预留计算；不足时提示缺口，不捏造总资产或投资收益。
- **重点记忆**：投资事项及大额记录按日期整理，可忘记摘要。原始聊天仍保留；账本删除与摘要遗忘分别处理。
- **模型分析**：连接团队 Core Agent 的 `/api/review`，返回真实模型结果与状态。实测有成功响应，也出现过一次不可用；失败会明确提示，保留已保存记录。当前模型复核偏保守，不能等同于完整投资顾问或联合风控验收。
- **来源透明**：财务归档仍使用规则解析器，尚未用大模型完整理解任意口语。没有银行、券商、优惠搜索、自动扣款、交易执行或定时行情更新。无跨设备同步和正式账户认证。

会话保存在 `data/assistant.sqlite`，默认只允许本机访问，浏览器使用 HttpOnly 会话标识。分析请求会将当前问题和必要财务摘要发给团队模型；日常记账不调用外部服务。数据库、环境配置和运行产物已排除在版本管理之外。清除浏览器 Cookie 会失去当前会话入口；本版本尚未提供账户找回。

## 陆小果最新页面

2026-10-20 核验时，原改造仓库 `main` 仍为 10 月 12 日的 `6ed9ee5`。最新页面在另一仓库：

- 来源：<https://github.com/lixjanus526-art/finance-lab-ui-preview/tree/57e0a6bccd890b00c8599d8bd64b62569fe3d196>
- 分支：`preview`，提交：`57e0a6bccd890b00c8599d8bd64b62569fe3d196`
- 完整来源快照：`upstream-preview/`（80 个文件）；逐文件哈希：`docs/upstream-preview-source.json`
- 原版入口：`/upstream-preview/investment-only/investment.html`
- 旧改造任务台：`/workspace-legacy.html`

新对话主入口采用现有深色、暖橙设计基线，把已做好的本地随手记能力接到后端会话服务，并接入团队 Core Agent。原版 Qwen 页面作为完整来源保留，其独立授权服务未复制进新入口。

## 验证

```powershell
python -m unittest discover -s tests -v
python serve.py --port 8878 --assistant-db artifacts/e2e.sqlite
# 另一终端：需可用的 Playwright 与 Chrome
node tests/browser_conversation.cjs
# 单独验证真实服务可用性；会发起一次模型请求
node tests/browser_conversation.cjs --live
```

浏览器脚本使用独立 Cookie 和测试数据库。`BROWSER_EXECUTABLE` 可指定浏览器，`TEST_URL` 可指定测试服务地址。详情见 [设计与改造说明](docs/对话工作空间改造说明-2026-10-20.md) 和 [验收记录](docs/对话工作空间验收-2026-10-20.md)。
