import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type PackageMetadata = {
  name?: string;
  version?: string;
  license?: string | { type?: string };
  licenses?: Array<{ type?: string }>;
  repository?: string | { url?: string };
};

const packages = new Map<string, { license: string; repository: string }>();

function normalizeLicense(metadata: PackageMetadata) {
  if (typeof metadata.license === "string") return metadata.license;
  if (metadata.license?.type) return metadata.license.type;
  const legacy = metadata.licenses?.map((item) => item.type).filter(Boolean).join(" OR ");
  return legacy || "未声明";
}

function normalizeRepository(metadata: PackageMetadata) {
  const value = typeof metadata.repository === "string" ? metadata.repository : metadata.repository?.url;
  return value?.replace(/^git\+/, "").replace(/\.git$/, "") ?? "—";
}

async function scan(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await scan(path);
      continue;
    }
    if (entry.name !== "package.json") continue;
    try {
      const metadata = JSON.parse(await readFile(path, "utf8")) as PackageMetadata;
      if (!metadata.name || !metadata.version || metadata.name.startsWith("@toonflow/")) continue;
      packages.set(`${metadata.name}@${metadata.version}`, {
        license: normalizeLicense(metadata),
        repository: normalizeRepository(metadata),
      });
    } catch {
      // A malformed third-party package manifest is reported by omission from the generated inventory.
    }
  }
}

await scan("node_modules");
const rows = [...packages.entries()].sort(([left], [right]) => left.localeCompare(right));
const unknown = rows.filter(([, metadata]) => metadata.license === "未声明").map(([name]) => name);
const output = [
  "# Third-party dependency license inventory",
  "",
  "> Generated from the clean `bun install --frozen-lockfile` dependency tree. Re-run `bun run licenses` after dependency changes.",
  "",
  `Packages inspected: ${rows.length}. Packages without a declared license field: ${unknown.length}.`,
  "",
  "This inventory is an engineering record, not legal advice. A production release still requires legal review of applicable notices and distribution obligations.",
  "",
  "| Package | Declared license | Repository |",
  "|---|---|---|",
  ...rows.map(([name, metadata]) => `| ${name.replaceAll("|", "\\|")} | ${metadata.license.replaceAll("|", "\\|")} | ${metadata.repository.replaceAll("|", "\\|")} |`),
  "",
  "## Unresolved declarations",
  "",
  ...(unknown.length ? unknown.map((name) => `- ${name}`) : ["No installed package is missing its license declaration."]),
  "",
];

await writeFile("THIRD_PARTY_LICENSES.md", output.join("\n"));
