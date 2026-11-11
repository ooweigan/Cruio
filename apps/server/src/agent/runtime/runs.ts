import { contextId } from "@/utils/account";

const runs = new Map<string, { cwd: string; account: string; stop(): Promise<void> }>();

export function registerRun(cwd: string, cancel: () => void) {
  const id = crypto.randomUUID();
  const finished = Promise.withResolvers<void>();
  runs.set(id, { cwd, account: contextId(), stop() { cancel(); return finished.promise; } });
  return { id, finish() { runs.delete(id); finished.resolve(); } };
}

export async function stopRun(cwd: string, id: string) {
  const run = runs.get(id);
  if (!run) return;
  if (run.cwd !== cwd || run.account !== contextId()) throw Object.assign(new Error("不能停止其他工作区或账号的回复"), { status: 403 });
  await run.stop();
}
