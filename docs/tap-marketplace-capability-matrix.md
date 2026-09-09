# Tap Marketplace 能力与接入边界

核对日期：2026-09-09｜适用任务：D-02、PAY-01～05、PLAN-02

本文记录官方公开接口与当前代码之间的对应关系。它不证明 As'a 的 Tap 商户已获得相应权限；实际能力仍以 Marketplace 合同、TapOS 中的 key、sandbox 返回和 Tap account manager 的书面确认作为验收证据。

## 官方公开能力

| 能力 | 官方公开契约 | 当前结论 |
| --- | --- | --- |
| 密钥 | Marketplace onboarding 使用 Marketplace keys；Charge 等交易使用 Merchant keys | 必须分别保存，不能复用一个环境变量 |
| 创建 Lead | `POST /v3/lead/`；KSA 测试环境也校验真实 CR、National ID、IBAN 等资料 | 不能使用占位 KYC 数据做“成功”演示 |
| 创建账户 | `POST /v3/connect/account` 使用 `lead_id`，响应提供 retailer ID 和独立的 payout 状态 | retailer/destination 身份与 payout 能力分开保存 |
| 查询 destination | `GET /v2/destination/{destination_id}`；列表接口为 `POST /v2/destination/list` | 页面状态和提现资格必须来自外部查询，不能信任 URL 或本地布尔值 |
| 即时分账 | Charge 请求可带 `destinations.destination[]`，未分配部分留在 Marketplace wallet | 需要先确定订单平台费、Tap 手续费/VAT、退款与争议承担方式 |
| 延迟分账 | Marketplace 指南描述成交后通过 Update Charge 分配；公开 Update Charge 参考页目前只列 description、metadata 和 receipt | 接口公开文档存在缺口，未取得商户能力确认前不实现或调用 |
| Payout | KYC 批准后由 Tap 自动出款，或按协议在 TapOS 手工发起；另有 payout webhook/report | 平台不能把“提现审批”显示成“已到账”，外部终态必须对账 |

官方入口：[Marketplace Overview](https://developers.tap.company/docs/marketplace-overview)、[Create Lead](https://developers.tap.company/reference/create-a-lead-v3)、[Create Account / Retailer onboarding](https://developers.tap.company/docs/onboarding-retailers)、[Retrieve Destination](https://developers.tap.company/reference/retrieve-a-destination)、[Charge split](https://developers.tap.company/reference/charges)、[Update Charge](https://developers.tap.company/reference/update-a-charge)、[Payout webhook/report](https://developers.tap.company/reference/webhook-api)。

## 当前本地实现

| 项目 | 状态 | 证据与限制 |
| --- | --- | --- |
| Charge、Refund 与支付回调 | 门禁关闭 | `TAP_PAYMENTS_ENABLED`、`TAP_REFUNDS_ENABLED` 默认 false；事件、幂等和对账已在本地数据库验证 |
| Charge 尝试状态 | 已补齐公开枚举 | IN_PROGRESS 继续复用，ABANDONED/TIMEDOUT 可重试，UNKNOWN 必须对账；旧 Charge 晚到 CAPTURED 保留原 attempt |
| Charge 响应丢失恢复 | 已实现人工安全恢复，待 sandbox | 管理员从 TapOS 取得 Charge ID；服务端实时查询并双重校验 metadata、金额和币种后，事务化记录事件和审计 |
| Marketplace destination 查询 | 已实现，待 sandbox | 使用独立 `TAP_MARKETPLACE_SECRET_KEY` 调用 Retrieve Destination，15 秒超时，响应 ID 必须等于已绑定 ID |
| 收款与提现状态 | 已拆分 | `tap_charges_enabled` 与 `tap_payouts_enabled` 独立保存；管理员可查看来源和最后核验时间 |
| 提现资格 | 本地事务已收紧 | 每次申请先查询 Tap；数据库仅接受五分钟内由 destination API 写入且 payout=true 的状态 |
| 创建 Lead、上传 KYC、Connect/Account、补件 | 未实现 | `createConnectAccount` 与 `createAccountLink` 明确返回不可用，不产生假 URL 或占位 destination |
| Marketplace onboarding webhook | 未实现 | 公开说明提到 payout 启用通知，但需要取得该事件的实际 payload、签名规则和重试约定 |
| 分账 | 未实现 | 当前 Charge 适配器没有 `destinations`；D-01 和结算模式未确认时不能默认即时或延迟分账 |

## 继续实施所需输入

1. Tap 书面确认 As'a sandbox 已启用 Marketplace，并提供测试 Marketplace MID、Marketplace secret/public key 和 Merchant test keys。
2. 确认 KSA 支持的主体类型、字段、文件类型、文件大小、资料更新/补件方式，以及测试数据必须满足的真实性条件。
3. 提供 onboarding 与 payout webhook 的脱敏样例、签名算法、重试规则和状态枚举。
4. 确认结算使用即时分账还是延迟分账；若使用延迟分账，确认当前商户实际可用的接口、请求字段和幂等能力。
5. 确认 Tap processing fee 与 VAT 的承担方、退款时 destination 资金回收方式、争议/chargeback 责任和已出款后的追偿规则。
6. 确认 KYC 数据保留期限、访问角色、导出/删除规则和支持人员职责后，再新增资料表单与私有文件 bucket。

## Sandbox 验收证据

- 一个真实有效的测试 Lead 从创建、补件到 retailer/destination 生成，重复请求不创建第二个账户。
- destination 从 pending/未开 payout 转为 active/payout enabled，页面、管理员列表和数据库同步一致。
- 过期或错误 destination、响应 ID 不一致、Marketplace key 错误和超时都不会授权提现。
- 选定分账模式后，Charge 总额、provider share、Marketplace share、Tap fee/VAT 与订单快照逐项相等。
- 退款、争议、自动/手工 payout 及 webhook 重试都能用同一外部 reference 与本地账本对上。
- 证据只记录脱敏 ID、金额对照和日志引用，不保存或输出 key、完整 KYC 内容和完整银行资料。
