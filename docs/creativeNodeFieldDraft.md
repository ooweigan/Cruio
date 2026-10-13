# 八类创作节点字段草案

> 状态：供讨论与 review，尚未定稿。本文讨论字段、数据归属和相邻节点的职责边界，不规定执行流程。以 `nodeModelNotes.md` 中已确认的节点公共字段为前提。C01、C02 已有部分实现；C03、C04 是结合现有系统评估后的模型草案，C05～C08 仍是首轮概要。

## 1. 字段边界

每个节点实例共用 `id`、`type`、`name`、`position`、`revision`、`data`。下面只展开各类型的 `data`。`type` 使用稳定的业务类型标识；导入、生成、编辑等模式不成为新的顶层类型。

- `data` 保存节点自身的小型配置、所选模式，以及指向独立业务对象的引用。
- 有独立身份或可能持续增长的内容另存为业务对象：剧本正文、镜头清单、参考包、导演配置、时间线工程、媒体文件均不内嵌在节点 `data` 中。
- 画布连线独立保存。来自连线的输入不再复制进 `data`；用户直接在节点内选择的已有内容则记录固定版本引用。
- Run、候选结果、正式采用记录和历史状态不放进节点 `data`。`data` 中的期望规格（如目标时长）也不充当实际产物元数据。
- `schemaVersion` 属于节点**类型定义**；实例 `revision`、业务对象 `version`、素材 `revision` 分别表示不同对象的版本。
- `selectedModelId` 是用户所选的展示模型标识，可选；可用模型列表动态获取，不持久化在节点中。供应渠道和精确模型版本属于执行快照。

本文讨论的目标模型使用两种引用形状；当前素材系统尚未实现素材修订号，不能把草案中的 `revision` 当作现有接口字段：

| 引用 | 字段 | 含义 |
| --- | --- | --- |
| 版本化内容引用 | `id`、`version` | 指向一个固定版本的剧本、镜头清单、参考包、导演配置或时间线工程；落库时使用各自明确的 ID 字段名。 |
| 素材引用 | `assetId`、`revision` | 指向一个固定版本的已有素材。 |

生成结果使用已可靠保存的 `resultId`，但它属于候选／采用记录或输入快照，不作为八类节点的公共 `data` 字段。

## 2. 各类型的 `data`

表中“可选”表示节点可以先创建，再填写该字段；不表示执行时也可缺少。字段名是本轮建议。C01、C02 的独立业务对象字段一并展开，便于 review 两类节点的真实产物。

### C01 剧本

#### 设计依据与产物边界

[平台调研](scriptPlatformResearch.md)显示：CapCut、Pictory 会先产生可编辑的剧本文字，再进入分镜或视频制作；LTX Studio 将剧本与镜头清单列为不同产物；Runway 的角色台词视频、InVideo 的剧本转视频也不能据此把视频当作剧本文档。因此 C01 的主产物拟为**有固定版本的剧本文档**。提纲是剧本内部的可选规划内容；分镜、配音音频和视频分别属于后续业务对象。这里的划分是 Cruio 的建模提案，不声称各平台使用相同内部结构。

#### 节点实例的 `data`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `scriptRef` | `{ scriptId: string; version: number }`，可选 | 关联的剧本库对象及固定版本。可以来自私人库或公共库；这里不复制正文，也不重复存可见范围。 |
| `writingBrief` | 对象，可选 | 节点中的写作要求：`idea?`、`purpose?`、`audience?`、`keyPoints?`、`tone?`、`language?`、`targetLength?`、`constraints?`。这是创作意图，不是已写出的剧本内容。 |
| `selectedModelId` | `string`，可选 | 用户为需要模型的剧本操作选定的展示模型 ID；可用列表不持久化在节点。 |

`targetLength` 建议表达为 `{ unit: "words" | "characters" | "minutes"; value: number }`，明确目标单位；实际字数或时长另从内容计算。`constraints` 是用户写作要求的文本或受控条目，不作为可执行指令。节点内新建剧本时创建剧本库对象，节点仍只记录 `scriptRef`。

不增加持久的 `mode` 字段：选择库剧本、手写、导入、AI 创作或改写是对同一剧本对象的不同入口，当前编辑器所处页面不必成为剧本的身份。若后续发现某项模式有必须跨会话保留的专属参数，再在该操作的配置中定义。

