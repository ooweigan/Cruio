# V1 当前开发状态

本文只记录截至 2026-09-29 已落盘和已执行的工作。MVP范围按用户最新决定：不以前置市场profile、M14治理review或隐私流程阻断模型主链；本地适配器stub验收不代表真实供应商渠道已联测或开放。

## 已落盘

- 本地开发启动：在 `apps/server` 运行 `bun run dev`（PostgreSQL `cruio_dev` 和 macOS Keychain 项 `cruio-dev-postgres`/`cruio_app` 需已配置）。默认不启动生成 worker；需显式设置 `CRUIO_GENERATION_WORKER_ENABLED=true`。模型映射的 `credentialRef` 指向服务端环境变量名，密钥值只放 server 环境，不写进数据库/前端。运营入口为模型 `/models` 与积分 `/operations`；modelOperator 和 creditOperator 分别授权，admin 不自动继承。视频模型还要求本机可用 ffmpeg/ffprobe（`CRUIO_FFMPEG_PATH`、`CRUIO_FFPROBE_PATH` 或 `data/ffmpeg/<platform>-<arch>/`）。
- 当前本地 server 已重启并加载最新代码，生成 worker 显式关闭；`http://localhost:3000/api/health` 和 `http://localhost:5173/api/health` 均返回 `database connected`。

