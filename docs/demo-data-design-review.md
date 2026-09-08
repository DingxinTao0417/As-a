# 演示数据设计审查

本审查基于仓库中的迁移和应用查询；不代表已经核实或修改远端 Supabase。目标是让服务目录、服务详情和提供者主页有可展示内容。

## 建议范围

默认使用纯目录数据：专用占位 Auth 用户 → `profiles` → `providers` → `services`。使用明确的“演示 / Demo”标识、阿拉伯语和英语内容、现有分类 ID、有效图片路径和不同价格。不要将演示提供者绑定到现有真实用户。

服务可由受信任的导入过程设为 `is_active=true`，以供匿名访问；仅在隔离的演示环境使用。提供者保持 `is_verified=false`、`rating=0`、`reviews_count=0`、`completed_projects=0`，Tap 字段保持未连接默认值。不要通过伪造认证、评分或成交量美化目录。

不默认添加 `orders`、`reviews`、`service_history`、`withdrawal_requests`、`messages`、`favorites` 或管理权限。当前没有演示订单标志或财务隔离机制，`completed` 订单的 `provider_amount` 会直接计入可提现余额。评论依赖订单，评论触发器会刷新提供者评分；独立编造评分会与实际记录不一致。

## 代码约束

| 项目 | 已确认的仓库行为 | 导入含义 |
| --- | --- | --- |
| 身份外键 | `profiles.id` 引用 `auth.users.id`；`providers.user_id` 非空且唯一 | 无法只建 provider，也不能用随机悬空用户 UUID |
| Auth 触发器 | `on_auth_user_created` 自动建 profile；从 metadata 取姓名和 provider/seeker 身份，管理权限恒为 false | 创建身份后检查触发器生成的 profile，不重复 INSERT 同一 profile |
| Provider 触发器 | 新建 provider 会将其 profile 的 role 改为 provider | 不必直接更改真实用户 role |
| 可见性 | 未删除的 provider 可公开读；公开 service 要 active | Auth 的登录封禁不会隐藏目录；`profiles.deletion_requested_at` 则会隐藏目录 |
| 客户端权限 | 客户端不能设置认证、评分、成交量或直接发布 service；修改已发布 service 会重新待审核 | 导入不能借客户端 RLS 绕过审核；远端授权和作用范围必须明确 |
| 图片 | 管理发布操作要求至少一张 service image | 目录种子应附图片，不依赖直接写库绕过该产品要求 |
| 财务 | SAR 十进制金额；订单满足 amount = platform_fee + provider_amount；正常平台费为 15% | 不使用历史 cents 字段，不重跑单位换算迁移，不伪造订单测试提现 |
| 订单关系 | 插入订单检查双方身份、会话参与者及 service 归属和 active 状态 | 若后续需要全流程演示，应单独设计隔离数据库和完整一致的交易样本 |
| 清理 | 主要业务外键均为 ON DELETE RESTRICT；管理日志 append-only | 不得用 CASCADE、禁用触发器或删除日志来强行清理 |

依据：[基础表](../supabase/migrations/20260423000000_initial_schema.sql)、[权限与触发器](../supabase/migrations/20260908010000_security.sql)、[付款事务](../supabase/migrations/20260908020000_payment_transactions.sql)、[管理审计](../supabase/migrations/20260908030000_admin_transactions.sql)。

## Auth 创建方式