#### 剧本库对象 `Script`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `scriptId` | `string` | 剧本在库中的稳定身份。 |
| `ownerId` | `string` | 私人剧本的所有者，或平台发布内容的归属主体。 |
| `title` | `string` | 剧本库显示名称；节点实例自己的 `name` 可以不同。 |
| `description` | `string`，可选 | 供库中检索和选择的简介，不等于正文梗概。 |
| `createdAt`、`updatedAt` | 时间 | 库对象的管理时间；不用于代表某个正文版本的生成时间。 |

私人／公共不是节点字段。已确认的“公共版本不可变、撤回后不再允许新引用但已有引用可读”要求我们把**版本内容**和**公开记录**分开：建议公开记录至少含 `scriptId`、`version`、`publisherId`、`publishedAt`、`withdrawnAt?`。是否需要审核字段留给剧本库设计，不在本轮虚构。

#### 剧本版本 `ScriptVersion`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `scriptId`、`version` | `string`、`number` | 指向库对象的不可混淆版本身份。 |
| `title` | `string` | 该版本的标题快照；后来给库对象改名不改历史内容。 |
| `language` | `string`，可选 | 正文语言，例如 `zh-CN`。 |
| `summary` | `string`，可选 | 内容梗概，区别于库对象的检索简介。 |
| `outline` | `OutlineItem[]`，可选 | 写作阶段的提纲；可以不存在，也不强制短广告文案拥有章节大纲。 |
| `sections` | `ScriptSection[]` | 剧本正文。按章节／段落组织；短文本可以只有一个 section。 |
| `source` | 对象 | 内容来源类别及引用：手写、文件导入、基于已有版本改写或模型生成；只记录适用的源文件引用、源剧本版本引用或 Run ID。 |
| `createdAt` | 时间 | 该内容版本的形成时间。 |

`OutlineItem` 最少含 `outlineItemId`、`text`、`order`；可选 `heading`。`ScriptSection` 最少含稳定的 `sectionId`、可选 `heading`、有序的 `blocks`。`ScriptBlock` 最少含稳定的 `blockId`、`kind`、`text`；`kind` 建议先覆盖 `plainText`、`sceneHeading`、`action`、`dialogue`、`narration`，对台词块可选 `speakerRef`。这样纯文本导入、短文案、叙事剧本和旁白稿都能表示，同时保留段落身份，后续局部改写不依赖数组下标定位。

`sections` 表示**剧本的文字结构**，不等于 C02 的镜头清单：这里的 `sectionId`、`blockId` 不能冒充 `shotId`。也不把生成视频所需的画幅、素材选择和配音模型存进剧本版本。

#### C01 类型定义中的输入／输出字段提案

| 方向 | 端口字段 | 值类型 | 说明 |
| --- | --- | --- | --- |
| 输入 | `brief` | `Text`，可选 | 上游传入的创作要求；不替代实例中的 `writingBrief`。合并规则后续讨论。 |
| 输入 | `sourceScript` | `ScriptDocument`，可选 | 用于延续或改写的固定剧本版本；节点内从剧本库选择时使用 `scriptRef`。 |
| 输入 | `sourceFile` | `AssetRef`，可选 | 导入已有文档的来源文件引用；具体可接受格式按导入能力另定。 |
| 输出 | `script` | `ScriptDocument` | C01 的主要业务输出，值指向一个固定的 `ScriptVersion`。 |
| 输出 | `voiceScript` | `VoiceScript`，可选 | 供 C07 使用的结构化台词／旁白文本，不是音频文件。 |

`VoiceScript` 拟作为独立的可引用文本对象：每条 `utterance` 至少有稳定的 `utteranceId`、`text`、可选 `speakerRef`、`language`、`sourceBlockId`。情绪、停顿、发音要求可作为文本标注字段；声音文件和真实时间戳由声音节点或音频分析产生。是否需要将 `VoiceScript` 做成单独版本化对象，留到其自身模型设计时确定。

这里没有 `outline`、`storyboard` 或 `video` 输出端口：提纲属于剧本文档的可选内容；镜头清单、可视化分镜、视频是其他节点的产物。这不妨碍 UI 在同一流程里提供快捷入口。

以上是字段提案，并未决定草稿如何保存、何时形成正式版本、输入如何合并或哪个操作需要模型。

### C02 分镜

#### 职责与产物

