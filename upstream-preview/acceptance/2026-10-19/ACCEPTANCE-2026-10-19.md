# 百炼真实调用验收 · 2026-10-19

后续第二轮见 [用户投资偏好真实验收](PREFERENCE-ACCEPTANCE-2026-10-19.md)：按新请求新增一次指定场景真实调用及输入功能，不能将本文“两次已用完”解释为第二轮没有新的单次授权。本文保留当轮事实。

## A. 结论

**本机真实调用成功；Cloudflare 公网完整链路：权限或配置待验证，尚未通过。**

北京时间 2026-10-19 13:30，用户在本轮明确授权最多两次短输入调用、合计应用预算 0.02 元、无自动重试。本轮恰好发出两次真实百炼请求，均 HTTP 200，未再发送任何公网推理或第三次付费请求。网页展示的分析与供应商返回一致，未执行交易。

本机完整测试使用 Node 加载隔离候选 Worker 模块、注入本机测试身份和内存 storage 接口。**没有通过真实 Cloudflare Access 登录，没有使用云端 SQLite Durable Object，也没有部署 Worker。** 单独的 workerd 本地启动检查不加载密钥、不调用模型。两类证据不可合并解释成“云端已经验收”。

## B. 当前配置与模型身份

| 环境 | Provider / model | 路由及状态 |
| --- | --- | --- |
| 本机既存环境文件 | `MODEL_PROVIDER=http` / `MODEL_NAME=qwen3.8-flash` | 密钥已存在；与进程同名变量无冲突；本轮未改写文件 |
| 本轮隔离候选运行 | `aliyun_bailian` / `qwen3.8-flash` | 浏览器 `POST /api/review` → Access wrapper（本机测试注入身份）→ 既有 Core / ReviewService → 百炼 |
| 当前云端公开 `/health` | `cloudflare_workers_ai` / `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | HTTP 200；`/api/tinglan/status` HTTP 404；仍未部署本候选 |
| 个人 GitHub Pages | `OWNER_CONFIGURATION_REQUIRED` / `qwen3.8-flash` | `tinglan-config.json` 的 `endpoint=null`；网页 HTTP 200 不代表 AI 上线 |
| 仓库根及 chenchen Wrangler 默认配置 | `workers_ai` / Llama | 不能用默认配置发布本轮百炼候选 |
| 候选 wrangler.example.toml | `aliyun_bailian` / `qwen3.8-flash` | Workspace、Access 字段留空，付费 false / 预算 0；仅参考模板 |

实际验证 Base URL（无密钥、无秘密参数）：

`https://ws-h55unwqubcoxw7tb.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`

实际供应商请求：`POST` 上述地址追加一次 `/chat/completions`，HTTPS Bearer 服务端鉴权，OpenAI-compatible Chat Completions、非流式、`json_object`、`enable_thinking=false`。本机直连输出上限 32，完整链路输出上限 800；候选单次超时 30000ms，浏览器 35000ms，最多一次模型尝试。

模型 ID **确认为 `qwen3.8-flash`**：既存本机非敏感配置、候选配置、两次供应商实际返回均相符；官方文档也将其列为模型调用 ID。没有把“千问 3.8”猜成 `Qwen3-8B`，没有配置或验证独立专属模型部署 ID。若 Owner 的目标是自行部署 Qwen3-8B，需要另行提供控制台中的真实部署 ID 并走 Contract 审核。

本次成功证明当前本机 Key 在该 Workspace endpoint 下可调用 `qwen3.8-flash`；不证明该 Key 对其他模型有权限，也不证明云端 Secrets 为同一个 Key。Key 的管理归属、访问范围、到期及云端绑定仍需 Owner 控制台核对。

映射关系：

- 本机 `MODEL_API_KEY` 在**服务端进程内**映射为候选 `DASHSCOPE_API_KEY`；不存在自动读取本机文件的 Cloudflare 行为。
- `BAILIAN_WORKSPACE_ID=ws-h55unwqubcoxw7tb`；适配器根据它生成北京完整 endpoint。若填写 `MODEL_API_URL`，必须与该完整地址完全相同。
- `CORE_AGENT_API_KEY` 是独立的服务间密钥；本机验收随机生成临时值，仅在服务端使用，不是百炼 Key。
- 浏览器没有上述凭据。云端由 Access RS256 签名、issuer、audience、有效期和账号白名单鉴权后，服务端再注入 Core 凭据。

## C. 构建与测试实测

