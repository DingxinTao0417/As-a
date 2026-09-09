# BASE-01 数据库与外部配置盘点

首次远端盘点：2026-09-08｜最近只读复核：2026-09-09｜远端观察时的代码基线：`c4403a1`｜状态：远端待复核，本地契约持续更新

本文件记录当前仓库和远端的只读证据。它不包含密钥、用户内容或生产写入，也不把尚未读取的策略推断为缺失。

## 已确认的目标与访问边界

- 当前 Git 分支为 `main`，与 `origin/main` 同在 `c4403a1`。
- 仓库没有 `.env.local` 等运行环境文件，只有占位 `.env.example`；没有 `supabase/config.toml`，Supabase CLI 未链接当前目录。
- `next.config.mjs` 的图片域名指向项目 ref `nbhbendahduyiobyewzw`。当前 Supabase 账户的项目列表将它标为 `v0_database`、`ACTIVE_HEALTHY`，所以本轮将其作为候选现有环境只读盘点。
- 本轮通过 Supabase 管理凭据在内存中取得只读 schema、聚合计数和 bucket 元数据；没有打印或落盘任何 API key，没有查询业务行内容，也没有执行 SQL、Auth、Storage 或支付写入。
- 当前接口只能确认 PostgREST 暴露契约，尚未读取实际索引、外键、约束、RLS、grants、触发器、Realtime publication、函数体、Auth 重定向/邮件配置及迁移历史。因此 BASE-01 尚不能标记完成。
- 2026-09-08 尝试通过浏览器只读查看项目控制台时停在 Supabase 登录页；未填写凭据或触发第三方登录。CLI 管理会话仍可列出项目和 API 元数据，但没有数据库连接凭据，因此本轮不继续猜测远端 RLS/函数内容。
- 2026-09-09 再次执行只读 `supabase projects list --output json`，候选项目仍为 `ACTIVE_HEALTHY`，数据库为 PostgreSQL 17（管理面显示 `17.6.1.054`）；当前目录仍未链接项目，且工作区没有本地环境文件或数据库密码，因此没有执行 `db dump`、catalog SQL、Auth/Storage 写入或迁移。

## 仓库声明的外部配置

| 领域 | `.env.example` 声明 | 当前本地状态 | 待核对 |
| --- | --- | --- | --- |
| Supabase | URL、anon key | 仅占位值 | 实际部署变量、Auth URL、邮件确认、回调白名单 |
| Tap | secret/public/webhook secret | 仅占位值 | 商户/KYC、Charge、destination/transfer、refund、subscription 沙箱能力 |
| AI | DeepSeek 默认，可选 OpenAI | 仅占位值 | 生产 provider、模型、配额、超时、保留策略 |
| 应用 | site URL、开发 Auth redirect | 仅本地示例 | 预发布/生产域名和安全回跳 |
| 监控 | Sentry 可选 | DSN 空、token 占位 | 是否使用、接收者和隐私范围 |

远端 schema 在该次快照中保留 Stripe 字段，迁移时不得未经对账直接删除。本地 CI 已移除遗留 `STRIPE_SECRET_KEY`，Playwright 已从可能误复用其他应用的 3000 端口改为独立 3107 端口并禁止复用；这些本地改动不证明候选远端已经同步。

## 代码使用的数据对象

以下 10 张表是远端盘点当时可确认的旧契约：

`profiles`、`providers`、`services`、`conversations`、`messages`、`orders`、`reviews`、`favorites`、`service_history`、`withdrawal_requests`。

当时的代码还调用 `increment_completed_projects` RPC，并使用 `avatars`、`service-images` 两个 Storage bucket；这段记录只用于制作旧库 adoption migration。

当前本地 fresh-install 契约已扩展到 `supabase/migrations/` 中的完整迁移链，包含支付/退款/出款事件、账本、交付、争议、支持、通知、AI、数据权利和运营报表等对象；Storage 另包含私有 `dispute-evidence` 与 `order-deliveries`，Realtime 覆盖 messages、conversations、orders 与 notifications。具体对象和角色断言以 `scripts/test-database.mjs` 为准，不能反推候选远端已具备这些能力。

## 远端 PostgREST 契约

以下字段来自候选项目 `nbhbendahduyiobyewzw` 的实时 OpenAPI，不代表字段约束或访问策略已经正确：

| 对象 | 当前字段摘要 | 聚合行数 |
| --- | --- | ---: |
| `profiles` | id、email、full_name、phone、avatar_url、`user_type`、`role`、is_admin、deletion_requested_at、时间戳 | 9 |
| `providers` | 中英文及旧版通用资料、categories(jsonb)、价格/统计/认证/active、Stripe 与 Tap 开户字段 | 15 |
| `services` | 中英文名称说明、category、price、price_type、delivery、features、image_urls、is_active | 33 |
| `conversations` | 双方 ID、各自 pinned/archived/cleared_at、last_message_at | 8 |
| `messages` | conversation_id、sender_id、content、is_read、created_at | 5 |
| `orders` | 双方/会话/服务快照、金额拆分、status、Stripe 与 Tap 交易字段、状态时间 | 10 |
| `reviews` | service_id、reviewer_id、order_id、rating、comment、service_name | 4 |
| `favorites` | user_id、provider_id、created_at | 0 |
| `service_history` | 双方、服务文本、amount、status、completed_at/created_at | 5 |
| `withdrawal_requests` | provider_id、amount、status、requested/processed、notes、tap_transfer_id | 0 |