C02 是**镜头规划与分镜编排节点**：把叙事内容组织成有稳定身份、明确顺序、可追溯来源的镜头计划。主产物是固定版本的 `ShotListVersion`。它回答“这一镜呈现什么、承担什么叙事任务、依据哪些文字、涉及哪些主体、计划占用多少时长”。手工建立、导入清单、从剧本拆镜和局部调整都可以形成同一类产物，不需要持久的 `mode` 字段。

相邻内容的权威归属如下，C02 可以引用或联查，但不复制另一份权威正文：

| 内容 | 权威归属 | C02 保存的关联 |
| --- | --- | --- |
| 故事情节、正式台词与旁白 | C01 的剧本版本；结构化台词对象后续定模 | 固定剧本版本及原文位置。 |
| 镜头身份、叙事顺序、画面内容与计划时长 | C02 的 `ShotListVersion` | 清单自身的正文。 |
| 人物、场景、道具／产品设定 | 参考包对象，由 C03 承载引用 | 本镜使用关系及参考包固定版本；未绑定时只保留局部称呼。 |
| 景别、机位、构图、运镜、风格与表演指导 | C04 的 `DirectorSpec` | 可以展示适用的导演配置，不再保存第二份权威配置。 |
| 分镜图片、视频与音频文件 | C05～C07 的结果或素材系统 | 已保存产物的固定来源引用，不接管候选和采用记录。 |
| 素材入出点、转场、字幕时码与混音 | C08 的 `Timeline` | C02 只保存规划顺序与计划时长。 |

#### 节点实例的 `data`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `shotListRef` | `{ shotListId: string; version: number }`，可选 | 当前镜头清单的固定版本。镜头内容、稳定的 `shotId`、排序和来源位置由清单对象保存。 |
| `planningBrief` | 对象，可选 | 规划要求：`emphasis?`、`pacingNotes?`、`constraints?`；记录希望突出什么及叙事节奏倾向，不复制剧本正文。 |
| `splitSettings` | 对象，可选 | `granularity?`、`targetShotCount?`、`targetDurationMs?`、`visualExpansionPolicy?`；均为规划目标，不充当实际镜头数量或媒体时长。 |
| `selectedModelId` | `string`，可选 | 为需要模型的拆镜／规划操作选择的展示模型 ID，不是分镜图片生成模型。 |
| `localInputRefs` | 具名固定版本引用，可选 | 节点内直接选取的剧本或参考包；连线输入不在这里重复保存。 |

`targetShotCount` 为期望的正整数，`targetDurationMs` 为期望的正数。`visualExpansionPolicy` 暂建议 `literal | nonPlotDetails`：尽量忠于原文，或允许补充不改变剧情事实的环境与物件画面。原草案的 `allowAddedPlot` 混淆视觉补充与新增剧情，故移除；新增事件、人物关系或正式台词属于 C01 的内容创作。

原草案的 `sourceRange` 不再作为无版本锚点的持久节点字段。某次操作选中的范围属于该操作参数；产物实际依据的原文位置存入 `ShotListVersion`。只有确认需要跨会话保留选区时，才另定义版本锚定的选区字段。

当前选中的镜头、表格／卡片视图、筛选和折叠状态属于编辑器视图，不进入领域 `data`。只有确实出现“一镜多图、图板独立编排和版本”的需求时，再给节点增加 `storyboardRef`，不为显示缩略图提前建立图板对象。

#### 镜头清单 `ShotList` 与 `ShotListVersion`

| 对象 | 字段 | 说明 |
| --- | --- | --- |
| `ShotList` | `shotListId`、`ownerId`、`title`、`description?`、`createdAt`、`updatedAt` | 清单在库中的稳定身份与管理信息。节点的 `name` 可以不同；本轮不赋予清单公共发布规则。 |
| `ShotListVersion` | `shotListId`、`version`、`title`、`sourceScope?`、`groups?`、`shots`、`provenance?`、`createdAt` | 固定版本的规划正文。`sourceScope` 可引用固定剧本版本及范围，也允许手工清单无剧本来源。`provenance` 可记录父清单版本、来源文件或 Run 引用。 |

`groups` 是可选的叙事分组，每项至少有稳定 `groupId` 和名称；短内容无需分组。`shots` 数组顺序是清单的**唯一权威叙事顺序**。镜号是按顺序生成或用户填写的显示名，不再同时维护一个独立的持久 `order`。

