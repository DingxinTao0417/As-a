# 演示目录与导入记录

2026-09-07（America/Tijuana）已按用户授权写入 Supabase **v0_database / nbhbendahduyiobyewzw / main**。用户确认该项目目前没有真实业务数据。已有测试记录全部保留；本次只增加目录展示数据。

## 已导入内容

| 表 | 导入前 | 导入后 | 本次新增 |
| --- | ---: | ---: | ---: |
| auth.users | 3 | 9 | 6 |
| profiles | 3 | 9 | 6 |
| providers | 9 | 15 | 6 |
| services | 21 | 33 | 12 |
| orders | 10 | 10 | 0 |
| reviews | 4 | 4 | 0 |
| withdrawal_requests | 0 | 0 | 0 |

六个分类为 development、design、marketing、writing、video、consulting，各有两项服务。包含阿拉伯语和英语名称、描述、交付范围、价格与周期；覆盖固定价、小时价和起步价。名称带 `Demo / عرض تجريبي`。2026-09-08 已为这批目录生成 6 张虚构人物头像和 12 张服务封面，规格、提示词摘要与 Storage 路径见 [演示图片素材](demo-assets.md)。

占位身份邮箱使用 `example.invalid`，没有密码、identity 或 session，`banned_until` 为 2099-01-01；没有发送邀请邮件，也未创建任何凭据。它们用于关联展示目录，不能用来登录演示买卖双方操作。

数据库中这批服务商的评分、评价数和成交数均为 0，`is_verified=false`，未连接 Tap。没有导入虚构订单、好评或收入。完整交易场景保存在本地 [fixtures.mjs](../scripts/demo/fixtures.mjs)，详见 [场景说明](demo-scenarios.md)；不能直接将其财务部分写入正式业务库。

## 直接展示

打开 [服务目录](https://v0-professional-services-platform-ruby.vercel.app/services/seeker)，搜索 `Demo`，再切换分类。示例：[手工店视觉设计服务](https://v0-professional-services-platform-ruby.vercel.app/services/d3a00003-0000-4000-8000-000000000003)。

已通过浏览器确认：目录显示 33 项服务；`Demo` 加 Design 筛选显示两项；详情显示 950 SAR 及对应服务商、交付内容；英语和阿拉伯语切换正常。没有登录、下单或测试真实付款。

验收同时发现详情页仍显示无依据的 5.0、ID Verified、Pro Seller、默认响应时间和最后交付时间。这些来自前端展示逻辑，**不是本次导入的认证或业绩数据**。见 [功能审查](functional-review.md) 第 7 项。正式展示可信度和开放交易前应先修复。

## 可复用文件

- [catalog.sql](../supabase/demo/catalog.sql)：事务导入，固定 UUID，认证元数据标记 `asaa-showcase-v1`。重复执行跳过已有演示目录，不覆盖编辑后的内容；身份或关联冲突即回滚。
- [assets.sql](../supabase/demo/assets.sql)：只把已上传图片关联到固定演示 UUID；先核对全部归属，缺少目录记录时整笔回滚。
- [verify-catalog.sql](../supabase/demo/verify-catalog.sql)：只读检查身份、分类数量、访客可见性和文案摘要。
- [remove-catalog.sql](../supabase/demo/remove-catalog.sql)：仅清理这批精确编号；检测到订单、收藏、会话、Auth 活动、Storage、审计或未知引用时停止。**仅在本地验证过，未在线执行**。删除会丢弃对演示条目的编辑，原始目录可由 catalog.sql 重建。
- [generate-catalog.mjs](../scripts/demo/generate-catalog.mjs)：从完整本地样本生成只含目录的 SQL，不连接数据库。
- [validate-catalog.mjs](../scripts/demo/validate-catalog.mjs)：PGlite 隔离验证，不连接 Supabase。

```sh
node scripts/demo/generate-catalog.mjs
node scripts/demo/validate-catalog.mjs
```

本地 73 项断言覆盖重复导入、匿名读取、财务隔离、RESTRICT 与旧版 CASCADE 外键、清理保护和保留无关数据。SQL 只应在核对过的目标项目 SQL Editor 中明确执行；不放入自动 migrations 或默认 seed.sql，也不运行 db reset。

## 线上结构差异与实现依据

导入前已读取线上表字段、约束、触发器、权限规则与数量。线上 `providers.categories` 为 jsonb，本地新建基线为 text[]；导入使用 `jsonb_populate_record` 按目标列类型转换。线上 Auth 建档触发器仅写入基础 profile，导入对刚创建的六个 profile 补充 provider 角色。没有更改 schema、RLS 或任何应用配置。

Supabase 的[官方本地 seed 示例](https://supabase.com/docs/guides/local-development/cli-workflows)使用无密码 `auth.users` 占位行供业务外键引用；本次在核对托管库结构后采用该模式，并额外使用无效域名与有限期限禁用。官方示例本身针对本地开发，本次托管项目写入与页面可见性已单独验证。

上一轮本地生产加固尚未应用到线上旧库。本次目录可展示不代表支付、权限或整站已达到上线条件；当前具体阻断项记录在 [功能审查](functional-review.md) 中。本轮业务代码未修改，未 commit、push 或部署。
