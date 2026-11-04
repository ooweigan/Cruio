# Cruio 独立账户服务

## PostgreSQL 账户存储（2026-11-04）

账户服务已改用 Bun 内置 SQL 驱动连接 PostgreSQL，不再读写 JSON 作为运行时账本。账号、密码哈希、加密 Key 与绑定字段位于 `accountUsers`，会话位于 `accountSessions`，版本、加密密钥指纹及迁移来源摘要位于 `accountMeta`。表名和字段名使用带引号的小驼峰。

- 本机使用已有 `light-pg` 的 PostgreSQL 18.3，独立数据库 `cruioIdentityDev`；不修改已有 `cruio_dev` 业务表。连接配置位于被 Git 忽略的 `apps/accountService/.env`，权限 0600。仍使用 `bash startAccount.sh` 启动。
- 服务器使用官方 PostgreSQL 18.3 Alpine，容器 `cruioPostgres`，仅绑定 `127.0.0.1:5432`，数据库 `cruioIdentity`。应用使用独立非超级用户，不使用数据库超级用户连接。
- 两端通过 `CRUIO_IDENTITY_DATABASE_URL` 配置连接；`CRUIO_IDENTITY_DATA_DIR` 继续保存 `credentialKey.bin`。数据库保存 Key 密文和带密钥的指纹，账号、Key 指纹及 New API 客户/Key ID 均有唯一约束，会话引用账号外键。
- 登录、会话验证直接查询数据库，不使用进程内账户快照。管理修改和会话写入使用数据库事务锁，跨进程保护重复绑定、最后管理员及会话数量限制。锁内不执行密码哈希或网络请求。当前写操作串行、管理列表仍一次读取全部账户；高吞吐时可进一步拆分锁并将列表分页下推 SQL。
- PostgreSQL 不可用时请求失败，不回退写入 JSON。限频仍在各进程内存中，多实例部署前需要共享限频或代理层防刷；本次生产仍运行一个账户服务实例。

新环境先配置数据库 URL 和独立绝对数据目录，再显式执行：

```sh
bun run --cwd apps/accountService manage initialize
```

已有 JSON 数据必须停止旧版账户服务、同时备份 `accounts.json` 与 `credentialKey.bin`，使用原数据目录执行：

```sh
bun run --cwd apps/accountService manage migrateJson
```

迁移先验证旧数据、解密可读性和约束，再在同一个事务内写入所有账号、会话及迁移标记。保留账号 ID、原密码哈希、Key 密文和会话哈希；原文件不修改。相同来源重复执行不重复导入，来源变化或非空目标库拒绝覆盖。正常启动不自动初始化或迁移，数据库中的密钥指纹与本机文件不匹配时拒绝启动。

普通运营 CLI 现可与 PostgreSQL 版服务同时运行；只有旧 JSON 迁移需要停止旧服务。备份须同时保留 PostgreSQL 一致性导出与匹配的 `credentialKey.bin`。迁移后产生新数据时，不得直接切回旧 JSON，否则会丢失迁移后的改动。

手动验证：临时数据迁移及重复执行通过；原密码哈希、Key 密文和会话哈希一致；真实管理登录和客户登录通过；双进程并发创建同名账号返回 303/409；跨进程撤销后旧会话返回 401；重复绑定返回 409 且未写入，最后管理员禁止停用。未新增测试模块。

本次两端已实际迁移：Mac 的 2 个原账户进入 `cruioIdentityDev`，原启动入口和运行中 CLI 均正常；临时服务重启后原管理员会话仍有效。服务器的 1 个账号、3 条原会话完整迁入 `cruioIdentity`，原密码登录、客户列表与退出正常，服务无异常重启。正常会话写入会清理已过期记录，迁移后会话数量因此可能减少。

服务器程序位于 `/opt/cruio/releases/postgres20261104`；systemd 的 `postgres.conf` 加载 `/etc/cruio/accountDatabase.env`。数据库镜像固定为 `postgres@sha256:54451ecb8ab38c24c3ec123f2fd501303a3a1856a5c66e98cecf2460d5e1e9d7`，数据挂载 `/var/lib/cruio/postgres`，内存上限 512 MiB，本次空闲观测约 51 MiB。密码配置均为 0600，仅 root 可读；数据库只监听回环地址。

停机备份与原配置在 `/root/cruioPgBackup20261104`，`account.tar.gz` 含原 JSON 与加密密钥，`afterMigration.dump` 是切换后的 PostgreSQL 导出。旧 JSON 和程序保留未删除。后续备份使用 `docker exec cruioPostgres pg_dump -U postgres -Fc cruioIdentity`，输出写入受限备份目录，并同时备份账户数据目录中的 `credentialKey.bin`；不要在线直接复制 PostgreSQL 数据文件。New API 仍使用原 SQLite，未改变其账户、余额和渠道。

## VIP 消费折扣与兑换充值

`codex/vipRecharge` 使用 New API 作为余额、会员分组和消费倍率的唯一来源。兑换码按面额对应的 quota 入账；例如普通组倍率为 1、VIP1 为 0.8，同样面额的兑换码到账相同，VIP1 在消费时按对应倍率扣费。客户端显示真实余额、用户组、Key 实际使用的分组和倍率。自动分组显示按实际分组计费，不假定固定折扣。用户专属分组倍率优先于普通分组倍率，沿用 New API 的 `GetUserGroupRatio`。