#### 单镜头 `Shot`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `shotId` | `string` | 在清单版本之间尽可能保持稳定的镜头身份；不使用数组下标或显示编号代替。 |
| `label` | `string`，可选 | 人可读的镜号或称呼，例如 `12A`。 |
| `groupId` | `string`，可选 | 所属叙事分组，不是 C01 的 `sectionId` 或 C03 的场景身份。 |
| `content` | `{ description: string; narrativePurpose?: string }` | 本镜呈现什么，以及可选的叙事任务；不是供应商专用提示词，也不内嵌导演配置。 |
| `sourceSpans` | `ScriptSpanRef[]`，可选 | 与本镜有关的零到多段固定版本原文；允许一段对应多镜、多段对应一镜、手工镜头无原文。 |
| `subjects` | `ShotSubjectUse[]`，可选 | 本镜涉及的人物、地点、道具或产品及其使用关系；可选固定版本参考包引用。 |
| `speechRefs` | `ScriptSpanRef[]`，可选 | 关联的台词／旁白原文位置，只表达语义关联，不代表独立配音次数、播放顺序或音频时码。 |
| `plannedDurationMs` | `number`，可选 | 本镜计划时长；缺失表示未知，不按零处理。 |
| `continuityNotes` | `string`，可选 | 与相邻镜头有关的内容连续性要求，不作摄影或表演参数的备用字段。 |
| `derivedFrom` | `ShotRef[]`，可选 | 拆分、合并或派生时的来源镜头；不表示旧媒体或导演配置已自动适配。 |

`ScriptSpanRef` 至少为 `{ scriptId, version, blockId }`。如需精确到块内文字，可再加 `textRange: { start, end }`，但落地前必须确定字符计量方式和区间端点语义；该范围只对被引用的正文版本有效。跨对象镜头引用使用完整 `ShotRef = { shotListId, version, shotId }`，单独 `shotId` 不能指出哪一版内容。

`ShotSubjectUse` 第一轮只建议包含局部称呼、主体在本镜的使用类别，以及可选 `referencePackRef = { packId, version }`。名称相同不自动建立全局主体身份，也不提前虚构参考包内部的成员 ID。

镜头的画面内容或顺序修改可以保留 `shotId`；复制出的独立镜头应有新身份。拆分、合并的一对多或多对一关系使用 `derivedFrom` 说明来历，不能据此假定历史引用自动迁移。这些是身份约束，不在本轮规定编辑动作流程。

#### 可视化分镜的两级数据边界

第一层仅显示已有图片、视频缩略图与镜头内容时，采用现有产物引用组成**展示视图**即可；不要在 `ShotList` 中复制一份“已采用媒体”。

第二层确实需要一镜多图、镜内图板顺序、独立图板说明和版本时，再引入附属的 `StoryboardVersion`：包含 `storyboardId`、`version`、固定 `shotListRef`、有序 `panels`、`createdAt`。每个 `Panel` 至少包含稳定的 `panelId`、`shotId`、镜内顺序、图片固定来源引用和可选说明。外部镜头顺序仍来自 `ShotListVersion`，图板不能维护第二份镜头顺序；组合展示时须校验 `StoryboardVersion.shotListRef` 与节点当前 `shotListRef` 一致。

一镜三张连续示意图是三个图板，同一张图的三个生成备选是三个候选，采用其中哪张是采用记录；三者不共用一个数组。C02 可以按计划顺序和计划时长做轻量节奏预览。一旦用户独立编辑素材入出点、转场、音轨位置、字幕时码或混音，这些字段属于 C08 的 `Timeline`，即使界面称其为“预演”。

#### 检查结果与协作记录的归属

原文覆盖、缺失主体绑定和计划时长完整性可以基于清单计算；未填写时长应显示“合计不完整”。叙事重复或衔接问题只能作为分析建议。版本差异、逐镜评论与批准记录是独立的检查／协作事实，不嵌入 `Shot` 正文。C02 可提供入口，但不会因此拥有 C04 的摄影配置或 C08 的时间线。

### C03 素材与参考资料

#### 对来稿的评估

