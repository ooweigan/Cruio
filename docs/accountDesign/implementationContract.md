# Cruio 账户实现统一协议

日期：2026-11-02。开发任务依据用户最新授权启动。所有开发智能体以本文件和 `@toonflow/server/accountProtocol` 类型为唯一协议来源；修改契约须先由主线程同步所有调用方。

## 浏览器与客户端内置服务

保留 `{ code, data, message }` 响应结构及真实 HTTP 状态。错误 `data` 使用 `AccountErrorData`，不把上游报错或凭证原文传给页面。

| 方法及路径 | 输入 | 成功 data |
| --- | --- | --- |
| GET `/api/account/bootstrap` | 无 | `AccountBootstrap`，公开安全字段，不含模型凭证 |
| GET `/api/account/session` | 本地 HttpOnly Cookie | `AccountSession`；无会话返回 anonymous，账户和模型状态分开 |
| POST `/api/account/login` | `AccountLoginRequest` | `AccountSession`；设置本地会话 Cookie，已有不同身份必须先退出 |
| POST `/api/account/logout` | 当前本地 Cookie | `AccountLogoutResult`；本地清理完成，远端撤销结果单独表达 |

本地 Cookie 为 HttpOnly、SameSite=Strict，校验请求来源；生产 HTTPS 使用 Secure。客户端不能自行指定 `userId`、角色或模型凭证。前端请求使用已有 `x-toonflow-workspace: 1`，该请求头不是认证凭据。`contextId` 是不可变会话上下文标识，用于拒绝旧异步结果，不是密钥。

所有受保护的非 GET/HEAD 请求必须带 `x-cruio-context: <操作开始时的 contextId>`，缺失或不匹配返回 409 accountConflict。GET/HEAD 提供该头时同样核对。logout 有本机会话时也必须匹配该头，没有会话时幂等成功。失效保存沿用原 contextId。

`AccountBootstrap` 的空链接不渲染为可点击按钮；不能使用假地址或跳转 NewAPI。未配置身份服务时如实显示不可用，不启用本地假登录。

## 状态及错误

会话状态：`anonymous`、`authenticated`、`expired`、`disabled`。模型状态：`available`、`notProvisioned`、`unavailable`。时间均为 ISO 字符串，匿名会话的用户、上下文和有效期为 null。

401 仅在 `sessionExpired` 时触发已有工作区的失效提示；登录的 `invalidCredentials` 只显示表单错误。`accountDisabled` 为 403。503 表示服务未配置或不可达。429 使用 `rateLimited` 及可选秒数 `retryAfter`。模型授权问题不自动退出 Cruio 会话。

## 前端共同入口

主线程维护 `apps/web/src/stores/account.ts`，页面不得分别维护登录凭证或直接拼接口。

公开 ref：`accountSession`、`accountBootstrap`、`accountBusy`、`accountError`、`accountReady`、`accountDataReady`、`logoutRequested`。`accountDataReady` 仅在个人设置加载成功后置为 true，不以身份登录成功冒充初始化完成。

公开 computed：`isAuthenticated`、`requiresReauthentication`。

公开函数：`loadAccount(navigate = false)`、`loginAccount(account, password)`、`logoutAccount()`、`requestLogout()`。登录和退出失败抛出可读 Error；启动与重新连接的 `loadAccount` 将错误记录到 `accountError`，保证登录页可显示恢复入口。登录成功但设置加载失败时，可重新加载或退出，不重复提交登录请求。登录成功后的设置装载、导航和队列隔离由主线程统一接入，页面不重复导航。

账户对话框额外使用 `apps/web/src/lib/accountWorkspace.ts`：`hasUnsavedAccountWork`（computed）、`saveAccountWork()`、`finishAccountWork(discard: boolean)`、`accountWorkFinished`，以及内部注册保存/清理回调的入口。已连接现有文档与画布的保存/取消逻辑；保存失败保留内容。收尾成功冻结业务请求，退出网络失败时只能重试退出，不能继续编辑已取消的保存上下文。文件实例绑定登录生命周期，旧实例在退出后即使再次登录同一账号也不可复用。

## 分工与文件所有权

- 主线程：共享类型与契约、前端账户状态、启动和路由、保存收尾与全局集成、跨边界收敛。
- 登录智能体：`pages/hello/index.vue`、登录页专属素材和样式。复刻已选 `creativeLogin.png`，不修改公共 Store、路由或服务端。
- 面板智能体：`components/settings/panels/account.vue`、`components/accountDialogs.vue`、设置分类接入。复刻四张深化稿，不修改主线程公共文件。
- 服务端智能体：`apps/server` 中账户接口、鉴权、个人配置和调用上下文；共享类型和 package exports 由主线程维护。
- 最后独立验收智能体：基于实际代码与浏览器、现有 typecheck/build、必要手动 HTTP 验证出具验收结果；不新建测试模块、mock、临时测试文件或自检脚本。