- 独立 `createApp` 显式挂载私有媒体和生成/积分路由，登录校验使用 `response.locals.user`，共享数据库放在 `response.locals.database`。没有启用 `core.ts`/`router.ts` 的旧路由扫描，避免把桌面旧 API 意外暴露到 SaaS。
- `createApp({ database, dataDirectory, storageDirectory, generationConfigFile })` 支持隔离数据库和存储目录；默认私有媒体路径由源码/构建目录定位到仓库 `data/privateMedia`，不依赖 `process.cwd()`；媒体路由保留 HEAD 在 GET 前的顺序。
- 数据库 migration 5 增加 `media_assets`；migration 6 增加模型目录、积分账户与追加式账本、报价、任务、任务结果及作品关联；migration 7 补齐缺列并建立采用记录；migration 8 增加 worker lease、供应商请求/用量和尝试记录、任务级 `reserved_delta` 及结算/释放唯一约束；migration 9 保存采用请求/提交版本和正式输出快照；migration 10 增加岗位授权、人工积分操作、独立私有凭据和预览记录；migration 11 增加作品软删除；migration 12 增加用户与运营任务事件；migration 13 增加邮箱验证/密码找回 Token、安全事件；migration 14 增加通知回执和客服工单；migration 15 增加模型适配器版本、配置版本和当前版本唯一指针；migration 16 增加显式市场、模型版本市场核验、管理审计和 `privacyOperator` 岗位；migration 17 建立隐私请求、对象处置状态和事件表。已应用迁移不得改写或通过清空 schema 重跑。
- 媒体 API：`POST /api/media/upload`、`GET /api/media/list`、`HEAD|GET /api/media/read?id=...`、`GET /api/media/status?id=...`、`DELETE /api/media/retract?id=...`。当前仅接受 PNG/JPEG/WebP/GIF 图片，最大 20 MiB；服务端完整解码并将文件以私有权限写入。视频和音频上传明确拒绝。
- 生成/积分 API 已挂载：`GET /api/generation/models`、`POST /api/generation/quotes`、`POST /api/generation/tasks`、`GET /api/generation/tasks?projectId=...`、`GET /api/generation/tasks/:taskId`、`GET /api/credits`、`GET /api/credits/ledger`、`POST /api/generation/results/:resultId/adopt`、`GET /api/generation/results/:resultId/read`、`POST /api/works`、作品下载与软删除。运营路径按岗位及用户 scope 校验，不继承登录会话中的角色缓存。
- 报价读取已保存的项目画布或绑定工作流快照，服务端核当前版本、节点是否存在及图片/视频生成节点类型；读取节点 prompt/参数和具名输入端口，检查所选能力参数白名单及当前用户仍有效的素材。服务端会在节点数据含 `version` 时比对请求 `nodeVersion`，并独立核对画布/工作流当前版本。
- 任务提交在数据库事务内锁定报价和积分账户，复核报价有效期、用户/项目版本、节点存在、模型配置版本和素材状态，校验可用积分，写任务及积分预占账本。同一报价/key 重复提交返回原任务；同一报价换 key 拒绝。任务公开字段使用安全摘要，不返回上游密钥、签名链接或原始错误。任务账单的 reserved/settled/released 仅按该任务的 reserve/settle/release 账本事实计算，不以状态推断；例如 failed 但没有 release 记录时仍显示预占。
- generation worker 已接入 OpenAI Images 与 Ark 视频受控协议。每次领取采用数据库行锁和短租约；提交超时/5xx 归为 unknown，已开始过的任务绝不重提，Ark 任务按持久供应商 ID 查询。供应商成功响应先原子写入私有 staging；输出经完整解码/格式校验后转存到私有结果目录，结果记录、delivered 状态与结算在同一事务提交。明确未提交失败会原子释放预占。worker 不在 `createApp` 自动启动，仅独立 server 且显式设置 `CRUIO_GENERATION_WORKER_ENABLED=true` 才启动；SIGINT/SIGTERM 会停止接收新任务、中止活动请求/视频子进程并关闭数据库。
- 生成成功与采用、保存作品分为独立事实。采用要求目标画布版本、匹配类型的正式生成节点和可靠交付结果；作品保存只接受 `delivered` 结果，不能据此自动采用或触发任务。任务列表/详情返回服务端持久状态、`nodeId`、结果列表及 `adoptedResultId`/`adoptionVersion`；前端按当前节点关联任务，不能本地伪造执行进度或候选结果。
- 当前 `generation_task_attempts.attempt_number` 对应 worker 状态事件顺序（如 submitting、accepted、polling、delivered），不是供应商调用次数；不能用它统计模型请求量或计费次数，后续应单独规范事件与供应商提交记录。
- 当前岗位包括 `admin`、`creditOperator`、`modelOperator`、`support` 和 `privacyOperator`。admin 仅能做角色管理，不因此获得积分、模型或凭据权限；积分操作只由有效 creditOperator grant 开放，支持全局或指定用户 scope。模型配置操作由有效modelOperator授权控制；privacyOperator与隐私请求在MVP之外保留，且不继承admin。注册不会自动授予运营岗位。岗位授权包含范围、到期时间和理由；grant/revoke保留审计记录。每个请求重新读取有效授权；敏感写入与凭据读取要求当前密码。
- M07 人工积分采用预览后确认：`POST /api/operations/credits/preview` 绑定目标、金额/原账本项、账号余额与预占快照、幂等元数据和凭据；随后走 `/topups`、`/refunds` 或 `/reversals`。提交事务复核岗位、密码、预览期限、账户快照和账本约束。余额可为负；充值追加正向账本并抵减欠额。退款必须关联原 topup 且累计扣回不超过未退款余额；冲正追加反向记录，同一源账本仅能冲正一次，冲正充值前须先冲正关联退款。内部理由不进入用户账单；原始凭据保存于与 media 分开的私有目录，只有授权 creditOperator 可在填写用途并再次验证密码后读取，访问会留痕。
- 首位本地 admin 的显式引导命令为 `NODE_ENV=dev CRUIO_ALLOW_LOCAL_ADMIN_BOOTSTRAP=true bun src/db/bootstrapAdmin.ts <本地用户UUID> <到期时间ISO8601> <授权理由>`（在 `apps/server` 运行）；命令不会创建账户，只能操作本机开发数据库，并且仅当没有有效 admin 时执行。
- 作品软删除只更新 `works.deleted_at`，项目列表过滤已删除作品；原 `generation_result_works`、结果、任务和账本继续保留。作品下载验证本人所有权及可靠交付结果。
- M04 增加 `generation_task_events` 追加式事件存储和用户任务操作/运营待核查路由。任务核查需有效 modelOperator 对应目标用户 scope；不能覆盖已可靠交付任务。

