import { createApp } from "./app";
import { openStore } from "./store";

const port = Number(process.env.CRUIO_IDENTITY_PORT ?? 4310);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("账户服务端口无效");
const store = await openStore().catch(error => {
  console.error(error instanceof Error ? error.message : "账户数据目录无法打开。");
  process.exit(1);
});
try {
  const app = await createApp(store);
  const server = app.listen(port, "127.0.0.1", () => console.info(`Cruio 账户管理后台：http://localhost:${port}/admin（Ctrl+C 停止）`));
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close(async () => {
      try { await store.close(); process.exit(0); }
      catch { console.error("账户服务退出时未能正常关闭数据库连接。"); process.exit(1); }
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  server.once("error", async () => {
    console.error("账户服务监听失败，请检查端口是否占用。");
    await store.close();
    process.exit(1);
  });
} catch {
  await store.close();
  console.error("账户服务启动失败，请检查数据和环境配置。");
  process.exitCode = 1;
}
