<template>
  <main v-if="workflow" class="canvasShell" :class="{ compactNodes: viewport.zoom < 0.75, tinyNodes: viewport.zoom < 0.45 }">
    <header class="canvasHeader">
      <button class="brandButton" type="button" @click="router.push('/projects')">
        <span class="brandMark">C</span><span>CRUIO</span>
      </button>
      <div class="workflowIdentity">
        <button type="button" @click="goBack">{{ isProjectCanvas ? "项目" : "工作流库" }}</button>
        <span>/</span>
        <strong>{{ workflow.name }}</strong>
      </div>
      <div class="canvasActions">
        <span class="saveStatus" :class="saveState">{{ saveLabel }}</span>
        <button v-if="saveState === 'error'" class="textButton" type="button" @click="saveCanvas(changeRevision)">重试保存</button>
        <div ref="nodePickerAnchor" class="nodePickerAnchor">
          <button ref="nodePickerTrigger" class="primaryButton" type="button" aria-haspopup="dialog" :aria-expanded="showNodePicker" aria-controls="nodePicker" @click="toggleNodePicker">添加节点</button>
          <section v-if="showNodePicker" id="nodePicker" class="nodePicker" role="dialog" aria-label="选择节点类型">
            <div class="pickerHeading">
              <div><span>节点库</span><h2>添加到画布</h2></div>
              <button class="pickerClose" type="button" aria-label="关闭节点库" @click="closeNodePicker">×</button>
            </div>
            <template v-if="pickerView === 'types'">
              <button class="nodeChoice" type="button" @click="addContentNode('textNode')">
                <span class="choiceMark">T</span>
                <span><strong>文本草稿</strong><small>手动记录并保存文案，不会输入生成任务</small></span>
                <span class="choiceArrow">↗</span>
              </button>
              <button v-if="imageModels.length" class="nodeChoice" type="button" @click="addGenerationNode('imageGenerationNode')">
                <span class="choiceMark referenceMark">▧</span>
                <span><strong>图片生成</strong><small>添加生成定义，使用服务端已开放模型</small></span>
                <span class="choiceArrow">↗</span>
              </button>
              <div v-else class="nodeChoice unavailableChoice" aria-disabled="true">
                <span class="choiceMark referenceMark">▧</span>
                <span><strong>图片生成</strong><small>{{ modelDirectoryMessage("image.generate") }}</small></span>
                <span class="choiceState">暂不可用</span>
              </div>
              <button v-if="videoModels.length" class="nodeChoice" type="button" @click="addGenerationNode('videoGenerationNode')">
                <span class="choiceMark referenceMark">▷</span>
                <span><strong>视频生成</strong><small>添加生成定义，使用服务端已开放模型</small></span>
                <span class="choiceArrow">↗</span>
              </button>
              <div v-else class="nodeChoice unavailableChoice" aria-disabled="true">
                <span class="choiceMark referenceMark">▷</span>
                <span><strong>视频生成</strong><small>{{ modelDirectoryMessage("video.generate") }}</small></span>
                <span class="choiceState">暂不可用</span>
              </div>
              <p v-for="model in unavailableModels" :key="model.modelId" class="capabilityUnavailable">{{ modelName(model) }} 暂不可用：{{ model.unavailableReason ?? "能力尚未开放" }}</p>
              <p v-if="modelsLoadError" class="capabilityUnavailable">模型目录读取失败：{{ modelsLoadError }}</p>
              <button v-if="isProjectCanvas" class="nodeChoice" type="button" @click="showMediaChoices">
                <span class="choiceMark referenceMark">▧</span>
                <span><strong>素材</strong><small>上传并声明来源，或引用已有素材</small></span>
                <span class="choiceArrow">›</span>
              </button>
              <button v-if="isProjectCanvas" class="nodeChoice" type="button" @click="showWorkflowChoices">
                <span class="choiceMark referenceMark">◇</span>
                <span><strong>工作流引用</strong><small>把项目已引入的工作流放入画布</small></span>
                <span class="choiceArrow">›</span>
              </button>
              <p v-if="!isProjectCanvas" class="pickerFootnote">文本节点只保存文本草稿。旧版“提示词草稿”仍可查看和编辑；生成节点在这里仅保存工作流定义，需放入项目后才能报价和执行。</p>
              <p v-else class="pickerFootnote">文本节点只保存文本草稿，不会触发生成；生成操作按服务端模型能力提供。</p>
            </template>
            <template v-else>
              <template v-if="pickerView === 'media'">
                <button class="pickerBack" type="button" @click="showNodeTypes">← 返回节点类型</button>
                <label class="uploadField">
                  上传素材
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="uploadMedia" />
                </label>
                <label class="uploadField">素材来源
                  <select v-model="mediaSource">
                    <option value="self_created">本人创作</option>
                    <option value="licensed">已取得许可</option>
                    <option value="third_party_authorized">第三方已授权</option>
                  </select>
                </label>
                <label class="uploadField">
                  用途
                  <input v-model="mediaUsage" maxlength="200" placeholder="例如：作为生成参考图" />
                </label>
                <label class="declarationCheck"><input v-model="mediaAuthorized" type="checkbox" />我声明拥有该素材，或已取得用于此目的的必要许可</label>
                <label class="declarationCheck"><input v-model="containsRealPerson" type="checkbox" />素材包含真人</label>
                <label v-if="containsRealPerson" class="declarationCheck"><input v-model="subjectIsAdult" type="checkbox" />我确认素材中的真人均为成年人</label>
                <p class="pickerFootnote">此声明由你作出，平台不验证素材权属。未成年人真人素材不能上传。</p>
                <div v-if="mediaItems.length" class="workflowChoices">
                  <button v-for="item in mediaItems" :key="item.id" type="button" @click="addMediaNode(item)">
                    <strong>{{ item.fileName }}</strong><small>{{ item.mediaType }} · {{ item.usage }}</small>
                  </button>
                </div>
              </template>
    <template v-else>
              <button class="pickerBack" type="button" @click="showNodeTypes">← 返回节点类型</button>
              <div v-if="bindings.length" class="workflowChoices">
                <button v-for="binding in bindings" :key="binding.id" type="button" @click="addWorkflowReference(binding.id)">
                  <strong>{{ binding.name }}</strong><small>项目引用 v{{ binding.version }}</small>
                </button>
              </div>
              <div v-else class="pickerEmpty">
                <p>这个项目还没有引入工作流。</p>
                <button type="button" @click="router.push(`/projects/${projectId}`)">返回项目引入工作流</button>
              </div>
              </template>
            </template>
          </section>
        </div>
      </div>
    </header>

    <div class="projectMetrics" aria-label="当前项目状态">
      <span>{{ isProjectCanvas ? "项目专属画布" : "工作流定义" }}</span>
      <span>{{ isProjectCanvas ? "当前运行范围：单个选中节点" : "保存后形成独立工作流版本" }}</span>
      <button v-if="isProjectCanvas" class="metricsLink" type="button" @click="router.push(`/projects/${projectId}`)">查看项目任务与作品</button>

    </div>

    <section class="workspace">
      <aside class="stationPanel" aria-label="工作区导航">
        <button class="backButton" type="button" @click="goBack">{{ isProjectCanvas ? "返回项目" : "返回工作流库" }}</button>
        <nav class="stationNav" aria-label="创作工位">
          <button class="stationActive" type="button" aria-label="画布" title="画布" @click="clearSelection()"><span aria-hidden="true">⌘</span><span class="stationLabel">画布</span></button>
          <button v-if="isProjectCanvas" type="button" aria-label="任务与作品" title="任务与作品" @click="router.push(`/projects/${projectId}`)"><span aria-hidden="true">▤</span><span class="stationLabel">任务与作品</span></button>
        </nav>
        <div class="stationInfo">
          <p class="eyebrow">{{ isProjectCanvas ? "项目" : "工作流" }}</p>
          <strong>{{ workflow.name }}</strong>
        </div>
      </aside>

      <dialog ref="editorDialog" class="nodeEditorDialog" :class="{ scriptDialog: selectedNode?.type === 'scriptNode' && editorPurpose === 'edit' }" aria-labelledby="editorTitle" @cancel.prevent="closeEditor" @click="onDialogBackdrop">
        <section v-if="selectedNode && editorOpen" class="editorLayout">
          <header class="editorHeader"><span class="editorTypeIcon"><nodeIcon :kind="selectedStation?.id ?? 'workflow'" /></span><div><h2 id="editorTitle">{{ editorPurpose === 'history' ? '执行历史' : editorPurpose === 'execute' ? '执行节点' : `编辑${selectedStation?.label ?? '节点'}` }} · {{ selectedNode.data.label }}</h2><p>{{ editorPurpose === 'history' ? '查看此节点的真实执行记录与结果' : editorPurpose === 'execute' ? '确认报价后执行当前节点' : selectedNode.type === 'scriptNode' ? '选择剧本、阅读正文，将确认的定稿交给后续制作' : '专注当前创作，保存后回到画布' }}</p></div><button class="pickerClose" type="button" aria-label="关闭节点弹窗" @click="closeEditor">×</button></header>
          <div class="editorBody">
          <div class="editorForm">
        <template v-if="selectedNode && editorPurpose !== 'history'">


          <div v-if="selectedNode.type === 'workflowReference' && editorPurpose === 'edit'" class="referenceDetails">
            <strong>{{ bindingFor(selectedNode.data.workflowId)?.name ?? selectedNode.data.label }}</strong>
            <span>项目引用 v{{ bindingFor(selectedNode.data.workflowId)?.version ?? "?" }}</span>
            <button v-if="bindingFor(selectedNode.data.workflowId)" class="linkButton" type="button" @click="openSourceWorkflow(selectedNode.data.workflowId)">编辑源工作流</button>
          </div>
          <label v-if="editorPurpose === 'edit' && selectedNode.type !== 'scriptNode'" class="fieldLabel titleField">
            节点标题
            <input v-model="selectedNode.data.label" class="textInput" maxlength="160" :aria-invalid="!!titleError" aria-describedby="titleError" aria-label="节点标题" />
          </label>
          <p v-if="titleError" id="titleError" class="errorMessage" role="alert">{{ titleError }}</p>
          <div v-if="selectedNode.type === 'mediaNode'" class="mediaDetails">
            <strong>{{ selectedNode.data.fileName }}</strong>
            <img v-if="selectedNode.data.mediaType?.startsWith('image/')" :src="mediaReadUrl(selectedNode.data.assetId)" :alt="selectedNode.data.fileName" />
            <span>素材引用 · {{ selectedNode.data.mediaStatus ?? "可用" }}</span>
            <button class="linkButton" type="button" @click="retractMedia(selectedNode.data.assetId)">撤回素材</button>
          </div>
          <scriptNodeEditor v-if="selectedNode.type === 'scriptNode' && editorPurpose === 'edit'" :key="selectedNode.id" ref="scriptEditor" :nodeId="selectedNode.id" :scriptRef="nodes.find(node => node.id === selectedNodeId)?.data.scriptRef" :legacyContent="selectedNode.data.content" :suggestedTitle="selectedNode.data.label" :writingBrief="selectedNode.data.writingBrief" :model="selectedNode.data.model" :models="scriptModels" :saving="editorSaving" @setScriptRef="setScriptRef" @updateWritingBrief="setWritingBrief" @updateModel="setScriptModel" @adopt="saveEditor" />
          <shotListNodeEditor v-if="selectedNode.type === 'storyboardNode' && editorPurpose === 'edit'" :key="selectedNode.id" ref="shotListEditor" :nodeId="selectedNode.id" :shotListRef="selectedNode.data.shotListRef" :suggestedTitle="selectedNode.data.label" :planningBrief="selectedNode.data.planningBrief" :splitSettings="selectedNode.data.splitSettings" @setShotListRef="setShotListRef" @updatePlanningBrief="setPlanningBrief" @updateSplitSettings="setSplitSettings" />
          <label v-if="editorPurpose === 'edit' && ['textNode', 'promptNode', 'imageGenerationNode', 'videoGenerationNode'].includes(selectedNode.type ?? '')" class="fieldLabel contentField">
            {{ selectedNode.type === "promptNode" ? "提示词草稿" : selectedNode.type?.endsWith("GenerationNode") ? "生成提示词" : "文本内容" }}
            <textarea :value="['imageGenerationNode', 'videoGenerationNode'].includes(selectedNode.type ?? '') ? selectedNode.data.prompt ?? '' : selectedNode.data.content ?? ''" class="textArea" :aria-label="selectedNode.type?.endsWith('GenerationNode') ? '生成提示词' : selectedNode.type === 'promptNode' ? '提示词草稿内容' : '文本内容'" rows="7" @input="updateNodePrompt($event)" />
          </label>
          <p v-if="selectedNode.type === 'promptNode'" class="fieldHint">这是旧版提示词草稿节点，仅保存提示文字，不会执行生成。需要生成时，请在项目画布使用可用的图片或视频生成节点。</p>
          <p v-if="['directorNode', 'soundNode', 'editingNode'].includes(selectedNode.type ?? '')" class="fieldHint">此工位当前仅保存节点定义；相关操作尚未接入，不会执行模型或产生费用。</p>
          <section v-if="selectedNode.type === 'materialStationNode'" class="stationBindingPanel">
            <p class="fieldHint">选择已有素材后，此节点会变为该素材的真实引用。</p>
            <div v-if="isProjectCanvas && mediaItems.length" class="workflowChoices">
              <button v-for="item in mediaItems" :key="item.id" type="button" @click="bindStationMedia(selectedNode.id, item)">
                <strong>{{ item.fileName }}</strong><small>{{ item.mediaType }} · {{ item.usage }}</small>
              </button>
            </div>
            <p v-else-if="isProjectCanvas" class="fieldHint">项目素材库暂无可选素材。</p>
            <button v-if="isProjectCanvas" class="secondaryButton" type="button" @click="openMediaPicker">上传或管理素材</button>
            <p v-else class="fieldHint">工作流定义暂不绑定项目私有素材；该节点不会发起生成。</p>
          </section>
          <section v-if="selectedNode.type === 'workflowNode'" class="stationBindingPanel">
            <p v-if="isProjectCanvas" class="fieldHint">选择项目已引入的固定版本后，此节点会变为真实工作流引用。</p>
            <div v-if="isProjectCanvas && bindings.length" class="workflowChoices">
              <button v-for="binding in bindings" :key="binding.id" type="button" @click="bindStationWorkflow(selectedNode.id, binding.id)">
                <strong>{{ binding.name }}</strong><small>项目引用 v{{ binding.version }}</small>
              </button>
            </div>
            <p v-else-if="isProjectCanvas" class="fieldHint">项目尚未引入工作流。</p>
            <button v-if="isProjectCanvas" class="secondaryButton" type="button" @click="router.push(`/projects/${projectId}`)">查看项目工作流</button>
            <p v-else class="fieldHint">独立工作流中的工作流工位仅保留节点定义，不会创建子运行或产生费用。</p>
          </section>
          <section v-if="editorPurpose === 'edit' && ['imageGenerationNode', 'videoGenerationNode'].includes(selectedNode.type ?? '')" class="runPanel">
            <p class="eyebrow">工作流定义</p>
            <label class="fieldLabel">可用模型
              <select v-model="selectedModelId" class="textInput" aria-label="选择生成模型" @change="setSelectedModel(selectedModelId)">
                <option value="" disabled>选择服务端开放的模型</option>
                <option v-for="model in modelsForSelectedNode" :key="model.modelId" :value="model.modelId">{{ modelName(model) }} · {{ model.operation }}</option>
              </select>
            </label>
            <p v-if="!modelsForSelectedNode.length" class="fieldHint">{{ modelDirectoryMessage(selectedNode.type === "imageGenerationNode" ? "image.generate" : "video.generate") }}</p>
            <p class="fieldHint">此处保存节点与模型定义，不会创建生成任务或产生费用。将工作流引入项目后，才能在项目画布获取报价并执行。</p>
          </section>
          <section v-if="editorPurpose === 'execute' && isProjectCanvas && ['imageGenerationNode', 'videoGenerationNode'].includes(selectedNode.type ?? '')" class="runPanel">
            <div class="panelRule" />
            <p class="eyebrow">生成任务</p>
            <label class="fieldLabel">可用模型
              <select v-model="selectedModelId" class="textInput" aria-label="选择生成模型" @change="setSelectedModel(selectedModelId)">
                <option value="" disabled>选择服务端开放的模型</option>
                <option v-for="model in modelsForSelectedNode" :key="model.modelId" :value="model.modelId">{{ modelName(model) }} · {{ model.operation }}</option>
              </select>
            </label>
            <button class="primaryButton runButton" type="button" :disabled="working || !selectedModelId || selectedNode.data.disabled" @click="requestQuote">获取报价</button>
            <div v-if="quote" class="quoteCard">
              <strong>本次报价 {{ quote.credits }} 点</strong>
              <p>确认范围：当前节点。报价有效期至 {{ formatDate(quote.expiresAt) }}。</p>
              <p v-for="block in quote.blocks ?? quote.plan.blocks ?? []" :key="block">{{ quoteBlockMessage([block]) }}</p>
              <button class="primaryButton" type="button" :disabled="working || !!quote.blocks?.length || !!quote.plan.blocks?.length" @click="submitTask">确认报价并提交</button>
            </div>
            <div v-if="task" class="taskCard">
              <div><strong>任务 {{ task.taskId }}</strong><span>{{ taskStatusLabel(task.status) }}</span></div>
              <button class="linkButton" type="button" :disabled="working" @click="refreshTask">刷新状态</button>
              <div v-for="result in task.results ?? []" :key="result.resultId" class="taskResult">
                <img v-if="result.mediaType === 'image'" :src="result.previewUrl" alt="生成结果" />
                <video v-else-if="result.mediaType === 'video'" :src="result.previewUrl" controls aria-label="生成结果" />
                <a :href="result.downloadUrl" download>下载结果</a>
                <span v-if="task.adoptedResultId === result.resultId" class="adoptionStatus">正式输出</span>
                <button v-else-if="task.status === 'delivered'" class="secondaryButton" type="button" :disabled="working" @click="adoptResult(result.resultId)">采用此结果</button>
                <button v-if="task.status === 'delivered'" class="linkButton" type="button" :disabled="working" @click="saveWork(result.resultId)">保存为作品</button>
              </div>
              <p v-if="task.failure">{{ task.failure }}</p>
              <p v-if="task.blocks?.length">{{ task.blocks.join("；") }}</p>
              <label v-if="task.status === 'delivered'" class="fieldLabel workTitle">作品名称
                <input v-model="workTitle" class="textInput" maxlength="120" />
              </label>
            </div>
          </section>
        </template>
        <section v-if="editorPurpose === 'history'" class="executionHistory" aria-label="节点执行历史">
          <div class="historyHeading"><strong>已加载 {{ nodeHistory.length }} 条记录</strong><button class="secondaryButton" type="button" :disabled="historyLoading" @click="loadNodeHistory(false)">刷新</button></div>
          <p v-if="historyLoading" role="status">正在读取执行历史…</p>
          <div v-if="historyError" class="errorMessage" role="alert">历史记录加载失败。<button class="textButton" type="button" @click="loadNodeHistory(false)">重试</button></div>
          <p v-if="!historyLoading && !historyError && !nodeHistory.length" class="fieldHint">{{ isProjectCanvas ? historyCursor ? '本页暂无此节点记录，可继续加载更早记录。' : '此节点还没有执行记录。' : '工作流定义不直接运行。在项目中执行后，可从项目画布查看历史。' }}</p>
          <article v-for="record in nodeHistory" :key="record.taskId" class="historyCard"><div class="historyHeading"><strong>{{ taskStatusLabel(record.status) }}</strong><span>{{ record.createdAt ? formatDate(record.createdAt) : record.taskId }}</span></div><p v-if="record.failure" class="errorMessage">{{ record.failure }}</p><p v-if="record.blocks?.length" class="errorMessage">{{ quoteBlockMessage(record.blocks) }}</p><div class="historyResults"><button v-for="result in record.results ?? []" :key="result.resultId" class="historyResult" type="button" @click="openPreview(result.previewUrl, result.mediaType)"><img v-if="result.mediaType === 'image'" :src="result.previewUrl" alt="历史生成结果" /><nodeIcon v-else kind="play" /><span>{{ result.mediaType === 'image' ? '查看图片' : '播放视频' }}{{ record.adoptedResultId === result.resultId ? ' · 正式输出' : '' }}</span></button></div><button v-if="['queued', 'running', 'succeeded'].includes(record.status)" class="textButton" type="button" @click="loadNodeHistory(false)">刷新执行状态</button></article>
          <button v-if="historyCursor" class="secondaryButton" type="button" :disabled="historyLoading" @click="loadNodeHistory(true)">加载更早记录</button>
        </section>
        <p v-if="message" class="errorMessage" role="status">{{ message }}</p>
          </div>
          </div>
          <footer class="editorFooter"><span>{{ editorPurpose === 'edit' ? selectedNode.type === 'scriptNode' ? '只有确认采用的剧本，才会成为定稿输出' : '保存配置后，单独执行节点' : editorPurpose === 'history' ? '历史结果不会自动替换当前输出' : '运行范围：当前节点' }}</span><div v-if="editorPurpose === 'edit'"><button class="secondaryButton" type="button" :disabled="editorSaving || scriptEditor?.working" @click="closeEditor">{{ selectedNode.type === 'scriptNode' ? '关闭' : '取消' }}</button><button v-if="selectedNode.type !== 'scriptNode'" class="primaryButton" type="button" :disabled="editorSaving || working" @click="saveEditor">{{ editorSaving ? '正在保存…' : '保存节点' }}</button></div><button v-else class="secondaryButton" type="button" :disabled="working" @click="closeEditor">关闭</button></footer>
        </section>
      </dialog>
      <dialog ref="discardDialog" class="discardDialog" aria-labelledby="discardTitle" @cancel.prevent="discardDialog?.close()"><h2 id="discardTitle">保留这次修改吗？</h2><p>{{ selectedNode?.type === 'scriptNode' ? '创作要求或草稿有未保存的修改。返回继续编辑并采用定稿，或放弃修改关闭详情页。当前定稿不会改变。' : '当前节点有未保存的修改。你可以保存，或放弃并返回画布。' }}</p><div><button class="secondaryButton" type="button" @click="discardDialog?.close()">继续编辑</button><button class="secondaryButton" type="button" @click="discardEditor">放弃修改</button><button v-if="selectedNode?.type !== 'scriptNode'" class="primaryButton" type="button" :disabled="editorSaving" @click="discardDialog?.close(); saveEditor()">保存节点</button></div></dialog>
      <dialog ref="previewDialog" class="previewDialog" aria-label="内容预览" @click="onPreviewBackdrop"><button class="pickerClose" type="button" aria-label="关闭预览" @click="previewDialog?.close()">×</button><img v-if="previewType === 'image'" :src="previewUrl" alt="节点内容预览" /><video v-else :src="previewUrl" controls autoplay aria-label="节点视频预览" /></dialog>

      <div ref="canvasPanel" class="canvasPanel" :aria-label="isProjectCanvas ? 'Cruio 项目画布' : 'Cruio 工作流图'" @dragover.prevent="allowStationDrop" @drop.prevent="onStationDrop">
        <nav class="stationToolbar" aria-label="添加创作工位">
          <button
            v-for="station in stationDefinitions"
            :key="station.id"
            class="stationTool"
            type="button"
            draggable="true"
            :title="`${station.label}：拖到画布添加，也可点击添加`"
            :aria-label="`添加${station.label}节点；可拖到画布，也可按 Enter 或空格添加`"
            @click="addStationNode(station.id)"
            @dragstart="startStationDrag($event, station.id)"
          >
            <nodeIcon :kind="station.id" />
            <span>{{ station.label }}</span>
          </button>
        </nav>
        <vue-flow
          v-model:nodes="nodes"
          v-model:edges="edges"
          :minZoom="0.25"
          :maxZoom="2"
          :deleteKeyCode="null"
          :noDragClassName="'nodrag'"
          :defaultEdgeOptions="{ type: 'default', style: { stroke: '#c9c1df', strokeWidth: 1.6 } }"
          :elevateEdgesOnSelect="true"
          :isValidConnection="isValidConnection"
          @connect="onConnect"
          @nodesInitialized="frameCanvas"
          @nodeClick="onNodeClick"
          @nodeDoubleClick="openNodeDetails($event.node.id)"
          @edgeClick="onEdgeClick"
          @paneClick="clearSelection()"
        >
          <template v-for="nodeType in cardNodeTypes" :key="nodeType" #[`node-${nodeType}`]="{ id, data }">
            <canvasNodeCard :nodeType="nodeType === 'default' || nodeType === 'input' || nodeType === 'output' ? 'basicNode' : nodeType" :data="data" :referenceName="bindingFor(data.workflowId)?.name" :referenceVersion="bindingFor(data.workflowId)?.version" :inputConnected="hasNodeConnection(id, 'target')" :outputConnected="hasNodeConnection(id, 'source')" :executionStatus="taskForNode(id)?.status" :canExecute="canExecuteNode(id)" :executionUnavailableReason="isProjectCanvas ? '此节点尚未接入执行能力' : '请在项目画布执行'" :progress="taskForNode(id)?.progress" :failure="taskForNode(id)?.failure" @execute="openExecution(id)" @history="openHistory(id)" @action="nodeAction(id, $event)" @preview="openPreview" @openDetails="openNodeDetails(id)" />
          </template>
          <template #node-mediaNode="{ id,data }"><mediaNodeCard :media="data" :previewUrl="mediaReadUrl(data.assetId)" :inputConnected="hasNodeConnection(id, 'target')" :outputConnected="hasNodeConnection(id, 'source')" :executionStatus="taskForNode(id)?.status" :canExecute="canExecuteNode(id)" :executionUnavailableReason="isProjectCanvas ? '此节点尚未接入执行能力' : '请在项目画布执行'" :progress="taskForNode(id)?.progress" :failure="taskForNode(id)?.failure" @execute="openExecution(id)" @history="openHistory(id)" @action="nodeAction(id, $event)" @preview="openPreview" @openDetails="openNodeDetails(id)" /></template>
          <background :gap="24" :size="1" patternColor="#e0dbe9" />
          <template #edge-default="edgeProps">
            <canvasEdge v-bind="edgeProps" :active="selectedEdgeId === edgeProps.id" :zoom="viewport.zoom" :options="insertableStations(edgeProps.id)" @remove="removeSelectedEdge" @insert="(type, position) => insertEdgeNode(edgeProps.id, type, position)" />
          </template>
          <mini-map pannable zoomable :nodeColor="'#dfd8f3'" :maskColor="'rgba(247,245,251,.7)'" />
          <div class="controlDock" role="toolbar" aria-label="画布缩放控制">
            <button type="button" aria-label="撤销画布操作" title="撤销画布操作" :disabled="!undoActions.length" @click="undoNodeAction">↶</button>
            <button type="button" aria-label="缩小画布" title="缩小画布" @click="zoomOut()">−</button>
            <select class="zoomPreset" aria-label="选择画布缩放预设" :value="zoomPreset" @change="setZoomPreset">
              <option value="" disabled>{{ Math.round(viewport.zoom * 100) }}%</option>
              <option value="0.5">50%</option>
              <option value="0.75">75%</option>
              <option value="1">100%</option>
            </select>
            <button type="button" aria-label="放大画布" title="放大画布" @click="zoomIn()">+</button>
            <button type="button" aria-label="整理节点布局" title="整理节点布局；保留连接，可撤销" @click="arrangeNodeLayout">整理</button>
            <button type="button" aria-label="适配所有节点" title="适配所有节点" @click="fitView({ padding: 0.3, maxZoom: 1 })">适配</button>
          </div>
          <div v-if="nodes.length === 0" class="canvasEmpty">
            <p class="eyebrow">{{ isProjectCanvas ? "空项目画布" : "空工作流" }}</p>
            <h2>从第一个节点开始</h2>
            <p>先选择节点类型，再放入画布。</p>
            <button class="primaryButton" type="button" @pointerdown.stop @click="openNodePicker">选择节点</button>
          </div>
        </vue-flow>
      </div>
    </section>
    <div v-if="toast" class="canvasToast" role="status">{{ toast }}<button v-if="toastUndo && undoActions.length" type="button" @click="undoNodeAction">撤销</button></div>
    <footer class="telemetryFooter">
      <span>文档：{{ saveLabel }}</span>
      <span v-if="task">任务：{{ taskStatusLabel(task.status) }}</span>
      <span>单击选中 · 双击编辑 · Enter 编辑</span>
      <span>{{ workflow.updatedAt ? formatDate(workflow.updatedAt) : "更新时间未知" }}</span>
    </footer>
  </main>
  <main v-else class="loadingState">正在打开画布…</main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import { Background } from "@vue-flow/background";
