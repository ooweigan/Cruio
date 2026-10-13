<template>
  <header v-if="!route.meta.admin" class="appHeader">
    <button class="brandButton" type="button" @click="router.push('/projects')">
      <span class="brandMark">C</span>
      <span class="brandName">CRUIO</span>
    </button>

    <nav class="desktopNav" aria-label="主导航"><router-link v-for="item in navItems" :key="item.path" :to="item.path">{{ item.label }}</router-link></nav>

    <details ref="compactNavigation" class="compactNavigation">
      <summary aria-label="打开主导航">导航</summary>
      <nav aria-label="主导航"><router-link v-for="item in navItems" :key="item.path" :to="item.path" @click="closeCompactNavigation">{{ item.label }}</router-link></nav>
    </details>

    <div class="accountArea">
      <span>{{ session.user?.email }}</span>
      <button type="button" class="textButton" @click="logout">退出</button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useCruioSession } from "@/stores/cruioSession";

const router = useRouter();
const route = useRoute();
const session = useCruioSession();
const compactNavigation = ref<HTMLDetailsElement | null>(null);
const hasAdminAccess = computed(() => session.user?.roles?.some(role => !role.revokedAt && new Date(role.expiresAt).getTime() > Date.now()) ?? false);
const navItems = computed(() => {
  const items = [
    { path: "/projects", label: "项目" },
    { path: "/workflows", label: "工作流" },
    { path: "/materials", label: "素材库" },
    { path: "/tasks", label: "任务" },
  ];
  items.push({ path: "/credits", label: "积分" });
  if (hasAdminAccess.value) items.push({ path: "/admin", label: "管理后台" });
  items.push({ path: "/notifications", label: "通知" });
  items.push({ path: "/support", label: "客服工单" });
  items.push({ path: "/account", label: "账户安全" });
  return items;
});

onMounted(() => { if (!route.meta.admin) void session.refresh(); });

function closeCompactNavigation() {
  compactNavigation.value?.removeAttribute("open");
}

async function logout() {
  await session.signOut();
  await router.replace("/login");
}
</script>

<style scoped lang="scss">
.appHeader {
  width: 100%;
  height: 56px;
  position: relative;
  padding: 0 max(24px, calc((100% - 1320px) / 2));
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  border-bottom: 1px solid var(--cr-border-subtle);
  color: var(--cr-text-primary);
  background: color-mix(in srgb, var(--cr-surface) 92%, transparent);
  backdrop-filter: blur(12px);
}

.brandButton {
  width: fit-content;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 0;
  color: var(--cr-text-primary);
  background: transparent;
  cursor: pointer;
}

.brandMark {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  color: var(--cr-text-primary);
  background: var(--cr-gradient);
  font-family: Georgia, serif;
  font-size: 1.05rem;
}

.brandName { font-size: 12px; font-weight: 700; letter-spacing: .16em; }
nav { display: flex; align-items: center; white-space: nowrap; }
nav a { padding: 8px; border-radius: 6px; color: var(--cr-text-secondary); text-decoration: none; font-size: 14px; font-weight: 600; }
nav a.router-link-active { color: var(--cr-text-primary); background: var(--cr-surface-hover); }
.compactNavigation { display: none; position: relative; justify-self: center; summary { padding: 8px 12px; border: 1px solid var(--cr-border-subtle); border-radius: 6px; color: var(--cr-text-primary); font-size: 14px; cursor: pointer; list-style: none; } summary::-webkit-details-marker { display: none; } summary:focus-visible { outline: 2px solid var(--cr-border-focus); outline-offset: 2px; } nav { position: absolute; top: calc(100% + 8px); left: 0; z-index: 50; min-width: 208px; display: grid; gap: 4px; padding: 8px; border: 1px solid var(--cr-border-subtle); border-radius: 8px; background: var(--cr-surface); box-shadow: 0 4px 12px color-mix(in srgb, var(--cr-text-primary) 12%, transparent); } nav a { display: block; } }
.accountArea { min-width: 0; justify-self: end; display: flex; align-items: center; gap: 12px; color: var(--cr-text-muted); font-size: 12px; }
.accountArea > span { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.textButton { border: 0; border-radius: 6px; color: var(--cr-brand-primary); background: transparent; font: inherit; font-weight: 600; cursor: pointer; }

@media (max-width: 1280px) {
  .appHeader { grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; padding: 0 24px; }
  .desktopNav { display: none; }
  .compactNavigation { display: block; }
}

@media (max-width: 760px) {
  .appHeader { padding: 0 12px; grid-template-columns: auto auto 1fr; }
  .compactNavigation { justify-self: center; }
  .accountArea > span { display: none; }
}
</style>
