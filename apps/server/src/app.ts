import express from "express";
import type { NextFunction, Request, Response } from "express";

export async function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok", service: "cruio" });
  });
  app.use((error: Error, _request: Request, response: Response, _next: NextFunction) => {
    console.error(error);
    response.status(500).json({ message: "服务器暂时无法处理请求。" });
  });

  return app;
}