运营在 New API 后台配置用户组、倍率、客户和 Key。Cruio 后台创建账号后，在详情页点击“从 New API 获取客户”，选择客户、加载其 Key，再保存绑定。服务端核验 Key 归属、客户状态和 Key 是否停用或过期；同一 New API 客户只允许绑定一个 Cruio 账号。旧的手工 Key 绑定继续支持模型调用，重新选择客户与 Key 后才开通余额与兑换。更换或解除绑定会撤销原 Cruio 会话。

### New API 集成安装

源码位于 `integrations/newApi/cruio.go`，仅增加 `/api/cruio/*` 受限接口。安装器锁定已核对的 New API `v1.0.0-rc.47` 路由源码，升级上游版本前需重新核对；遇到不同的同名扩展文件会停止，不覆盖。完整源码仍由上游维护。

1. 准备该版本的 New API 源码，在 Cruio 仓库根目录执行：

   ```sh
   bun integrations/newApi/install.ts /path/to/newApiSource
   ```

2. 按 New API 原有构建流程构建前端和 Go 服务，然后发布包含扩展的版本。只更新 Cruio 账户服务不足以启用此功能。
3. 通过服务器的秘密配置渠道设置至少 32 个字符、无空白的随机专用密钥：New API 使用 `CRUIO_INTEGRATION_SECRET`，Cruio 账户服务使用相同值的 `CRUIO_IDENTITY_NEW_API_SECRET`。密钥只保存在两端可信服务，不发给客户端、不写入仓库。反向代理不得记录 Authorization 或请求、响应正文。
4. 为账户服务设置 `CRUIO_IDENTITY_NEW_API_URL`，内容为 New API 根地址，不带 `/v1` 或其他路径。同机部署可使用 `http://127.0.0.1:3001`；远程地址必须使用 HTTPS。该地址须与客户端已配置的 Cruio 模型服务指向同一个 New API 实例。
5. 在 New API 后台确认充值相关功能的启用条款，配置额度展示币种及汇率，然后生成兑换码；无需配置在线支付渠道。Cruio 使用同一币种与换算规则展示余额和到账额，不额外乘除会员系数。

接口包括可用客户的分页搜索、指定客户的 Key 元数据列表、绑定时的归属核验与 Key 读取、绑定账户余额及消费倍率查询、兑换充值。全部接口要求专用 Bearer 凭据，缺少配置时拒绝访问；列表不返回密钥，绑定接口只向可信账户服务返回密钥，随后按既有方式加密保存。扩展不提供修改余额、创建客户、修改分组、创建或删除 Key 的能力。

### 客户端与账务边界

- 本地 `/api/account/wallet` 和 `/api/account/redeem` 复用现有登录、同源与账号上下文校验，经云端账户服务确定目标用户。客户端只能提交兑换码，不能指定到账客户、金额或折扣。
- 兑换复用 New API 的 `model.Redeem`，在原数据库事务内核销兑换码并入账，同时刷新其缓存和充值流水；Cruio 不新增余额账本。
- 单个 Cruio 账号每分钟最多提交 5 次兑换；不自动重试。遇到超时或未知结果时提示先刷新余额，不能将未知结果冒充“未扣码”。
- 会员等级变化后，余额数值不变，后续模型消费使用 New API 当前有效倍率。Key 固定分组、用户可用分组和用户专属倍率可能影响最终折扣，需一起配置。
- 用户钱包与 Key 自身限额不同。充值增加用户钱包，不会增加 Key 的独立额度；由运营将 Key 配置为无限额度或设置合适的限制。
- 服务器部署进度以下方发布记录为准；客户端仍需使用本分支版本，旧客户端不会自动出现充值入口。

### 2026-11-04 服务器发布

账户后台与 New API 扩展已部署至 `121.4.92.111`。管理入口仍为 `https://cruio.onebeget.com/admin`，New API 仍为 `https://cruiorouter.onebeget.com`。此次未部署网页版创作客户端，也未重打包桌面客户端。

- 账户服务发布目录为 `/opt/cruio/releases/vip20261104`，`/opt/cruio/current` 指向该版本。生产模式在构建时显式定义；systemd 通过 `/etc/cruio/accountIntegration.env` 加载仅服务端持有的专用集成配置。
- New API 使用原 rc.47 镜像作为基础层替换扩展后的程序，镜像为 `cruio/newapi:vip20261104`，状态版本为 `v1.0.0-rc.47+cruioVip`。继续只映射 `127.0.0.1:3001`，复用原数据目录及运行密钥。
- 停机一致性备份位于 `/root/cruioVipBackup20261104`，含账户与 New API 数据、原配置和容器信息。原账户程序仍保留；旧容器 `cruioNewApiBeforeVip20261104` 已停止并禁用自动重启，不得与新容器同时挂载运行。
- 公网管理登录、客户选择器、2 个客户的 3 个 Key 列表及人民币钱包读取通过；发布前后用户数 2、Key 数 3、渠道数 5 和余额总额一致。未自动绑定真实客户、调整分组或兑换真实充值码。
- 公网管理页与 New API 页面返回 200，匿名集成接口返回 403，匿名模型目录返回 401。额外读取生产模型 Key 并访问模型目录的检查被自动审批拒绝，未执行，不记为模型鉴权或调用已验证。
- 客户端充值完整链路已在下方临时环境验证；2026-11-04 Mac 安装包已切换生产账户服务及模型网关地址并重新构建。

