import conf from "conf";
import { mkdirSync, readdirSync, realpathSync } from "@toonflow/file";
import { resolve } from "node:path";
import cruio from "@toonflow/providers/language/cruio";
import type { RemoteTeam } from "@/utils/teams";
import type { A2aSettings } from "@/agent/a2a/settings";
import type { desktopUpdateAttempt } from "@/types/desktop";
import type { MobileLinkConfig } from "@/utils/mobileLink";
import { normalizeNodeMenu, serializeNodeMenu } from "@/lib/nodeMenu";
import type { SavedMcpServer } from "@toonflow/mcp/client";

const autoInstallProviders = [cruio];
const dataDirectory = process.env.TOONFLOW_DATA_DIR ?? resolve(import.meta.dirname, "../../../../../data");
mkdirSync(dataDirectory, { recursive: true });
const configDirectory = realpathSync(dataDirectory);
process.env.TOONFLOW_DATA_DIR = configDirectory;

const config = new conf<{ settings: Record<string, unknown>; disabledSkills: string[]; mcpServers: SavedMcpServer[]; mcpBundles: Record<string, string>; toolConfigs: Record<string, Record<string, unknown>>; nodeConfigs: Record<string, Record<string, unknown>>; extConfigs: Record<string, Record<string, unknown>>; remoteConnections: Record<string, RemoteTeam>; a2a: A2aSettings; desktopUpdateAttempt: desktopUpdateAttempt; mobileLink: MobileLinkConfig }>({
  cwd: configDirectory,
  configName: "settings",
  configFileMode: 0o600,
  watch: true,
});

export function removeLegacySettings(settings: Record<string, unknown>) {
  let changed = false;
  // ACT: 只清理已废弃字段，保留其他设置和插件配置。
  for (const [record, key] of [[settings, "developerConfirmed"], [settings.general, "systemPrompt"], [settings.stores, "toonflow.developer"]] as const) {
    if (record && typeof record === "object" && !Array.isArray(record) && Object.hasOwn(record, key)) {
      Reflect.deleteProperty(record, key);
      changed = true;
    }
  }
  return changed;
}

export function synchronizeModelGateway(settings: Record<string, unknown>) {
  const providers = Array.isArray(settings.customProviders) ? settings.customProviders : [];
  let provider = providers.find(item => item?.id === cruio.id);
  if (!provider) {
    const { id, label, version, apiUrl, protocol, models } = cruio;
    provider = { id, label, version, apiUrl: process.env.CRUIO_NEW_API_URL || apiUrl, protocol, models, apiKey: process.env.CRUIO_NEW_API_KEY || "" };
    settings.customProviders = [...providers, provider];
  } else if (!process.env.CRUIO_NEW_API_URL && ["http://127.0.0.1:3001", "http://127.0.0.1:3001/v1", "http://localhost:3001", "http://localhost:3001/v1"].includes(provider.apiUrl)) {
    // 升级旧体验包时迁移本机网关地址，避免已有设置覆盖生产默认值。
    provider.apiUrl = cruio.apiUrl;
  }
  const configs = settings.mediaProviderConfigs;
  const mediaConfigs = configs && typeof configs === "object" && !Array.isArray(configs) ? configs as Record<string, unknown> : {};
  // ACT: 文本设置是唯一接入配置；保留旧供应商数据，但不再用于模型调用。
  settings.mediaProviderConfigs = { ...mediaConfigs, cruio: { apiUrl: provider.apiUrl, apiKey: provider.apiKey } };
}

export function cleanNodeMenuSettings(settings: Record<string, unknown>) {
  const general = settings.general;
  if (!general || typeof general !== "object" || Array.isArray(general) || !Object.hasOwn(general, "nodeMenu")) return false;
  const record = general as Record<string, unknown>;
  const installedTypes = new Set<string>();
  try {
    // ACT: 仅扫描已安装文件名；禁用节点保留配置，菜单清理与同步存盘间不插入异步等待。
    for (const file of readdirSync(resolve(configDirectory, "nodes"), { withFileTypes: true })) {
      if (file.isFile() && /^[a-z][a-zA-Z0-9]*\.umd\.js$/.test(file.name)) installedTypes.add(`remote-${file.name.slice(0, -7)}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const nodeMenu = serializeNodeMenu(normalizeNodeMenu(record.nodeMenu), installedTypes);
  if (!nodeMenu.length) {
    delete record.nodeMenu;
    return true;
  }
  if (JSON.stringify(record.nodeMenu) === JSON.stringify(nodeMenu)) return false;
  record.nodeMenu = nodeMenu;
  return true;
}

const settings = config.get("settings", {});
if (removeLegacySettings(settings)) config.set("settings", settings);

// ACT: 仅初始化尚未配置的文本供应商；已有列表（包括用户清空的列表）保持原样。
if (!config.has("settings.customProviders")) {
  config.set("settings.customProviders", autoInstallProviders.map(({ id, label, version, apiUrl, protocol, models }) =>
    ({ id, label, version, apiUrl: process.env.CRUIO_NEW_API_URL || apiUrl, protocol, models, apiKey: process.env.CRUIO_NEW_API_KEY || "" })));
}

if (!config.has("settings.mediaProviderConfigs.cruio")) {
  config.set("settings.mediaProviderConfigs.cruio", {
    apiUrl: process.env.CRUIO_NEW_API_URL || cruio.apiUrl,
    apiKey: process.env.CRUIO_NEW_API_KEY || "",
  });
}

// ACT: 部署配置在进程启动时覆盖该供应商，其他设置保持原样；凭证不写入供应商源码。
if (process.env.CRUIO_NEW_API_URL || process.env.CRUIO_NEW_API_KEY) {
  const apiUrl = process.env.CRUIO_NEW_API_URL;
  if (apiUrl) {
    const url = new URL(apiUrl);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("CRUIO_NEW_API_URL 须为不含凭据、查询参数或片段的 HTTP(S) 地址");
  }
  const overrides = {
    ...(apiUrl ? { apiUrl } : {}),
    ...(process.env.CRUIO_NEW_API_KEY ? { apiKey: process.env.CRUIO_NEW_API_KEY } : {}),
  };
  const providers = config.get("settings.customProviders");
  if (Array.isArray(providers)) config.set("settings.customProviders", providers.map(provider => provider?.id === cruio.id ? { ...provider, ...overrides } : provider));
  const mediaConfigs = config.get("settings", {}).mediaProviderConfigs as Record<string, Record<string, unknown>> | undefined;
  config.set("settings.mediaProviderConfigs.cruio", { ...mediaConfigs?.cruio, ...overrides });
}

const gatewaySettings = config.get("settings", {});
synchronizeModelGateway(gatewaySettings);
config.set("settings", gatewaySettings);

export default config;