import { VueFlow, useVueFlow, type Connection } from "@vue-flow/core";
import { MiniMap } from "@vue-flow/minimap";
import nodeIcon from "@/components/nodeIcon.vue";
import canvasEdge from "@/components/canvasEdge.vue";
import canvasNodeCard from "@/components/canvasNodeCard.vue";
import mediaNodeCard from "@/components/mediaNodeCard.vue";
import scriptNodeEditor from "@/components/scriptNodeEditor.vue";
import shotListNodeEditor from "@/components/shotListNodeEditor.vue";
import { api, quoteBlockMessage } from "@/lib/cruioApi";
import { useCruioSession } from "@/stores/cruioSession";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/minimap/dist/style.css";

type FormalOutput = { resultId: string; taskId: string; adoptionVersion: number; mediaType: "image" | "video"; mimeType: string; sha256: string };
type CanvasNode = {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: { label: string; disabled?: boolean; content?: string; scriptRef?: { scriptId: string; version: number }; writingBrief?: { idea?: string; purpose?: string; audience?: string; keyPoints?: string; tone?: string; language?: string; targetLength?: { unit: "words" | "characters" | "minutes"; value: number }; constraints?: string }; shotListRef?: { shotListId: string; version: number }; planningBrief?: { emphasis?: string; pacingNotes?: string; constraints?: string }; splitSettings?: { granularity?: string; targetShotCount?: number; targetDurationMs?: number; visualExpansionPolicy?: "literal" | "nonPlotDetails" }; selectedModelId?: string; prompt?: string; model?: string; size?: string; ratio?: string; duration?: number; resolution?: string; mode?: string; generateAudio?: boolean; workflowId?: string; assetId?: string; fileName?: string; mediaType?: string; mediaStatus?: string; version?: number; formalOutput?: FormalOutput };
};
type StationId = "script" | "storyboard" | "material" | "director" | "image" | "video" | "sound" | "editing" | "workflow";
type CanvasEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};
type Workflow = {
  id: string;
  name: string;
  canvas: { nodes: CanvasNode[]; edges: CanvasEdge[] };
  version: number;
  updatedAt: string;
};
type WorkflowBinding = { id: string; name: string; version: number };
type MediaItem = { id: string; fileName: string; mediaType: string; size: number; source: string; usage: string; status: string; createdAt: string };
type GenerationModel = { modelId: string; upstreamModelId?: string; providerId?: string; label?: string; providerLabel: string; modelVersion?: string; operation: string; capabilities: { inputs?: string[]; parameters?: Record<string, unknown>; outputs?: string[] }; available: boolean; unavailableReason?: string };
type GenerationQuote = { quoteId: string; credits: number; expiresAt: string; plan: { blocks?: string[] }; blocks?: string[] };
type GenerationResult = { resultId: string; mediaType: string; mimeType: string; previewUrl: string; downloadUrl: string };
type GenerationTask = { taskId: string; createdAt?: string; nodeId?: string; workflowId?: string | null; status: string; operation: string; modelSnapshot: unknown; adoptedResultId?: string; adoptionVersion?: number; credits: { quoted: number; reserved: number; settled: number; released: number }; progress?: number; blocks: string[]; results: GenerationResult[]; failure?: string };