### 本地验证记录（2026-11-04）

使用独立临时 SQLite 数据库运行已安装扩展的 New API rc.47、Cruio 账户服务及客户端内置服务，未连接生产账户执行充值。

- 真实 HTTP 链路完成客户搜索、所属 Key 列表、绑定、登录、余额查询与兑换。VIP1 倍率为 0.8，100 USD 面额兑换后余额从 0 变为 100 USD；再次兑换返回 400，余额仍为 100 USD。
- 无效兑换码、未登录请求、旧账号上下文、重复客户绑定、跨客户 Key、缺少集成密钥和错误 CSRF 均被拒绝。后台列表与选择页未返回 Key 明文。
- 浏览器确认后台能够选择客户及所属 Key；客户端“我的账户”显示 100 USD 余额、vip1 会员组、8 折和兑换码入口。
- Cruio 类型检查及相关构建通过，New API 扩展与完整 Go 服务编译通过。未发起收费模型请求，实际模型消费扣费仍需部署后的渠道验收。

## 2026-11-04 本机 NewAPI 数据同步完成

本节优先于下方初始化记录。已将本机 v1.0.0-rc.44 的一致性数据库快照迁入服务器 v1.0.0-rc.47，保留用户密码、额度、调用令牌、渠道密钥及模型计费配置。5 个渠道、2 个用户、3 个令牌、30 条渠道模型关联（24 个不同模型）已逐表核对一致；独立 models 表原本为空，模型来自渠道配置。使用迁移令牌访问正式域名 /v1/models 返回 200 和 24 个模型，未发起收费生成请求。

- 服务器使用本机原有账号密码；初始随机管理员密码已失效，归档在 /root/cruioNewApiMigration20261104/previousAdminPassword。Cruio 账户服务账号未改动。
- 迁移副本清除了旧登录会话、访问会话令牌和临时认证流程，保留业务调用令牌；沿用源加密密钥，正式地址及 Passkey 来源改为新域名，公开注册保持关闭。
- 服务器迁移前数据库、环境配置及源迁移副本位于 /root/cruioNewApiMigration20261104/，权限仅 root 可读。旧容器 cruioNewApiBeforeSync 已停止并关闭自动重启；回滚必须先恢复数据库和匹配环境，不可直接启动共享数据目录的旧容器。
- 本机原目录曾随项目改名移至 /Users/cheng/Projects/cruioBackup20261021/data/newApi，导致停止后无法重新挂载。已保留原文件并复制回当前项目 data/newApi，恢复服务；源快照完整性检查及本机健康接口通过。
- 尚未完成：全部渠道实际生成验证、Cruio 用户 Key 绑定、客户端正式地址切换。此次仅同步 NewAPI，不迁移 Cruio 账户。

## 2026-11-04 独立 NewAPI 域名定稿

用户新增 DNS 主机记录 `cruiorouter`，确认两项服务同机、分域名提供访问。以下为当前地址，取代下方历史 `/tokenrouter` 方案：

| 用途 | 当前地址 |
| --- | --- |
| Cruio 账户后台 | `https://cruio.onebeget.com/admin` |
| Cruio 账户服务 | `https://cruio.onebeget.com`，保留 `/api/account/*` 协议 |
| NewAPI 管理页面 | `https://cruiorouter.onebeget.com` |
| NewAPI 文本模型基址 | `https://cruiorouter.onebeget.com/v1` |
| NewAPI 媒体根地址 | `https://cruiorouter.onebeget.com` |

- 两个域名均指向 `121.4.92.111`，Nginx 在本机转发到 4310、3001；业务端口仍只监听回环地址。旧 `/tokenrouter` 路由已移除，返回 404。
- 新域名正式证书已签发，到期日 2027-02-02，共用已启用的续期定时器和重载钩子；此前续期演练连接失败仍为待复验项。
- NewAPI 管理员 `admin` 已通过正式初始化接口创建，独立随机密码在服务器 `/root/cruioAccess/newApiPassword`（0600）；Cruio 管理员密码仍在 `/root/cruioAccess/accountPassword`。不将密码写入仓库或聊天。
- 关闭 `RegisterEnabled`、`PasswordRegisterEnabled`，由运营手工建号；不启用自用模式或演示模式。`ServerAddress` 设为正式 NewAPI 域名。
- 已开启 `SESSION_COOKIE_SECURE=true`，可信来源限定新域名；`TRUSTED_PROXIES` 限定实际 Docker 网桥代理地址 `172.17.0.1/32`，Nginx 覆盖客户端传入的转发头。旧容器 `cruioNewApiBeforeHttps` 保留但停止、禁用自动重启；配置备份为服务器 `/etc/cruio/newApiBeforeHttps.env`。
- 已验证：NewAPI 初始化成功、真实管理员登录和正常退出、关闭注册；公网两端页面 200、未带 Key 的 `/v1/models` 为 401；登录页面引用的全部 JS/CSS 均为 200 且内容类型正确。公网 `/api/setup` 只允许读取状态，禁止再次提交初始化。
- 内置浏览器两次打开页面超时，因此没有记录浏览器交互验证通过。未创建测试文件，未发起模型生成。
- 后续仍需：用户 Key 与 Cruio 绑定（上游渠道已由上方同步记录完成），替换客户端本机联调地址、端到端生成验证和异机备份。当前客户端配置未切换，不冒充新服务器已有可用模型。

