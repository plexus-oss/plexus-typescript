/**
 * Config resolution, Python-SDK parity: explicit option > environment >
 * ~/.plexus/config.json (node only, read-only) > default.
 */

export const DEFAULT_GATEWAY_URL = "https://gateway.plexus.company";
export const DEFAULT_ENDPOINT = "https://app.plexus.company";

interface FileConfig {
  api_key?: string;
  source_id?: string;
  gateway_url?: string;
  endpoint?: string;
}

function isNode(): boolean {
  return typeof process !== "undefined" && !!process.versions?.node;
}

let fileConfigCache: FileConfig | null | undefined;

/** Best-effort read of ~/.plexus/config.json; never throws. */
export async function readFileConfig(): Promise<FileConfig | null> {
  if (fileConfigCache !== undefined) return fileConfigCache;
  if (!isNode()) return (fileConfigCache = null);
  try {
    const [{ readFile }, { homedir }] = await Promise.all([
      import("node:fs/promises"),
      import("node:os"),
    ]);
    const raw = await readFile(`${homedir()}/.plexus/config.json`, "utf8");
    fileConfigCache = JSON.parse(raw) as FileConfig;
  } catch {
    fileConfigCache = null;
  }
  return fileConfigCache;
}

export function envVar(name: string): string | undefined {
  return isNode() ? process.env[name] : undefined;
}

/** Test hook. */
export function resetFileConfigCache(): void {
  fileConfigCache = undefined;
}
