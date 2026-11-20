import { $ } from "bun";
import { copyFileSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync } from "@toonflow/file";
import { file } from "@toonflow/file/bun";
import { compareDesktopVersions, isDesktopVersion } from "@toonflow/server/desktop";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import desktopConfig from "../../../electrobun.config";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { initial: { type: "boolean" }, auto: { type: "boolean" } },
});
// ACT: 旧三段版本沿用原始拼写（包括前导零）；比较时才转为规范整数段。
const legacyVersionPattern = /^\d+\.\d+\.\d+$/;
const version = positionals[0];
if (positionals.length !== 1 || typeof version !== "string" || (!legacyVersionPattern.test(version) && !isDesktopVersion(version))) {
  throw new Error("用法：bun run release:desktop <X.Y.Z | X.Y.Z.W> [--auto | --initial]；四段版本必须使用 --initial。");
}
if (values.initial && values.auto) throw new Error("--initial 与 --auto 不能同时使用。");
const fourPartVersion = version.split(".").length === 4;
if (fourPartVersion && !values.initial) throw new Error("四段桌面版本必须使用 --initial 构建完整包。");
const isMac = process.platform === "darwin";
if (fourPartVersion && isMac && (process.env.macCodesign !== "1" || !process.env.ELECTROBUN_DEVELOPER_ID ||
    !process.env.ELECTROBUN_APPLEAPIKEY || !process.env.ELECTROBUN_APPLEAPIISSUER || !process.env.ELECTROBUN_APPLEAPIKEYPATH)) {
  throw new Error("四段 macOS 桌面版本必须配置 Developer ID 签名和 Apple 公证凭据。");
}
if ((!isMac || !["x64", "arm64"].includes(process.arch)) && (process.platform !== "win32" || process.arch !== "x64")) {
  throw new Error("增量发布需在 Windows x64 或 macOS x64/arm64 本机执行。");
}

const projectDir = resolve(import.meta.dirname, "../../..");
const platform = isMac ? "macos" : "win";
const targetFolder = isMac ? process.arch === "x64" ? "macX64" : "macArm64" : "";
const releasesDir = join(projectDir, "build/desktop/releases", targetFolder);
const releaseDir = join(releasesDir, version);
const artifactDir = resolve(projectDir, desktopConfig.build.artifactFolder);
const prefix = `stable-${platform}-${process.arch}`;
const manifestName = `${prefix}-update.json`;
const manifestUrl = `${desktopConfig.release.baseUrl.replace(/\/+$/, "")}/${manifestName}`;
if (existsSync(releaseDir)) throw new Error(`版本已保留，请使用新版本号：${releaseDir}`);

