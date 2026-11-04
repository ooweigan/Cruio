import u from "@/utils";
import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.put("/", validateFields({ settings: z.record(z.string(), z.json()) }), (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const settings = u.accountSettings.validateSettings(req.body.settings);
  u.cleanNodeMenuSettings(settings);
  u.accountSettings.saveSettings(settings);
  res.json(success({ nodeMenu: settings.general?.nodeMenu ?? null }, "设置已保存"));
});
