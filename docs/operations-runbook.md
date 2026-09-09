# As'a 运维与发布运行手册

本文用于预发布和生产环境操作。仓库默认配置不会发起真实付款、退款或出款，也不会自动修改已存在的 Supabase 项目。

## 1. 环境与职责

至少准备三个相互隔离的环境：本地、预发布、生产。预发布使用独立 Supabase 项目、Tap sandbox 商户和测试 AI key，不复用生产用户或交易。

每个环境指定以下责任人并记录到团队内部系统，不把姓名、邮箱或密钥提交到仓库：

- 发布负责人：执行应用发布和回退。
- 数据库负责人：审查迁移、备份和向前修复。
- 支付运营：核对 Tap Charge、Refund、Payout 与平台账本。
- 支持负责人：处理工单、退款、争议和删除申请。
- 安全联系人：接收凭据泄露、越权和异常访问告警。

测试账号由环境负责人创建，至少覆盖 seeker、provider、admin 和无关第三方四个角色。凭据存入团队密码管理器，不写入 seed、截图、trace 或 CI 日志。

## 2. 发布前配置

按 `.env.example` 配置变量。`NEXT_PUBLIC_*` 会进入浏览器，其余密钥只能配置在服务端运行环境。

资金开关初始必须为 `false`：

- `TAP_MARKETPLACE_ENABLED`：允许用独立的 `TAP_MARKETPLACE_SECRET_KEY` 读取已绑定 destination 状态；它不创建 Lead、账户或 Connect URL。
- `TAP_PAYMENTS_ENABLED`：允许创建真实 Tap Charge。
- `TAP_PAYMENT_RECONCILIATION_ENABLED`：允许管理员查询已有 Charge 并持久化观察结果，不创建新 Charge。
- `TAP_REFUNDS_ENABLED`：允许创建真实 Tap Refund。
- `TAP_PAYOUT_RECONCILIATION_ENABLED`：允许管理员保存已在 Tap 外部核实的出款结果；它不会发起转账。

Marketplace key 与 Merchant Charge key 必须分别保管，不能互换。服务商提现前会实时读取 destination，只有 active 且响应明确给出 payout 能力，数据库才接受五分钟内的核验结果；本地布尔值、回跳参数和过期状态不能授权提现。

先配置并验证 `NEXT_PUBLIC_SITE_URL`、Supabase Auth Redirect URL 和 Tap webhook URL，再开启资金开关。支付 webhook 地址为 `/api/webhooks/tap`。KSA Marketplace 自助开户还需要 Tap 确认的 MID、KYC 材料清单、测试凭据及 onboarding webhook，未具备时保持 `createConnectAccount` 和 `createAccountLink` 不可用。

接口能力、当前代码边界和 sandbox 证据清单见 [Tap Marketplace 能力与接入边界](tap-marketplace-capability-matrix.md)。

## 3. 数据库安装与采用

新项目按 `supabase/migrations/` 文件名顺序执行。提交发布前在干净依赖环境运行：

```bash
npm ci
npm run lint
npm run check:boundaries
npx tsc --noEmit --incremental false
npm test
npm run test:db
npm run build
npm run test:e2e
```

本地真实网关回归使用 `npm run supabase:start`、`supabase db reset`、`npm run test:supabase` 和 `npm run test:e2e:supabase`；完成后运行 `npm run supabase:stop`。测试只使用 `supabase status` 返回的本地临时 key，不能把本地默认 key 复制到托管环境。

已有项目不能直接运行 fresh-install 基线。先执行以下步骤：

1. 生成数据库备份和 schema-only dump。
2. 在隔离项目恢复备份并记录恢复耗时。
3. 只读运行 `supabase/checks/preflight.sql`。
4. 对比表、函数、约束、RLS、Storage bucket、Realtime publication 和迁移历史。
5. 编写单独的 adoption migration；历史金额必须对照已结算 Tap 证据。
6. 在恢复副本上运行角色、金额、文件和回调验收后再安排生产窗口。

迁移失败时不要修改已记录的历史文件或强行标记为 applied。保留错误输出，在恢复副本重现，并以新的向前修复迁移处理。只有整个数据库不可恢复且发布窗口明确授权时才执行整库恢复。

## 4. Storage 与 Realtime

当前 bucket：

| Bucket | 可见性 | 写入者 | 读取者 | 限制 |
| --- | --- | --- | --- | --- |
| `avatars` | public | 本人 | public | JPEG/PNG/WebP，5MB |
| `service-images` | public | 服务商本人路径 | public | JPEG/PNG/WebP，10MB |
| `dispute-evidence` | private | 争议参与者/管理员路径 | 争议双方/管理员 | 图片/PDF，10MB |
| `order-deliveries` | private | 履约服务商 | 订单双方/管理员 | 文档/ZIP/图片，25MB |
| `provider-verification` | private | 申请认证的服务商 | 本人/管理员 | PDF/图片，10MB |

私有文件只通过短期签名 URL 展示。已登记的争议证据、交付文件和认证材料不能由浏览器删除。服务图片清理失败会先保留当前设备离线记录，恢复连接后写入服务端队列；任意设备可重试，服务端仅删除归属正确且已不再被服务引用的路径，失败任务保留尝试次数。未被应用识别和入队的孤儿对象仍需在预发布环境以只读扫描确认后再决定清理。