const route = useRoute();
const router = useRouter();
const session = useCruioSession();
const { fitView, zoomIn, zoomOut, zoomTo, viewport, screenToFlowCoordinate } = useVueFlow();
const canvasPanel = ref<HTMLElement | null>(null);
const cardNodeTypes = ["default", "input", "output", "basicNode", "textNode", "scriptNode", "storyboardNode", "materialStationNode", "directorNode", "soundNode", "editingNode", "workflowNode", "promptNode", "workflowReference", "imageGenerationNode", "videoGenerationNode"] as const;
const stationDefinitions: { id: StationId; label: string; type: string }[] = [
  { id: "script", label: "剧本", type: "scriptNode" },
  { id: "storyboard", label: "分镜", type: "storyboardNode" },
  { id: "material", label: "素材", type: "materialStationNode" },
  { id: "director", label: "导演", type: "directorNode" },
  { id: "image", label: "图片", type: "imageGenerationNode" },
  { id: "video", label: "视频", type: "videoGenerationNode" },
  { id: "sound", label: "声音", type: "soundNode" },
  { id: "editing", label: "剪辑", type: "editingNode" },
  { id: "workflow", label: "工作流", type: "workflowNode" },
];
function hasNodeConnection(nodeId: string, side: "source" | "target") {
  return edges.value.some(edge => edge[side] === nodeId);
}
const isProjectCanvas = computed(() => route.name === "project-canvas");
const projectId = computed(() => String(route.params.projectId ?? ""));
const workflowId = computed(() => String(route.params.workflowId ?? ""));
const workflow = ref<Workflow | null>(null);
const bindings = ref<WorkflowBinding[]>([]);
const showNodePicker = ref(false);
const pickerView = ref<"types" | "workflows" | "media">("types");
const nodePickerAnchor = ref<HTMLElement | null>(null);
const nodePickerTrigger = ref<HTMLButtonElement | null>(null);
const nodes = ref<CanvasNode[]>([]);
const edges = ref<CanvasEdge[]>([]);
const selectedNodeId = ref<string | null>(null);
const scriptEditor = ref<{ confirmDiscard: () => boolean; hasUnsavedChanges: boolean; working: boolean; validate: () => boolean; savePending: () => Promise<boolean | undefined> } | null>(null);
const shotListEditor = ref<{ confirmDiscard: () => boolean; hasUnsavedChanges: boolean; working: boolean; savePending: () => Promise<boolean | undefined> } | null>(null);
const selectedEdgeId = ref<string | null>(null);
const message = ref("");
const mediaItems = ref<MediaItem[]>([]);
const canvasTasks = ref<GenerationTask[]>([]);
const mediaSource = ref("self_created");
const mediaUsage = ref("");
const mediaAuthorized = ref(false);
const containsRealPerson = ref(false);
const subjectIsAdult = ref(false);
const models = ref<GenerationModel[]>([]);
const allModels = ref<GenerationModel[]>([]);
const modelsLoaded = ref(false);
const modelsLoadError = ref("");
const unavailableModels = computed(() => allModels.value.filter((model) => !model.available));
const imageModels = computed(() => models.value.filter((model) => model.operation === "image.generate"));
const scriptModels = computed(() => models.value.filter(model => model.operation === "text.generate" && model.providerId && model.upstreamModelId).map(model => ({
  value: JSON.stringify([model.providerId, model.upstreamModelId]), label: `${model.providerLabel} · ${model.label || model.upstreamModelId}`,
})));
const videoModels = computed(() => models.value.filter((model) => model.operation === "video.generate"));
const modelsForSelectedNode = computed(() => selectedNode.value?.type === "imageGenerationNode" ? imageModels.value : selectedNode.value?.type === "videoGenerationNode" ? videoModels.value : []);
const zoomPreset = computed(() => [0.5, 0.75, 1].includes(viewport.value.zoom) ? String(viewport.value.zoom) : "");
const selectedModelId = ref("");
const quote = ref<GenerationQuote | null>(null);
const task = ref<GenerationTask | null>(null);
const workTitle = ref("");
const idempotencyKey = ref("");
const working = ref(false);
const editorDialog = ref<HTMLDialogElement | null>(null);
const discardDialog = ref<HTMLDialogElement | null>(null);
const previewDialog = ref<HTMLDialogElement | null>(null);
const editorOpen = ref(false);
const editorPurpose = ref<"edit" | "execute" | "history">("edit");
const editDraft = ref<CanvasNode | null>(null);
const editorBaseline = ref("");
const editorSaving = ref(false);
const titleError = ref("");
const toast = ref("");
const toastUndo = ref(false);
const undoActions = ref<(() => void)[]>([]);
const previewUrl = ref("");
const previewType = ref("");
const nodeHistory = ref<GenerationTask[]>([]);
const historyLoading = ref(false);
const historyError = ref("");
const historyCursor = ref<string | null>(null);
let historyRevision = 0;
let editorReturnFocus: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const saveState = ref<"saved" | "saving" | "dirty" | "error">("saved");
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let hydrating = true;
let changeRevision = 0;
let loadRevision = 0;
let ready = false;
let savePromise: Promise<void> | undefined;
let taskLoadRevision = 0;