## 历史：2026-11-04 同域名前缀方案

用户指定 `cruio.onebeget.com`，NewAPI 模型接口使用 `/tokenrouter` 前缀。域名 A 记录已解析到目标服务器，已签发有效的 Let's Encrypt 证书（到期日 2027-02-02），启用 `certbot-renew.timer` 与续期后的 Nginx 配置校验、重载钩子；旧 numi 域名续期配置已移入旧部署备份目录。

续期演练连续两次在连接证书测试服务时收到 `ConnectionResetError(104)`，尚未通过，不能记录为续期已验证。现有正式证书签发和公网 HTTPS 验证成功，不受此次演练失败影响；后续需复验测试环境网络和自动续期。

- Cruio 管理入口：`https://cruio.onebeget.com/admin`，根路径跳转至该入口；账户协议保持 `/api/account/*`。
- NewAPI 文本调用基址：`https://cruio.onebeget.com/tokenrouter/v1`；当前代理开放 `/tokenrouter/v1/*` 与媒体适配使用的 `/tokenrouter/doubao/*`，去掉 `/tokenrouter` 后转发到本机 3001。流式响应关闭代理缓冲。
- 已初始化 Cruio 管理员 `admin`，独立随机密码保存在服务器 `/root/cruioAccess/accountPassword`，权限 0600。文件仅供管理员经 SSH 查看，不复制到仓库或聊天。NewAPI 管理员与渠道尚未初始化。
- 已从客户端网络验证：有效证书下管理页 200、未登录账户接口 401、未带 Key 的模型目录接口 401；`/tokenrouter/api/setup` 返回 404，不能从公网抢先初始化。服务器本地实际管理员登录返回 303。
- 当前 NewAPI `v1.0.0-rc.47` 前端使用根路径资源和路由，不能仅靠前缀反代完整承载 `/tokenrouter` 管理界面。已询问用户采用独立管理子域名、SSH 隧道，或明确接受额外适配；等待决定期间只开放模型接口，不开放管理及初始化入口。
- 客户端正式地址替换、NewAPI 上游渠道及用户 Key、两端实际生成联调、异机备份仍未完成。配置模型之前不把旧客户端的可用本地模型配置自动迁移到空的新服务。

## 2026-11-04 云服务器准备记录

用户确认将 Cruio 账户后台与 NewAPI 同机部署，并授权停止原业务。目标服务器为 `121.4.92.111`，OpenCloudOS 9.4 x86_64，约 4 GB 内存。当前仅完成服务器端安装与本机 HTTP 验证，尚未正式对外上线。

- 旧 `numi-api` 已通过 PM2 停止并保存停止状态；旧 Nginx 已停止并禁用开机启动。旧代码、代理配置、证书与 PM2 原配置备份在服务器 `/root/cruioMigration20261104101628/previousDeployment.tar.gz`，原目录未删除。此为同机回滚备份，不替代异机灾备。
- Cruio 使用 systemd 单元 `cruioAccount.service`，以独立 `cruio` 系统用户运行，开机启动；程序位于 `/opt/cruio/current/`，账户数据位于 `/var/lib/cruio/account/`，仅监听 `127.0.0.1:4310`。
- 账户服务与管理 CLI 从当前源码交叉编译为 Linux 独立可执行文件。服务构建必须显式使用 `--define 'process.env.NODE_ENV="production"'`；仅设置 systemd 环境变量不足以纠正构建期已替换的值。首份产物发现 HTTP 限制未生效，已替换并复验。首次归档 `cruioAccountRelease.tar.gz` 不作为后续回滚版本，最终服务产物为 `cruioAccountService.gz`（SHA-256：`73f80c230731af505df2cf14fb7fec807c9ade1842f20c80ede900c164ad5905`）。
- NewAPI 容器名 `cruioNewApi`，仅映射 `127.0.0.1:3001`，数据目录 `/var/lib/cruio/newApi/`，使用独立 SQLite。运行密钥存于 `/etc/cruio/newApi.env`，不写入仓库。设置容器自动重启和日志轮转。
- NewAPI 使用官方文档指定镜像，固定摘要 `calciumion/new-api@sha256:938fa2713d4946723c9e9ce3076351c33f7770699fec92d23f3a26fd95791026`；状态接口报告 `v1.0.0-rc.47`，属于候选版本，正式发布前须确认版本选择和模型兼容性。
- 实际验证：账户服务正常运行、无自动重启；纯 HTTP 请求返回 403，可信本机代理声明 HTTPS 后管理登录页返回 200，未登录会话查询返回 401；账户文件权限为 0600。NewAPI 状态接口成功，初始化接口显示管理员尚未创建。SSH 与系统基础服务保留。
- 待完成：确定域名与备案状态、配置正式 HTTPS 代理、初始化两套管理员、运营配置 NewAPI 上游和用户 Key、绑定 Cruio 账号、异机备份、修改客户端正式地址及端到端验证。没有迁移本机真实账户、模型 Key 或项目文件；当前两个业务端口均未对公网开放。