## MVP 模型配置

模型目录目前由受控 JSON 配置文件同步到数据库；通过 `createApp` 的 `generationConfigFile` 参数或 `CRUIO_GENERATION_MODELS_FILE` 环境变量指定文件。文件不应放入公开静态目录或提交 API key。`credentialEnv` 保存环境变量名，真正的渠道密钥从该环境变量读取。

每项映射需要 `providerId`、`providerLabel`、`channelKind`、`region`、`protocol`、HTTPS `endpoint`、环境变量名形式的凭据引用、精确 `modelId`/`modelVersion`、`operation`、`capabilities`、`costReference` 和 `creditPrice`。migration 15追加 `adapterVersion`、`configVersion`、`is_current`；历史映射不可覆盖，移除后重加从最大版本递增。开发 JSON 导入仅在generation_models为空时作为首次bootstrap；后续启动不会将运营修改回退到本地文件，缺失配置也不改变current。MVP后台支持revision/publish/pause；发布时检查环境变量凭据存在。敏感写入要求当前密码，credentialRef仅是环境变量名别名，绝不读取密钥值。配置时间不代表渠道验证。报价使用已发布模型快照；提交和首次外发复核模型revision、凭据配置和媒体状态，不依赖market/review。

公共 `GET /api/generation/models` 返回当前已发布映射的创作字段和白名单capability；不返回endpoint、credential引用/秘密、采购成本、积分价格或任意capability key。MVP无marketCode/default-market要求。

OpenAI endpoint 必须是 HTTPS 且路径为 `/v1`；官方配置使用 `https://api.openai.com/v1`，受控 compatible channel 也可配置兼容服务。Ark endpoint 必须是 HTTPS 且路径为 `/api/v3`。服务端会追加官方资源路径。Ark `capabilities.resultHosts` 必须逐个列出允许下载的视频 CDN 主机名，下载强制 HTTPS、精确主机匹配且禁止重定向，允许服务端签名 query。视频本地完整验证要求配置 `CRUIO_FFMPEG_PATH` 与 `CRUIO_FFPROBE_PATH`，或将两个可执行文件放在 `data/ffmpeg/<platform>-<arch>/`；不会自动下载或安装工具。缺少视频解码工具时模型显示不可用，报价和新任务也会阻止提交。

支持协议适配器及凭据注入。MVP模型映射可通过版本化后台发布、列表、报价与执行；migration16市场/review表和migration17隐私请求不属于MVP请求依赖。真实供应商账号、精确版本、参数语义、成本和CDN下载尚待用户实际联测，未宣称开放或核验。worker缺视频工具时明确失败并释放预占；OpenAI在完整读响应后、原子staging前崩溃仍可能保持unknown并由运营核查。

## 仍缺的闭环

