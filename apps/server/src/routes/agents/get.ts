import { Router } from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

export default Router().get("/", async (req, res) => {
  const agents = (await u.teams.listTeams()).map(team => ({
    ...team,
    builtin: team.kind === "local" && req.app.locals.builtinPlugins.agent.has(team.name),
  }));
  res.json(success({ agents, canManage: false }));
});
