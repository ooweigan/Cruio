import { Router } from "express";
import type { Database } from "@/db/database";

type User = { id: string };

export function createCreditsGetRoute(database: Database) {
  return Router().get("/", async (_request, response) => {
    const user = response.locals.user as User | undefined;
    if (!user?.id) return response.status(401).json({ message: "请先登录。" });
    const rows = await database<{ balance: number; reserved: number }[]>`
      SELECT balance, reserved FROM credit_accounts WHERE user_id = ${user.id}
    `;
    const balance = Number(rows[0]?.balance ?? 0);
    const reserved = Number(rows[0]?.reserved ?? 0);
    return response.json({ credits: { balance, reserved, available: Math.max(0, balance - reserved), debt: Math.max(0, -balance) } });
  });
}
