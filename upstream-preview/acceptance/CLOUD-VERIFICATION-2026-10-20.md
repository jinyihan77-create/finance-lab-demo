# 昕澜 Finance Lab：Qwen3.8 云端真实验收（2026-10-20）

结论：Cloudflare 服务端到百炼、网页到服务端到百炼两条真实链路均成功。大陆直连可用性仍未通过，不能宣称大陆稳定可用或全面正式上线。

分享入口：https://xinlan-qwen38-share.lixjanus526.workers.dev/investment-only/investment.html#ai-assistant 。网页内嵌分析表单；登录分享会话后填写金额、期限、风险偏好和目标，直接展示模型结果。持仓区仍是固定 Demo，未接入真实行情或账户，不执行交易。分享口令仅保存在本机私有说明文件，由 Owner 私下分发，未提交 GitHub；它不是百炼 API Key。

## 部署归属与架构

- 本轮账号：lixjanus526@gmail.com，Account ID 323563bd429155d1e603e8493138ada3；Wrangler OAuth 登录和 workers write 权限已实测。
- 独立 Worker：xinlan-qwen38-share；版本 68891f8b-752d-4c90-8442-9eb41773d44b。Worker Assets 复用原 UI，与 /api/review 同源；没有新建 Pages 项目。
- 原个人预览实际是 GitHub Pages：https://lixjanus526-art.github.io/finance-lab-ui-preview/investment-only/investment.html#ai-assistant 。此前称其 Cloudflare Pages 的平台归属不准确。本轮保留静态预览并增加已验收的真实工作台链接，不用跨站 Cookie 绕过鉴权。
- 旧 realchenchenluo.workers.dev 地址属于另一部署命名空间，且旧 health 显示 Llama；在本账号查询该旧 Worker 返回不存在，无法核实旧账号数字 ID。不得把旧地址作为本轮 Qwen 验收证据。

## 实际模型与环境映射

- 当前模型：qwen3.8-flash；两次成功响应的 model 均与之完全一致。
- Workspace：ws-h55unwqubcoxw7tb，北京地域。
- Base URL：https://ws-h55unwqubcoxw7tb.cn-beijing.maas.aliyuncs.com/compatible-mode/v1 。此 Workspace、服务端 Key 与 Flash 模型的组合已由真实成功调用验证。
- 上游：POST /chat/completions，OpenAI 兼容 chat_completions，json_object；enable_thinking=false；不自动切换模型。
- 网页：POST /api/review；会话：/api/session；只读用量：/api/tinglan/status。
- 本机忽略文件 MODEL_API_KEY 映射为云端 Secret DASHSCOPE_API_KEY。另三项 Secret：CORE_AGENT_API_KEY、SHARE_ACCESS_CODE、SESSION_SIGNING_KEY。均通过服务端内存和标准输入上传，没有写入前端、GitHub、证据或命令参数。
- 30 秒模型超时、35 秒前端超时、1600 最大输出 Token、一次尝试、不自动重试。生产 paid=true；源配置默认 paid=false，必须以显式预算参数启用。
- 已保留显式 qwen3.8-max 的隔离候选支持和更高预算预留；当前分享 Worker 锁定 Flash，没有自动切换。

## 真实调用证据

| 链路 | /api/review HTTP | 端到端耗时 | Token | 百炼响应 ID |
| --- | --- | --- | --- | --- |
| 已鉴权云端后端 → 百炼 | 200 | 8799 ms | 1083（输入702/输出381） | chatcmpl-782ec7ce-7ef3-9169-8e85-d3d7deba0f84 |
| 网页按钮 → Worker → 百炼 | 200 | 9844 ms | 1150（输入734/输出416） | chatcmpl-6daef9a1-9962-9bde-920e-c478c99f50d4 |

网页使用用户指定的大学生、10000 元、中低风险、未来三年需求。页面显示约 9.75 秒、1150 tokens；其风险总结和四段分析与 raw_text JSON 逐项一致。模型输出包含备用金、期限/流动性、资产研究类别及主要风险，没有实时价格或收益预测。运行编号 review-84169272-7f9a-4e61-97af-5aaf8c2eff2f，审计编号 audit-36d91fba-b5e9-47b7-b83a-96e87a632794。

实际云端 source=model、call_succeeded=true、model=qwen3.8-flash；Durable Object 保存 RESPONDED、真实 usage 与 chatcmpl 响应 ID。Mock 测试使用明确的 MOCK-BROWSER 标识和固定 120 tokens，只用于错误/界面检查，未冒充真实调用。虚构测试输入 data_mode=SYNTHETIC_REPLAY 不等于 Mock 模型；第一条云端测试输入为虚构示例，仍调用了真实百炼。网页最终输入采用用户自述 LIVE 模式。

