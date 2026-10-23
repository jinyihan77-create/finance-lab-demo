# 用户投资偏好真实验收 · 2026-10-19 第二轮

## 明确结论

**指定大学生场景的网页 → 本机候选后端 → 百炼 Qwen3.8 调用成功。公网网页 → Cloudflare → 百炼尚未通过，仍被 Owner 登录、Access 和部署配置阻塞。**

本轮按用户“进行一次受控低成本真实 API 调用”的明确要求，只发送一次请求，没有重用上一轮已耗尽的两次授权，没有自动重试。此前两次另有独立记录；截至本轮结束，本对话累计真实调用为三次，本轮为一次。

测试输入原文：

> 我是一名中国大学生，目前有10000元闲置资金，风险承受能力中低，希望制定未来三年的投资计划，请分析我的投资偏好、资金配置思路和风险。

| 证据项 | 实测 |
| --- | --- |
| 时间 | 北京时间 2026-10-19 14:13 |
| 浏览器 API | `POST /api/review`，HTTP 200 |
| 供应商 API | 北京专属域名 `/compatible-mode/v1/chat/completions`，HTTP 200 |
| 请求及返回模型 | `qwen3.8-flash` |
| 完整网页往返 | 8814ms |
| 上游请求耗时 | 8568ms |
| Token | 输入 727、输出 421、合计 1148 |
| 供应商响应 ID | `chatcmpl-2e84e992-3e31-98e5-8741-f8a78fe93cc6` |
| 结束原因 | `stop`，不是因输出限额截断 |
| 本机运行 ID | `review-d1589be9-2304-4224-9903-9ce663e36584` |
| 本机审计 ID | `audit-9d581df8-c5c4-4adf-bf7a-60f3f816e1ca` |
| 网页一致性 | 摘要、完整分析、模型原文均与供应商内容一致 |
| 五方面内容 | 偏好总结、资金配置、期限/流动性、研究资产类别、主要风险全部返回 |
| 费用保护 | 应用预留 0.01 元、输出上限 1600、最多一次尝试、无自动重试 |

根据本轮查到的 Flash 北京输入 0.8 元/百万、输出 2.7 元/百万标价，估算本次 0.0017183 元；不是实际账单或供应商硬封顶。完整真实返回及截图见 `evidence/live-student.json`、`evidence/live-student-panel.png`。没有将固定文本或 Mock 返回用于这次验收。

## 本轮修复的真实功能缺口

1. 保留原页面布局、配色及其他演示模块，仅在听澜面板增加投资金额、风险偏好、投资目标和资料来源；按钮改为“开始 AI 分析”。回撤为可选值，不将“中低风险”擅自换算成某个回撤百分比。
2. 金额、目标和风险偏好转成现有 `text` 内容；期限、流动性及用户明确填写的回撤仍使用已有 `context.risk_profile`。没有新增公共必填 API 字段，没有改写共享 Schema。
3. 用户自述使用已有 `LIVE` / `synthetic=false`，示例使用 `SYNTHETIC_REPLAY` / `true`；两种来源均可以请求真实模型。**输入是真实或虚构，与推理是否真实是两个维度。** 本次指定测试场景按示例标记，没有冒充已核验的个人账户。
4. 服务端要求 summary 返回偏好总结，action_reason 返回其他四个具名段落；缺少收入、负债、备用金等信息必须明说，不能编造配置比例、收益率或实时行情。返回枚举与六字段契约不变。
5. 服务端及网页拒绝缺少分析段落的结果；网页另校验 `source=model`、`call_succeeded=true`、精确模型 ID、执行关闭和原文一致性。使用 textContent 显示完整分析，支持展开原始 JSON，失败时隐藏旧结果并显示错误，不做模拟回退。
6. 预留显式切换 `qwen3.8-max`：仅服务端 MODEL_NAME 可选，浏览器不提供任意模型选择，无自动模型切换。隔离候选对 Max 使用每次 0.50 元保守预留，Flash 保持 0.01 元，仍由原持久化预算核算。Max 仅做 Mock 验证，**没有真实付费调用或宣称验收通过**。
7. 隔离候选准备改用 Git 批量读取文件，保持指定基线、路径检查和不复制环境文件，避免 Windows 每个文件启动一次 Git 的开销。

