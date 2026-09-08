# 演示图片素材

本目录使用 18 张 AI 生成的虚构展示素材：6 张服务商头像和 12 张服务封面。人物均为虚构成年人，不对应真实服务商；封面不使用客户作品、商标或可读品牌文案。

## 规格与位置

- 头像：`public/demo/providers/*.webp`，768 × 768，Supabase `avatars/asaa-showcase-v1/`
- 服务封面：`public/demo/services/*.webp`，1440 × 960，Supabase `service-images/asaa-showcase-v1/`
- Storage 项目：`v0_database / nbhbendahduyiobyewzw / main`
- 数据关联：`supabase/demo/assets.sql` 只更新固定的 6 个 profile/provider UUID 和 12 个 service UUID，可重复执行。

这些 WebP 是项目内的发布副本。图像生成工具保存的 PNG 原稿仍留在本机 Codex 生成目录，没有删除。

## 生成提示词摘要

素材通过 Codex 内置 ImageGen 生成。统一视觉要求为暖白背景、深青/陶土/沙色/海军蓝点缀、自然窗光、专业服务市场的编辑摄影质感、安全居中裁切，并明确禁止可读文字、Logo、水印和真实人物相似性。

头像分别描述了开发、设计、营销、写作、视频与咨询从业者，要求胸像、自然肤质和不同年龄/服装。服务封面分别描述双语咖啡馆页面、预约看板、手工店视觉识别、预约界面、内容日历、页面审校、产品文案、阿拉伯语编辑、竖屏视频、动态图形、项目梳理和咨询流程图。

上线页面应继续保留名称中的 `Demo / عرض تجريبي` 标记，避免把虚构人物或作品误认为真实履历。
