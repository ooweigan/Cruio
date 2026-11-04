import u from "@/utils";
import { Router } from "express";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.get("/", (req, res) => {
  u.mcpControl.assertAppRequest(req);
  res.set("Cache-Control", "no-store");
  const settings = u.accountSettings.getSettings();
  if (u.cleanNodeMenuSettings(settings)) u.accountSettings.saveSettings(settings);
  res.json(success({ ...settings, customProviders: [] }));
});