| 检查 | 结果与范围 |
| --- | --- |
| `node scripts/check.js`（候选 chenchen） | 通过，JavaScript 语法检查 |
| `node --test`（候选 chenchen） | 249/249 通过，供应商 Mock |
| `node --test …/tests/gateway.test.mjs` | 11/11 通过，输入、Access 签名、CORS、限额、模型身份、错误脱敏及禁用回退 |
| `node …/tests/browser.cjs` | 1440/1024/375px；正常模拟响应及鉴权、限额、超时、非法 JSON、网络故障、上游鉴权、未配置七类失败通过；保留三方案；真实付费 0 次 |
| Wrangler 4.151.1 `deploy --dry-run` | 通过，Worker 301.56 KiB / gzip 66.14 KiB、34 个资产；无部署 |
| Wrangler `types` | 环境绑定和 runtime 类型声明生成成功；仓库无独立 typecheck / tsconfig，**未声称全量 TypeScript 类型检查通过**；工具提示若引入 TS 检查需安装 @types/node |
| Wrangler `dev --local` | workerd 1.20261012.1 启动成功；网页/配置/health 200，缺配置 review/status 503，合法 OPTIONS 204，非法 Origin 403；未加载密钥，0 次模型调用 |
| 服务端短文本直连 | HTTP 200，633ms，模型 qwen3.8-flash，输入 36 / 输出 5 / 合计 41 tokens，返回 `{"ok":true}` |
| 网页 → 本机候选 → 百炼 | HTTP 200，完整网页往返 3065ms，上游 2837ms；模型 qwen3.8-flash，输入 539 / 输出 149 / 合计 688 tokens；网页与供应商分析一致 |

真实调用合计输入 575、输出 154、总计 729 tokens。按本次查到的北京官方标价估算约 0.0008758 元；**估算不是实际账单**。应用 0.02 元授权预算是保守试验预留，不是供应商账单硬封顶。两次授权次数已用完，云端真实验收须重新取得调用授权。

构建失败与修复记录：

1. 原安装命令 `node <bundled-pnpm>/bin/pnpm.cjs --dir <temp-build> add wrangler@4 --save-exact` 最终失败，`[23] The operation was aborted due to timeout`，目标是官方 `@cloudflare/workerd-windows-64` 的 `1.20261012.1` 压缩包。不是已确认的业务代码编译错误，也没有证据归因于包损坏。
2. 缺包时执行 `node <wrangler>/bin/wrangler.js deploy --config wrangler.example.toml --dry-run --outdir <temp-build-output>`，报 `The package "@cloudflare/workerd-windows-64" could not be found`；链接尚未完成时直接从顶层包路径运行还曾报 `MODULE_NOT_FOUND`。
3. 从官方 registry 获取同版本元数据并下载原压缩包，校验 SHA-512 完全一致后解压至临时依赖包对应的真实路径，保留原包代码。压缩包 34585961 字节，SHA-512 为 `c5hQvNx574UEoknaCFvMa/NdLrrYiALNbe6sx1okW8uOiRYWxrFuA8WpXFnBJ5XJypm0TEAHYaUTGv3rRLpY7Q==`。
4. 使用修复后的同一 Wrangler 4.151.1 再执行 dry-run、types 和本地 dev，均成功。没有把 pnpm 安装失败改写为安装通过；修复只发生于临时工具目录，不污染业务仓库。

无付费复验用途：在仓库根准备隔离候选，再在输出的 candidateRoot 内运行测试；需要先安装 Wrangler 4.151.1、Playwright 和可用 Chrome。源码测试后缀由 prepare 恢复。

```powershell
node team-staging/ui/tinglan-ai-20261018/prepare.cjs
# Change directory to the printed candidateRoot before the next commands.
node --test team-staging/ui/tinglan-ai-20261018/tests/gateway.test.mjs
node team-staging/ui/tinglan-ai-20261018/tests/browser.cjs
# In candidateRoot/chenchen:
node scripts/check.js
node --test
# In candidateRoot/team-staging/ui/tinglan-ai-20261018:
wrangler deploy --config wrangler.example.toml --dry-run
```

手工真实验收脚本 `tests/live-acceptance.cjs` 需要显式授权参数、本机服务端环境文件及候选目录，不进入普通回归。已有证据时拒绝重复执行；最多两次、限制输入输出、失败不自动重试、仅保存脱敏证据。**本轮不应重跑它**，后续每一轮真实付费调用均需要新的授权。

## D. 真模型与 Mock 的证据区别

