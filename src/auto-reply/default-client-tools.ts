/**
 * Load default client tools from a JSON file (e.g. for channel-originated runs).
 * Used so Slack/DM and other channels get the same MCP tools as OpenResponses.
 */
import fs from "node:fs/promises";
import type { ClientToolDefinition } from "../agents/pi-embedded-runner/run/params.js";
import type { OpenClawConfig } from "../config/config.js";
import { logInfo, logWarn } from "../logger.js";

let cached: ClientToolDefinition[] | null = null;
let cachedPath: string | null = null;

function isClientToolDefinitionArray(value: unknown): value is ClientToolDefinition[] {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const f = (item as { function?: unknown }).function;
    return f && typeof f === "object" && typeof (f as { name?: unknown }).name === "string";
  });
}

/**
 * Load default client tools from path. Returns undefined if path is missing or invalid.
 * Results are cached per path.
 */
export async function loadDefaultClientTools(
  cfg: OpenClawConfig,
): Promise<ClientToolDefinition[] | undefined> {
  const path =
    cfg.gateway?.defaultClientToolsPath?.trim() ||
    process.env.OPENCLAW_DEFAULT_CLIENT_TOOLS_PATH?.trim() ||
    "/app/config/default-client-tools.json";
  if (cachedPath === path && cached !== null) {
    return cached.length > 0 ? cached : undefined;
  }
  try {
    const raw = await fs.readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isClientToolDefinitionArray(parsed)) {
      logWarn(
        `default-client-tools: invalid format at ${path} (expected array of { function: { name } })`,
      );
      cachedPath = path;
      cached = [];
      return undefined;
    }
    cachedPath = path;
    cached = parsed;
    const out = parsed.length > 0 ? parsed : undefined;
    if (out) {
      logInfo(`default-client-tools: loaded ${out.length} tools from ${path}`);
    }
    return out;
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err ? (err as { code: string }).code : "";
    logWarn(
      `default-client-tools: failed to load ${path}: ${code || (err instanceof Error ? err.message : String(err))}`,
    );
    cachedPath = path;
    cached = [];
    return undefined;
  }
}

/**
 * Clear cache (e.g. for tests or config reload).
 */
export function clearDefaultClientToolsCache(): void {
  cached = null;
  cachedPath = null;
}
