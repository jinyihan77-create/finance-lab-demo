# Finance Lab UI Preview

Static UI demo only. No backend, real funds, approvals, executions, or fabricated success responses.

Source: Fintechathon-agent/Fintechathon-agent (private), branch codex/ui-site-integration-v1, commit a007143ae5fd22750442e3ce79880aceec3baf56.
Reviewed main: e51ce9bb4e30cd409414ef55f8f9a5eddd065dda.

Packaging adds a Preview notice and replaces the unintegrated legacy Risk tool with an unavailable page. It does not change source/backend code. Existing Node suite: 73/75; one pre-existing Landing stylesheet assertion fails and causes its parent test to fail. UI model 13/13; browser 17; visual 5 groups.

Rollback: revert the publishing commit to a verified prior artifact; for the first release, disable Pages in this preview repository. Never change the team repository or its main branch.

2026-10-16: mobile card titles and content aligned. Browser widths 320, 375, 390, 430, 700, 1024 checked. Syntax check passed. Full Node suite not rerun for CSS-only change.

2026-10-16: explicit two-line mobile headings, flowing CTA, single-row three-step navigation, punctuation-free static headings. Browser checks 320-1024px passed.

Mobile navigation: single-line centered labels in compact 8px rounded rectangles; 44px touch height retained.

## 2026-10-18：个人投资顾问独立候选

预览：https://lixjanus526-art.github.io/finance-lab-ui-preview/investment-only/investment.html

仅含虚构数据和浏览器模拟计算，AI 后端未连接，不执行交易。原统一工作台保留，店主入口下线，旧地址跳转到个人投资顾问。源码、测试和交付说明由团队 `team-staging/ui/investment-only-20261018/` 候选分支供审核；未更新 team-release，未合并团队 main。

## 听澜安全 AI 候选（2026-10-18）

投资页已加入结构化偏好输入与真实网络客户端；默认未配置付费入口，不发送模型请求。Cloudflare Owner 审核部署并提供受保护地址后启用。浏览器不持有模型 Key 或团队共享凭证。Mock 联调通过不代表真实百炼已上线。

交付代码、配置与操作清单位于团队仓库 `team-staging/ui/tinglan-ai-20261018/`。既有确定性计算和统一工作台保留。

## 百炼真实验收（2026-10-19）

两次授权的本机真实调用均 HTTP 200，返回 qwen3.8-flash；本机网页展示与供应商结果一致。Worker dry-run 和本地启动通过。云端仍是 Llama；Access、Secrets、部署及大陆真实网络验收待 Owner 完成。当前公开预览保持 endpoint=null，未启用付费入口。

[完整验收与 Owner 操作](acceptance/2026-10-19/ACCEPTANCE-2026-10-19.md)。真实与 Mock 证据分开，不将本机成功称为生产上线。

## 投资需求完整分析（2026-10-19 第二轮）

已补齐金额、期限、风险偏好和目标输入；指定大学生测试的一次真实 qwen3.8-flash 调用 HTTP 200，1148 tokens，网页完整显示五方面分析。默认公开入口仍未配置，等待 Cloudflare Owner 登录、Access 与受控域名部署，不能称为生产上线。

[本轮真实证据和 Owner 阻塞](acceptance/2026-10-19/PREFERENCE-ACCEPTANCE-2026-10-19.md)。
