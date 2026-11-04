import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({ account: z.string().trim().min(1).max(320), password: z.string().min(1).max(1024) }), async (req, res) => {
  const account = (req.body.account as string).trim();
  res.set("Cache-Control", "no-store").json(success(await u.account.login(req, res, { account, password: req.body.password })));
});