远端 PostgREST 只暴露 `is_admin` RPC，没有暴露代码调用的 `increment_completed_projects`。需要确认函数确实不存在、被禁止暴露还是 schema cache 未更新；在确认前，订单验收后的项目数更新不可视为可靠。

### 已确认的契约差异

| 差异 | 影响 | 后续任务 |
| --- | --- | --- |
| 远端 `profiles` 同时有 `user_type` 与 `role` | 当前页面和中间件读取来源不统一 | ACC-02 |
| 远端 `providers.categories` 为 jsonb | 拟建基线或代码类型不可直接假设 text[] | BASE-02、ACC-02 |
| 远端 `service_history` 没有代码插入的 `order_id`、`service_id` | `confirmOrder` 的历史写入会失败，但当前代码仅记录日志并返回成功 | BASE-02、ORD-04 |
| 远端 `orders` 仍有 Stripe 字段，代码走 Tap | 需要先核对历史订单和实际交易，再制定字段迁移 | BASE-02、PAY-02 |
| `increment_completed_projects` 未通过 PostgREST 暴露 | 完成项目统计可能静默失败 | BASE-02、ORD-04 |
| 远端结构含多组旧/新 provider 资料字段 | 公开页和编辑页可能读写不同来源 | BASE-02、ACC-03 |

## Storage 现状

| bucket | public | 大小限制 | MIME 限制 | 发现 |
| --- | --- | ---: | --- | --- |
| `avatars` | 是 | 5 MiB | JPEG、PNG、WebP、GIF | 公共头像语义成立；仍需核对对象级策略与路径所有权 |
| `service-images` | 是 | 未设置 | 未设置 | 与页面最多 10 MiB 的客户端检查不构成服务端保护；需设置 bucket 与对象级策略 |

这些 bucket 是公开 URL 资源，不应用来保存身份材料、争议证据等私有文件。

## 本地迁移与脚本现状

- 当前已新增 `20260423000000_initial_schema.sql`，放在历史 Tap 增量迁移之前；PGlite 已验证空库按顺序执行基础 schema、Tap 增量及安全迁移。它仍是新建环境契约，不能直接采用到现有远端。
- `20260908010000_security.sql` 已把 Realtime publication 和公开图片 bucket 初始化变成可检查的迁移，并加入 RLS、敏感字段保护及公开资料投影；后续迁移进一步撤销浏览器对服务商、服务、评价和收藏整表的读取以及业务表直接写入，并以受信详情投影和 Storage 所有权 helper 保留合法链路。现有远端策略差异仍需单独采用迁移。
- `fix_provider_associations.sql` 只读列出 provider/profile 关联问题，可作为人工盘点参考。
- `cleanup_seeker_services.sql` 会删除 provider、conversation、order、service_history，不能作为初始化或自动修复步骤。
- `origin/codex/production-readiness-demo` 是建立在当前提交之上的远端分支，其中有一套重建 schema、安全策略和数据库测试。它不是当前 `main` 的生效代码，也没有证明远端已采用；BASE-02 已独立审查并选择性复用了 fresh-install 设计，同时补上该分支缺少的详情查询字段，没有直接整分支合并。

## Preflight 脚本验证

2026-09-09 已在 Supabase Local PostgreSQL 17 上执行 `supabase/checks/preflight.sql`，脚本成功返回 1,463 行 schema、RLS、grants、函数、约束、索引、bucket 和 Realtime 元数据。该结果只证明采集脚本可执行，不替代候选远端输出；本地结果未提交到仓库。

## 下一步只读检查

1. 在不改远端的前提下取得 schema-only dump 或经审核的 SQL catalog 查询结果，补齐类型、默认值、索引、约束、外键、函数/触发器、grants 与 RLS。
2. 读取 Supabase migration history、Realtime publication、Storage policies、Auth 邮件确认与允许回跳配置。
3. 用聚合/约束查询确认重复 provider、孤儿关系、角色冲突、金额单位、旧 Stripe/Tap 交易分布和历史 service_history 缺口；结果只记录计数与异常 ID 的脱敏引用。
4. 核实候选项目是否是后续预发布目标；真实旧库先备份并在隔离项目验证恢复，再制作采用迁移。
5. 核实 Tap、AI、监控的实际账户能力和预发布配置；不读取或记录密钥正文。

完成上述项目后才能将 BASE-01 改为 Done，并据此决定 BASE-02 使用现有远端分支迁移、重写迁移，还是为旧库建立单独的采用路径。