本机编译记录：账户服务 `bun run typecheck` 通过。未创建测试文件，未发起收费模型调用。

更新：2026-11-03。实现位于 `apps/accountService`，沿用 Bun、TypeScript、Express、Zod 和 `@toonflow/file`。本服务负责身份验证，并在同一个 4310 服务的 `/admin` 提供账户管理页面；客户端内置服务通过统一协议连接。没有公开注册、默认账号、默认密码或共享模型密钥。

## 部署与启动

本机日常启动可直接在仓库根目录运行 `bash startAccount.sh`；默认使用 `$HOME/.cruio/accountService` 数据目录及 4310 端口，也保留已有环境变量设置。首次授权已有账号时运行 `bash startAccount.sh --admin demo`，管理员设置成功后才启动服务，密码不变；无需每次重复授权。脚本不创建账号、不重置密码，也不自动停止正在运行的服务。终端显示后管地址后即可访问，按 Ctrl+C 停止。

从仓库根目录显式安装工作区依赖；安装不绑定到启动和构建命令。仓库的 `apps/*` 已包含此包。

```sh
bun install --ignore-scripts
export CRUIO_IDENTITY_DATA_DIR=/srv/cruioIdentity
export CRUIO_IDENTITY_PORT=4310
# 通过受限环境文件提供 CRUIO_IDENTITY_DATABASE_URL；首次建库或旧 JSON 迁移见上方 PostgreSQL 章节。
bun run --cwd apps/accountService start
```

数据目录必须为专用绝对路径，建议位于代码仓库和 Web 静态目录之外。服务固定监听 `127.0.0.1`；开发可用回环 HTTP。生产设置 `NODE_ENV=production`，在同机部署带有效证书的 HTTPS 反向代理。仅当代理固定从回环地址连接且覆盖客户端提供的转发头时，设置 `CRUIO_IDENTITY_TRUST_PROXY=loopback`。代理须覆盖 `X-Forwarded-Proto` 和 `X-Forwarded-For`，禁止将账户服务端口直接对公网开放，禁止记录请求体、Authorization 和响应体。

生产模式会拒绝未被识别为 HTTPS 的请求。不要用关闭生产模式或信任任意代理解决部署错误。服务不设置浏览器 CORS；`/api/account/*` 仍拒绝带 Origin 的请求，客户页面应调用 Cruio 内置服务。管理页面 `/admin` 使用独立的同源表单、CSRF 校验和 HttpOnly Cookie。

客户端账户服务地址统一维护在 `apps/server/src/utils/account/config.ts` 的 `serviceUrl`，浏览器开发和桌面客户端复用同一份配置，随客户端一起构建，不再读取 `CRUIO_ACCOUNT_SERVICE_URL`。当前地址为 `https://cruio.onebeget.com`，用户不需要填写地址或设置启动环境变量。该地址不是 NewAPI 地址。帮助、协议、隐私链接继续由客户端的 `CRUIO_ACCOUNT_SUPPORT_URL`、`CRUIO_ACCOUNT_TERMS_URL`、`CRUIO_ACCOUNT_PRIVACY_URL` 提供。

浏览器开发时运行 `bun run dev`，打开前端开发地址 `http://localhost:5173`，账户默认连接生产服务。

### macOS 客户端体验包

当前首版目标为 Apple Silicon Mac，沿用 `apps/desktop`。打包命令为 `bun run package:desktop`，安装镜像输出至 `build/desktop/artifacts/macArm64/macos-arm64-cruio.dmg`。首次准备开发环境时显式执行 `bun packages/startup/scripts/buildMac.ts` 与 `bun apps/desktop/node_modules/electrobun/bin/electrobun.cjs prepare --env=stable`，不需要用户在安装时操作这些命令。

镜像提供“拖到 Applications”的安装引导，直接携带完整应用，首次打开进入账号登录与现有项目流程，不另加欢迎向导。客户端内置本地业务服务并自动分配回环端口，关闭主窗口或退出时先清理连接和浏览器运行时，再结束进程；无需另起 3000/5173 服务。数据仍按仓库约定保存在 `.app` 所在目录的 `data/`，更新应用包不覆盖该目录。

当前账户服务连接 `https://cruio.onebeget.com`，模型网关连接 `https://cruiorouter.onebeget.com`（文本接口使用 `/v1`），无需运行本机账户服务及 NewAPI。旧体验包保存的 localhost/127.0.0.1:3001 网关配置会自动迁移到生产地址，其他自定义地址保留；显式 `CRUIO_NEW_API_URL` 配置优先。本轮未完成正式签名、公证。首版 Mac 客户端仅通过安装包更新，不接收 Toonflow 上游更新包。Windows 与 Intel Mac 不属于本轮安装验证范围。

2026-11-04 开发验证：重新完成 `package:desktop`，DMG 校验通过；核对最终归档内账户地址和文本、媒体网关均指向生产。服务端与供应商包类型检查通过，手动验证旧本机网关配置迁移及自定义地址保留。本轮未执行真实模型消费请求。

