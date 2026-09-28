import { createApp } from "./app";
import { createDatabase } from "./db/database";
import { migrate } from "./db/migrate";

const startTime = Date.now();
const realPort = Number(process.env.PORT ?? 3000);
const database = await createDatabase();
await migrate(database);
const app = await createApp({ database });

app.listen(realPort, () => {
  console.log(`[Cruio server]: http://localhost:${realPort}`);
  console.log(`[启动耗时]: ${(Date.now() - startTime).toFixed(2)}ms`);
});
