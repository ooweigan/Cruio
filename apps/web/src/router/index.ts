import { createRouter, createWebHashHistory } from "vue-router";
import { useCruioSession } from "@/stores/cruioSession";

const router = createRouter({
  history: createWebHashHistory(),
  scrollBehavior(to, _from, savedPosition) {
    if (savedPosition) return savedPosition;
    if (to.hash) return { el: to.hash, top: 72 };
    return { top: 0 };
  },
  routes: [
    { path: "/", redirect: "/projects" },
    { path: "/login", name: "login", component: () => import("@/pages/loginPage.vue") },
    { path: "/verifyEmail", name: "verify-email", component: () => import("@/pages/authRecoveryPage.vue") },
    { path: "/passwordReset", name: "password-reset", component: () => import("@/pages/authRecoveryPage.vue") },
    { path: "/account", name: "account", component: () => import("@/pages/accountPage.vue") },
    { path: "/projects", name: "projects", component: () => import("@/pages/projectsPage.vue") },
    { path: "/workflows", name: "workflows", component: () => import("@/pages/workflowsPage.vue") },
    { path: "/materials/scripts", alias: "/materials", name: "materialLibrary", component: () => import("@/pages/materialLibraryPage.vue") },
    { path: "/tasks", name: "tasks", component: () => import("@/pages/tasksPage.vue") },
    { path: "/credits", name: "credits", component: () => import("@/pages/creditsPage.vue") },
    { path: "/admin", component: () => import("@/pages/adminPage.vue"), meta: { admin: true }, children: [
      { path: "", name: "admin", component: () => import("@/pages/adminDashboard.vue") },
      { path: "users", name: "adminUsers", component: () => import("@/pages/adminUsers.vue"), meta: { systemAdmin: true } },
      { path: "logs", name: "adminLogs", component: () => import("@/pages/adminLogs.vue"), meta: { systemAdmin: true } },
      { path: "providers", name: "adminProviders", component: () => import("@/pages/newApiPage.vue"), meta: { modelAdmin: true } },
      { path: "models", name: "adminModels", component: () => import("@/pages/newApiPage.vue"), meta: { modelAdmin: true } },
      { path: "credits", name: "adminCredits", component: () => import("@/pages/operationsPage.vue") },
      { path: "reconciliation", name: "adminReconciliation", component: () => import("@/pages/reconciliationPage.vue") },
      { path: "tasks", name: "adminTasks", component: () => import("@/pages/tasksPage.vue") },
      { path: "support", name: "adminSupport", component: () => import("@/pages/supportPage.vue") },
      { path: "privacy", name: "adminPrivacy", component: () => import("@/pages/privacyOperationsPage.vue") },
    ] },
    { path: "/operations", name: "operations", component: () => import("@/pages/operationsPage.vue") },
    { path: "/models", name: "models", redirect: "/admin/models" },
    { path: "/reconciliation", name: "reconciliation", component: () => import("@/pages/reconciliationPage.vue") },
    { path: "/notifications", name: "notifications", component: () => import("@/pages/notificationsPage.vue") },
    { path: "/support", name: "support", component: () => import("@/pages/supportPage.vue") },
    { path: "/privacyRequests", name: "privacy-requests", component: () => import("@/pages/privacyRequestsPage.vue") },
    { path: "/privacyOperations", name: "privacy-operations", component: () => import("@/pages/privacyOperationsPage.vue") },
    { path: "/workflows/:workflowId", name: "workflow-canvas", component: () => import("@/pages/cruioCanvas.vue") },
    {
      path: "/projects/:projectId",
      name: "project-detail",
      component: () => import("@/pages/projectDetailPage.vue"),
    },
    {
      path: "/projects/:projectId/canvas",
      name: "project-canvas",
      component: () => import("@/pages/cruioCanvas.vue"),
    },
    {
      path: "/projects/:projectId/workflows/:workflowId",
      redirect: (to) => `/workflows/${to.params.workflowId}`,
    },
    { path: "/:pathMatch(.*)*", redirect: "/projects" },
  ],
});

router.beforeEach(async to => {
  if (["/verifyEmail", "/passwordReset"].includes(to.path)) return true;
  const session = useCruioSession();
  const user = await session.initialize(Boolean(to.meta.admin));
  if (to.path === "/login") {
    if (!user) return true;
    return typeof to.query.next === "string" && to.query.next.startsWith("/") && !to.query.next.startsWith("//") ? to.query.next : "/projects";
  }
  if (!user) return { path: "/login", query: { next: to.fullPath } };
  if (to.meta.admin && !user.roles?.some(role => session.hasRole(role.role))) return "/projects";
  if (to.meta.systemAdmin && !session.hasRole("admin", true)) return "/admin";
  if (to.meta.modelAdmin && !session.hasRole("admin", true) && !session.hasRole("modelOperator", true)) return "/admin";
  return true;
});

export default router;