2026-11-03 开发验证：`package:desktop` 完成，镜像校验通过；从最终镜像复制应用到用户的 `~/Applications/cruio.app` 后，原生窗口正常显示 Cruio 登录页。验证关闭窗口后 launcher、Bun 进程及业务监听端口退出，重新启动可再次显示登录页。桌面端和服务端类型检查通过。本轮未重新提交视频生成任务，真实模型调用链路沿用用户已确认跑通的结果。

`CRUIO_IDENTITY_SESSION_HOURS` 默认 8，支持 1–168 小时整数。会话不会在验证请求中无限滑动续期；每个用户最多保留最近 10 个会话。独立服务重启后仍可验证尚未过期的会话；当前客户端只在内存保留远端令牌，客户端进程重启仍须重新登录。

构建和类型检查分别为 `bun run --cwd apps/accountService build`、`bun run --cwd apps/accountService typecheck`。构建产物在包内 `dist`，使用外置依赖；部署须保留工作区依赖，不能单独拷贝一个 JS 文件即视为完整安装。

## 运营开通

日常管理可在 `/admin` 完成，不需要停止服务。PostgreSQL 版运营 CLI 可与服务同时运行，事务保护并发修改；首次旧 JSON 迁移仍须停止旧服务。运维命令须使用与服务一致的数据库连接和加密密钥目录。

已有 `demo` 账号可以显式设为管理员，密码保持不变：

```sh
export CRUIO_IDENTITY_DATA_DIR="$HOME/.cruio/accountService"
bun run --cwd apps/accountService manage makeAdmin demo
bun run --cwd apps/accountService start
```

随后打开 `http://localhost:4310/admin`，使用 `demo` 的原密码。也可用下表的 `createAdmin` 新建独立管理员。

创建账号时可指定显示名，省略时使用账号本身。密码至少 6 个字符，最大 1024 字符，不设置邮箱或手机号格式。账号大小写敏感，去除前后空格；账号稳定 ID 由服务生成。

以下 zsh 示例从终端隐藏读取密码，只经 stdin 传递，不把密码写入命令历史、进程参数或文件：

```sh
read -rs 'accountPassword?输入新账号密码：'
printf '%s' "$accountPassword" | bun run --cwd apps/accountService manage create 账号 显示名称
unset accountPassword
```

也可由秘密管理器直接向命令 stdin 提供密码。不能以参数传密码；不要在终端里使用包含真实密码的 `echo` 命令。密码输入最多移除一个末尾换行符。终端输入和命令退出后应清除临时变量；不要开启 shell tracing。

| 命令 | 标准输入 | 效果 |
| --- | --- | --- |
| `manage create 账号 显示名称` | 原始密码 | 建立新账号，不自动开通模型 |
| `manage createAdmin 账号 显示名称` | 原始密码 | 新建管理员，不自动关联 NewAPI |
| `manage makeAdmin 账号` | 无 | 将已有账号设为管理员，密码保持不变，撤销旧 Cruio 会话 |
| `manage resetPassword 账号` | 原始新密码 | 更新哈希、撤销该用户全部旧会话 |
| `manage disable 账号` | 无 | 停用账号；登录与存量未过期会话返回 `accountDisabled` |
| `manage enable 账号` | 无 | 重新启用并删除全部旧会话，旧令牌不能恢复 |
| `manage revoke 账号` | 无 | 删除全部 Cruio 会话，不删除账号 |
| `manage setModel 账号` | 原始 API Key | 加密绑定用户专属 Key，撤销原 Cruio 会话 |
| `manage clearModel 账号` | 无 | 移除模型授权，撤销原 Cruio 会话 |
| `manage list` | 无 | 仅列账号、名称、停用及模型配置标记，不输出秘密 |

上表命令均使用 `bun run --cwd apps/accountService` 前缀。例如 `bun run --cwd apps/accountService manage disable 账号`。缺失账号不会自动创建，重复账号不会覆盖。服务繁忙和写入失败会返回非零退出码，不打印密码、模型 Key 或数据库内容。

## 管理页面与 NewAPI Key 绑定

第一版按用户确认的线下流程工作：

1. 运营在 NewAPI 后台开通用户、创建 API Key，并配置该 Key 的模型权限、额度等。
2. 在 Cruio 管理页创建账号，填写 API Key 完成绑定；也可先创建账号，再在详情页绑定。
3. 客户使用 Cruio 账号登录。调用携带该账号的 Key，模型权限由 NewAPI 判定。

Cruio 不填写 NewAPI 用户 ID、用户名、实例地址或模型允许清单，也不调用 NewAPI 管理接口、索取管理令牌或核验用户映射。模型服务地址沿用本机服务已有的 Cruio 供应商部署配置（已有 `CRUIO_NEW_API_URL` 可覆盖），不是每个账号的绑定字段。

账户列表支持按 Cruio 账号、显示名搜索，以及筛选未绑定 Key、已停用账户。详情页提供绑定/更换/解除 Key、启停、重置密码、撤销 Cruio 会话。管理员授权仍通过本机 CLI 完成，最后一个可用管理员不能被停用。

