import { createApp } from "./app";

const startTime = Date.now();
const realPort = Number(process.env.PORT ?? 3000);
const app = await createApp();

app.listen(realPort, () => {
  console.log(`[Cruio server]: http://localhost:${realPort}`);
  console.log(`[启动耗时]: ${(Date.now() - startTime).toFixed(2)}ms`);
});