const selectedNode = computed(() => editDraft.value ?? nodes.value.find((node) => node.id === selectedNodeId.value));
const selectedStation = computed(() => stationDefinitions.find(item => item.type === selectedNode.value?.type));
const editorDirty = computed(() => Boolean(editDraft.value) && JSON.stringify(editDraft.value) !== editorBaseline.value || !!scriptEditor.value?.hasUnsavedChanges || !!shotListEditor.value?.hasUnsavedChanges);
const canvasSnapshot = computed(() => JSON.stringify({
  nodes: nodes.value.map((node) => ({
    id: node.id,
    ...(node.type ? { type: node.type } : {}),
    position: node.position,
    data: node.data,
  })),
  edges: edges.value.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
    ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
  })),
}));
const saveLabel = computed(() => ({
  saved: "已保存",
  saving: "正在保存…",
  dirty: "等待保存…",
  error: "保存失败",
})[saveState.value]);

onMounted(async () => {
  document.addEventListener("pointerdown", closePickerOutside);
  window.addEventListener("keydown", closePickerOnEscape);
  window.addEventListener("beforeunload", warnPendingChanges);
  if (!(await session.initialize())) {
    await router.replace({ path: "/login", query: { next: route.fullPath } });
    return;
  }
  ready = true;
  await loadCanvas();
  await Promise.all([loadModels(), ...(isProjectCanvas.value ? [loadMedia(), loadTasks()] : [])]);
});

watch(() => route.fullPath, () => {
  if (!ready) return;
  void (async () => {
    await loadCanvas();
    await Promise.all([loadModels(), ...(isProjectCanvas.value ? [loadMedia(), loadTasks()] : [])]);
  })();
});

watch(selectedNodeId, () => {
  quote.value = null;
  selectedModelId.value = selectedNode.value ? modelForNode(selectedNode.value)?.modelId ?? "" : "";
  task.value = selectedNodeId.value ? taskForNode(selectedNodeId.value) ?? null : null;
});
watch(selectedModelId, () => { quote.value = null; });

async function guardCanvasNavigation() {
  if (editorOpen.value && editorDirty.value) { closeEditor(); return false; }
  if (!confirmEditorDiscard()) return false;
  if (saveState.value === "dirty") await saveCanvas(changeRevision);
  if (saveState.value !== "saved") {
    message.value = "画布尚未保存，请等待保存完成或重试后再离开。";
    return false;
  }
  return true;
}

onBeforeRouteUpdate(guardCanvasNavigation);
onBeforeRouteLeave(guardCanvasNavigation);

async function loadCanvas() {
  const revision = ++loadRevision;
  taskLoadRevision += 1;
  if (saveTimer) clearTimeout(saveTimer);
  closeNodePicker();
  hydrating = true;
  workflow.value = null;
  bindings.value = [];
  nodes.value = [];
  edges.value = [];
  canvasTasks.value = [];
  task.value = null;
  discardEditor();
  undoActions.value = [];
  clearSelection(true);
  saveState.value = "saved";
  message.value = "";
  try {
    const result = isProjectCanvas.value
      ? await api<{ project: Workflow & { workflows: WorkflowBinding[] } }>(`/api/projects/${projectId.value}`)
      : await api<{ workflow: Workflow }>(`/api/workflows/${workflowId.value}`);
    if (revision !== loadRevision) return;
    const document = "project" in result ? result.project : result.workflow;
    bindings.value = "project" in result ? result.project.workflows : [];
    workflow.value = document;
    nodes.value = document.canvas.nodes;
    edges.value = document.canvas.edges.map((edge) => ({
      ...edge,
      sourceHandle: edge.sourceHandle ?? "out",
      targetHandle: edge.targetHandle ?? "in",
    }));
    window.setTimeout(() => { if (revision === loadRevision) hydrating = false; }, 250);
  } catch (error) {
    if (revision !== loadRevision) return;
    message.value = error instanceof Error ? error.message : "无法打开画布。";
    await router.replace(isProjectCanvas.value ? `/projects/${projectId.value}` : "/workflows");
  }
}

async function loadMedia() {
  try {
    mediaItems.value = (await api<{ media: MediaItem[] }>("/api/media/list")).media;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "无法加载素材。";
  }
}

async function uploadMedia(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!mediaAuthorized.value || !mediaUsage.value.trim() || (containsRealPerson.value && !subjectIsAdult.value)) {
    message.value = "请完成来源、用途和授权声明后再上传。";
    input.value = "";
    return;
  }
  working.value = true;
  message.value = "";
  try {
    const mediaType = ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) ? file.type : "";
    if (!mediaType) throw new Error("当前仅支持 PNG、JPEG、WebP 和 GIF 图片。");
    if (file.size > 20 * 1024 * 1024) throw new Error("图片不能超过 20 MiB。");
    const query = new URLSearchParams({
      fileName: file.name,
      mediaType,
      source: mediaSource.value,
      usage: mediaUsage.value.trim(),
      authorizationDeclared: "true",
      containsRealPerson: String(containsRealPerson.value),
      subjectIsAdult: String(subjectIsAdult.value),
    });
    const response = await api<{ media: MediaItem }>(`/api/media/upload?${query}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: await file.arrayBuffer(),
    });
    mediaItems.value = [response.media, ...mediaItems.value];
  } catch (error) {
    message.value = error instanceof Error ? error.message : "素材上传失败。";
  } finally {
    input.value = "";
    working.value = false;
  }
}

function mediaReadUrl(id?: string) {
  return id ? `/api/media/read?id=${encodeURIComponent(id)}` : "";
}

async function retractMedia(id?: string) {
  if (!id) return;
  working.value = true;
  try {
    await api(`/api/media/retract?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    mediaItems.value = mediaItems.value.filter((item) => item.id !== id);
    for (const node of nodes.value) {
      if (node.data.assetId === id) node.data.mediaStatus = "已撤回";
    }
    message.value = "素材已撤回，关联任务提交将由服务端重新校验。";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "无法撤回素材。";
  } finally {
    working.value = false;
  }
}

async function loadModels() {
  modelsLoaded.value = false;
  modelsLoadError.value = "";
  allModels.value = [];
  models.value = [];
  try {
    allModels.value = (await api<{ models: GenerationModel[] }>("/api/generation/models")).models;
    models.value = allModels.value.filter((model) => model.available);
    modelsLoaded.value = true;
    selectedModelId.value = "";
  } catch (error) {
    modelsLoadError.value = error instanceof Error ? error.message : "无法读取服务端模型目录。";
  }
}

async function loadTasks() {
  const revision = ++taskLoadRevision;
  try {
    const result = await api<{ tasks: GenerationTask[] }>(`/api/generation/tasks?projectId=${encodeURIComponent(projectId.value)}&limit=100`);
    if (revision !== taskLoadRevision) return;
    const currentWorkflowId = isProjectCanvas.value ? null : workflowId.value;
    canvasTasks.value = result.tasks.filter(item => item.nodeId && (item.workflowId ?? null) === currentWorkflowId);
    task.value = canvasTasks.value.find(item => item.nodeId === selectedNodeId.value) ?? null;
  } catch (error) {
    if (revision !== taskLoadRevision) return;
    message.value = error instanceof Error ? error.message : "无法读取项目任务。";
  }
}

function taskForNode(nodeId: string) {
  return canvasTasks.value.find((item) => item.nodeId === nodeId);
}

async function requestQuote() {
  if (selectedNode.value?.data.disabled) { message.value = "节点已禁用，请先启用节点。"; return; }
  if (saveState.value === "error") {
    message.value = "请先重试保存画布，保存成功后才能获取报价。";
    return;
  }
  const targetNodeId = selectedNodeId.value;
  if (saveState.value === "dirty") await saveCanvas(changeRevision);
  else if (saveState.value === "saving" && savePromise) await savePromise;
  if (saveState.value !== "saved") {
    message.value = "画布尚未保存成功，请稍后重试报价。";
    return;
  }
  const node = nodes.value.find((item) => item.id === targetNodeId);
  const operation = node?.type === "imageGenerationNode" ? "image.generate" : node?.type === "videoGenerationNode" ? "video.generate" : "";
  const model = models.value.find((item) => item.modelId === selectedModelId.value && item.operation === operation);
  if (!node || !model || !workflow.value || selectedNodeId.value !== targetNodeId) return;
  const workflowSnapshot = workflow.value;
  const modelId = model.modelId;
  const inputRevision = changeRevision;
  const nodeSnapshot = JSON.parse(JSON.stringify(node)) as CanvasNode;
  const incomingEdges = edges.value.filter((edge) => edge.target === targetNodeId && (edge.targetHandle == null || edge.targetHandle === "in"));
  const assetIds = incomingEdges.flatMap((edge) => {
    const source = nodes.value.find((item) => item.id === edge.source);
    return source?.type === "mediaNode" && source.data.assetId ? [source.data.assetId] : [];
  });
  const formalInputs = incomingEdges.flatMap((edge) => {
    const source = nodes.value.find((item) => item.id === edge.source);
    const output = source?.data.formalOutput;
    return source?.type?.endsWith("GenerationNode") && output?.mediaType === "image"
      ? [{ sourceNodeId: source.id, resultId: output.resultId, adoptionVersion: output.adoptionVersion,
          sourceHandle: edge.sourceHandle ?? "out", targetHandle: edge.targetHandle ?? "in", role: "reference_image" }]
      : [];
  });
  const parameterNames = operation === "image.generate" ? ["size", "ratio"] as const : ["duration", "resolution", "ratio", "mode", "generateAudio"] as const;
  const parameters = Object.fromEntries(parameterNames.flatMap((key) => nodeSnapshot.data[key] === undefined ? [] : [[key, nodeSnapshot.data[key]]]));
  working.value = true;
  message.value = "";
  quote.value = null;
  idempotencyKey.value = crypto.randomUUID();
  try {
    const result = await api<{ quote: GenerationQuote }>("/api/generation/quotes", {
      method: "POST",
      body: JSON.stringify({
        projectId: projectId.value,
        ...(!isProjectCanvas.value ? { workflowId: workflowSnapshot.id } : {}),
        ...(!isProjectCanvas.value ? { workflowVersion: workflowSnapshot.version } : { canvasVersion: workflowSnapshot.version }),
        nodeId: nodeSnapshot.id,
        nodeVersion: nodeSnapshot.data.version ?? 1,
        operation,
        modelId: model.modelId,
        prompt: nodeSnapshot.data.prompt ?? "",
        parameters,
        assetIds,
        formalInputs,
      }),
    });
    if (selectedNodeId.value !== targetNodeId || selectedModelId.value !== modelId || workflow.value !== workflowSnapshot || changeRevision !== inputRevision || saveState.value !== "saved") {
      message.value = "报价返回时画布内容已变化，请重新获取报价。";
      return;
    }
    quote.value = result.quote;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "获取报价失败。";
  } finally {
    working.value = false;
  }
}

async function submitTask() {
  if (selectedNode.value?.data.disabled) { message.value = "节点已禁用，请先启用节点。"; return; }
  if (!quote.value || quote.value.blocks?.length || quote.value.plan.blocks?.length) return;
  working.value = true;
  message.value = "";
  try {
    const result = await api<{ task: GenerationTask }>("/api/generation/tasks", {
      method: "POST",
      body: JSON.stringify({ quoteId: quote.value.quoteId, idempotencyKey: idempotencyKey.value }),
    });
    task.value = result.task;
    canvasTasks.value = [result.task, ...canvasTasks.value.filter((item) => item.taskId !== result.task.taskId)];
    quote.value = null;
    await refreshTask();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "任务提交失败。";
  } finally {
    working.value = false;
  }
}

