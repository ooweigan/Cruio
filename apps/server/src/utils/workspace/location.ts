import type { Request } from "express";
import { access, constants, lstat, mkdir, mkdirSync, readFileSync, readdir, realpath, writeAtomicSync } from "@toonflow/file";
import { join } from "node:path";
import { accountDirectory } from "@/utils/account";
import { resolveWorkspace } from "@/utils/workspace";
import { lockWorkspaceFiles, resolveWorkspacePath, writeWorkspaceFile } from "@/utils/workspace/files";

export function getCreationDirectory(): string | null {
  try {
    const value = JSON.parse(readFileSync(join(accountDirectory(), "creationLocation.json"), "utf8"));
    if (typeof value.directory !== "string" || !value.directory) throw new Error("创作目录配置无效");
    return value.directory;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function creationFolder(name: "公共素材" | "项目") {
  const root = getCreationDirectory();
  if (!root) throw Object.assign(new Error("请先选择创作文件存放位置"), { status: 409 });
  if (!(await lstat(root)).isDirectory()) throw Object.assign(new Error("创作目录不可用，请重新连接磁盘或选择位置"), { status: 404 });
  const { path } = await resolveWorkspacePath(await realpath(root), name);
  if (!(await lstat(path)).isDirectory()) throw Object.assign(new Error(`${name}目录不可用`), { status: 404 });
  return path;
}

export async function getLocation(req: Request) {
  const directory = getCreationDirectory();
  let available = false;
  if (directory) {
    try {
      await resolveWorkspace(req, directory);
      await creationFolder("公共素材");
      await creationFolder("项目");
      available = true;
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "") && ![403, 404].includes((error as { status?: number }).status ?? 0)) throw error;
    }
  }
  const legacyDirectory = join(accountDirectory(), "assets");
  const legacyEntries = await readdir(legacyDirectory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return { directory, available, legacyAssets: legacyEntries.length ? legacyDirectory : null };
}

export async function saveLocation(req: Request, selected: string) {
  const directory = await resolveWorkspace(req, selected);
  const configPath = join(accountDirectory(), "creationLocation.json");
  const release = lockWorkspaceFiles([configPath, directory]);
  try {
    const current = getCreationDirectory();
    // ACT: 首版只设置位置，不自动迁移磁盘文件；不可用的旧位置由用户明确重新选择。
    if (current && current !== directory && (await getLocation(req)).available) {
      throw Object.assign(new Error("创作位置已设置，请继续使用原目录；暂不支持自动迁移"), { status: 409 });
    }
    for (const name of ["公共素材", "项目"]) {
      const { path } = await resolveWorkspacePath(directory, name);
      await mkdir(path).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
        if (!(await lstat(path)).isDirectory()) throw new Error(`${name}已存在且不是文件夹，请选择其他目录`);
      });
      await access(path, constants.W_OK);
    }
    mkdirSync(accountDirectory(), { recursive: true });
    writeAtomicSync(configPath, JSON.stringify({ directory }), { mode: 0o600 });
    return { directory, available: true };
  } finally { release(); }
}

export async function createProject(req: Request, name: string) {
  const root = getCreationDirectory();
  if (!root) throw Object.assign(new Error("请先选择创作文件存放位置"), { status: 409 });
  await resolveWorkspace(req, root);
  const parent = await creationFolder("项目");
  const { path } = await resolveWorkspacePath(parent, name);
  const release = lockWorkspaceFiles([parent]);
  try {
    await mkdir(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") throw Object.assign(new Error("已有同名项目，请换一个名称或打开已有项目"), { status: 409 });
      throw error;
    });
    try {
      await mkdir(join(path, "assets"));
      await writeWorkspaceFile(join(path, "画布1.json"), JSON.stringify({ toonflowCanvas: true, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }), true);
    } catch (cause) {
      throw new Error(`项目初始化未完成，已创建的文件保留在 ${path}，请检查目录权限后通过“打开已有项目”继续。`, { cause });
    }
    return { directory: path, name };
  } finally { release(); }
}