let previousResponse: Response | undefined;
if (!values.initial) {
  console.log(`读取构建基线：${manifestUrl}`);
  try {
    previousResponse = await fetch(manifestUrl, {
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    throw new Error("无法读取上一版本，请检查更新地址与网络；为避免漏打补丁，已停止构建。", { cause: error });
  }
}
const initial = values.initial || (values.auto && previousResponse?.status === 404);
let previousHash: string | undefined;
if (!initial) {
  if (!previousResponse?.ok) {
    throw new Error(previousResponse?.status === 404
      ? "更新源尚无基线，请使用 --initial 或 --auto 构建首次版本。"
      : `读取上一版本失败（HTTP ${previousResponse?.status}），已停止构建。`);
  }
  const previous = await previousResponse.json().catch((error) => {
    throw new Error(`上一版本清单不是有效 JSON：${manifestUrl}（Content-Type: ${previousResponse.headers.get("content-type") || "未提供"}）`, { cause: error });
  });
  if (!previous || previous.platform !== platform || previous.arch !== process.arch ||
      typeof previous.hash !== "string" || !/^[a-zA-Z0-9]+$/.test(previous.hash) ||
      typeof previous.version !== "string" || (!legacyVersionPattern.test(previous.version) && !isDesktopVersion(previous.version))) {
    throw new Error("更新清单的平台、架构、版本或 Hash 无效。");
  }
  // ACT: Intel 固定使用 1.18.1 旧协议；不向独立发布服务器传递桌面配置。
  const legacy = isMac && process.arch === "x64" && previous.schemaVersion === undefined;
  if (!legacy && (previous.identifier !== desktopConfig.app.identifier || previous.channel !== "stable")) {
    throw new Error("更新清单的应用标识或通道不一致。");
  }
  const archive = legacy ? `${prefix}-${desktopConfig.app.name.replace(/\s/g, "")}.app.tar.zst` : previous.artifact?.file;
  if (typeof archive !== "string" || !archive.startsWith(`${prefix}-`) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tar\.zst$/.test(archive)) {
    throw new Error("更新清单的归档名称无效。");
  }
  previousHash = previous.hash;
  if (compareDesktopVersions(version.replace(/\b0+(?=\d)/g, ""), previous.version.replace(/\b0+(?=\d)/g, "")) <= 0) {
    throw new Error(`新版本 ${version} 必须高于服务器版本 ${previous.version}。`);
  }
  console.log(`构建增量更新：${previous.version} → ${version}`);
} else {
  console.log(`构建首次完整版本：${version}，不生成增量补丁。`);
}

await $`${process.execPath} run package:desktop`
  .cwd(projectDir)
  .env({ ...process.env, appVersion: version, generateUpdatePatch: initial ? "0" : "1" });

// ACT: 本机 SDK 产物直接读取，完整清单校验仅用于远程基线。
const manifest = await file(join(artifactDir, manifestName)).json();
if (manifest.version !== version || (fourPartVersion && (manifest.platform !== platform || manifest.arch !== process.arch))) {
  throw new Error("本次构建的更新清单与请求的版本、平台或架构不一致。");
}
const archiveName = isMac && process.arch === "x64" && manifest.artifact === undefined
  ? `${prefix}-${desktopConfig.app.name.replace(/\s/g, "")}.app.tar.zst`
  : manifest.artifact?.file;
if (typeof archiveName !== "string" || !archiveName.startsWith(`${prefix}-`) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tar\.zst$/.test(archiveName)) {
  throw new Error("本次构建的更新清单归档名称无效。");
}
const names = [archiveName];
let dmgName: string | undefined;
if (isMac) {
  const installers = readdirSync(artifactDir).filter((name) => name.endsWith(".dmg"));
  if (installers.length !== 1) throw new Error("Mac 发布必须包含且仅包含一个 DMG 安装包。");
  dmgName = installers[0]!;
  names.push(dmgName);
} else names.push(`cruio-${version}-Setup.exe`);
if (previousHash) names.push(`${prefix}-${previousHash}.patch`);
for (const name of names) {
  if (!existsSync(join(artifactDir, name))) throw new Error(`构建产物缺失，未创建发布快照：${name}`);
}
if (fourPartVersion && !isMac) {
  // ACT: NSIS 包嵌入同一归档解压出的 tar；在保存快照前校验 tar 里的应用版本。
  const archive = await file(join(artifactDir, archiveName)).arrayBuffer();
  const result = Bun.spawnSync(["tar.exe", "-xOf", "-", `${desktopConfig.app.name}/Resources/version.json`], {
    stdin: Bun.zstdDecompressSync(archive),
    stderr: "inherit",
  });
  const archiveInfo = result.exitCode === 0 ? JSON.parse(result.stdout.toString()) : undefined;
  if (archiveInfo?.version !== version || typeof manifest.hash !== "string" || !/^[a-zA-Z0-9]{1,64}$/.test(manifest.hash) || archiveInfo.hash !== manifest.hash) {
    throw new Error("Windows 应用 version.json 的版本或 Hash 与更新清单不一致。");
  }
}
mkdirSync(releasesDir, { recursive: true });
mkdirSync(releaseDir);
try {
  for (const name of [...names, manifestName]) {
    const releaseName = fourPartVersion && name === dmgName ? `cruio-${version}-mac-${process.arch}.dmg` : name;
    copyFileSync(join(artifactDir, name), join(releaseDir, releaseName));
  }
} catch (error) {
  if (dirname(realpathSync(releaseDir)) !== realpathSync(releasesDir)) throw new Error("拒绝清理发布目录以外的路径。", { cause: error });
  rmSync(releaseDir, { recursive: true });
  throw error;
}
console.log(`版本快照：${releaseDir}`);
if (!fourPartVersion) console.log(`将此目录交给独立更新服务器发布：bun run publish:update ${releaseDir}`);
