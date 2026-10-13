<template>
  <div class="adminShell">
    <aside class="adminSidebar">
      <router-link to="/admin" class="adminBrand"><span class="brandMark">C</span><strong>CRUIO</strong><span>管理后台</span></router-link>
      <nav aria-label="管理后台导航">
        <div v-for="group in navigation" :key="group.title" class="navGroup">
          <p>{{ group.title }}</p>
          <router-link v-for="item in group.items" :key="item.path" :to="item.path" :class="{ selected: route.path === item.path }">
            {{ item.label }}
          </router-link>
        </div>
      </nav>
      <router-link to="/projects" class="backLink">← 返回创作台</router-link>
    </aside>
    <div class="adminWorkspace">
      <header class="adminTopbar"><span>后台管理 <span class="separator">/</span> {{ currentTitle }}</span><div><span class="accountEmail">{{ session.user?.email }}</span><router-link to="/projects" class="mobileBack">创作台</router-link><button type="button" @click="logout">退出</button></div></header>
      <div class="adminContent"><router-view :key="route.path" /></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useCruioSession } from "@/stores/cruioSession";
import "@/assets/admin.scss";

const session = useCruioSession();
const route = useRoute();
const router = useRouter();
const navigation = computed(() => {
  const admin = session.hasRole("admin", true);
  const models = admin || session.hasRole("modelOperator", true);
  return [
    { title: "总览", items: [{ path: "/admin", label: "Dashboard", show: true }] },
    { title: "系统管理", items: [
      { path: "/admin/users", label: "用户与权限", show: admin },
      { path: "/admin/logs", label: "操作日志", show: admin },
    ] },
    { title: "模型管理", items: [
      { path: "/admin/providers", label: "供应商与渠道", show: models },
      { path: "/admin/models", label: "New API 模型管理", show: models },
    ] },
    { title: "业务运营", items: [
      { path: "/admin/tasks", label: "任务核查", show: session.hasRole("modelOperator") },
      { path: "/admin/credits", label: "积分运营", show: session.hasRole("creditOperator") },
      { path: "/admin/reconciliation", label: "积分核对", show: session.hasRole("creditOperator") },
      { path: "/admin/support", label: "客服工单", show: session.hasRole("support") || session.hasRole("modelOperator") || session.hasRole("creditOperator") },
      { path: "/admin/privacy", label: "隐私申请", show: session.hasRole("privacyOperator") },
    ] },
  ].map(group => ({ ...group, items: group.items.filter(item => item.show) })).filter(group => group.items.length);
});
const currentTitle = computed(() => navigation.value.flatMap(group => group.items).find(item => item.path === route.path)?.label ?? "工作区");
async function logout() { await session.signOut(); await router.replace("/login"); }
</script>

<style scoped lang="scss">
.adminShell {
  min-height: 100dvh; display: grid; grid-template-columns: 216px minmax(0, 1fr); background: var(--cr-page-background);
  .adminSidebar {
    position: sticky; top: 0; height: 100dvh; display: flex; flex-direction: column; background: var(--cr-surface); border-right: 1px solid var(--cr-border-subtle);
    .adminBrand { height: 64px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 20px; color: var(--cr-text-primary); text-decoration: none;
      .brandMark { display: grid; place-items: center; width: 26px; height: 26px; border: 1px solid var(--cr-border-strong); border-radius: 6px; font-family: Georgia, serif; font-size: 18px; }
      strong { font-size: 12px; letter-spacing: .1em; } > span:last-child { margin-left: 4px; color: var(--cr-text-muted); font-size: 11px; }
    }
    nav { flex: 1; overflow-y: auto; padding: 12px; }
    .navGroup { margin-bottom: 20px;
      p { margin: 0 12px 6px; color: var(--cr-text-muted); font-size: 11px; }
      a { display: flex; align-items: center; min-height: 38px; padding: 8px 12px; margin: 2px 0; color: var(--cr-text-secondary); text-decoration: none; border-radius: 5px; font-size: 13px;
        &:hover { background: var(--cr-surface-subtle); }
        &.selected { color: var(--cr-text-primary); background: var(--cr-surface-hover); font-weight: 600; box-shadow: inset 2px 0 var(--cr-brand-primary); }
      }
    }
    .backLink { padding: 20px 24px; border-top: 1px solid var(--cr-border-subtle); color: var(--cr-text-secondary); text-decoration: none; font-size: 12px; }
  }
  .adminWorkspace { min-width: 0;
    .adminTopbar { min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 32px; border-bottom: 1px solid var(--cr-border-subtle); background: var(--cr-surface); font-size: 12px; color: var(--cr-text-secondary);
      .separator { margin: 0 12px; color: var(--cr-border-strong); }
      > div { display: flex; align-items: center; gap: 20px; min-width: 0; }
      .accountEmail { max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
      .mobileBack { display: none; color: inherit; text-decoration: none; }
      button { border: 0; padding: 4px 0; background: transparent; color: var(--cr-text-secondary); cursor: pointer; }
    }
    .adminContent { max-width: 1500px; padding: 28px 32px 64px; }
  }
  @media (max-width: 800px) {
    grid-template-columns: 172px minmax(0, 1fr);
    .adminSidebar .adminBrand { padding: 0 16px; > span:last-child { display: none; } }
    .adminWorkspace { .adminContent { padding: 24px 16px 48px; } .adminTopbar { padding: 0 16px; .accountEmail { display: none; } } }
  }
  @media (max-width: 560px) {
    display: block;
    .adminSidebar { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--cr-border-subtle);
      .adminBrand { height: 48px; > span:last-child { display: inline; } }
      nav { display: flex; overflow-x: auto; padding: 0 8px 8px; }
      .navGroup { display: flex; margin: 0; flex: none; p { display: none; } a { white-space: nowrap; margin: 0; } }
      .backLink { display: none; }
    }
    .adminWorkspace .adminTopbar { min-height: 44px; .mobileBack { display: inline; } }
  }
}
</style>