async function refreshTask() {
  if (!task.value) return;
  const taskId = task.value.taskId;
  const nodeId = selectedNodeId.value;
  try {
    const updated = (await api<{ task: GenerationTask }>(`/api/generation/tasks/${encodeURIComponent(taskId)}`)).task;
    canvasTasks.value = [updated, ...canvasTasks.value.filter((item) => item.taskId !== taskId)];
    if (task.value?.taskId === taskId && selectedNodeId.value === nodeId) task.value = updated;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "任务状态读取失败。";
  }
}

async function saveWork(resultId: string) {
  if (!task.value || task.value.status !== "delivered") return;
  working.value = true;
  message.value = "";
  try {
    await api("/api/works", {
      method: "POST",
      body: JSON.stringify({ taskId: task.value.taskId, resultIds: [resultId], title: workTitle.value.trim() || workflow.value?.name || "我的作品" }),
    });
    message.value = "作品已保存。";
    workTitle.value = "";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "作品保存失败。";
  } finally {
    working.value = false;
  }
}

async function adoptResult(resultId: string) {
  const requestedTask = task.value;
  if (working.value || !requestedTask || requestedTask.status !== "delivered" || !workflow.value
    || !requestedTask.results.some(result => result.resultId === resultId)) return;
  working.value = true;
  message.value = "";
  try {
    if (saveState.value === "dirty" || saveState.value === "saving") await saveCanvas(changeRevision);
    if (saveState.value !== "saved") throw new Error("画布尚未保存，请重试后再采用。");
    const node = selectedNode.value;
    const currentTask = task.value;
    const currentWorkflow = workflow.value;
    if (!node || !currentTask || currentTask.taskId !== requestedTask.taskId || currentTask.status !== "delivered"
      || !currentTask.results.some(result => result.resultId === resultId)) return;
    const adoptionOperation = node.type === "imageGenerationNode" ? "image.generate" : node.type === "videoGenerationNode" ? "video.generate" : "";
    if (adoptionOperation !== currentTask.operation || currentTask.nodeId !== node.id
      || (currentTask.workflowId ?? null) !== (isProjectCanvas.value ? null : workflowId.value)) return;
    const taskId = currentTask.taskId;
    const nodeVersion = node.data.version ?? 1;
    const result = await api<{ adoptedResultId: string; adoptionVersion: number; canvasVersion: number; formalOutput: FormalOutput; currentFormalOutput?: boolean }>(`/api/generation/results/${encodeURIComponent(resultId)}/adopt`, {
      method: "POST",
      body: JSON.stringify({
        projectId: projectId.value,
        ...(isProjectCanvas.value
          ? { canvasVersion: currentWorkflow.version }
          : { workflowId: workflowId.value, workflowVersion: currentWorkflow.version }),
        nodeId: node.id,
        nodeVersion,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    if (workflow.value !== currentWorkflow) return;
    if (result.currentFormalOutput === false) {
      message.value = "采用请求已完成，但画布随后又有更新。请刷新画布确认当前正式输出。";
      return;
    }
    workflow.value.version = result.canvasVersion;
    const currentNode = nodes.value.find(item => item.id === node.id);
    if (currentNode) currentNode.data.formalOutput = result.formalOutput;
    if (task.value?.taskId === taskId) {
      task.value.adoptedResultId = result.adoptedResultId;
      task.value.adoptionVersion = result.adoptionVersion;
    }
    message.value = "已采用此结果。";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "采用结果失败。";
  } finally {
    working.value = false;
  }
}

function taskStatusLabel(status: string) {
  return ({ queued: "排队中", running: "生成中", succeeded: "正在保存结果", delivered: "结果可用", failed: "生成失败", unknown: "状态待核查", cancelled: "已取消" } as Record<string, string>)[status] ?? "处理中";
}

function modelName(model: GenerationModel) {
  return model.label ?? `${model.providerLabel} · ${model.upstreamModelId ?? model.modelId}${model.modelVersion ? ` v${model.modelVersion}` : ""}`;
}

function modelDirectoryMessage(operation: GenerationModel["operation"]) {
  if (modelsLoadError.value) return "服务端模型目录读取失败";
  if (!modelsLoaded.value) return "正在读取服务端模型目录…";
  const operationModels = allModels.value.filter((model) => model.operation === operation);
  if (!operationModels.length) return "服务端尚未发布此类生成模型";
  return operationModels.map((model) => model.unavailableReason ?? "能力尚未开放").join("；");
}

function modelForNode(node: CanvasNode) {
  if (!node.data.model) return undefined;
  try {
    const [providerId, upstreamModelId] = JSON.parse(node.data.model) as [string, string];
    return models.value.find((model) => model.providerId === providerId && model.upstreamModelId === upstreamModelId);
  } catch {
    return undefined;
  }
}

function setSelectedModel(modelId: string) {
  const node = selectedNode.value;
  const model = modelsForSelectedNode.value.find((item) => item.modelId === modelId);
  if (!node || !model || !model.providerId || !model.upstreamModelId) return;
  node.data.model = JSON.stringify([model.providerId, model.upstreamModelId]);
}

function updateNodePrompt(event: Event) {
  if (!selectedNode.value) return;
  const value = (event.target as HTMLTextAreaElement).value;
  if (["imageGenerationNode", "videoGenerationNode"].includes(selectedNode.value.type ?? "")) selectedNode.value.data.prompt = value;
  else selectedNode.value.data.content = value;
}

function setScriptRef(nodeId: string, scriptRef: { scriptId: string; version: number }) {
  const node = editDraft.value?.id === nodeId ? editDraft.value : nodes.value.find(item => item.id === nodeId && item.type === "scriptNode");
  if (!node) return;
  node.data.scriptRef = scriptRef;
}

function setScriptModel(nodeId: string, model: string) {
  if (editDraft.value?.id === nodeId) editDraft.value.data.model = model;
}

function setWritingBrief(nodeId: string, writingBrief: NonNullable<CanvasNode["data"]["writingBrief"]>) {
  const node = editDraft.value?.id === nodeId ? editDraft.value : nodes.value.find(item => item.id === nodeId && item.type === "scriptNode");
  if (!node) return;
  node.data.writingBrief = writingBrief;
}

function setShotListRef(nodeId: string, shotListRef: { shotListId: string; version: number }) {
  const node = editDraft.value?.id === nodeId ? editDraft.value : nodes.value.find(item => item.id === nodeId && item.type === "storyboardNode");
  if (node) node.data.shotListRef = shotListRef;
}

function setPlanningBrief(nodeId: string, planningBrief: NonNullable<CanvasNode["data"]["planningBrief"]>) {
  const node = editDraft.value?.id === nodeId ? editDraft.value : nodes.value.find(item => item.id === nodeId && item.type === "storyboardNode");
  if (node) node.data.planningBrief = planningBrief;
}

function setSplitSettings(nodeId: string, splitSettings: NonNullable<CanvasNode["data"]["splitSettings"]>) {
  const node = editDraft.value?.id === nodeId ? editDraft.value : nodes.value.find(item => item.id === nodeId && item.type === "storyboardNode");
  if (node) node.data.splitSettings = splitSettings;
}

function confirmEditorDiscard() {
  return (scriptEditor.value?.confirmDiscard() ?? true) && (shotListEditor.value?.confirmDiscard() ?? true);
}

function setZoomPreset(event: Event) {
  const value = Number((event.target as HTMLSelectElement).value);
  if ([0.5, 0.75, 1].includes(value)) zoomTo(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function goBack() {
  void router.push(isProjectCanvas.value ? `/projects/${projectId.value}` : "/workflows");
}

function availableNodePosition(position: { x: number; y: number }) {
  const occupied = nodes.value;
  const overlapping = occupied.find(node => Math.abs(node.position.x - position.x) < 340 && Math.abs(node.position.y - position.y) < 300);
  if (!overlapping) return position;
  // ACT: 只消除卡片重叠，保留连线与已有坐标；线性扫描不做完整图布局。
  return { x: Math.max(...occupied.map(node => node.position.x)) + 380, y: overlapping.position.y };
}
function arrangeNodeLayout() {
  if (nodes.value.length < 2) return;
  const positions = nodes.value.map(node => ({ id: node.id, position: { ...node.position } }));
  const nodesById = new Map(nodes.value.map(node => [node.id, node]));
  const incoming = new Map(nodes.value.map(node => [node.id, 0]));
  const children = new Map<string, string[]>();
  for (const edge of edges.value) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) continue;
    incoming.set(edge.target, incoming.get(edge.target)! + 1);
    children.set(edge.source, [...children.get(edge.source) ?? [], edge.target]);
  }
  const ordered = nodes.value.filter(node => incoming.get(node.id) === 0);
  const columns = Math.min(3, Math.ceil(Math.sqrt(nodes.value.length)));
  // ACT: 按依赖顺序分行摆放，不求最少交叉；有环的剩余节点保留原顺序，连接始终不变。
  for (let index = 0; index < ordered.length; index += 1) {
    for (const childId of children.get(ordered[index]!.id) ?? []) {
      const count = incoming.get(childId)! - 1;
      incoming.set(childId, count);
      if (count === 0) ordered.push(nodesById.get(childId)!);
    }
  }
  const orderedIds = new Set(ordered.map(node => node.id));
  ordered.push(...nodes.value.filter(node => !orderedIds.has(node.id)));
  const rowGap = nodes.value.some(node => node.data.formalOutput) ? 480 : 330;
  ordered.forEach((node, index) => { node.position = { x: (index % columns) * 400, y: Math.floor(index / columns) * rowGap }; });
  undoActions.value.push(() => { for (const item of positions) { const node = nodes.value.find(node => node.id === item.id); if (node) node.position = item.position; } frameCanvas(); });
  frameCanvas(); showToast("已整理布局，连接关系保留", true);
}
function frameCanvas() {
  void nextTick().then(() => fitView({ padding: 0.3, maxZoom: 1 }));
}

function openNodePicker() {
  pickerView.value = "types";
  showNodePicker.value = true;
  void nextTick().then(() => nodePickerAnchor.value?.querySelector<HTMLButtonElement>(".nodeChoice")?.focus());
}

function closeNodePicker() {
  showNodePicker.value = false;
  pickerView.value = "types";
}

function toggleNodePicker() {
  if (showNodePicker.value) closeNodePicker();
  else openNodePicker();
}

function showWorkflowChoices() {
  pickerView.value = "workflows";
  void nextTick().then(() => nodePickerAnchor.value?.querySelector<HTMLButtonElement>(".workflowChoices button, .pickerBack")?.focus());
}

function showMediaChoices() {
  pickerView.value = "media";
  if (!mediaItems.value.length) void loadMedia();
}

function showNodeTypes() {
  pickerView.value = "types";
  void nextTick().then(() => nodePickerAnchor.value?.querySelector<HTMLButtonElement>(".nodeChoice")?.focus());
}

function startStationDrag(event: DragEvent, stationId: StationId) {
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("application/x-cruio-station", stationId);
}

function allowStationDrop(event: DragEvent) {
  if (event.dataTransfer?.types.includes("application/x-cruio-station")) event.dataTransfer.dropEffect = "copy";
}

function onStationDrop(event: DragEvent) {
  if (event.target instanceof Element && event.target.closest(".stationToolbar")) return;
  const stationId = event.dataTransfer?.getData("application/x-cruio-station") as StationId | undefined;
  if (!stationId || !stationDefinitions.some((station) => station.id === stationId)) return;
  const position = screenToFlowCoordinate({ x: event.clientX, y: event.clientY });
  addStationNode(stationId, position);
}

function addStationNode(stationId: StationId, position?: { x: number; y: number }) {
  if (!confirmEditorDiscard()) return;
  const station = stationDefinitions.find((item) => item.id === stationId);
  if (!station) return;
  const rect = canvasPanel.value?.getBoundingClientRect();
  const toolbarHeight = canvasPanel.value?.querySelector<HTMLElement>(".stationToolbar")?.getBoundingClientRect().height ?? 0;
  const nodePosition = position ?? screenToFlowCoordinate({
    x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
    y: rect ? rect.top + toolbarHeight + Math.max(0, rect.height - toolbarHeight) / 2 : window.innerHeight / 2,
  });
  nodes.value.push(createStationNode(station, availableNodePosition({ x: nodePosition.x - 140, y: nodePosition.y - 90 })));
  selectedNodeId.value = nodes.value[nodes.value.length - 1].id;
  selectedEdgeId.value = null;
  selectCanvasNode(selectedNodeId.value);
}

function createStationNode(station: typeof stationDefinitions[number], position: { x: number; y: number }): CanvasNode {
  const index = nodes.value.filter(node => node.type === station.type).length + 1;
  const label = `${station.label} ${index}`;
  const data: CanvasNode["data"] = station.id === "script"
    ? { label, writingBrief: {} }
    : station.id === "image" || station.id === "video"
      ? { label, prompt: "", model: "", version: 1 }
      : { label, version: 1 };
  return { id: crypto.randomUUID(), type: station.type, position, data };
}

function insertableStations(edgeId: string) {
  const edge = edges.value.find(item => item.id === edgeId);
  const source = nodes.value.find(item => item.id === edge?.source);
  const target = nodes.value.find(item => item.id === edge?.target);
  if (!source || !target) return [];
  return stationDefinitions.filter(station => {
    const candidate: CanvasNode = { id: "", type: station.type, position: { x: 0, y: 0 }, data: { label: "" } };
    return canConnectNodes(source, candidate) && canConnectNodes(candidate, target);
  });
}

function insertEdgeNode(edgeId: string, type: string, position: { x: number; y: number }) {
  const edge = edges.value.find(item => item.id === edgeId);
  const station = insertableStations(edgeId).find(item => item.id === type);
  if (!edge || !station || editorOpen.value) return;
  const node = createStationNode(station, { x: position.x - 140, y: position.y - 95 });
  const before: CanvasEdge = { id: crypto.randomUUID(), source: edge.source, sourceHandle: edge.sourceHandle ?? "out", target: node.id, targetHandle: "in" };
  const after: CanvasEdge = { id: crypto.randomUUID(), source: node.id, sourceHandle: "out", target: edge.target, targetHandle: edge.targetHandle ?? "in" };
  nodes.value.push(node);
  edges.value = edges.value.filter(item => item.id !== edgeId);
  edges.value.push(before, after);
  undoActions.value.push(() => {
    nodes.value = nodes.value.filter(item => item.id !== node.id);
    edges.value = edges.value.filter(item => item.source !== node.id && item.target !== node.id);
    if (nodes.value.some(item => item.id === edge.source) && nodes.value.some(item => item.id === edge.target)) edges.value.push(edge);
  });
  selectCanvasNode(node.id);
  showToast(`已插入“${node.data.label}”`, true);
}

function closePickerOutside(event: PointerEvent) {
  if (showNodePicker.value && !nodePickerAnchor.value?.contains(event.target as Node)) closeNodePicker();
}

function warnPendingChanges(event: BeforeUnloadEvent) {
  if (!editorDirty.value && saveState.value === "saved") return;
  event.preventDefault(); event.returnValue = "";
}
function closePickerOnEscape(event: KeyboardEvent) {
  if (event.target instanceof Element && event.target.closest("input, textarea, select, button, summary, dialog, [contenteditable]")) return;
  if (editorOpen.value) return;
  if (event.key === "Escape") { closeNodePicker(); clearSelection(); }
  if (event.key === "Enter" && selectedNodeId.value) { event.preventDefault(); openNodeDetails(selectedNodeId.value); }
  if ((event.key === "Delete" || event.key === "Backspace") && (selectedNodeId.value || selectedEdgeId.value)) { event.preventDefault(); selectedNodeId.value ? removeSelectedNode() : removeSelectedEdge(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undoNodeAction(); }
}

function addContentNode(type: "textNode") {
  const index = nodes.value.length + 1;
  nodes.value.push({
    id: crypto.randomUUID(),
    type,
    position: { x: 100 + (index % 3) * 340, y: 100 + Math.floor(index / 3) * 220 },
    data: { label: `文本 ${index}`, content: "" },
  });
  closeNodePicker();
}

function addGenerationNode(type: "imageGenerationNode" | "videoGenerationNode") {
  if (!(type === "imageGenerationNode" ? imageModels.value : videoModels.value).length) return;
  const index = nodes.value.length + 1;
  nodes.value.push({
    id: crypto.randomUUID(),
    type,
    position: { x: 100 + (index % 3) * 340, y: 100 + Math.floor(index / 3) * 220 },
    data: { label: type === "imageGenerationNode" ? `图片生成 ${index}` : `视频生成 ${index}`, prompt: "", model: "", version: 1 },
  });
  closeNodePicker();
}

function addWorkflowReference(id: string) {
  const binding = bindingFor(id);
  if (!binding) return;
  const index = nodes.value.length + 1;
  nodes.value.push({
    id: crypto.randomUUID(),
    type: "workflowReference",
    position: { x: 100 + (index % 3) * 340, y: 100 + Math.floor(index / 3) * 220 },
    data: { label: binding.name, workflowId: binding.id },
  });
  closeNodePicker();
}

function addMediaNode(item: MediaItem) {
  const index = nodes.value.length + 1;
  nodes.value.push({
    id: crypto.randomUUID(),
    type: "mediaNode",
    position: { x: 100 + (index % 3) * 340, y: 100 + Math.floor(index / 3) * 220 },
    data: { label: item.fileName, fileName: item.fileName, assetId: item.id, mediaType: item.mediaType, mediaStatus: item.status, version: 1 },
  });
  closeNodePicker();
}

function bindStationMedia(nodeId: string, item: MediaItem) {
  if (!isProjectCanvas.value || !mediaItems.value.some((media) => media.id === item.id)) return;
  const node = editDraft.value?.id === nodeId ? editDraft.value : nodes.value.find((canvasNode) => canvasNode.id === nodeId && canvasNode.type === "materialStationNode");
  if (!node) return;
  node.type = "mediaNode";
  node.data = { label: item.fileName, fileName: item.fileName, assetId: item.id, mediaType: item.mediaType, mediaStatus: item.status, version: 1 };
}

function bindStationWorkflow(nodeId: string, workflowBindingId: string) {
  if (!isProjectCanvas.value) return;
  const binding = bindingFor(workflowBindingId);
  const node = editDraft.value?.id === nodeId ? editDraft.value : nodes.value.find((canvasNode) => canvasNode.id === nodeId && canvasNode.type === "workflowNode");
  if (!binding || !node) return;
  node.type = "workflowReference";
  node.data = { label: binding.name, workflowId: binding.id };
}

function openMediaPicker() {
  pickerView.value = "media";
  showNodePicker.value = true;
  if (!mediaItems.value.length) void loadMedia();
}

function bindingFor(id?: string) {
  return bindings.value.find((binding) => binding.id === id);
}

function openSourceWorkflow(id?: string) {
  if (id && bindingFor(id)) void router.push(`/workflows/${id}`);
}

function onConnect(connection: Connection) {
  if (!isValidConnection(connection)) {
    message.value = "无法连接：请检查重复连线、节点禁用状态；生成节点的参考图输入仅接受图片素材或已采用的图片结果。";
    return;
  }
  edges.value.push({
    id: crypto.randomUUID(),
    ...connection,
    sourceHandle: connection.sourceHandle ?? "out",
    targetHandle: connection.targetHandle ?? "in",
  });
}

function isValidConnection(connection: Connection & { id?: string }) {
  // Vue Flow 同步边时也调用此校验；已有边不能被新连接的去重或输入校验过滤。
  if (connection.id) return true;
  if (!connection.source || !connection.target || connection.source === connection.target) return false;
  const sourceHandle = connection.sourceHandle ?? "out";
  const targetHandle = connection.targetHandle ?? "in";
  if (sourceHandle !== "out" || targetHandle !== "in") return false;
  if (edges.value.some((edge) => edge.source === connection.source && edge.target === connection.target
    && (edge.sourceHandle ?? "out") === sourceHandle && (edge.targetHandle ?? "in") === targetHandle)) return false;
  const source = nodes.value.find((node) => node.id === connection.source);
  const target = nodes.value.find((node) => node.id === connection.target);
  if (!source || !target || source.data.disabled || target.data.disabled) return false;
  return canConnectNodes(source, target);
}

function canConnectNodes(source: CanvasNode, target: CanvasNode) {
  if (source.data.disabled || target.data.disabled) return false;
  if (["imageGenerationNode", "videoGenerationNode"].includes(target.type ?? "")) {
    return source.type === "mediaNode" && source.data.mediaType?.startsWith("image/")
      || ["imageGenerationNode", "videoGenerationNode"].includes(source.type ?? "")
        && source.data.formalOutput?.mediaType === "image";
  }
  return true;
}

function selectCanvasNode(nodeId: string | null) {
  selectedNodeId.value = nodeId;
  selectedEdgeId.value = null;
  for (const node of nodes.value) (node as CanvasNode & { selected?: boolean }).selected = node.id === nodeId;
  highlightEdges();
}
function highlightEdges() {
  for (const edge of edges.value) {
    const related = edge.id === selectedEdgeId.value || edge.source === selectedNodeId.value || edge.target === selectedNodeId.value;
    Object.assign(edge, { selected: edge.id === selectedEdgeId.value, style: { stroke: related ? "#9480d8" : "#cec7df", strokeWidth: related ? 2.3 : 1.6, opacity: selectedNodeId.value && !related ? .5 : 1 } });
  }
}
function openNodeDetails(nodeId: string) { openEditor(nodeId, "edit"); }
function openEditor(nodeId: string, purpose: "edit" | "execute" | "history") {
  const node = nodes.value.find(item => item.id === nodeId);
  if (!node || editorOpen.value) return;
  editorReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  selectCanvasNode(nodeId);
  editorPurpose.value = purpose;
  editDraft.value = purpose === "edit" ? JSON.parse(JSON.stringify(node)) : null;
  editorBaseline.value = JSON.stringify(editDraft.value);
  titleError.value = "";
  message.value = "";
  editorOpen.value = true;
  void nextTick().then(() => { editorDialog.value?.showModal(); editorDialog.value?.querySelector<HTMLInputElement>("input")?.focus(); });
}
function closeEditor() {
  if (editorSaving.value || working.value || scriptEditor.value?.working || shotListEditor.value?.working) return;
  if (editorPurpose.value === "edit" && editorDirty.value) { discardDialog.value?.showModal(); return; }
  discardEditor();
}
function discardEditor() {
  discardDialog.value?.close();
  editorDialog.value?.close();
  editorOpen.value = false;
  editDraft.value = null;
  historyRevision += 1;
  editorReturnFocus?.focus();
}
function onDialogBackdrop(event: MouseEvent) { if (event.target === editorDialog.value) closeEditor(); }
async function saveEditor() {
  if (!editDraft.value || !workflow.value || editorSaving.value) return;
  titleError.value = !editDraft.value.data.label.trim() ? "请填写节点标题。" : "";
  if (titleError.value) return;
  if (scriptEditor.value && !scriptEditor.value.validate()) return;
  if (!editorDirty.value) { discardEditor(); showToast("配置未改变"); return; }
  editorSaving.value = true;
  message.value = "";
  try {
    if (scriptEditor.value && !(await scriptEditor.value.savePending())) return;
    if (shotListEditor.value && !(await shotListEditor.value.savePending())) return;
    await nextTick();
    if (saveState.value !== "saved") await saveCanvas(changeRevision);
    if (saveState.value !== "saved") throw new Error("画布尚未保存成功，请重试后再保存节点。");
    const document = workflow.value;
    const canvas = JSON.parse(canvasSnapshot.value) as { nodes: CanvasNode[]; edges: CanvasEdge[] };
    const node = canvas.nodes.find(item => item.id === editDraft.value?.id);
    if (!node) throw new Error("节点已不存在，请重新打开画布。");
    node.data = JSON.parse(JSON.stringify(editDraft.value.data));
    node.type = editDraft.value.type;
    const endpoint = isProjectCanvas.value ? `/api/projects/${projectId.value}/canvas` : `/api/workflows/${workflowId.value}/canvas`;
    const result = await api<{ project: Workflow } | { workflow: Workflow }>(endpoint, { method: "PUT", body: JSON.stringify({ canvas, version: document.version }) });
    const saved = "project" in result ? result.project : result.workflow;
    hydrating = true;
    const currentNode = nodes.value.find(item => item.id === node.id);
    if (currentNode) { currentNode.data = node.data; currentNode.type = node.type; }
    document.version = saved.version;
    document.updatedAt = saved.updatedAt;
    await nextTick();
    hydrating = false;
    saveState.value = "saved";
    discardEditor();
    showToast("节点已保存");
  } catch (error) { message.value = error instanceof Error && error.message !== "Failed to fetch" ? error.message : "节点保存失败，请重试。已填写的内容仍保留。"; }
  finally { editorSaving.value = false; }
}
function canExecuteNode(nodeId: string) {
  const node = nodes.value.find(item => item.id === nodeId);
  return isProjectCanvas.value && ["imageGenerationNode", "videoGenerationNode"].includes(node?.type ?? "");
}
function openExecution(nodeId: string) {
  const node = nodes.value.find(item => item.id === nodeId);
  if (!canExecuteNode(nodeId) || node?.data.disabled) return;
  openEditor(nodeId, "execute");
}
function openHistory(nodeId: string) {
  openEditor(nodeId, "history");
  nodeHistory.value = [];
  historyCursor.value = null;
  if (isProjectCanvas.value) void loadNodeHistory(false);
}
async function loadNodeHistory(append: boolean) {
  if (!isProjectCanvas.value || historyLoading.value) return;
  const revision = ++historyRevision;
  const nodeId = selectedNodeId.value;
  historyLoading.value = true;
  historyError.value = "";
  try {
    const query = new URLSearchParams({ projectId: projectId.value, limit: "100" });
    if (append && historyCursor.value) query.set("cursor", historyCursor.value);
    const result = await api<{ tasks: GenerationTask[]; nextCursor: string | null }>(`/api/generation/tasks?${query}`);
    if (revision !== historyRevision) return;
    const records = result.tasks.filter(item => item.nodeId === nodeId && (item.workflowId ?? null) === null);
    nodeHistory.value = append ? [...nodeHistory.value, ...records] : records;
    historyCursor.value = result.nextCursor;
    for (const record of result.tasks) {
      const index = canvasTasks.value.findIndex(item => item.taskId === record.taskId);
      if (index >= 0) canvasTasks.value[index] = record;
      else canvasTasks.value.push(record);
    }
  } catch { if (revision === historyRevision) historyError.value = "历史记录加载失败"; }
  finally { historyLoading.value = false; }
}
function openPreview(url: string, type: string) {
  previewUrl.value = url;
  previewType.value = type;
  previewDialog.value?.showModal();
}
function onPreviewBackdrop(event: MouseEvent) { if (event.target === previewDialog.value) previewDialog.value?.close(); }
function onNodeClick(event: { node: { id: string } }) { selectCanvasNode(event.node.id); }
function onEdgeClick(event: { edge: { id: string } }) { selectCanvasNode(null); selectedEdgeId.value = event.edge.id; highlightEdges(); }
function clearSelection(skipDraftGuard = false) {
  if (!skipDraftGuard && editorOpen.value) return;
  selectCanvasNode(null);
}
function showToast(text: string, canUndo = false) {
  toast.value = text;
  toastUndo.value = canUndo;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 5000);
}
function nodeAction(nodeId: string, action: string) {
  selectCanvasNode(nodeId);
  const node = nodes.value.find(item => item.id === nodeId);
  if (!node) return;
  if (action === "rename") { openNodeDetails(nodeId); return; }
  if (action === "delete") { removeSelectedNode(); return; }
  if (action === "disable") {
    const previous = node.data.disabled;
    node.data.disabled = !previous;
    undoActions.value.push(() => { node.data.disabled = previous; });
    showToast(node.data.disabled ? "节点已禁用" : "节点已启用", true);
  }
  if (action === "duplicate") {
    const copy = JSON.parse(JSON.stringify(node)) as CanvasNode;
    copy.id = crypto.randomUUID(); copy.data.label += " 副本"; copy.position = { x: node.position.x + 48, y: node.position.y + 72 };
    delete copy.data.formalOutput;
    nodes.value.push(copy);
    undoActions.value.push(() => { nodes.value = nodes.value.filter(item => item.id !== copy.id); edges.value = edges.value.filter(item => item.source !== copy.id && item.target !== copy.id); });
    selectCanvasNode(copy.id);
    showToast("已复制节点", true);
  }
}
function undoNodeAction() { undoActions.value.pop()?.(); clearSelection(); showToast("已撤销画布操作", undoActions.value.length > 0); }
function removeSelectedNode() {
  const node = nodes.value.find(item => item.id === selectedNodeId.value);
  if (!node || editorOpen.value) return;
  const removedNode = JSON.parse(JSON.stringify(node)) as CanvasNode;
  const removedEdges = edges.value.filter(edge => edge.source === node.id || edge.target === node.id);
  undoActions.value.push(() => { nodes.value.push(removedNode); edges.value.push(...removedEdges.filter(edge => nodes.value.some(item => item.id === edge.source) && nodes.value.some(item => item.id === edge.target))); });
  nodes.value = nodes.value.filter(item => item.id !== node.id);
  edges.value = edges.value.filter(edge => edge.source !== node.id && edge.target !== node.id);
  clearSelection(true);
  showToast(`已删除“${node.data.label}”及其连接`, true);
}
function removeSelectedEdge() {
  const edge = edges.value.find(item => item.id === selectedEdgeId.value);
  if (!edge) return;
  undoActions.value.push(() => { if (nodes.value.some(item => item.id === edge.source) && nodes.value.some(item => item.id === edge.target)) edges.value.push(edge); });
  edges.value = edges.value.filter(item => item.id !== edge.id);
  clearSelection(); showToast("已删除连接", true);
}

async function saveCanvas(revision: number) {
  if (!workflow.value) return;
  if (saveTimer) clearTimeout(saveTimer);
  if (savePromise) {
    await savePromise;
    if (saveState.value === "dirty" && changeRevision > revision) await saveCanvas(changeRevision);
    return;
  }
  if (saveState.value === "saved") return;
  const currentWorkflow = workflow.value;
  const baseVersion = currentWorkflow.version;
  const endpoint = isProjectCanvas.value ? `/api/projects/${projectId.value}/canvas` : `/api/workflows/${workflowId.value}/canvas`;
  const content = canvasSnapshot.value;
  saveState.value = "saving";
  const currentSave = (async () => {
    try {
    const result = await api<{ project: Workflow } | { workflow: Workflow }>(
      endpoint,
      {
        method: "PUT",
        body: JSON.stringify({ canvas: JSON.parse(content), version: baseVersion }),
      },
    );
    if (workflow.value !== currentWorkflow) return;
    const saved = "project" in result ? result.project : result.workflow;
    workflow.value.version = saved.version;
    workflow.value.updatedAt = saved.updatedAt;
    if (changeRevision > revision) {
      saveState.value = "dirty";
      scheduleSave();
    } else {
      saveState.value = "saved";
    }
    } catch (error) {
    if (workflow.value !== currentWorkflow) return;
    saveState.value = "error";
    if (changeRevision > revision && currentWorkflow.version !== baseVersion) {
      saveState.value = "dirty";
      scheduleSave();
      return;
    }
    message.value = error instanceof Error ? error.message : "保存失败。";
    }
  })();
  savePromise = currentSave;
  await currentSave;
  if (savePromise === currentSave) savePromise = undefined;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  const revision = changeRevision;
  saveTimer = setTimeout(() => void saveCanvas(revision), 650);
}

watch(
  canvasSnapshot,
  () => {
    if (hydrating || !workflow.value) return;
    changeRevision += 1;
    quote.value = null;
    saveState.value = "dirty";
    scheduleSave();
  },
);

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer);
  if (toastTimer) clearTimeout(toastTimer);
  document.removeEventListener("pointerdown", closePickerOutside);
  window.removeEventListener("keydown", closePickerOnEscape);
  window.removeEventListener("beforeunload", warnPendingChanges);
});
</script>

<style scoped lang="scss">
.canvasShell {
  --cr-page-background: #f7f6fa;
  --cr-surface-subtle: #f7f5fb;
  --cr-surface-hover: #eee9fa;
  --cr-border-subtle: #e8e3ef;
  --cr-border-strong: #d9d1e5;
  --cr-text-primary: #302940;
  --cr-text-secondary: #655d76;
  --cr-text-muted: #81798e;
  --cr-brand-primary: #8267c9;
  --cr-border-focus: #9b81dd;
  --cr-selection-ring: 0 0 0 4px rgba(155,129,221,.12), 0 8px 24px rgba(65,45,106,.07);
  display: grid; grid-template-rows: 64px 30px minmax(0, 1fr) 28px; height: 100dvh; overflow: hidden; color: var(--cr-text-primary); background: var(--cr-page-background); font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  button, input, select, textarea { font: inherit; }
  button { cursor: pointer; &:disabled { cursor: not-allowed; opacity: .5; } }
  :is(button, input, textarea, select, a, summary):focus-visible { outline: 2px solid var(--cr-border-focus); outline-offset: 3px; }
  .canvasHeader { z-index: 5; display: grid; grid-template-columns: 184px minmax(0, 1fr) auto; align-items: center; padding: 0 24px; border-bottom: 1px solid var(--cr-border-subtle); background: var(--cr-surface); }
  .brandButton { display: flex; gap: 10px; align-items: center; width: fit-content; border: 0; background: transparent; color: var(--cr-text-primary); font-size: 15px; font-weight: 750; letter-spacing: .13em; }
  .brandMark { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; background: var(--cr-gradient); font-family: Georgia, serif; font-style: italic; font-size: 23px; }
  .workflowIdentity { display: flex; gap: 12px; align-items: center; color: var(--cr-text-muted); font-size: 13px; button { max-width: 200px; border: 0; background: transparent; color: var(--cr-text-muted); } strong { overflow: hidden; max-width: 300px; color: var(--cr-text-primary); text-overflow: ellipsis; white-space: nowrap; font-weight: 600; } }
  .canvasActions { display: flex; gap: 20px; align-items: center; }
  .saveStatus { color: var(--cr-text-muted); font-size: 12px; &.saved { color: #39876b; } &.error { color: #b1465c; } }
  .primaryButton, .secondaryButton { min-height: 40px; padding: 9px 20px; border-radius: 10px; font-size: 13px; font-weight: 600; white-space: nowrap; }
  .primaryButton { border: 1px solid transparent; background: #8970cf; color: #fff; box-shadow: 0 3px 9px rgba(99,72,156,.12); &:hover { background: #785cbd; } }
  .secondaryButton { border: 1px solid var(--cr-border-subtle); background: #fff; color: var(--cr-text-secondary); &:hover { background: var(--cr-surface-hover); } }
  .textButton, .linkButton, .metricsLink { border: 0; background: transparent; color: var(--cr-brand-primary); padding: 6px 0; font-size: 12px; }
  .projectMetrics { display: flex; align-items: center; gap: 24px; padding: 0 24px; border-bottom: 1px solid var(--cr-border-subtle); font-size: 11px; color: var(--cr-text-muted); background: #fcfbfe; .metricsLink { margin-left: auto; } }
  .workspace { display: grid; grid-template-columns: 184px minmax(0, 1fr); grid-template-areas: "left canvas"; min-height: 0; }
  .stationPanel { grid-area: left; padding: 22px 12px; background: #fdfcfe; border-right: 1px solid var(--cr-border-subtle); }
  .backButton { padding: 8px; margin-bottom: 16px; border: 0; background: transparent; color: var(--cr-brand-primary); font-size: 12px; }
  .stationNav { display: grid; gap: 8px; button { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 16px; border: 0; border-radius: 12px; background: transparent; color: var(--cr-text-secondary); text-align: left; font-size: 13px; &:hover { background: var(--cr-surface-subtle); } &.stationActive { color: var(--cr-brand-primary); background: #f0ebfa; } } }
  .stationInfo { padding: 22px 16px; margin-top: 14px; strong { display: block; font-size: 13px; font-weight: 600; overflow-wrap: anywhere; } }
  .eyebrow { margin: 0 0 10px; font-size: 11px; font-weight: 500; color: var(--cr-text-muted); }
  .canvasPanel { position: relative; grid-area: canvas; min-width: 0; min-height: 0; overflow: hidden; background: var(--cr-page-background); }
  .stationToolbar { position: absolute; z-index: 4; top: 22px; left: 50%; transform: translateX(-50%); display: flex; gap: 3px; max-width: calc(100% - 36px); overflow-x: auto; padding: 8px 12px; border: 1px solid var(--cr-border-subtle); border-radius: 16px; background: #ffffff; box-shadow: 0 4px 18px rgba(67,46,103,.045); }
  .stationTool { flex: 0 0 60px; display: grid; justify-items: center; gap: 6px; padding: 6px 8px; border: 0; border-radius: 9px; background: transparent; color: var(--cr-text-secondary); font-size: 11px; cursor: grab; &:hover { background: var(--cr-surface-hover); color: var(--cr-brand-primary); } &:active { cursor: grabbing; } }
  .vue-flow { width: 100%; height: 100%; }
  .controlDock { position: absolute; z-index: 4; bottom: 24px; left: 24px; display: flex; align-items: center; gap: 3px; padding: 5px; border: 1px solid var(--cr-border-subtle); border-radius: 12px; background: #fff; box-shadow: 0 4px 14px rgba(67,46,103,.045); button { min-width: 34px; height: 34px; padding: 5px 9px; border: 0; border-radius: 8px; background: transparent; color: var(--cr-text-secondary); font-size: 13px; &:hover { background: var(--cr-surface-hover); } } .zoomPreset { width: 74px; height: 30px; border: 0; color: var(--cr-text-secondary); background: #fff; font-size: 12px; } }
  .canvasEmpty { position: absolute; inset: 0; display: grid; justify-items: center; place-content: center; text-align: center; pointer-events: none; h2 { font-size: 22px; margin: 0; } p { color: var(--cr-text-secondary); font-size: 14px; } button { pointer-events: auto; } }
  .nodePickerAnchor { position: relative; }
  .nodePicker { position: absolute; z-index: 9; top: calc(100% + 12px); right: 0; width: min(360px, calc(100vw - 24px)); max-height: 75dvh; overflow: auto; padding: 18px; border: 1px solid var(--cr-border-subtle); border-radius: 16px; background: #fff; box-shadow: 0 12px 40px rgba(67,46,103,.12); }
  .pickerHeading { display: flex; justify-content: space-between; margin-bottom: 14px; span { color: var(--cr-brand-primary); font-size: 12px; } h2 { font-size: 18px; margin: 5px 0; } }
  .pickerClose { display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 10px; color: var(--cr-text-secondary); background: transparent; font-size: 25px; &:hover { background: var(--cr-surface-hover); } }
  .nodeChoice { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; align-items: center; gap: 12px; width: 100%; margin-top: 4px; padding: 10px 8px; border: 0; border-radius: 10px; color: var(--cr-text-primary); background: transparent; text-align: left; &:hover { background: var(--cr-surface-subtle); } strong, small { display: block; } strong { font-size: 13px; } small { margin-top: 4px; color: var(--cr-text-muted); font-size: 11px; line-height: 1.6; } }
  .choiceMark { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; color: var(--cr-brand-primary); background: var(--cr-surface-hover); }
  .choiceState, .choiceArrow { color: var(--cr-text-muted); font-size: 11px; }
  .unavailableChoice { cursor: default; opacity: .65; }
  .pickerFootnote, .capabilityUnavailable, .pickerEmpty { font-size: 12px; line-height: 1.7; color: var(--cr-text-muted); }
  .pickerBack { border: 0; background: transparent; color: var(--cr-brand-primary); padding: 8px 0; }
  .workflowChoices { display: grid; gap: 8px; max-height: 270px; overflow: auto; button { padding: 12px; border: 1px solid var(--cr-border-subtle); border-radius: 10px; background: #fff; text-align: left; strong, small { display: block; } small { color: var(--cr-text-muted); margin-top: 5px; } } }
  .uploadField, .fieldLabel { display: grid; gap: 8px; color: var(--cr-text-secondary); font-size: 13px; font-weight: 600; }
  .uploadField { margin: 14px 0; input, select { width: 100%; padding: 10px; border: 1px solid var(--cr-border-subtle); border-radius: 10px; background: #fff; } }
  .declarationCheck { display: flex; align-items: start; gap: 8px; margin: 12px 0; font-size: 12px; color: var(--cr-text-secondary); }
  .textInput, .textArea { width: 100%; padding: 10px 12px; border: 1px solid var(--cr-border-subtle); border-radius: 10px; color: var(--cr-text-primary); background: #fff; font-size: 14px; font-weight: 400; &:focus { outline: 2px solid #e6dff5; border-color: var(--cr-border-focus); } }
  .textArea { min-height: 150px; resize: vertical; line-height: 1.7; }
  .contentField, .runPanel { margin-top: 20px; }
  .fieldHint { font-size: 12px; color: var(--cr-text-muted); line-height: 1.7; }
  .errorMessage { font-size: 13px; color: #a53749; line-height: 1.7; overflow-wrap: anywhere; }
  .referenceDetails, .mediaDetails { display: grid; gap: 12px; img { max-height: 240px; max-width: 100%; object-fit: contain; border-radius: 12px; } }
  .quoteCard, .taskCard, .historyCard { border: 1px solid var(--cr-border-subtle); border-radius: 14px; padding: 18px; margin-top: 18px; p { font-size: 13px; line-height: 1.7; } }
  .runButton { margin-top: 16px; }
  .taskResult { display: grid; gap: 10px; padding-top: 16px; img, video { max-width: 100%; max-height: 240px; border-radius: 10px; } a { color: var(--cr-brand-primary); } }
  .panelRule { height: 1px; background: var(--cr-border-subtle); margin-bottom: 18px; }
  .workTitle { margin-top: 16px; }
  .nodeEditorDialog { width: min(960px, calc(100vw - 40px)); max-width: none; max-height: 85dvh; padding: 0; border: 1px solid #e7e1ee; border-radius: 24px; color: var(--cr-text-primary); background: #fff; box-shadow: 0 24px 80px rgba(47,35,75,.16); overflow: hidden; &::backdrop { background: rgba(43,32,66,.20); } }
  .nodeEditorDialog.scriptDialog { width: min(1080px, calc(100vw - 40px)); .editorHeader { padding: 20px 28px; } .editorBody { padding: 24px; } .editorFooter { padding: 14px 28px; } }
  .editorLayout { display: flex; flex-direction: column; max-height: 85dvh; min-height: min(620px, 85dvh); }
  .editorHeader { display: flex; align-items: center; gap: 14px; flex-shrink: 0; padding: 24px 28px; border-bottom: 1px solid var(--cr-border-subtle); h2 { margin: 0; font-size: 20px; font-weight: 650; } p { margin: 5px 0 0; color: var(--cr-text-muted); font-size: 12px; } .pickerClose { margin-left: auto; flex-shrink: 0; } }
  .editorTypeIcon { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 14px; background: var(--cr-surface-hover); color: var(--cr-brand-primary); :deep(.nodeIcon) { width: 25px; height: 25px; } }
  .editorBody { overflow: auto; flex: 1; min-height: 0; padding: 26px 28px; }
  .editorForm { min-width: 0; .titleField { margin-bottom: 22px; } }
  .editorFooter { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 28px; border-top: 1px solid var(--cr-border-subtle); background: #fff; > span { font-size: 11px; color: var(--cr-text-muted); } > div { display: flex; gap: 10px; } }
  .discardDialog { max-width: min(440px, calc(100vw - 32px)); border: 1px solid var(--cr-border-subtle); border-radius: 20px; padding: 26px; color: var(--cr-text-primary); background: #fff; &::backdrop { background: rgba(43,32,66,.25); } h2 { font-size: 20px; margin: 0 0 12px; } p { font-size: 13px; color: var(--cr-text-secondary); line-height: 1.8; } > div { display: flex; gap: 8px; justify-content: end; margin-top: 24px; } button { padding: 8px 12px; } }
  .previewDialog { max-width: 85vw; max-height: 85dvh; padding: 18px; border: 1px solid var(--cr-border-subtle); border-radius: 18px; background: #fff; &::backdrop { background: rgba(43,32,66,.3); } .pickerClose { margin-left: auto; } img, video { max-width: 78vw; max-height: 70dvh; object-fit: contain; } }
  .historyHeading { display: flex; justify-content: space-between; gap: 14px; align-items: center; > span { font-size: 12px; color: var(--cr-text-muted); overflow-wrap: anywhere; } }
  .historyResults { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; .historyResult { display: grid; gap: 8px; padding: 8px; max-width: 220px; border: 1px solid var(--cr-border-subtle); border-radius: 10px; background: var(--cr-surface-subtle); color: var(--cr-text-secondary); font-size: 12px; img { width: 100%; max-height: 140px; object-fit: contain; border-radius: 6px; } } }
  .canvasToast { position: fixed; z-index: 7; bottom: 90px; left: 50%; transform: translateX(-50%); display: flex; gap: 18px; align-items: center; padding: 12px 20px; border: 1px solid var(--cr-border-subtle); border-radius: 12px; background: #fff; box-shadow: 0 6px 24px rgba(67,46,103,.1); font-size: 13px; button { border: 0; color: var(--cr-brand-primary); background: transparent; } }
  .telemetryFooter { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 0 22px; border-top: 1px solid var(--cr-border-subtle); background: #fdfcfe; color: var(--cr-text-muted); font-size: 10px; }
  :deep(.vue-flow__node) { padding: 0; border: 0; background: transparent; box-shadow: none; }
  :deep(.vue-flow__node.selected .nodeCard) { border-color: var(--cr-border-focus); box-shadow: var(--cr-selection-ring); .cardHeader { border-color: var(--cr-border-focus); } }
  :deep(.vue-flow__minimap) { margin: 24px; border: 1px solid var(--cr-border-subtle); border-radius: 14px; overflow: hidden; box-shadow: 0 4px 16px rgba(67,46,103,.04); background: #fff; }
  &.compactNodes { :deep(.nodeCard) { min-height: 115px; } :deep(.cardBody), :deep(.cardFooter), :deep(.formalOutput), :deep(.cardStates), :deep(.portSummary) { display: none; } :deep(.cardTitle) { font-size: 22px; } :deep(.cardHeader .typeName), :deep(.nodeStatus) { font-size: 14px; } :deep(.editAction) { opacity: 1; } :deep(.cardActions .editAction) { font-size: 16px; } :deep(.cardActions button), :deep(.cardActions summary) { min-height: 36px; min-width: 36px; } }
  &.tinyNodes { :deep(.failureReason), :deep(.executionProgress) { display: none; } :deep(.cardActions button), :deep(.cardActions summary) { min-width: 42px; height: 42px; } :deep(.editAction span) { font-size: 20px; } :deep(.cardActions .nodeIcon) { width: 26px; height: 26px; } :deep(.cardTitle) { font-size: 30px; } :deep(.nodeStatus), :deep(.cardHeader .typeName) { font-size: 18px; } }
}
.loadingState { display: grid; place-items: center; min-height: 100dvh; color: #81798e; background: #f7f6fa; }
@media (max-width: 1100px) { .canvasShell { .workspace { grid-template-columns: 64px minmax(0, 1fr); } .stationPanel { padding: 20px 8px; } .stationLabel, .stationInfo, .stationPanel .backButton { display: none; } .stationNav button { justify-content: center; padding: 12px; } .canvasHeader { grid-template-columns: 160px minmax(0, 1fr) auto; } } }
@media (max-width: 700px) { .canvasShell { .canvasHeader { grid-template-columns: 1fr auto; padding: 0 12px; } .workflowIdentity { display: none; } .canvasActions { gap: 10px; } .projectMetrics { padding: 0 12px; gap: 12px; > span:nth-child(2) { display: none; } } .workspace { grid-template-columns: minmax(0, 1fr); grid-template-areas: "canvas"; } .stationPanel { display: none; } .stationToolbar { top: 12px; } .stationTool { flex-basis: 52px; } .editorHeader, .editorBody, .editorFooter { padding: 18px; } .nodeEditorDialog.scriptDialog { width: calc(100vw - 20px); .editorBody { padding: 12px; } .editorHeader, .editorFooter { padding: 16px; } } .editorHeader h2 { font-size: 17px; } .editorFooter > span { display: none; } .editorFooter { justify-content: end; } .telemetryFooter span:last-child { display: none; } :deep(.vue-flow__minimap) { width: 120px; height: 90px; margin: 16px; } .controlDock { left: 12px; bottom: 16px; } } }
</style>
