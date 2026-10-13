import { createApp } from "./app";
import { createDatabase } from "./db/database";
import { migrate } from "./db/migrate";
import { basename, resolve } from "node:path";
import { startGenerationWorker } from "./utils/generation/worker";
import { findVideoToolchain } from "./utils/generation/delivery";

const startTime = Date.now();
const realPort = Number(process.env.PORT ?? 3000);
const database = await createDatabase();
await migrate(database);
const dataDirectory = process.env.TOONFLOW_DATA_DIR ?? resolve(import.meta.dir, basename(import.meta.dir) === "src" ? "../../../data" : "../../data");
const app = await createApp({ database, dataDirectory });
const worker = process.env.CRUIO_GENERATION_WORKER_ENABLED === "true"
  ? startGenerationWorker({ database, dataDirectory, storageDirectory: resolve(dataDirectory, "privateMedia"),
    videoToolchain: await findVideoToolchain(dataDirectory) })
  : null;

const server = app.listen(realPort, () => {
  console.log(`[Cruio server]: http://localhost:${realPort}`);
  console.log(`[启动耗时]: ${(Date.now() - startTime).toFixed(2)}ms`);
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    void (async () => {
      await worker?.stop();
      await new Promise<void>(resolveClose => server.close(() => resolveClose()));
      await database.close();
    })();
  });
}
