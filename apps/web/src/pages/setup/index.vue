<template>
  <main class="setupPage">
    <div class="setupCard">
      <img class="brandLogo" :src="logoUrl" alt="Cruio" />
      <p class="stepLabel">首次使用 · 创作空间</p>
      <h1>选择创作文件存放位置</h1>
      <p class="description">选择或新建一个 Cruio 文件夹。以后只需给项目起个名字，画布和生成素材会自动放在一起。</p>
      <el-alert v-if="creationLocation.directory" type="warning" :closable="false" title="原创作目录暂时不可用">
        <p>请先连接原磁盘；也可以重新选择位置。原文件不会自动迁移。</p>
        <p class="pathText">{{ creationLocation.directory }}</p>
        <el-button text @click="retryLocation">重新检测</el-button>
      </el-alert>
      <div class="directoryChoice">
        <span class="choiceLabel">保存文件夹</span>
        <span class="pathText" role="status">{{ directory || '尚未选择' }}</span>
        <el-button :disabled="saving" :loading="picker?.selecting" @click="picker?.chooseDirectory()">{{ directory ? '重新选择' : '选择文件夹' }}</el-button>
      </div>
      <div class="folderPreview" aria-label="应用将创建的目录结构">
        <div class="folderRow"><icon-folder :size="20" /><strong>{{ folderName }}</strong></div>
        <div class="folderContents">
          <div class="folderRow"><icon-folder :size="18" /><span>公共素材</span><small>多个项目共用</small></div>
          <div class="folderRow"><icon-folder :size="18" /><span>项目</span><small>每个项目独立保存画布与素材</small></div>
        </div>
      </div>
      <p v-if="creationLocation.legacyAssets" class="legacyNotice">原素材仍保存在 <span class="pathText">{{ creationLocation.legacyAssets }}</span>，需要沿用时可手动复制到新位置的“公共素材”中。</p>
      <el-alert v-if="error" :title="error" type="error" :closable="false" role="alert" />
      <div class="setupFooter">
        <el-button text :disabled="saving" @click="requestLogout">退出登录</el-button>
        <el-button type="primary" size="large" :disabled="!directory || picker?.selecting" :loading="saving" @click="finishSetup">确认位置，开始创作</el-button>
      </div>
      <workspacePicker ref="picker" v-model="directory" hideTrigger :disabled="saving" />
    </div>
  </main>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { IconFolder } from "@tabler/icons-vue";
import logoUrl from "@toonflow/assets/logoColor.svg";
import workspacePicker from "@/pages/home/workspacePicker.vue";
import { creationLocation, loadCreationLocation, saveCreationLocation } from "@/stores/creationLocation";
import { requestLogout } from "@/stores/account";

const router = useRouter();
const picker = ref<InstanceType<typeof workspacePicker>>();
const directory = ref("");
const saving = ref(false);
const error = ref("");
const folderName = computed(() => directory.value.split(/[\\/]/).filter(Boolean).at(-1) || "Cruio");

function showError(cause: unknown) {
  error.value = axios.isAxiosError(cause) ? cause.response?.data?.message || "无法保存位置，请检查文件夹权限后重试" : cause instanceof Error ? cause.message : "无法保存位置，请重试";
}

async function retryLocation() {
  error.value = "";
  try {
    await loadCreationLocation();
    if (creationLocation.value.available) await router.replace("/home");
    else error.value = "原目录仍不可用，请检查磁盘连接和文件夹位置";
  } catch (cause) { showError(cause); }
}

async function finishSetup() {
  if (!directory.value || saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    await saveCreationLocation(directory.value);
    await router.replace("/home");
  } catch (cause) { showError(cause); }
  finally { saving.value = false; }
}
</script>

<style lang="scss" scoped>
.setupPage {
  min-height: 100dvh;
  padding: 48px 24px;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  color: var(--el-text-color-primary);
  background: var(--el-bg-color-page);

  .setupCard {
    width: min(100%, 620px);
    .brandLogo { width: 52px; height: 52px; object-fit: contain; }
    .stepLabel { margin: 28px 0 12px; color: var(--el-text-color-secondary); font-size: 13px; }
    h1 { margin: 0; font-size: clamp(24px, 4vw, 32px); font-weight: 600; letter-spacing: -.6px; }
    .description { margin: 16px 0 28px; line-height: 1.8; color: var(--el-text-color-regular); }
    .pathText { overflow-wrap: anywhere; }
    .directoryChoice {
      display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 10px 20px;
      padding: 20px; border: 1px solid var(--el-border-color); border-radius: 12px; background: var(--el-bg-color);
      .choiceLabel { grid-column: 1 / -1; font-size: 12px; color: var(--el-text-color-secondary); }
      .pathText { min-width: 0; font-size: 14px; }
    }
    .folderPreview {
      margin: 24px 0; padding: 4px 20px;
      .folderRow {
        display: flex; flex-wrap: wrap; align-items: center; gap: 10px; min-height: 42px; font-size: 14px;
        svg { flex-shrink: 0; color: var(--el-text-color-secondary); }
        small { color: var(--el-text-color-secondary); font-size: 12px; }
      }
      .folderContents { margin-left: 9px; padding-left: 24px; border-left: 1px solid var(--el-border-color); }
    }
    .legacyNotice { color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.7; }
    .el-alert { margin: 16px 0; }
    .setupFooter { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; margin-top: 32px; }
  }
}
</style>
