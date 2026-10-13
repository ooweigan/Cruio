# 剧本相关平台能力调研

调研日期：2026-09-29。仅记录官方页面明确描述的能力；“剧本正文”“分镜”“视频”是不同产物。此文档覆盖 LTX Studio、Runway、CapCut、Pictory、InVideo、Descript，供 C01 剧本节点讨论使用，不是 Cruio 的字段定稿。

## LTX Studio

| 场景 | 输入 | 官方明确描述的产物与能力 | 证据 |
| --- | --- | --- | --- |
| 从剧本启动项目 | 上传已有剧本 | 自动生成场景和分镜。官网把它列为项目入口之一，并与“从概念、图片、视频启动”并列。这里剧本是**输入**，不能据此认定该功能会输出新剧本文档。 | [LTX Studio 官网](https://website.ltx.studio/) |
| 从文字制作动画 | 写提示词或上传剧本 | 生成带场景和镜头方向的结构化分镜；之后可调整风格、镜头类型、机位、音频和视觉效果，再导出视频。结构化分镜与导出视频属于不同制作阶段。 | [AI Animation Generator](https://website.ltx.studio/studio/platform/ai-animation-generator) |
| 剧本与概念开发 | 概念或创作要求；页面未列具体输入字段 | 官方称可生成 scripts、shot lists、pitch visuals，但未给出剧本文档结构、版本语义或剧本文件导出格式。 | [LTX Enterprise](https://website.ltx.studio/studio/enterprise) |
| 影视提案 | 创意概念、项目设置 | 可形成按场景拆分的可编辑分镜，并生成涵盖梗概、角色、风格等内容的提案；**提案**可导出 PDF，生成素材可下载为 ZIP。这不是“剧本导出 PDF”的证据。 | [AI Pitch Deck Generator](https://website.ltx.studio/studio/platform/pitch-deck-generator) |
| 预演与成片 | 剧本或概念，经场景与镜头可视化后继续制作 | 官方将 Storyboard、animatic、Video Editor 分为不同工作空间或步骤，说明从剧本到视觉分镜、预演及视频编辑是连续但不同的产物。 | [TV & Media Networks](https://website.ltx.studio/studio/solution/tv-media-networks) |

**核对结论：** LTX 明确支持“已有剧本 → 场景/分镜 → 视频”以及“AI 生成剧本”这一大类能力；公开页面没有足够细节证明其 AI 生成剧本必然是可导出的完整标准剧本文档，也没有证明剧本正文与分镜采用同一数据结构。[官网](https://website.ltx.studio/) · [企业功能页](https://website.ltx.studio/studio/enterprise)

## Runway

| 场景 | 输入 | 官方明确描述的产物与能力 | 证据 |
| --- | --- | --- | --- |
| Agent 创作规划 | 自然语言创意、可选素材 | Agent 可帮助写 script 和 narrative structure；也可另行生成 storyboards、mood boards、character sheets，以及图像、视频、音频。官网将文本规划与视觉资产列为不同能力，没有规定一个固定的剧本对象结构。 | [Creating with Runway Agent](https://help.runwayml.com/hc/en-us/articles/51601639579667-Creating-with-Runway-Agent) |
| 从文档或剧本生成 | 上传 PDF，附带自然语言任务描述；文本 PDF 与扫描 PDF 均支持，单文件不超过 20 MB | Agent 可读取 brief/script 的语气、参考与规格，用于生成图像、视频、音频或多镜头项目。Word、TXT、Google Doc 需先转 PDF。PDF 在这里是**输入文档格式**，不是剧本输出格式。 | [Creating from PDFs with Runway Agent](https://help.runwayml.com/hc/en-us/articles/54355254443923-Creating-from-PDFs-with-Runway-Agent) |
| 角色台词成片 | 角色预设或角色图片，加输入台词或已有音频；文本模式需选择声音 | Character Script to Video 生成角色同步表演的视频。此处 `script` 指角色要说的台词文本，不等于完整故事剧本；产物是视频。 | [Character Script to Video](https://help.runwayml.com/hc/en-us/articles/51285026291219-Character-Script-to-Video) |
| 长视频策划 | 故事、分镜与逐镜描述 | 官方建议每帧分镜对应一次潜在镜头生成，逐镜描述作为视频提示词基础；随后生成镜头、组装粗剪。这是创作方法说明，未声称自动输出标准剧本文件。 | [How to create longer videos and films](https://help.runwayml.com/hc/en-us/articles/26871350018835-How-to-create-longer-videos-and-films) |
| 多镜头剪辑 | Agent 生成的多镜头视频与音频 | Agent 在 Final Cut 中自动合并片段和音频；用户可再裁切、分割和编排。这是视频时间线产物，不是剧本产物。 | [Creating with Runway Agent](https://help.runwayml.com/hc/en-us/articles/51601639579667-Creating-with-Runway-Agent) |

**核对结论：** Runway 官方明确有剧本写作辅助和以剧本为创作输入的能力，但未在上述资料中规定稳定的“剧本对象”字段，也未明确说明可把 Agent 写出的剧本导出为 PDF、FDX、Fountain 等完整剧本文件。其 `Character Script to Video` 的 script 是单个角色表演的台词，不宜与 C01 的完整剧本混同。[Agent 文档](https://help.runwayml.com/hc/en-us/articles/51601639579667-Creating-with-Runway-Agent) · [角色台词视频文档](https://help.runwayml.com/hc/en-us/articles/51285026291219-Character-Script-to-Video)

## CapCut

| 场景 | 输入 | 官方明确描述的产物与能力 | 证据 |
| --- | --- | --- | --- |
| AI 剧本写作 | 主题或创意；可逐步扩展主题和提纲 | 生成可继续编辑的剧本文字；可控制篇幅、文风和写作要求。剧本是视频生成前的独立可审阅文本阶段。 | [AI Writer](https://www.capcut.com/tools/ai-writer) |
| Script to Video | 自写剧本或 AI Writer 的剧本 | 用户选择剧本并修改后，可生成含视觉内容、旁白、音乐或字幕的视频草稿，再进入多轨编辑器；最终导出视频。视频属于后续流程的产物。 | [Script to Video](https://www.capcut.com/tools/script-to-video-maker) · [桌面版说明](https://www.capcut.com/tools/desktop-ai-power) |

## Pictory

| 场景 | 输入 | 官方明确描述的产物与能力 | 证据 |
| --- | --- | --- | --- |
| 从想法写剧本 | 视频目标、平台、语气、比例和目标长度等 | 生成剧本草稿；用户可以直接编辑，或使用改写、缩短、加长、调整语气等工具。页面显示预计时长和按句子／换行划分场景的选项。 | [Video Preferences](https://kb.pictory.ai/en/articles/15690545-video-preferences) |
| 从剧本制作视频 | 粘贴／输入剧本，或用 AI 起草剧本 | 将文本分成场景，匹配视觉、字幕和旁白，形成可编辑的 storyboard；随后渲染并导出视频。storyboard 是后续制作产物，不等于剧本文本本身。 | [Script to Video 官方教程](https://pictory.ai/academy/how-to-turn-script-into-video-pictory-ai) |
| 从文档制作视频 | 当前官方帮助中心明确支持 PDF | 归纳文档并形成带逐场景文字、画面和旁白的 storyboard，最后导出视频。该入口是文档转视频，不证明剧本本身必须保存为 PDF。 | [Doc to Video 帮助中心](https://kb.pictory.ai/en/articles/15137793-turn-a-document-into-a-video-doc-to-video) |

## InVideo

| 场景 | 输入 | 官方明确描述的产物与能力 | 证据 |
| --- | --- | --- | --- |
| 使用自己的剧本 | 用户在提示页选择 `Use my script` 并提供全文，还可设置媒体、背景音乐、字幕样式和语言 | 生成视频；Agent 模式可通过对话逐步制作，Autopilot 可走一次生成流程。此处剧本是输入，而非 InVideo 承诺输出的独立剧本文档。 | [使用已有剧本制作视频](https://help.invideo.io/en/articles/9382180-how-can-i-create-a-video-using-my-script) |
| 后续编辑 | 已生成的视频及其脚本文字 | 官方帮助中心列有编辑剧本、编辑／增删章节，以及拆分／合并剧本行的功能入口；这些文字与视频编辑关联。 | [Autopilot 帮助中心目录](https://help.invideo.io/en/collections/9486768-autopilot) |

## Descript

| 场景 | 输入 | 官方明确描述的产物与能力 | 证据 |
| --- | --- | --- | --- |
| AI 写作工具 | 写作请求、已有内容或项目上下文 | 官方把 `Write a script`、`Write an outline` 和 `Rewrite` 列为不同 AI 工具；说明文本创作本身可以是独立操作，但页面未定义统一的剧本数据格式。 | [AI 工具用量说明](https://help.descript.com/hc/en-us/articles/27841674958221-Track-and-understand-your-Media-minutes-and-AI-Credits) |
| 文本参与视频编辑 | 剧本或转录文本；Quick Design 还要求项目脚本轨已有媒体 | 将内容划分为场景、添加布局和可选 B-roll，得到可继续编辑的视频粗剪。粗剪是视频项目产物，不是新剧本文档。 | [Quick Design](https://help.descript.com/ai-assistant/quick-design) |
| 剧本转配音 | 手写、粘贴或在 Write 模式生成的剧本文字，选择 AI Speaker | 生成对应语音；这里音频是独立于剧本文字的输出。 | [Stock AI Speakers](https://help.descript.com/hc/en-us/articles/10165983351565-Stock-AI-speakers) |

## 对 C01 字段设计可直接采用的事实边界

1. 这些平台存在两条不同入口：**已有剧本作为输入**，或**从概念辅助创作剧本**。[LTX 官网](https://website.ltx.studio/) · [CapCut AI Writer](https://www.capcut.com/tools/ai-writer) · [Pictory 视频偏好设置](https://kb.pictory.ai/en/articles/15690545-video-preferences) · [InVideo 已有剧本入口](https://help.invideo.io/en/articles/9382180-how-can-i-create-a-video-using-my-script)
2. “剧本文本”“场景/镜头分镜”“生成的视频或剪辑项目”应当在调研中分开表述；平台虽然串联这些阶段，但公开资料未把它们定义成一个同质输出。[LTX 动画工具](https://website.ltx.studio/studio/platform/ai-animation-generator) · [Pictory 官方教程](https://pictory.ai/academy/how-to-turn-script-into-video-pictory-ai) · [Descript Quick Design](https://help.descript.com/ai-assistant/quick-design)
3. 不能根据 LTX 提案 PDF 或 Runway 的 PDF 上传，推导出“剧本节点必须输出 PDF”；两处 PDF 分别是**提案输出**与**参考文档输入**。[LTX 提案工具](https://website.ltx.studio/studio/platform/pitch-deck-generator) · [Runway PDF 输入说明](https://help.runwayml.com/hc/en-us/articles/54355254443923-Creating-from-PDFs-with-Runway-Agent)
