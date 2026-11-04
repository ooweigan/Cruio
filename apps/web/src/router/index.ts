import { createRouter, createWebHashHistory } from "vue-router";
import { accountSession, isAuthenticated, accountDataReady } from "@/stores/account";
import { creationLocation } from "@/stores/creationLocation";
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      redirect: "/hello",
    },
    {
      path: "/hello",
      component: () => import("@/pages/hello/index.vue"),
    },
    {
      path: "/setup",
      component: () => import("@/pages/setup/index.vue"),
    },
    {
      path: "/home",
      component: () => import("@/pages/home/index.vue"),
    },
    {
      path: "/canvas",
      redirect: "/workspace",
    },
    {
      path: "/workspace",
      component: () => import("@/pages/workspace/index.vue"),
    },
  ],
});
router.beforeEach((to, from) => {
  if (isAuthenticated.value && accountDataReady.value) {
    if (!creationLocation.value.available) return to.path === "/setup" ? true : "/setup";
    return ["/hello", "/setup"].includes(to.path) ? "/home" : true;
  }
  if (to.path === "/hello") return true;
  // ACT: 失效时保留当前工作区及未保存内容，由全局重登面板收尾。
  if (accountSession.value.user && from.path === "/workspace") return false;
  return "/hello";
});
export default router;