一个 Cruio 账号绑定一个 Key，同一个 Key 不允许重复绑定其他账号。绑定与新建可一次原子保存；重复 Key 不会留下半创建的账号。Key 加密保存，已有 Key 不在页面回显。更换或解除绑定会撤销该账号的 Cruio 会话，不自动撤销 NewAPI 中的 Key。

“已绑定”只表示已保存 Key，不代表上游鉴权、余额或模型生成已经验证。无 Key 的账号可以登录，但不能生成；有 Key 时展示客户端已接入的模型目录，目录是调用适配清单，不是账户授权清单。Cruio 不保存或执行第二套模型允许列表；未授权模型由 NewAPI 拒绝。运营修改 NewAPI 中的模型权限无需重新填写 Cruio 账号资料。

管理 Cookie 为 HttpOnly、SameSite=Strict，生产增加 Secure；管理会话与客户会话区分用途，写入校验来源、CSRF、管理员权限与有效会话。旧加密凭证中的 Key 可继续读取，旧地址和 `modelIds` 不再参与调用地址或权限判断；历史 `newApiAccount` 元数据保留兼容读取，不再展示或使用。更新时需同时更新账号服务与客户端内置服务，旧客户端不能消费新的仅 Key 凭证协议。

页面预览见 [adminPreview.jpg](./adminPreview.jpg)。验证使用独立临时账户与临时 Key，不代表真实 NewAPI 调用已验收；不新增测试模块或测试脚本。

## 命令行绑定 Key

日常使用管理页面即可。CLI 的 `setModel` 从 stdin 读取原始 Key，不接收包含地址和模型清单的 JSON；配置好同一 PostgreSQL 连接和密钥目录后运行：

```sh
read -rs 'accountApiKey?输入该账号的 NewAPI API Key：'
printf '%s' "$accountApiKey" | bun run --cwd apps/accountService manage setModel 账号
unset accountApiKey
```

Key 只在账号服务与客户端内置服务之间传输，普通客户页面不取得 Key。`clearModel` 解除 Cruio 绑定；最终停用、撤销模型权限仍由运营在 NewAPI 完成。

## 接口与退出语义

接口均使用真实 HTTP 状态及 `{ code, data, message }`；字段协议见 `implementationContract.md` 的 `AccountGrant`。

- `POST /api/account/login`：接收严格 `{ account, password }`。成功下发 32 字节随机 Bearer token、稳定用户信息、ISO 到期时间及该用户模型授权。
- `GET /api/account/session`：验证 Bearer token 哈希、到期时间及停用状态；返回当前用户授权，不刷新到期时间。
- `POST /api/account/logout`：原子删除该 Bearer token 对应的 Cruio 会话。删除成功才响应；重复退出仍为成功。不影响其他设备的会话。

登录凭证错误为 401 `invalidCredentials`；会话无效为 401 `sessionExpired`；停用为 403 `accountDisabled`；限频为 429 `rateLimited` 并带 `Retry-After`；存储和其他内部异常为 503 `accountServiceUnavailable`。错误响应不回传输入、密码哈希、数据库详情或内部异常原文。

当前统一协议的 `remoteRevoked` 使用保守口径：仍有静态模型 token 的账号返回 `false`，表示**模型平台令牌未确认撤销**，并不表示 Cruio 身份会话仍有效。没有此关联凭证时返回 `true`。该字段保留为内部结果，客户端退出完成后直接返回登录页，不弹出模型令牌管理提示，也不宣称“所有设备已退出”或“NewAPI token 已撤销”。最终运营封禁时，还需在模型平台撤销对应独立 token。

## 历史：JSON 持久化与边界（已由 PostgreSQL 替代）

`accounts.json` 保存用户、Argon2id 密码哈希、AES-256-GCM 加密的模型凭证及 SHA-256 会话令牌哈希。随机令牌具有 256 位熵，不落盘原始会话令牌。密码哈希使用 64 MiB 内存、3 次迭代；未知账号同样执行密码验证，避免直接通过省略哈希操作泄露账号是否存在。

凭证加密密钥 `credentialKey.bin` 为初次初始化时生成的 32 字节随机值；GCM 关联数据绑定用户 ID，防止把一人的密文直接搬给另一人。目录权限 0700，文件权限 0600；Windows 部署还应使用主机 ACL。加密密钥和数据库同属受保护主机，不能防御拥有该主机运维权限的攻击者，也不能替代磁盘加密和秘密备份策略。

写入经 `@toonflow/file.writeAtomic`，先保存成功再替换内存快照。读入数据损坏、密钥缺失、文件过大时拒绝启动，不自动重建。正常停机清理进程锁；启动或 CLI 操作时，若 `processLock/owner.json` 指向的本机 PID 已不存在，则自动回收遗留锁后重新竞争排他锁。仍存活的 PID（包括被系统复用的 PID）、权限不足、锁信息缺失或无效均保留锁并提示人工核实；不按锁龄强制解锁。并发回收通过 `processLock/recovery` 串行化，若回收期间强制退出而留下该标记，也须人工核实后处理。数据目录仅支持本机单进程，不可由多台主机共享。

备份须在停机或同等一致性快照下同时保存 `accounts.json` 与 `credentialKey.bin`，用独立加密备份存储。恢复后保留同一密钥；丢失密钥无法恢复已绑定模型 token，不能生成新密钥假装成功。数据库与密钥一起泄露时，需在模型平台撤销 token、重置账号密码，并撤销全部 Cruio 会话。