## 模型、地址与配置核对

实际 Base URL：`https://ws-h55unwqubcoxw7tb.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。

协议：HTTPS / OpenAI-compatible Chat Completions，`POST /chat/completions`、非流式、`json_object`、`enable_thinking=false`。真实供应商返回证明本机 Key、该 Workspace 和 Flash 在本次请求时匹配。没有猜测或替换 Workspace 地址。

复用变量：本机已有 `MODEL_API_KEY`、`MODEL_API_URL`、`MODEL_NAME`，只在服务端验收进程映射到既有团队适配器的 `DASHSCOPE_API_KEY`、`BAILIAN_WORKSPACE_ID`。没有新增模型 Key 别名，也没有把 Key 写入源码、浏览器、截图、日志或 Git。独立的 CORE_AGENT_API_KEY 仍只在服务器内部使用。

真实测试仍使用 Node 加载候选 Worker、测试注入身份和内存 storage，并不是实际 Cloudflare Access 登录或云端 SQLite。后端/Contract Owner 的待审事项写入 `docs/contract-proposals/2026-10-19-user-preference-qwen38.md`，所有补丁只在 team-staging 候选及临时副本中，不能跳过审核合并或发布。

## 构建及免费测试

- 既有 Core：语法检查、249/249 回归通过。
- 候选：15/15 通过，新增金额/目标输入、真实来源标记、未填回撤、显式 Max 预算、禁止非 3.8 浏览器模式和缺失分析段落拒绝测试。原 Access 签名、输入限制、来源、限流、超时、配额和错误处理保留。
- 浏览器：1440/1024/375px 正常 Mock、加载状态、七类失败、三方案保留通过；这些为受控验证，不是本轮真实调用证据。
- Wrangler 4.151.1：dry-run 通过，34 个资产，初次构建 303.03 KiB / gzip 66.75 KiB；没有部署。之后把提示中的固定“三年目标”改为输入期限与目标，并完成候选测试及最终编译；真实请求证据保留调用时的原始结果，不为文字修正追加付费请求。
- 新旧环境变量冲突检查、源码/资产一致性、Git diff 检查和真实 Key 缺席扫描通过。完整 TypeScript 类型检查在该 JS 仓库没有独立任务，未声称通过。

## 云端现状与中国大陆网络边界

本轮重新核验：现有云端 `/health` HTTP 200，但 provider 仍为 `cloudflare_workers_ai`、模型 Llama；`/api/tinglan/status`、`/investment-only/tinglan-config.json` 均 404。Cloudflare Worker 作为旧后端确实存在并可响应，经验证它**尚未运行这次的百炼候选**。没有向它发送可能触发其他模型的推理请求。

个人公开预览实际由 GitHub Pages 发布（preview 分支），不是本 Worker 自动附带的 Pages Functions。静态前端的 `tinglan-config.json` 保持 endpoint=null；只有 Owner 发布同源 Worker + ASSETS 并配置 Access 后，才可用受保护域名打开页面、使用相对 `/api/review`。不将公开预览指向 localhost、测试身份服务或仍使用 Llama 的旧接口。

默认 Node 直连 Worker 连接超时；使用已有环境代理后健康检查成功。代理出口地理位置、当地运营商和无代理路径未验证，因此**中国大陆实际电信/联通/移动可用性尚未通过**。原始结果见 `student-cloud-check.json`、`student-direct-network.json`。不能凭本机系统时区、百炼北京地域或代理成功推断大陆验收。

## 当前必须由 Owner 完成的操作

Wrangler 本轮明确返回 `You are not authenticated`，未发现可用 CLOUDFLARE_API_TOKEN，也没有已连接的 Cloudflare 管理会话。不能据此断言生产 Secret 缺失；准确状态是**无权限读取、尚未验证**。

| 项目 | 具体位置与填写内容 |
| --- | --- |
| 登录 | 在本机用目标团队账号完成 Wrangler login；若交由 Owner 操作，可按下列命令在隔离候选目录完成 |
| Worker | Cloudflare → Workers & Pages → `personal-ai-fund-manager-core-agent`，不是新建临时账号 Worker |
| 环境 | 当前候选为默认顶层 Worker 环境，配置文件没有 `[env.production]` 或 `[env.preview]`；不能把 Pages Preview 变量当作 Worker 变量。若 Owner 采用命名环境，须分别填写其 vars、Secrets、bindings，不能猜环境名称 |
| Secrets | 该 Worker → Settings → Variables and Secrets：加密 `DASHSCOPE_API_KEY`；保留既有独立 `CORE_AGENT_API_KEY`，不得覆盖或发给浏览器 |
| 非秘密模型配置 | `MODEL_PROVIDER=aliyun_bailian`、`MODEL_NAME=qwen3.8-flash`、`BAILIAN_REGION=cn-beijing`、`BAILIAN_WORKSPACE_ID=ws-h55unwqubcoxw7tb`；MODEL_API_URL 若设置须为 Base URL 加一次 `/chat/completions` |
| 调用保护 | `MODEL_API_STYLE=chat_completions`、`MODEL_RESPONSE_FORMAT=json_object`、`MODEL_TIMEOUT_MS=30000`、`MODEL_MAX_ATTEMPTS=1`、`BAILIAN_MAX_OUTPUT_TOKENS=1600`；回退禁用、保留原限流和每用户额度。先保持付费 false / 预算 0，后续真实云端验收需要新的单次授权 |
| Access | Zero Trust → Access → Applications：提供批准的受控域名、issuer、应用 AUD、团队邮箱名单；填写 ACCESS_ISSUER / ACCESS_AUD / ACCESS_ALLOWED_EMAILS。无 Everyone 或 Bypass；保留旧机器调用 Service Auth |
| 域名与部署 | Worker → Settings → Domains & Routes：同源受控域名、workers.dev 旁路关闭；审核候选入口 worker-entry.mjs、ASSETS、ReviewService 及原迁移历史后部署；不得清空 Durable Object |
| 后续验收 | 未登录拒绝、合法 Access 登录、Secrets/预算拒绝、持久化审计及回退验证；另获费用授权后进行一次云端全链路，并在中国大陆真实运营商网络记录 HTTP、耗时、模型、Token 和错误率 |

以下命令用途：登录既有团队 Cloudflare 账号、只读确认身份；第二条不会发布，也不要使用 temporary 模式创建无关 Worker。当前机器的已验证工具入口为：

```powershell
node C:/Users/Y7000P/AppData/Local/Temp/finance-ai-build-20261019/node_modules/.pnpm/wrangler@4.151.1/node_modules/wrangler/bin/wrangler.js login
node C:/Users/Y7000P/AppData/Local/Temp/finance-ai-build-20261019/node_modules/.pnpm/wrangler@4.151.1/node_modules/wrangler/bin/wrangler.js whoami
```

不要把 Key 发到聊天。Owner 登录并提供批准的域名/Access 非秘密配置、确认候选后，才能继续真正部署和生产验收；不把源码准备或本机成功标为上线。

## 仓库交付

团队分支 `codex/tinglan-secure-ai-20261018`，草稿 [PR #23](https://github.com/Fintechathon-agent/Fintechathon-agent/pull/23)，不合并。个人仓库 `lixjanus526-art/finance-lab-ui-preview` 的 preview 分支同步本轮面板、客户端及脱敏证据；其他页面保留。提交及远端核验在最终回复提供。

[个人网页预览](https://lixjanus526-art.github.io/finance-lab-ui-preview/investment-only/investment.html#ai-assistant)可查看新增输入，但尚未配置生产推理入口。[当前旧后端健康检查](https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev/health)仅证明旧服务存在，不证明百炼上线。

官方依据：[Flash 模型与价格](https://help.aliyun.com/zh/model-studio/qwen3-8-flash)、[Max 模型与价格](https://help.aliyun.com/zh/model-studio/qwen3-8-max)、[Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)、[环境隔离](https://developers.cloudflare.com/workers/wrangler/environments/)。