如果需要可登录的演示用户，应使用服务器端 `auth.admin.createUser`，或 Supabase Studio；Admin API 支持 `email_confirm: true`。服务端密钥必须留在服务器或本地运行环境，不传给浏览器页面代码，也不写入种子文件。不要用 invite/signup 来填数据，避免发送邮件。[官方 createUser 文档](https://supabase.com/docs/reference/javascript/auth-admin-createuser)

本次纯目录不需要登录。Supabase 官方本地开发示例明确使用最小的 `auth.users(id,email,raw_user_meta_data)` INSERT 作为外键占位，并说明无密码的记录不能用于密码登录。该示例的范围是本地开发；在托管演示数据库使用同一模式属于需要核对实际 schema 和触发器后的实现选择，不能将其说成已验证的远端 Auth 集成。[官方本地开发 seed 示例](https://supabase.com/docs/guides/local-development/cli-workflows)

占位身份使用固定 UUID、专用 `.invalid` 邮箱和不可由普通用户修改的 `raw_app_meta_data` dataset 标记。不创建密码、identity、session 或 refresh token；如果设置 `banned_until`，使用有限的未来时间，避免 PostgreSQL infinity 与 Auth 服务日期解析不兼容。无密码只能证明不能使用密码登录，不应将它单独当成所有认证路径的保证。若使用 Admin API，`ban_duration` 应由 API 设置，且不共享任何登录凭据。

用户可编辑 `user_metadata`，因此它不能作为安全敏感的归属依据。身份删除还可能被 Storage 对象引用阻止，既有 JWT 也不会因删除身份立即在所有路径上失效。[官方 Users 文档](https://supabase.com/docs/guides/auth/users)、[官方用户管理文档](https://supabase.com/docs/guides/auth/managing-user-data)

## 幂等性与精确清理边界

1. 固定一份 dataset ID 和完整 UUID 清单。记录预期 Auth、profile、provider、service 的数量及关联，不使用 `name LIKE '%demo%'`、邮箱后缀或整个 UUID 前缀直接删除。
2. 导入前检查目标项目身份、schema、触发器、固定 UUID/邮箱碰撞。若同 ID 已存在但标记或关联不同，报错停止；不执行覆盖式 upsert。已有相同 dataset 可跳过或报已导入，但不能悄悄覆盖人工修改。
3. SQL 目录导入放在一个事务内。通过 Admin API 导入时，Auth 和多次 REST 写入不能自动组成一个事务，应在创建每个身份后立即持久化精确 manifest，并在失败后报告残留 UUID；不能假称整体自动回滚。
4. 清理前，检查所有目标服务仍属于预期提供者、所有目标提供者仍属于预期占位用户，profile 不是管理员且 Tap 仍未连接，并检查金额/评分/成交量等是否出现业务变化。
5. 一旦目标 ID 被任意订单、会话、消息、评论、历史、收藏、提现、未知服务、管理审计或 Storage 对象关联，停止清理并报告关联数量，不删除这些后续产生的记录。管理审计除 actor_id 外还要查 target_id；target_id 本身没有外键保护。
6. 对目标记录加锁并在事务内复核后，按 `services → providers → profiles → 专用 Auth 占位行` 删除精确清单。保留外键、RLS、触发器及审计。任何约束错误均回滚，不使用 `TRUNCATE`、`CASCADE`、disable triggers、数据库 reset 或广泛清库。
7. 若占位身份已获得 identity/session/refresh token、密码、真实邮箱或 Storage 所有权，不再按简单占位方案删除；改走明确的 Auth/Storage 处理流程。不要为方便清理额外创建可长期调用的高权限 RPC。

清理脚本的意义是“仅撤销未被真实互动使用的本批目录”，不保证无论发生什么都能一键删除。若真实 schema 与仓库有差异，应先只读检查，调整脚本或保持未执行状态。

## 需要验证

- 本地真实 PostgreSQL 兼容层运行目录导入、重复导入、清理；断言业务表没有额外金额、订单、审计或权限变更。
- 对 ID/邮箱冲突、额外 service、收藏/会话/订单引用、管理审计引用、修改后的 Auth 信息进行失败测试，确认报错和事务回滚。
- 通过 anon 角色读取目录、服务详情和提供者主页；验证双语、图片、分类筛选与价格展示。
- 远端执行后只读核对数量和固定 UUID；确认目标与授权一致，不把本地测试记为远端成功。
