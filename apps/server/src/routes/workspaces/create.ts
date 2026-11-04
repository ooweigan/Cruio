import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const name = z.string().trim().min(1).max(100).refine(value => value !== "." && value !== ".."
  && !/[\\/:*?"<>|\u0000-\u001f]/.test(value) && !/[. ]$/.test(value)
  && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value), "请输入有效的项目名称");
const router = Router();
export default router.post("/", validateFields({ name }), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  res.json(success(await u.workspaceLocation.createProject(req, name.parse(req.body.name))));
});
