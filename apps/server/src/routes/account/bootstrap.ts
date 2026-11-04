import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

export default Router().get("/", (_req, res) => {
  res.set("Cache-Control", "no-store").json(success(u.account.bootstrap()));
});