证据：evidence/cloud-live-fixed-20261020.json（后端成功，后续页面加载超时，保留失败边界）、evidence/cloud-browser-final-20261020.json（完整网页成功）、evidence/cloud-live-20261020.png（真实页面）、evidence/cloud-accounting-20261020.json（云端持久额度）。

## 修复与失败记录

首次云端请求 HTTP502，持久记录 MODEL_PROVIDER_UNAVAILABLE、11ms，无 usage/响应 ID。定位为 workerd 不支持 redirect=error；修复为仅在 Worker 的 fetchImpl 使用 manual 并拒绝所有 3xx，禁止密钥随重定向发送。共享 Node 适配器保持原契约，Owner 测试未改。官方实现：https://github.com/cloudflare/workerd/blob/main/src/workerd/api/http.c%2B%2B 。初次尝试直接改共享适配器导致原 B01 重定向断言失败，已撤销该做法；最终 Worker 专属修复后完整 249 项通过。

网页验收还发现登录初始化竞态：事件处理器完成前可提交表单。现登录按钮初始禁用、登录表单显式 POST、投资表单初始隐藏，初始化完成后才可提交。增加慢网络回归，验证不会原生 GET 提交口令。随后轮换分享口令与会话签名密钥，旧会话失效。

早期准备临时运行时 probe 时 Miniflare 5 构造参数校验失败；该探针未完成，未当作通过证据。最终以 Worker 实际发布和真实 HTTP 调用证明运行兼容性。中途 F 盘短暂不可用，已恢复；仓库和密钥路径已重新核实。

## 验证结果与费用边界

- JavaScript syntax check 通过；项目没有独立 TypeScript typecheck 脚本，未声称运行不存在的检查。
- 原 Core 回归 249/249；隔离候选网关/安全测试 21/21，包括 3xx 拒绝、内部用量权限与脱敏。
- 慢网络登录初始化 browser-session 测试通过；无模型请求，口令未进入 URL。
- 浏览器 1440/1024/375 像素 Mock 检查覆盖加载、鉴权、超时、限额、模型服务错误、错误模型/响应、无配置和原确定性三个方案。此项不是付费调用证据。
- Wrangler 构建与线上部署通过；最终 313.46 KiB，gzip 68.81 KiB，两项 SQLite Durable Object 与 Assets 绑定有效。
- 云端认证前测：匿名/伪造机器密钥 401、跨站登录 403、有效登录200、HttpOnly/Secure/SameSite=Strict、退出成功；最终网页无脚本错误。
- 总持久预留 3 次、0.03 元：两次 RESPONDED，首次失败仍保守占额；剩余最多17次、0.17元应用预留。它不是阿里云账单硬封顶，实际账单以百炼为准。未因两次浏览器加载/点击失败自动重发模型请求。
- 本机不使用环境代理访问 Worker health：10736ms 连接超时 UND_ERR_CONNECT_TIMEOUT。成功云端/浏览器验收使用现有代理，不能据此认定大陆直连通过。证据 evidence/direct-network-20261020.json。

## 权限、安全和后续操作

分享口令 + HMAC 会话是受控分享授权，不是团队成员邮箱身份或完整 RBAC；所有口令持有者共享主体限额。每主体每分钟2次、每日20次；原全局模型限流、持久总预算、输入校验、审计、不执行交易及禁用规则回退均保留。没有强制要求 Access issuer/AUD；既有 Access 网关能力保留。

Owner 不再需要重新登录或重复配置 Secrets。查看位置：Cloudflare 控制台 → 选择上述账号 → Workers & Pages → xinlan-qwen38-share → Settings → Variables and Secrets；核对四个 Secret 名称及非秘密模型/预算变量。Deployments 中核对上述版本；Bindings 中应有 REVIEW_SERVICE、SHARE_AUTH、ASSETS。不要在聊天发送 Secret。

后续需 Owner 在中国大陆实际浏览器、关闭代理的网络下打开分享入口并验收；当前直连未通过。如需大陆稳定分享，应使用已批准且能实际访问的受控域名/合规部署网络，再单独复验，不猜测域名、不创建重复 Pages。

## 仓库协作

仅修改 team-staging/ui/tinglan-ai-20261018 下的隔离网关、会话/部署、准备脚本、前端 AI 面板、测试和证据；根目录 Owner 后端源码不改。个人 preview 仅同步 AI 面板/客户端、清晰的 live 链接与发布清单。完整文件清单见本轮提交 diff。

团队 PR：https://github.com/Fintechathon-agent/Fintechathon-agent/pull/23 ，保持 OPEN / DRAFT，未合并 main，未修改 team-release 或其他组员仓库。本轮提交 SHA 与远端核验在最终交付列出。