| 结论 | 内容 | 结合 Cruio 的理由 |
| --- | --- | --- |
| 采纳 | 区分单素材、临时多选、可复用集合和有语义的参考包；生成结果、素材登记与正式采用是不同事实。 | 当前项目已有独立的素材记录、生成结果和采用记录，不能把它们统称为节点里的 `assets[]`。 |
| 采纳但调整 | 参考用途属于参考包条目或具体消费关系，不是素材文件的固有分类。 | 现有 `media_assets.usage` 是上传时填写的用途声明，应保留其现有语义；不能直接复用为“首帧”“构图参考”等逐次使用角色。 |
| 暂缓 | 独立 `AssetCollection`、素材自动分析、区域／片段标注、造型变体和共享参考包。 | 当前没有复用集合、分析结果、坐标与时间基准、共享权限等完整链路；先定身份和引用边界，不凭平台功能一次建齐。 |
| 不照搬 | 立即建立 `AssetRevision` 并要求所有引用写 `revision: 1`。 | 当前 `media_assets` 是一份不可原地替换的图片内容，以 `assetId` 标识，并可撤回；还不存在修订表。虚构修订号会给人“内容可替换”的错误暗示。 |

当前实现只接受 PNG、JPEG、WebP、GIF 图片；`materialStationNode` 选取已有素材后转换成带 `assetId` 的 `mediaNode`。生成结果可以直接供下游使用，明确“另存为素材”后才形成素材记录。视频、音频素材库、命名集合和参考包尚未落地。C02 已允许保存可选的 `referencePackRef` 结构，但还没有 C03 参考包选择与校验链路，不能因此认为参考包已经可用。

#### 职责与节点字段

C03 是画布上选择和查看已有素材、组织可复用参考资料的入口。文件与权限仍由素材系统管理；C03 不保存生成配置、候选采用关系、镜头顺序、导演要求或剪辑时间线。节点承载什么内容，应以互斥形态表达：

| `contentKind` | 节点引用 | 本轮判断 |
| --- | --- | --- |
| `singleAsset` | 当前为 `assetId?`；若日后素材允许内容修订，再定义固定的 `{ assetId, revision }` 并迁移旧引用 | 对应现有 `mediaNode`，可先落地。 |
| `referencePack` | `{ packId, version }?` | 目标模型成立，但须先实现参考包对象与访问校验。 |
| `assetCollection` | `{ collectionId, version }?` | 只有出现具名、持续维护或跨节点复用的集合需求时才加入；当前节点临时多选不叫集合版本。 |

引用可选只表示允许创建未配置节点。单素材不再用长度为一的 `assetRefs[]` 表达；一个节点也不同时保存 `collectionRef` 与完整成员数组。临时选择多份素材应留在具体输入绑定或有数量边界的局部选择中，不因此自动产生可复用集合。

#### 参考包的最小目标模型

`ReferencePack` 保存 `packId`、`ownerId`、`title`、可选检索简介及管理时间；`ReferencePackVersion` 保存 `packId`、`version`、版本标题、`packKind`、可复用特征说明和有序 `entries`。`packKind` 先考虑 `character | location | prop | product`，不把风格包或完整人物百科提前纳入首版。每个 `ReferenceEntry` 至少有稳定的 `entryId`、固定素材引用、说明这份资料用途的 `referenceRole?`、视角说明 `viewLabel?` 和 `note?`。成员顺序只是资料的展示顺序，不是 C02 镜头顺序。

参考包描述可复用的外观、布局或结构依据；它不拥有角色、说话人或故事场景身份。`packId` 不等于 `characterId`，也不等于 C01 的 `speakerRef`。同一素材可以在不同包中担任不同参考作用。某镜头如何借鉴这些资料由 C04 记录，某次生成把它作为首帧或源图由 C05／C06 的输入绑定记录。包公开或共享时，还必须分别确认成员素材可访问，不能沿用 C01 公共剧本的撤回规则作默认假设。

当前系统已有上传来源、用途与授权声明字段。它们是素材登记事实，不能被单个 `isPublic`、`isLicensed` 或节点 `usage` 替代。自动标签、转录和识别描述若以后加入，应作为关联具体素材内容的分析结果，不覆盖用户维护的参考包正文。

### C04 导演表达

#### 对来稿的评估