- `evidence/live-local.json`：真实网络供应商请求，两个 `chatcmpl-*` 响应 ID、真实模型身份、真实 Token、真实供应商文本和网页一致性；`scope=LOCAL_REAL_PROVIDER`，`cloudflareDeployed=false`。截图为实际成功请求后的页面，未用 Mock 替换内容。
- `evidence/browser-mock.json`：`mode=MOCK_ONLY`、`realPaidCalls=0`；供应商返回显式 `MOCK` 文本与 `MOCK-BROWSER` ID。错误测试为受控故障，未故意耗尽真实配额或造成真实超时。
- 真实完整链路的 run_id：`review-d8e1c662-3bec-468f-862d-accf02f17ade`；audit_id：`audit-b95f54a2-e13a-4172-8edc-9628032e1b6d`。这些来自本机临时存储，**不是云端持久审计编号**。
- 供应商原文摘要：“用户表达保留备用金偏好，未提供持仓与行情数据。”网页显示相同内容。输入全部是虚构示例，没有真实账户信息。
- 既有确定性三方案计算是 Demo，和模型结果分区；公开预览尚未配置入口，明确显示待配置，不展示“AI 已正式上线”。

## E. Cloudflare / 百炼 Owner 操作清单

当前 `wrangler whoami` 明确返回未认证；没有可用的 `CLOUDFLARE_API_TOKEN`，不据此推断用户账号一定没有权限。本轮未登录账号、未读取或改写远端 Secrets、未发布任何 Worker。Owner 需按下列步骤完成：

| 控制台位置 | 要核对或填写的内容 | 验收条件 |
| --- | --- | --- |
| 阿里云百炼 → 华北2北京 → 对应业务空间 → API-Key / 模型访问权限 | 确认空间 `ws-h55unwqubcoxw7tb`、Key 所属空间及允许 `qwen3.8-flash`；控制台模型调用 ID 与本报告一致 | 不提供 Key 截图；云端使用的 Key 与拟授权空间匹配 |
| 团队 PR #23 / Contract 提案 | 审核 prepare 中模型白名单和供应商模型校验补丁、Access wrapper、同源部署；保留原 ReviewService 迁移 | 对应后端/Contract Owner 明确确认，继续保持 PR 草稿直至审核完成 |
| Cloudflare → Workers & Pages → `personal-ai-fund-manager-core-agent` → Deployments / Settings | 记录当前版本、路由、绑定、迁移和回退版本；候选入口 `worker-entry.mjs`，不是静态 Pages Functions | 同一 Worker + ASSETS，不另建未受保护的接口；保留 Durable Object 数据 |
| 该 Worker → Settings → Variables and Secrets | Secret：`DASHSCOPE_API_KEY`、既有独立 `CORE_AGENT_API_KEY`。普通服务端变量见下文 | **每个实际运行环境分别配置**；不要把本机 MODEL_API_KEY 名称误当自动映射，不要写浏览器构建变量 |
| Zero Trust → Access → Applications → Self-hosted | 专用 HTTPS 域名；覆盖整个应用或 `/investment-only/*`、`/api/review*`、`/api/tinglan/*`；指定团队邮箱 Allow 策略 | 无 Everyone / Bypass；保留原机器调用所需 Service Auth；验证 JWT issuer/audience/账号限制 |
| Worker → Settings → Variables and Secrets | `ACCESS_ISSUER=https://<team>.cloudflareaccess.com`；`ACCESS_AUD` 为该应用 AUD；`ACCESS_ALLOWED_EMAILS` 为确认名单 | 字段从实际 Access 应用复制，不猜值；未登录拒绝，不调用模型 |
| Worker → Settings → Domains & Routes | 绑定受控域名，按模板关闭 workers.dev；ASSETS 同源加载页面和 `/api/review` | 新域名已生效，无法经旁路绕过 Access；CORS 仅列真实需要的精确 Origin |
| Worker → Deployments → 对应实际版本 | 发布审核后的候选，复查环境变量和 Secrets 绑定，并重新加载 | 网页、`/api/tinglan/status`、`/api/review` 来自同一个实际候选版本 |
| 阿里云费用中心 / 百炼用量，Worker 日志与 Durable Object | 费用提醒、预算、持久化限额和审计；日志不记录密钥/JWT | 配置失败、存储失败、预算拒绝均在模型调用前终止 |

