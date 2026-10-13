# V1 岗位授权与人工积分接口

本文描述当前后端接口，不表示线上渠道、运营人员或法律保留期限已经核验。路由均由 `createApp` 挂载，要求有效登录；路径与接口字段以当前实现为准。

## 角色授权

`GET /api/auth/me` 每次从数据库读取当前有效角色，返回 `roles: [{ id, role, scopeKind, scopeUserId, expiresAt }]`。会话本身不缓存岗位权限，注册不会创建授权。

只有有效 `admin` 可管理授权。`GET /api/operations/roles/users?query=&limit=` 搜索用户，只返回 ID 和邮箱；`GET /api/operations/roles?userId=<uuid>` 查看其授权与撤权历史。`POST /api/operations/roles` 授权，JSON 字段为 `{ userId, role, scopeKind, scopeUserId?, expiresAt, reason, currentPassword }`。当前可从接口授予 `admin`、`creditOperator`、`modelOperator`；admin 只能用 `global` scope，其他两个岗位可用 `global` 或 `user` scope。用户 scope 必须指定 `scopeUserId`。重复有效的相同范围授权返回 409。

`POST /api/operations/roles/:grantId/revoke` 撤权，body 为 `{ reason, currentPassword }`。授权人、理由、范围、有效期和撤权人/时间/理由都保留在授权记录中。`support` 仅存在于角色数据约束中，本轮没有授予入口或 support API 权限。admin 不自动获得积分、账单或凭据权限。

首个本地开发 admin 只能由 `apps/server` 目录下的显式 CLI 建立：

```sh
NODE_ENV=dev CRUIO_ALLOW_LOCAL_ADMIN_BOOTSTRAP=true \
  bun src/db/bootstrapAdmin.ts <本地用户UUID> <到期时间ISO8601> <授权理由>
```

目标用户必须已经注册；命令不创建账户，并且已有有效 admin 时会拒绝执行。该命令连接本机开发数据库，不能用于真实账户。

## 用户账单与运营查询

`GET /api/credits` 返回用户自己的 `{ balance, reserved, available, debt }` 摘要。`GET /api/credits/ledger?limit=&cursor=` 只返回自己的追加式账本和安全摘要，不显示运营自由文本理由或原始凭据。

只有有效 `creditOperator` 可访问 `GET /api/operations/credits/users?query=&userId=&limit=` 和 `GET /api/operations/credits/users/:userId/ledger?limit=`。global scope 可按邮箱搜索；user scope 仅能查已授权用户。运营账单返回余额/欠额摘要、账本类型/金额、时间、渠道、外部编号、安全理由和关联账本 ID，不返回内部理由或凭据原件。admin 需要先由另一位 admin 显式授予 `creditOperator` 才能访问这些接口。

## 人工充值、退款扣回和冲正

先调用 `POST /api/operations/credits/preview` 取得短时预览，再调用对应写入接口。每一种操作都必须附上凭据，字段为 `{ fileName, contentType, data }`；`data` 使用匹配 MIME 的 `data:<mime>;base64,...` 格式，最大 1 MiB，只接受 PDF、JPEG、PNG 或纯文本。后端检查文件签名，并把凭据写入独立私有目录，不使用普通 media API。预览令牌绑定岗位操作者、用户、操作类型、账本关联、金额、渠道/外部编号、文件和账户余额/预占快照；有效期 15 分钟。过期预览文件在之后的预览请求中清理。

充值预览 body：

```json
{
  "operation": "topup",
  "userId": "<用户UUID>",
  "amount": 100,
  "channel": "线下转账",
  "externalReference": "外部凭据编号",
  "credential": { "fileName": "凭据.pdf", "contentType": "application/pdf", "data": "data:application/pdf;base64,..." }
}
```

退款预览使用 `operation: "refund"`，并额外提供 `entryId` 指向原充值 topup。冲正预览使用 `operation: "reversal"` 和 `entryId` 指向一条 topup 或 refund；冲正金额由服务器按原账本记录反向计算，预览的 `impact.amountDelta` 提供实际正负变化。

后续提交路径和 body：

- `POST /api/operations/credits/topups`：沿用预览的 `amount`、`channel`、`externalReference`，附 `previewToken`、`idempotencyKey`、`reason` 和 `currentPassword`。
- `POST /api/operations/credits/refunds`：沿用 `amount`、原充值 `entryId`、`channel` 和退款 `externalReference`，附 `previewToken`、`idempotencyKey`、`reason` 和 `currentPassword`。
- `POST /api/operations/credits/reversals`：沿用原账本 `entryId`，附 `previewToken`、`idempotencyKey`、`reason` 和 `currentPassword`。

`currentPassword` 只用于再次验证操作人，不存入数据库或账本。账户若在预览后变化，提交以 409 拒绝并要求重新预览；同一操作者的相同幂等请求返回已记账结果。外部编号重复、重复冲正或超额退款被拒绝。退款必须关联原 topup，累计退款不能超过未退款余额。原充值存在有效退款时必须先冲正关联退款，才能冲正充值。所有变化只追加 `credit_ledger`，不直接编辑余额。充值不会把负余额设为零，而是按充值金额自然抵减欠额；负余额仍阻止新的付费生成。

## 私有凭据读取

只有对目标用户范围有效的 `creditOperator` 可读凭据。使用 `POST /api/operations/credits/entries/:entryId/credential`，body 为 `{ currentPassword, purpose }`。服务端记录操作者、访问用途和时间，并以附件响应；admin、modelOperator 和 support 均无权读取。操作提交后凭据保存在 `data/privateCredits/evidence/` 下，目录和文件权限分别为 0700 和 0600，不通过静态文件或 media 路由开放。未配置凭据历史清理期限；该期限需运营与隐私政策确认后另行实现。

V1 此接口只登记外部/线下凭据对应的积分事实；不创建平台订单、支付、退款、会员、佣金或审批记录。