Realtime 至少验证 messages、conversations、orders 和 notifications：断网后重连补拉、另一标签页已读同步、退出/停用后不再收到私人事件。

用户从资料页调用 `GET /api/user-data-export` 下载无缓存的 `tar.gz`。归档中的 `export.json` 记录数据快照与私有文件映射，随后流式加入交付文件、争议证据和认证材料。任一私有对象无法读取时，响应流会失败，用户应重新发起导出；不能把截断归档当成成功证据。超大账户仍需在发布前核对平台请求时限，并在超过同步流能力时实施可恢复的异步导出任务。

## 5. 支付、退款与出款处置

### Charge 或回跳结果未知

不要重新创建 Charge。先在 `/admin/payments` 按订单或 Charge 检查持久化事件，再用订单现有 payment attempt 的外部 Charge ID 查询 Tap。若 creating attempt 没有保存 Charge ID，但 TapOS 能找到对应 Charge，使用“Recover Charge”填写外部 ID 与证据；服务端会实时查询 Tap，并要求 Charge metadata 中的 order/attempt、金额和币种全部匹配后，才在同一数据库事务记录事件、处理结果和管理员审计。主动查询、浏览器回跳和 webhook 必须进入同一事件处理器。金额、币种、订单或 attempt 不匹配时保持 quarantined，并记录人工核对证据。已有异常事件只有 Charge、金额和币种全部匹配时，才可用“安全重关联”填写 order/attempt 和审计理由。

可选批量任务为 `POST /api/jobs/payment-reconciliation`。它要求 `Authorization: Bearer <RECONCILIATION_JOB_SECRET>`、`TAP_PAYMENT_RECONCILIATION_ENABLED=true`，每次最多处理 25 条超过 `PAYMENT_RECONCILIATION_MIN_AGE_MINUTES` 的开放 attempt，只查询已有 Charge。部署调度器需限制调用源、记录 401/500 和汇总结果，并在异常增长时停止调度、转人工队列。

### Webhook 返回 500

这表示事件没有可靠持久化，Tap 应重试。先恢复数据库，再确认相同事件键只生成一条记录。不要为了返回 200 而跳过持久化错误。

### Refund 为 PENDING、ACCEPTED、UNKNOWN 或 TIMED_OUT

保持退款金额预留，不再次盲目发起。通过 `/admin/refunds` 使用原 attempt 对账，只有 Tap 终态和金额、币种、Charge 都匹配后才记录成功或明确失败。

### Payout 结果未知

保持账本 reserved。通过 `/admin/withdrawals` 保存 Tap dashboard/report 的外部 reference 和证据；只有开关开启且证据已核实时记录 paid/failed。approved 不是已到账。

任何资金人工修复都应产生审计记录。直接修改 orders、refund_requests、withdrawal_requests 或 ledger_entries 不属于正常处置流程。

## 6. 业务队列

- `/admin/support`：工单及回复；关闭和重新打开需要审计理由。
- `/admin/refunds`：退款申请、批准、执行和未知结果对账。
- `/admin/disputes`：证据、冻结余额和人工裁决。
- `/admin/payments`：待处理或 quarantined 支付事件。
- `/admin/withdrawals`：提现审批与外部出款追踪。
- `/admin/deletions`：只读删除申请队列；保留规则确认前不执行 Auth/文件删除。
- `/admin/audit`：敏感管理员动作的只读记录。

队列读取失败时不得按“无待办”处理。先恢复数据访问，再确认统计卡片和队列明细一致。

## 7. 监控与告警

应用目前输出结构化 AI 和管理员失败事件，并把支付/退款处理结果持久化。接入监控平台时至少建立以下告警：

- webhook 5xx 或签名失败突增；
- payment/refund event 长时间 pending 或 quarantined；
- payout/refund unknown 数量增长；
- service-role RPC、Storage 签名 URL 或 Realtime 订阅持续失败；
- AI 429、502、503、504 比例异常；
- 数据库迁移、备份或恢复演练失败。

日志不得记录 API key、完整 webhook secret、完整对话、私有文件内容或不必要的用户资料。Sentry 仅在完成数据范围和接收者审查后配置。

## 8. 备份、恢复与回退演练

每次数据库发布前创建可验证备份。在隔离项目恢复后核对：

- 表行数和迁移历史；
- 订单金额、成功退款累计额和账本 available/reserved/paid 总和；
- payment/refund/payout attempt 与外部 reference；
- 私有 bucket 对象数量和参与者访问；
- Auth 登录、Realtime 订阅和关键 RPC。

应用代码可以回退到上一版本，但数据库优先使用向前修复迁移。若新代码依赖已新增列，先部署兼容修复再回退应用，避免旧代码写出不满足新约束的数据。

## 9. 发布验收与证据

发布记录至少包含：应用版本、迁移范围、环境、执行人、开始/结束时间、命令结果、角色测试账号、Tap/AI sandbox 证据、金额对照、截图或 trace、已知限制和回退决定。

保持资金开关关闭，直到 Auth 邮件、RLS/PostgREST、Realtime、五个 Storage bucket、Tap Charge/Refund/Payout 对账、AI 质量、备份恢复和法律/支持信息分别通过预发布验收。