| 结论 | 内容 | 结合 Cruio 的理由 |
| --- | --- | --- |
| 采纳 | 用固定版本 `DirectorSpecVersion` 保存整体方向与明确作用范围的局部指导。 | C02 已有固定版本 `ShotListVersion` 和稳定 `shotId`，足以作为镜头指导的锚点；导演节点不再维护第二份镜头清单。 |
| 采纳但简化 | 结构化区分取景、运镜、光色、风格和表演，参考资料注明借鉴维度。 | 先保存产品层的表达意图和说明，暂不把焦距、三维轨迹或供应商参数做成通用强控制字段。 |
| 暂缓 | 逐主体的机器可识别表演引用、自动冲突检测、方案比较、模型兼容性提示与预演。 | C02 当前主体只有局部称呼，没有稳定主体身份；C03 参考包、导演执行和检查对象也未实现。仅靠 `packId` 或文字名字无法可靠定位多人表演对象。 |
| 不采纳为首版字段 | `selectedModelId`、永久 `mode`、`compiledPrompt`、`outputSpec`、候选与采用状态。 | 现有 C04 没有模型操作；导演正文是创作意图，模型选择与最终请求属于后续明确的辅助操作或 C05～C07 执行快照。 |

当前 `directorNode` 只是画布占位，尚无导演配置表、版本 API 或执行能力。既有总设计提到轨迹关键点、预演产物和多个导演节点组合，但这些是远期产品能力；在作用范围、时间基准及合并规则确定前，不把它们当作首版模型承诺。

#### 节点实例与版本对象

节点 `data` 第一版只需要可选的 `directorSpecRef = { directorSpecId, version }`。如需在节点内直接选择镜头清单或参考内容，后续在输入端口定稿时增加具名 `localInputRefs`，不复制连线输入，也不与版本正文中的依据引用混用。导演要求的实际内容不再平铺为节点的 `cameraSettings`、`styleSettings` 和 `performanceSettings`。

`DirectorSpec` 保存 `directorSpecId`、`ownerId`、`title`、可选简介、`createdAt` 和 `updatedAt`。`DirectorSpecVersion` 保存固定的 `directorSpecId`、`version`、`title`、可选 `shotListRef`、`overallDirection?`、`scopedDirections?`、`createdAt`。针对具体镜头的版本必须绑定一份固定的 `shotListRef`；无镜头范围的通用视觉方案可以暂不绑定。第一版只引用一份镜头清单，不定义跨清单的作用域。

局部指导至少包含稳定 `directionId`、`scope` 和 `direction`。`scope` 首先支持单个 `shotId` 或 `shotIds[]`；这些 ID 统一解释于该版本的 `shotListRef`，不能用显示镜号、数组下标或序号范围持久化。C02 的 `groupId` 已落地，但是否让组成为稳定的导演作用域仍待讨论：组改名、删除或镜头移组时需明确影响规则。`shotIds[]` 表示受同一要求约束的成员，不产生第二份叙事顺序。清单形成新版本后，旧导演版本不会自动迁移或宣称仍适用。

`direction` 先按表达维度组织少量可选字段：`framing?`（景别、视角与构图说明）、`cameraMotion?`（固定或运动方式及速度意图）、`lighting?`（方向与明暗关系）、`visualStyle?`（色彩与质感说明）、`performanceNotes?`（表演及画面内调度）和 `requirements?`（需保持或避免的表达要求）。未填写运镜不等于明确要求固定机位。`performanceNotes` 首版是范围内的文字指导，不假装已经有稳定的逐主体外键；待主体身份模型确定，再增加结构化逐主体指导。

导演正文可以有具名的 `referenceUses?`：每项保存稳定使用关系 ID、当前可验证的固定素材引用或未来固定参考包版本、借鉴维度和说明。例如借鉴图片的构图但不借鉴色调。C03 管资料的通用含义，C04 管某个表达范围怎样使用它。对素材片段、图片区域、构图坐标等精确引用，须先定义与固定内容关联的坐标／时间基准；本轮不预设。首帧、尾帧等生成输入角色及供应商实际请求仍由生成操作保存。

整体与局部指导可能冲突；本轮只保留清楚的作用范围，不规定继承、覆盖、清空或多个导演节点的自动合并顺序。C04 输出导演意图，不保证模型准确执行。执行时形成的提示词、模型版本、输入快照及能力降级由生成任务追溯，不能回写成可独立编辑的导演正文。

