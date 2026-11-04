# Cruio 账户体系设计资料

更新日期：2026-11-03  
阶段：第一版功能与视觉范围已收敛，部分已实现并验证；设计完成不等于生产验收。

本目录集中账户流程、视觉方向、权限与数据边界、待确认事项及参考资料。目标是让用户通过 Cruio 登录后直接进入本地创作，并让退出、切换和授权异常有清楚的处理方式。

## 阅读顺序

| 文件 | 用途 |
| --- | --- |
| [第一版定稿范围](./accountPlan.md#第一版定稿范围) | 先读：必做功能、四页管理后台、NewAPI 关联边界与明确不做项 |
| [统一实现协议](./implementationContract.md) | 前后端共享字段、会话状态、错误与保存边界 |
| [独立账号服务](./accountService.md) | 实际运行、账号开通、用户模型凭证和部署约束 |
| [独立验收记录](./acceptanceReport.md) | 实际验证证据、未验项目和交付限制 |
| [产品流程与页面设计](./productDesign.md) | 页面清单、登录及切换流程、状态和文案、设计验收要求 |
| [视觉方案](./visualDesign.md) | 三张独立登录效果图、深浅色规范、账户面板与提示层布局 |
| [账户页面深化设计](./screenDesign.md) | 沿用已选第二张方向，包含我的账户、模型未开通、会话失效、退出确认四张效果图 |
| [账户体系改造方案](./accountPlan.md) | 身份、会话、NewAPI 映射、配置权限、数据归属、改造位置与实施顺序 |
| [设计决策与待确认清单](./decisionLog.md) | 已确认范围、设计假设、待定事项及交付边界 |
| [视觉生成记录](./imagePrompts.md) | 实际 ImageGen 提示词与引用图片，便于后续修订 |

## 文件组织

```text
accountDesign/
  readme.md
  accountService.md
  implementationContract.md
  acceptanceReport.md
  adminPreview.jpg
  productDesign.md
  visualDesign.md
  screenDesign.md
  accountPlan.md
  decisionLog.md
  imagePrompts.md
  screenPrompts.md
  visuals/
    focusedLogin.png
    creativeLogin.png
    lightLogin.png
    accountPanel.png
    modelUnavailable.png
    sessionExpired.png
    logoutConfirm.png
  references/
    workOutline.md
    explorationReport.md
    projectHome.png
    canvasDark.png
    canvasLight.png
```

`visuals` 是本次生成的视觉概念；`references` 是 2026-11-02 收录的工作大纲、调研报告及仓库现有界面截图。截图中的 Toonflow 品牌仅用来对照既有结构和样式，不是拟交付的 Cruio 品牌。参考文档是快照，后续项目进度仍以根目录[工作大纲](../../工作大纲.md)及[调研报告](../../explorationPlan.md)为准。

## 当前设计基线

- 桌面客户端与本地项目，保留已有创作功能，不扩展多人 Web。
- 登录后展示已接入模型目录，请求使用本人绑定的 Key；权限由运营在 NewAPI 中配置，客户不填写地址或 Key。
- 账户入口复用设置面板；模型开通状态与 Cruio 登录状态分别表达。
- 沿用现有深浅色主题、蓝色操作强调及 8px 基础圆角。正式 Logo 未定，暂用 Cruio 文字字标。
- 用户已选择第二张“创作入口”作为视觉基线，文件为 `visuals/creativeLogin.png`；第一、第三张仅保留作探索记录。
- 用户已确认“没有已有账号服务，采用最小独立账号服务”：账号密码、运营开通、无公开注册。

## 交付完成度

已整理：完整账户方案、页面及状态规格、三张登录视觉方向、选定方向下的四张账户状态图、配色与布局规范、技术改造清单、待确认事项、来源快照及生成提示词。

登录方向已选第二张；登录、账户面板、失效重登和退出保存已进入真实实现。独立身份服务在同一个 4310 端口新增 `/admin` 管理页面，支持账户管理、NewAPI API Key 绑定；首次管理员授权使用本机运营命令。启动、权限和核验配置见 [账户服务说明](./accountService.md)。效果图中的标点、字号和色值以文案及视觉规格为准。

当前实现不自动导入旧配置；不开放供应商配置、插件管理、MCP/A2A、开发者和新远程设备连接。旧匿名遥测未接入新账户流程。协议与帮助地址只显示真实配置的链接。

跨客户端重启的系统安全凭证存储尚未接入，启动恢复限于本机服务仍存活的会话；`rememberSession` 如实返回 `false`。NewAPI 用户专属令牌由运营配置，退出撤销 Cruio 会话并清除本机凭证，不宣称撤销静态 NewAPI 令牌。生产模型调用与系统安全存储需另行实机验证，具体以验收记录为准。
