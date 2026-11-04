import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();
export default router.put("/", validateFields({ directory: z.string().min(1).max(4096) }), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  res.json(success(await u.workspaceLocation.saveLocation(req, req.body.directory)));
});
