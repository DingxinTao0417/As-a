# 预览版本交接

用户已授权提交并推送，以查看线上效果。本轮将上一轮本地生产加固、功能审查及演示数据工具提交到 `codex/production-readiness-demo`，通过 Vercel Preview 验收；正式站点仍保留 `main` 版本。

本地已通过完整 `npm run verify`：157 项单元/API/UI 测试、47 条数据库权限断言及 SQL 回归、20 项 Chromium 验收、TypeScript、ESLint、构建和零漏洞依赖审计。演示数据导入与清理另通过 73 项断言，现已加入统一 verify 和预览分支 CI。

## 预览范围

目录展示使用此前已写入当前 Supabase 的 6 位演示服务商与 12 项服务。预览主要检查首页、目录、搜索、分类、详情、双语及手机布局；不是正式交易验收。

当前线上数据库仍使用旧表结构和权限。新订单 RPC、public_profiles、后台事务、共享限流等尚未应用；与其相关的账号、消息和交易行为仍待迁移后验收。不要因为预览构建通过就将新版直接提升为正式版本，也不要直接向旧库运行初始迁移或 db reset。

Vercel 构建需要 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`NEXT_PUBLIC_SITE_URL`。预览与正式环境的变量覆盖范围应分别核对。支付与 AI 默认关闭，启用前需满足 [生产部署说明](production.md) 和 [功能审查](functional-review.md) 的要求。

`vercel.json` 明确使用 `npm ci` 和 `npm run build`，避免平台历史 Bun 安装设置绕开 npm 锁文件。本站 Preview 的 `NEXT_PUBLIC_SITE_URL` 需要完整 HTTPS 地址，不能只填主机名或未展开的变量表达式。

预览不创建或修改数据库 schema/RLS，不新增登录凭据，也不执行演示数据清理。
