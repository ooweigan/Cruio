import { createRouter, createWebHashHistory } from "vue-router";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/projects" },
    { path: "/login", name: "login", component: () => import("@/pages/loginPage.vue") },
    { path: "/projects", name: "projects", component: () => import("@/pages/projectsPage.vue") },
    {
      path: "/projects/:projectId",
      name: "project-detail",
      component: () => import("@/pages/projectDetailPage.vue"),
    },
    {
      path: "/projects/:projectId/workflows/:workflowId",
      name: "workflow-canvas",
      component: () => import("@/pages/cruioCanvas.vue"),
    },
    { path: "/:pathMatch(.*)*", redirect: "/projects" },
  ],
});

export default router;