本版限定单进程、最多 1 万账号、5 万会话、32 MiB 数据文件。使用内存限频：单来源每分钟 600 请求、登录每来源每 15 分钟 30 次、每账号每 15 分钟 10 次；最多 4 个并行密码验证。限频状态不会跨服务重启持久化，生产反向代理应补充持续防刷与访问日志脱敏；不能通过频繁重启服务规避限制。需要多实例、高可用或更大容量时，应迁移事务数据库与共享限频，不能共用此目录横向扩容。

本轮开发手动验证使用独立临时目录与专用端口；不会开通正式用户或配置真实模型 token。模型生成的真实联调仍需运营提供实际用户专属模型授权。

## 创作文件位置与首次使用

登录后，尚未设置创作位置的账户进入“选择创作文件存放位置”。选择一个已存在的文件夹（可在系统选择器中新建 `Cruio`），确认后创建 `公共素材/` 和 `项目/`。记录保存在本机当前账户目录中的 `creationLocation.json`，与运营账户服务的数据分开。

新建项目只填写名称，自动创建 `项目/名称/画布1.json` 和 `项目/名称/assets/`；同名不覆盖。后续画布沿用项目内创建流程。生成图片、视频沿用当前项目的 `assets/generated/`，引用公共素材时沿用复制到项目 `assets/imported/` 的流程。公共素材库读写改为选定位置下的 `公共素材/`。

已有项目使用首页“打开已有项目”选择，原文件不会移动。原账户素材目录若有文件，首次设置页显示原位置，用户可手动复制到新位置的公共素材目录。首次设置不会自动合并或删除历史文件。整个创作目录可以整体备份；换设备后选择备份目录，再打开其中已有项目。

位置在后续登录时检查；磁盘未连接、目录不存在或不可访问时重新显示引导。连接原磁盘后可重新检测，也可明确选择新位置。当前版本不提供可用目录间的自动迁移。项目名同时按 Windows 文件名约束校验，拒绝路径分隔符、保留设备名和末尾句点。

## Windows x64 本机打包

当前 Windows 安装器依赖 Windows 的 C# 编译器、PowerShell、系统 tar 和 NSIS，因此需要 Windows x64 电脑构建。Mac 构建产物不能作为 Windows 安装包使用。

准备 Windows 10/11 x64、Bun、Git 和 NSIS 3；确认 `.NET Framework` 的 `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` 可用。NSIS 默认读取 `C:\Program Files (x86)\NSIS\makensis.exe`，安装在其他位置时设置 `NSIS_PATH`。首次构建需要联网下载 SDK 和微软 WebView2 组件。

将包含当前改动的完整源码复制或同步到 Windows，在仓库根目录的 PowerShell 中执行：

```powershell
bun install --frozen-lockfile
bun apps/desktop/node_modules/electrobun/bin/electrobun.cjs prepare --env=stable
bun run package:desktop
```

后续源码更新后执行 `bun run package:desktop`；若依赖发生变化，先重新安装依赖。输出为 `build/desktop/artifacts/cruio-2.0.0-Setup.exe`，版本以构建配置或 `appVersion` 为准。双击安装器选择安装位置；安装器准备 WebView2 并创建 Cruio 快捷方式。首次启动登录后选择创作文件位置。

Windows 和 Mac 共用 `packages/assets` 的 Cruio 品牌资源；Windows 使用 `logo.ico`，Mac 使用 `logo.iconset`。Windows 应用标识为 `local.cruio.desktop`，安装记录为 `cruio.ini`，协议为 `cruio://`。当前体验版通过完整安装包更新，不接收 Toonflow 更新包。客户端首页、关于页、插件列表及更新提示已移除 GitHub 入口。

账户服务地址统一写在 `apps/server/src/utils/account/config.ts`，不通过用户启动命令传入。当前配置为生产地址 `https://cruio.onebeget.com`，模型网关为 `https://cruiorouter.onebeget.com`。Mac Apple Silicon 安装包已重新构建；Windows 安装包仍需在对应构建环境生成。

本次 Windows 改动只完成源码适配与共享 TypeScript 检查；Windows 安装、首次登录、中文目录、生成和卸载仍需在 Windows 真机验证。

## 启动动画与 Mac 重复图标

原生启动窗口使用 `packages/startup/assets/startup.json`，与网页加载动画及应用图标分别加载。当前动画已改为 Cruio 标志与圆点呼吸效果，保留 `loading` 和 `ready` 阶段：加载时循环，就绪后在 400 ms 内淡出。Windows 启动窗口标题同步为 Cruio。

应用标识统一为 `local.cruio.desktop`，但 macOS 允许同一标识的应用存在于多个目录；构建副本、安装镜像内的应用和旧自解压缓存可能产生重复图标。`package:desktop` 完成 Mac 打包后注销并删除生成的 `.app` 构建副本，保留 DMG 和更新归档；制作 DMG 时在推出临时卷后注销其中的应用，避免 Finder 重新登记。`build:desktop` 和开发运行仍保留可执行构建副本。

日常安装统一拖到 `/Applications/cruio.app`，更新时替换该位置，完成后推出安装镜像。这不构成跨所有磁盘目录的单实例运行锁。