普通服务端变量：`MODEL_PROVIDER=aliyun_bailian`、`MODEL_NAME=qwen3.8-flash`、`MODEL_API_STYLE=chat_completions`、`MODEL_RESPONSE_FORMAT=json_object`、`MODEL_MAX_ATTEMPTS=1`、`MODEL_TIMEOUT_MS=30000`、`MODEL_DISABLE_RULE_FALLBACK=true`、`MODEL_FALLBACK_TO_RULES=false`、`BAILIAN_REGION=cn-beijing`、`BAILIAN_WORKSPACE_ID=ws-h55unwqubcoxw7tb`、`BAILIAN_MAX_OUTPUT_TOKENS=800`、`TINGLAN_DAILY_REQUESTS=5`、`REQUIRE_TRUSTED_ACTORS=true`。初始保持 `BAILIAN_ALLOW_PAID_CALLS=false`、`BAILIAN_TEST_BUDGET_CNY=0`。

production、preview、本地开发的区别：Workers 的命名环境/版本分别设置 Secrets 和非继承 bindings/vars；本模板目前没有 `[env.preview]`，不能声称已经拥有隔离 preview。Pages 项目若只发静态文件，不会自动发布此 Worker；Pages 的 Production / Preview 变量也不会自动转移到独立 Worker。本地 `.env.local` 仅由本机验收进程显式加载，不上传、不复制到 `.dev.vars`。不要在旧生产 Worker 上盲目更改模型或预算。

部署后先做免费验收：未登录拒绝、合法登录、状态接口、同源 OPTIONS、禁用预算、持久化/回退。再次得到付费授权后才开启本次试验限额，分别做**云端服务端到百炼**和**真实 Access 登录网页到云端到百炼**；确认 HTTP、模型 ID、Token、耗时、供应商文本、云端审计持久性，并关闭付费或重新审批。当前两次授权已全部使用，不能挪作后续云端调用。

## F. 文件与仓库交付

本轮仅新增验收报告、手工真实验收程序、真实/公网/本地 workerd 脱敏证据和截图，并更新 DELIVERY 的状态入口。没有修改根目录业务后端、Contract、Risk、审批、团队 main、team-release、旧 finance-lab-demo 或其他组员仓库。原 F 盘脏工作区保持不动。

团队工作分支：`codex/tinglan-secure-ai-20261018`。PR：https://github.com/Fintechathon-agent/Fintechathon-agent/pull/23 ，继续 OPEN / DRAFT，未合并。个人交付仓库：`lixjanus526-art/finance-lab-ui-preview` 的 `preview` 分支，只同步验收文档/脱敏证据；不更改公开预览的 endpoint，不伪装启用。

个人预览：https://lixjanus526-art.github.io/finance-lab-ui-preview/investment-only/investment.html#ai-assistant 。当前来源经 GitHub Pages API 确认为 `preview` 分支 `/` 的 GitHub Pages 发布，不能仅凭前情称其为 Cloudflare Pages。本轮提交 SHA 和远端核验在最终交付中提供，避免报告自包含提交哈希导致递归变动。

## G. 尚存阻塞与网络边界

1. 当前公网模型仍是 Llama，本候选尚未部署；公开预览 `endpoint=null`。
2. 没有 Cloudflare 登录/Owner 会话，不能核实实际 production / preview 的 Secrets、Access、路由及已发布版本。需要 Owner 按 E 操作。
3. 本机 Node 默认直连 Worker 的 health、status、OPTIONS 均约 10.6 秒连接超时；启用已有环境代理后 health 200（806ms）、status 404（262ms）、OPTIONS 204（227ms）。这表明**访问路径不同会改变结果**，不是模型已上线证据。代理出口地区未核实，不把它算作大陆直连。
4. 中国大陆电信/联通/移动的实际地区、运营商、无代理访问及真实 Access + 推理尚未验收。Owner 需在当地网络记录地区/运营商/时间、HTTP/耗时/Token，并使用新授权；不通过本机地区或单次海外/代理成功推断稳定可用。

最终状态：**本机真实模型及网页完整链路通过；编译和本地 Worker 启动通过；公网真实端到端验收仍由部署、Access、Secrets 和大陆网络实测阻塞。**

官方依据（本轮查阅）：[模型 ID 与价格](https://help.aliyun.com/zh/model-studio/qwen3-8-flash)、[子业务空间调用与权限](https://www.alibabacloud.com/help/en/model-studio/model-calling-in-sub-workspace)、[Wrangler 命令](https://developers.cloudflare.com/workers/wrangler/commands/)。