### C05 图片

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `mode` | `generate \| referenceGenerate \| edit` | 当前配置模式；不改变节点的业务类型。 |
| `instruction` | `string` | 用户填写的生成或修改要求。 |
| `selectedModelId` | `string`，可选 | 用户所选展示模型的 ID。 |
| `outputSpec` | 对象 | `aspectRatio?`、`targetSize?`、`candidateCount?` 等产品层目标规格。 |
| `editSpec` | 对象，可选 | 编辑模式特有的 `regionRef?`、`preserveNotes?`；源图通过连线或直接选择的固定版本输入提供。 |
| `localInputRefs` | 具名引用对象，可选 | 节点内直接选取、但未通过画布连线提供的源图／参考图；每项使用素材版本引用或已保存的结果 ID，并标明用途。 |

`outputSpec` 不存供应商原始参数；某模型专有参数应随具体操作定义单独校验，暂不加入公共字段。

### C06 视频

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `mode` | `generate \| edit \| extend \| lipSync` | 当前配置模式。 |
| `instruction` | `string` | 用户填写的生成或修改要求。 |
| `selectedModelId` | `string`，可选 | 用户所选展示模型的 ID。 |
| `outputSpec` | 对象 | `targetDurationMs?`、`aspectRatio?`、`targetResolution?`、`candidateCount?`、`audioPolicy?` 等目标规格；实际时长、分辨率和音轨信息属于结果。 |
| `editSpec` | 对象，可选 | 编辑／延展模式特有的 `sourceRange?`、`preserveNotes?`。 |
| `lipSyncSpec` | 对象，可选 | 对口型模式特有的 `subjectRef?`、`sourceRange?`、`originalAudioPolicy?`。 |
| `localInputRefs` | 具名引用对象，可选 | 节点内直接选择的首帧、尾帧、参考图、源视频或音频；每项有固定来源引用和用途。 |

### C07 声音

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `mode` | `voice \| music \| effect` | 配音、音乐或音效；仅列当前文档明确的三种创作模式。 |
| `selectedModelId` | `string`，可选 | 用户所选展示模型的 ID。 |
| `candidateCount` | `number`，可选 | 期望候选数。 |
| `voiceSpec` | 对象，可选 | 配音字段：`text?`、`speakerRef?`、`voiceRef?`、`language?`、`speakingRate?`、`emotion?`、`pronunciationNotes?`。逐句台词身份保存在被引用的台词对象。 |
| `musicSpec` | 对象，可选 | 音乐字段：`instruction?`、`mood?`、`style?`、`instruments?`、`tempoBpm?`、`targetDurationMs?`、`vocalPolicy?`。 |
| `effectSpec` | 对象，可选 | 音效字段：`instruction?`、`event?`、`environment?`、`intensity?`、`targetDurationMs?`、`loopIntent?`。 |
| `localInputRefs` | 具名引用对象，可选 | 节点内直接选择的参考音频、已有音频或台词版本引用；连线输入不重复写入。 |

### C08 剪辑

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `timelineRef` | `{ timelineId: string; version: number }`，可选 | 当前时间线工程的固定版本。轨道、`clipId`、源文件版本、入出点、字幕、混音和导出设置由工程对象保存。 |

## 3. 类型定义中与这八类有关的字段

八类均采用已讨论的公共类型定义：`type`、`displayName`、`description`、`icon`、`schemaVersion`、`dataSchema`、`defaultData`、`inputs`、`outputs`、`operations`、`allowedCanvasKinds`。本轮只确定 `data` 的字段草案，不在这里填写各类的端口、操作和可用模型列表，也不在领域模型中保存 CSS 或 Vue 组件。C01～C08 是本文的业务类型编号；现有画布中的 `scriptNode` 等运行时字符串不在此处直接确认为长期 `type` 值。

## 4. 本草案主动留下的边界

- `ShotList` 已有部分实现；`DirectorSpec` 与 `ReferencePack` 在本稿中仅确定建议的领域字段，表结构、授权和编辑流程尚未定稿；`Timeline` 的内部字段仍待设计。
- 现有素材只用 `assetId` 指向不可原地替换的图片内容；若以后建立素材修订，须明确旧画布的引用迁移与历史内容读取规则，不能直接给旧引用补一个虚构的 `revision: 1`。
- `localInputRefs` 的具体具名键与引用联合类型，要与各节点的输入端口定义一起定稿；它不是任意 URL 或文件路径字典。
- 图片、视频和声音的模式专有参数只列出稳定的产品字段；模型能力不同带来的专有参数不提前提升为所有节点的共同字段。
- 旧画布的 `type` 字符串如何映射到这八类、现有 `data.version` 如何迁移，属于兼容方案，不在本字段草案中定稿。