身份服务来源已由用户确认：采用仓库内 `apps/admin` 最小独立账号服务。后续新增的账户管理页面也由该服务在 4310 提供，运行及管理权限见 `accountService.md`。可持久恢复、安全存储及 NewAPI 撤销能力必须按实际支持范围验收，不用内存会话冒充跨重启恢复。

## 可信身份服务与客户端内置服务

`apps/server/src/utils/account/config.ts` 的 `serviceUrl` 统一指向独立可信身份服务，随客户端构建，用户无需在启动命令中配置；生产必须 HTTPS，开发仅允许回环 HTTP。以下契约已由仓库内 `apps/admin` 实现；是否完成实际部署及 NewAPI 联调须另行验证。

- `POST /api/account/login`：接收 `{ account, password }`。
- `GET /api/account/session`：通过 `Authorization: Bearer <token>` 验证当前身份、停用及模型授权状态。
- `POST /api/account/logout`：通过同一 Bearer 凭证撤销当前会话，返回 `{ code: 200, data: { remoteRevoked: boolean }, message: string }`。只有云端会话及关联模型授权均确认撤销才返回 true；手动配置的静态 NewAPI 凭证无法撤销时返回 false，不能把仅清除 Cruio 会话称作全部远端授权已撤销。

登录与会话验证成功返回 `{ code: 200, data: grant, message: string }`。`grant` 的结构如下：

```ts
type AccountGrant = {
  token?: string; // 登录必填；会话验证可省略以沿用原 token。
  user: { id: string; displayName: string; account: string };
  expiresAt: string; // ISO UTC，到期时间必须晚于当前时间。
  modelAccess: { status: "available" | "notProvisioned" | "unavailable"; message: string };
  modelCredential: null | { apiKey: string };
};
```

`available` 必须附带用户专属 Key，只表示已绑定，不证明上游调用成功。`modelCredential: null` 表示未绑定 Key。模型目录为客户端已接入目录，权限全部由 NewAPI 按 Key 执行；不再下发或执行 Cruio 的 `modelIds` 允许清单。调用地址沿用本机服务已有的 Cruio 供应商配置。账号服务负责身份、密码、停用、会话和 Key 绑定，不调用 NewAPI 管理接口或下发管理员凭证。旧客户端须随账号服务一起更新。401 登录失败映射 `invalidCredentials`，验证失败映射 `sessionExpired`；403 表示账号停用；429 支持秒数 `Retry-After`。其他异常归类为账户服务不可用，不向页面透传上游报文。

本地服务仅在受控内存保存 token 与模型凭证，页面只取得 `AccountSession`。每个本地进程只有一个当前身份；有效会话不能被 login 覆盖，失效后仅可重登同账号且须核对稳定 user.id，不同账号必须先 logout。重登创建新的 contextId，保留页面文档由前端按稳定身份协调。进程重启需要重新登录。会话接口每次查询真实身份服务，断网不误清凭证；本地接口仍受最后验证的 expiresAt 限制。

失效或停用保存收尾仅支持首次失效后 5 分钟内、当前保留原 Cookie 的 `PUT /api/workspaces/files/write`：目标必须是本次会话先前成功读取或写入过的规范路径、仍为已有普通文件且非 exclusive 新建。目录和路径权限、冲突检查继续执行。其他读取、目录操作、模型调用及新项目操作仍被拒绝。每次会话最多记录 1000 个已访问文件，不删除或迁移旧文件。

普通模型请求、媒体调用和 Agent 每轮模型执行最多复用 30 秒在线验证。超过该窗口后必须重新验证会话；网络失败拒绝新模型调用，账号停用或撤销终止现有本机任务。该窗口不等于即时撤销已提交到 NewAPI 的任务或静态令牌。

本轮尚未绑定账户的管理入口由服务端拒绝：供应商源码及配置、插件安装/修改/卸载、MCP、A2A、设备互联、远端团队接入、开发工具。现有节点/工具/扩展目录读取和本地创作保留；后续开放必须单独补身份绑定，旧 token 不能替代 Cruio 身份。

个人快照存放在 `data/accounts/<sha256(user.id)>/preferences.json`，使用原子写入。素材及个性化文档采用相同账号目录；旧 settings、素材与 localStorage 不自动导入首个账号。可保存字段为 ui、general、privacy、personalization、agentSystemPrompt、stores、updateBoxSeenBuilds；stores 仅允许 toonflow.projectList、toonflow:documentLayout: 和 toonflow:documentTree:。settings GET 的 customProviders 是只读无密钥元数据，PUT 不能提交。