- M03 MVP：模型revision、publish/pause接口已简化为配置链，不依赖market profile或11项review。modelOperator浏览器验收通过新配置revision201、缺凭据env发布409、有占位env发布201/v2及停用201/v3；390px无横溢出。占位凭据未调用供应商；真实供应商账号与精确渠道仍待用户联测。画布/node由其他session负责。隐私请求及新增M14治理不属于当前MVP；migration16/17历史表和相关原型接口不纳入主链验收。
- M04：核心生成链路已落盘并通过本地 stub 验证；新增用户任务操作、modelOperator 核查及任务事件记录，仍待真实供应商联测和 worker 多实例生产运维验收。报价前保存画布，并绑定画布版本、节点及已连接且 active 的素材。只有服务端 `delivered` 才显示结果候选或允许保存作品。
- M07：固定积分报价、预占/实结/明确失败释放、凭据驱动手工充值/退款扣回、负余额、新充值抵欠、幂等操作和追加冲正、用户账单及岗位权限已落盘并完成隔离 HTTP 验收；完整财务对账和变动用量计费仍未实现。新用户账户仍从零积分开始。
- M13 V1：增加只读运营核对 GET 与独立页面；按有效creditOperator scope展示账户与全量账本差异、任务预占/结算/释放和结果文件异常，以及手动积分账本净额/关联摘要。隔离HTTP验证覆盖scope拒绝、账务差异、异常可见和源事实不变；页面已通过独立浏览器空态/结果视图核验。时间窗口径和用户分页限制见页面。
- M02/M11：账户创建后可直接登录进入MVP主链；不伪造邮箱已验证状态。fresh role/scope仍按后端授权执行；注册不授予运营岗位。复杂隐私请求和邮件验证审批不属于MVP。
- M12：通知回执和工单API经隔离PG+Express验证本人任务关联、访问边界、用户回复通知、内部备注不通知、跨用户read拒绝、handoff及撤权、closed/reopen规则和双关联安全摘要投影。验证前后task/ledger事实不变。更广泛经营指标与全量M12仍未实现。
- M01：本轮已持久化采用请求版本、提交版本和正式输出快照；前端已区分候选、采用和作品保存。正式输出快照可作为下游生成引用输入；主线程隔离验证确认 A1 报价后改用 A2，下游任务仍提交已确认 A1 的原始 multipart image bytes。报价也支持 active 普通 mediaNode 素材。

## 已执行验证

