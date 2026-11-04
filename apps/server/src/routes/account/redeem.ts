import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({ key: z.string().trim().min(1).max(128).regex(/^\S+$/) }), async (req, res) => {
  res.json(success(await u.account.redeem((req.body.key as string).trim())));
});
