import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import u from "@/utils";

const fields = { directory: z.string().min(1), runId: z.uuid() };

export default Router().post("/", validateFields(fields), async (req, res) => {
  const cwd = await u.workspace.resolveWorkspace(req, req.body.directory);
  await u.agent.stopRun(cwd, req.body.runId);
  res.json(success());
});