- `apps/server` 的 `bun run typecheck` 在媒体接线及当前生成/积分路由完整接入后通过；没有新增测试文件。
- 主线程在临时 PostgreSQL schema 和临时存储上完成媒体 HTTP 验证：未登录 `GET /api/media/list` 返回 401；上传后读取字节一致；跨用户读取/撤回 404；Range 返回 206；HEAD 长度正确；截断 PNG、未成年人真人声明、缺授权声明均拒绝；本人撤回成功且读取随即变 404；撤回状态仍可查。视频/音频上传未开放。
- 主线程浏览器检查记录：1440px 三栏布局 220/840/380；1280px 无横向溢出，节点 300px、header 56px；1000px 左栏收窄并覆盖右栏、metrics 40px/footer 30px，无溢出；项目/工作流创建弹窗 Shift+Tab 可循环、Esc 关闭后焦点回到触发器；工作流页正文 14px、标题 20px。50/75/100% 缩放下节点宽度分别为 150/225/300px；100% 选中前后节点均为 300×136px；1000px 抽屉打开聚焦内部关闭按钮，Esc 后焦点回到触发器；viewport 已恢复默认。50% 文字优先级样式仍在收尾。
- 临时 schema 上的 submit 并发验收已通过：同一 quote/key 并发返回 201 与 200 且 taskId 相同，数据库仅产生一个 task 和一次 60 点预占；两个不同 quote 竞争 100 点余额时，一个提交成功、另一个以 409 可用积分不足，账本仍仅预占 60 点。此前另一次启动曾在迁移阶段报 `syntax error near ':'`，未触及路由；主线程后续 fresh schema 的 migration 1–7 已通过。
- 前端反馈当前 `apps/web` 的 `bun run typecheck` 与 `bun run build` 均通过。画布 50/75/100% 缩放预设实际节点宽度分别为 150/225/300px；100% 选中状态切换前后均为 300×136px；1000px 抽屉开关焦点返回检查通过，viewport 已恢复默认。
- 本轮 server `bun run typecheck` 与 `apps/server` `bun run build` 通过。adoption 子任务使用隔离 schema、存储和严格本地 fetch stub 完成 HTTP 图片整链验收：注册、项目/画布、模型、报价、提交，provider POST 一次后任务 delivered；私有结果读取字节一致，积分从注入的 100 余额结算为 75、reserved 为 0；采用持久化画布版本 2→3 的正式输出快照，作品列表新增 1 件。该余额由临时验证直接写入，不代表产品充值能力。
- 同一验收还覆盖无视频工具的新 queued 任务：任务 failed、provider fetch 次数为 0、写入一条 release 账本记录，reserved 从 60 降至 0 且 balance 不变。此前的未知任务/staging 恢复、无 staging 的 running 重启不重提，以及 Ark 只 POST 一次并按原 ID GET 也已由本地 stub 验证。所有临时 schema、存储、config 和凭证环境均已清理；未新增测试文件、未发起真实供应商网络请求。当前机器没有系统 ffmpeg/ffprobe，因此视频模型运行时不可用。
- credits 隔离 HTTP 验收使用随机 PostgreSQL schema 和临时存储：注册无岗位；admin 查询积分返回 403；creditOperator 指定用户 scope 不能访问其他用户；同幂等键并发 topup 返回同一账本 ID；私有凭据只由授权 creditOperator 读取，访问用途留痕，用户账单不显示内部理由。模拟已结算消费后，退款将余额保留为负数；冲正退款后可以冲正原充值；同一源项不能二次冲正；Boolean 积分输入拒绝；撤权后已有 session 的下一次运营请求返回 403。临时 schema 和凭据目录全部清理。
- M04/M06 隔离验证：M04 stub 验证报价后将 A1 正式输出绑定给 B，即使 A 在报价后改为采用 A2，B 实际 multipart 输入仍是确认的 A1。M06 验证本人下载可获得原 PNG 字节、跨用户下载 404、软删除后项目作品列表过滤且下载 404，任务/结果/账本事实计数不变。均使用临时 schema/storage/config，无真实供应商网络请求，未增加测试文件。
- 积分运营 UI 浏览器验收由主线程使用临时schema和fixture完成：1280/1000px无横向溢出，header56px、正文14px、标题20px；显式本地admin与creditOperator授权后上传text凭据，服务端预览100点并提交后余额100。密码初焦、Shift+Tab焦点循环、Esc关闭返回触发器；重开确认成功显示余额与凭据入口并清空输入。普通用户账单显示“积分入账 +100”，无内部理由。本人任务页和modelOperator区域空态可加载；这些空态检查不代表任务操作验收。M13核对页另有独立浏览器验证。临时backend/schema/storage/fixture均清理，没有真实用户充值或供应商请求。
- 设计整改由主线程浏览器复测：画布在 1440px 保持 header/metrics/footer 56/40/30px 与左右栏 220/380px；1000px 固定右侧检视器覆盖画布且关闭后焦点回触发器；节点前后状态维持 300×136px。75% 与 50% 缩放分别得到 0.75/0.5；50% 紧凑态隐藏正文而保留标题。登录页新居中 440px 白卡在 2320×1359、1280×800、390×844 视口均无横向溢出。M13页面另通过浏览器结果/空态验证。
- 主线程 M04 本地PostgreSQL隔离验证覆盖同微秒游标分页无遗漏、CAS、review幂等核查、Ark原任务ID查询、unknown/queued cancel和跨用户拒绝；真实供应商请求0。
- 历史市场profile/M14核验与隐私请求原型测试属于已撤销的旧MVP门禁，不构成当前MVP功能或验收要求。完整PRD和历史schema保留作未来范围参考；本轮不恢复旧强制门禁。
- 主线程 MVP 实际 `createApp` + 临时 PostgreSQL 整链通过：邮箱/密码注册201、`/api/auth/me` 200、建项目；模型revision201；未配置凭据环境变量时publish409，有占位env时publish201/config v2；PNG上传、保存含素材引用画布、quote200、并发submit201/200；worker只调用本地PNG fetch stub一次并交付。本人下载字节一致、保存作品201且下载字节一致；积分临时fixture从100结算到75、reserved归零。真实供应商和SMTP请求0，临时schema/storage/config已清理。
