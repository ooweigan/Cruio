import { SQL } from "bun";

const databaseTarget = Object.freeze({
  hostname: "127.0.0.1",
  port: 5432,
  database: "cruio_dev",
  username: "cruio_app",
});

async function readPasswordFromKeychain() {
  if (process.platform !== "darwin") {
    throw new Error("Cruio 本地数据库密码只能从 macOS 钥匙串读取。");
  }

  const processResult = Bun.spawn(
    [
      "security",
      "find-generic-password",
      "-s",
      "cruio-dev-postgres",
      "-a",
      "cruio_app",
      "-w",
    ],
    { stdout: "pipe", stderr: "ignore" },
  );
  const password = (await new Response(processResult.stdout).text()).trim();
  const exitCode = await processResult.exited;

  if (exitCode !== 0 || password.length === 0) {
    throw new Error("无法从 macOS 钥匙串读取 cruio-dev-postgres / cruio_app。");
  }

  return password;
}

export async function createDatabase() {
  const password = await readPasswordFromKeychain();
  return new SQL({
    ...databaseTarget,
    password,
    max: 10,
    idleTimeout: 20,
    connectionTimeout: 10,
  });
}

export type Database = Awaited<ReturnType<typeof createDatabase>>;
