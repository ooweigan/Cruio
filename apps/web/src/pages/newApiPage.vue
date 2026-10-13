<template>
  <section class="newApiPage">
    <header>
      <div><h1>{{ isProviders ? "供应商与渠道" : "模型管理" }} <span>New API</span></h1><p>使用 New API 独立管理员账号登录</p></div>
      <a :href="consoleUrl" target="_blank" rel="noopener noreferrer" class="adminButton">独立窗口打开 ↗</a>
    </header>
    <iframe :key="consoleUrl" :src="consoleUrl" :title="isProviders ? 'New API 供应商与渠道管理' : 'New API 模型管理'" referrerpolicy="no-referrer" />
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const isProviders = computed(() => route.name === "adminProviders");
const configuredUrl = import.meta.env.VITE_NEW_API_URL || "http://localhost:3001";
const baseUrl = new URL(configuredUrl);
if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) throw new Error("New API 地址必须是不含凭据的 HTTP(S) 地址");
const consoleUrl = computed(() => new URL(isProviders.value ? "/channels" : "/models", baseUrl).href);
</script>

<style scoped lang="scss">
.newApiPage {
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px;
    h1 { margin: 0; font-size: 20px; span { margin-left: 10px; color: var(--cr-text-muted); font-size: 12px; font-weight: 400; } }
    p { margin: 8px 0 0; color: var(--cr-text-muted); font-size: 12px; }
    a { flex-shrink: 0; text-decoration: none; }
  }
  iframe { display: block; width: 100%; height: calc(100dvh - 190px); min-height: 600px; border: 1px solid var(--cr-border-subtle); border-radius: 6px; background: var(--cr-surface); }
  @media (max-width: 560px) { header { align-items: flex-start; flex-direction: column; } iframe { min-height: 720px; } }
}
</style>
