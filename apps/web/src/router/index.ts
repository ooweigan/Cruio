import { createRouter, createWebHashHistory } from "vue-router";

const cruioCanvas = () => import("@/pages/cruioCanvas.vue");

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      component: cruioCanvas,
    },
    { path: "/projects/:projectId", component: cruioCanvas },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

export default router;
