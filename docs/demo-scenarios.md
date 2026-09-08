# 演示数据场景

数据源：[`scripts/demo/fixtures.mjs`](../scripts/demo/fixtures.mjs)，数据集标识 `asaa-showcase-v1`。该文件只生成数据，不连接 Supabase，不创建账户，不发送邮件，也不执行支付。

## 内容与标识

- 6 个虚构服务团队，覆盖 development、design、marketing、writing、video、consulting，每类 2 项服务。
- 3 个虚构买家，7 段会话、28 条双语消息、8 个订单、3 条已完成记录、3 条评价及 6 个收藏。
- 服务名、团队名、订单快照、消息和评价均带 `Demo / عرض تجريبي` 标识。描述写明内容虚构，范围、价格和期限仅供展示。
- 邮箱全部使用 `@example.invalid`，没有电话号码、管理员、密码、真实交易编号、收款账户或认证标识。所有服务团队均为未认证。
- 封面和头像使用仓库现有 `/placeholder.svg`。它是本站公开路径，兼容当前 Next Image 配置，无需上传 Storage 或放开外部图片域名；当前样本不包含作品图片。
- 三条评价对应三个已完成订单。服务商评分、评价数和完成数由这些演示订单推导，未额外编造业绩数字。

## 展示顺序

1. 打开 `/services/seeker`，切换阿拉伯语和英语，查看六个分类、固定价、起步价与按小时计价，尝试按价格或评分排序。
2. 打开服务详情，查看具体交付范围、排除项、双语描述和同类的另一项服务；打开服务商详情查看技能和服务列表。
3. 若在隔离的演示环境另行配置了受控登录方式，可按下表选择买家视角。数据文件本身不生成登录凭据，`@example.invalid` 也不用于收信。
4. 用服务商视角展示会话和订单状态。付款相关状态仅表示已写入的样本，不表示 Tap 支付已通过联调。

| 买家场景 | 虚构邮箱 | 可展示内容 |
| --- | --- | --- |
| Fusha Launch／فسحة | `asaa-demo-launch@example.invalid` | 已完成的咖啡馆页面、待确认的内容计划、两个待付款提案、3 个收藏、置顶与未读会话 |
| Khayt Shop／خيط | `asaa-demo-shop@example.invalid` | 已完成的视觉设计与 4 星评价、已付款的商品文案订单、2 个收藏、发给服务商的未读消息 |
| Riwaq Initiative／رواق | `asaa-demo-operations@example.invalid` | 已完成的视频订单与评价、付款前取消的咨询订单、已归档会话、1 个收藏 |

订单状态分布：`pending` × 2，`paid` × 1，`awaiting_confirmation` × 1，`completed` × 3，`cancelled` × 1。已支付类样本含演示时间，但 `tap_charge_id`、`tap_transaction_id` 和 `checkout_started_at` 均为空；没有退款、提现或收入凭证样本。展示含订单的数据时应使用独立演示项目并关闭真实支付。

## 生成契约

```js
import { createDemoFixtures, DEMO_ANCHOR, DEMO_USER_IDS } from "../scripts/demo/fixtures.mjs"

const data = createDemoFixtures()
// 可传入锚点日期；所有业务时间随之平移。
const shifted = createDemoFixtures({ anchor: "2026-10-01T12:00:00.000Z" })
// 若 Auth Admin API 分配了其他 UUID，重建数据以保持外键一致。
const remapped = createDemoFixtures({
  userIds: { seekerLaunch: "12345678-1234-4234-8234-123456789012" },
})
```

默认锚点为 `2026-09-07T12:00:00.000Z`。不传参数时，每次返回相同内容；返回值相互独立，可供导入器处理。

返回字段为 `datasetId`、`anchor`，以及数组 `authUsers`、`profiles`、`providers`、`services`、`conversations`、`messages`、`orders`、`service_history`、`reviews`、`favorites`。

`authUsers` 中每项仅包含 `id`、`email`、`email_confirm`、`user_metadata`。元数据含 `full_name`、`role`、`demo_dataset`。它是导入器输入，并不自行调用 Auth API。必须先建立对应 Auth 身份，才能写入 `profiles`；其余表按返回值列出的依赖顺序处理。服务商 `categories` 与 `skills` 以 JavaScript 数组表示，导入器需按目标数据库实际列类型序列化。

所有固定 UUID 使用 `d3a0000…` 命名空间；身份重映射后，资料、服务商、会话、消息、订单、历史和收藏的身份引用会同步更新。不要通过名字包含 `Demo` 或邮箱后缀进行宽泛删除，应由导入器按数据集清单和精确 ID 管理回滚。
