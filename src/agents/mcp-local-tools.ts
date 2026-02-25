/**
 * Local execution of MCP (mcporter) tools for channel-originated runs.
 * When executeClientToolsLocally is true, client tools are converted to tools
 * that run `mcporter call <tool> --args '<JSON>'` and return the result.
 */
import { spawn } from "node:child_process";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { logDebug, logError } from "../logger.js";
import type { ClientToolDefinition } from "./pi-embedded-runner/run/params.js";
import { jsonResult } from "./tools/common.js";

const MCPORTER_CALL_TIMEOUT_MS = 60_000;
const MCPORTER_MAX_OUTPUT_CHARS = 500_000;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function resolveMcporterCommand(): string {
  if (process.platform !== "win32") {
    return "mcporter";
  }
  return "mcporter.cmd";
}

/**
 * Run mcporter call and return parsed JSON result.
 */
async function runMcporterCall(params: {
  toolName: string;
  params: Record<string, unknown>;
  mcporterConfigPath: string;
  abortSignal?: AbortSignal;
}): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const args: string[] = [];
  if (params.mcporterConfigPath) {
    args.push("--config", params.mcporterConfigPath);
  }
  args.push("call", params.toolName, "--args", JSON.stringify(params.params));

  return new Promise((resolve) => {
    const cmd = resolveMcporterCommand();
    const child = spawn(cmd, args, {
      env: { ...process.env },
      cwd: process.cwd(),
    });
    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;

    const timer =
      MCPORTER_CALL_TIMEOUT_MS > 0
        ? setTimeout(() => {
            child.kill("SIGKILL");
            resolve({
              stdout: "",
              stderr: `mcporter call timed out after ${MCPORTER_CALL_TIMEOUT_MS}ms`,
              code: null,
            });
          }, MCPORTER_CALL_TIMEOUT_MS)
        : null;

    const onData = (chunk: string, isErr: boolean) => {
      const buf = isErr ? stderr : stdout;
      const next = buf + chunk;
      if (next.length > MCPORTER_MAX_OUTPUT_CHARS) {
        stdoutTruncated = true;
        if (isErr) {
          stderr = next.slice(0, MCPORTER_MAX_OUTPUT_CHARS);
        } else {
          stdout = next.slice(0, MCPORTER_MAX_OUTPUT_CHARS);
        }
      } else {
        if (isErr) {
          stderr = next;
        } else {
          stdout = next;
        }
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => onData(String(d), false));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d) => onData(String(d), true));

    if (params.abortSignal) {
      params.abortSignal.addEventListener(
        "abort",
        () => {
          child.kill("SIGKILL");
        },
        { once: true },
      );
    }

    child.on("error", (err) => {
      if (timer) {
        clearTimeout(timer);
      }
      logError(`mcp-local-tools: mcporter spawn error: ${String(err)}`);
      resolve({
        stdout: "",
        stderr: String(err),
        code: null,
      });
    });

    child.on("close", (code) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (stdoutTruncated) {
        resolve({
          stdout,
          stderr: stderr + "\n[output truncated]",
          code: code ?? null,
        });
        return;
      }
      resolve({ stdout, stderr, code: code ?? null });
    });
  });
}

/**
 * Convert ClientToolDefinition[] to ToolDefinition[] that execute via mcporter.
 * Used for channel-originated runs (Slack, etc.) so MCP tools run locally.
 */
export function toLocalMcpToolDefinitions(
  tools: ClientToolDefinition[],
  mcporterConfigPath: string,
): ToolDefinition[] {
  return tools.map((tool) => {
    const func = tool.function;
    const name = func.name;
    return {
      name,
      label: name,
      description: func.description ?? "",
      parameters: (func.parameters as ToolDefinition["parameters"]) ?? {},
      execute: async (
        toolCallId: string,
        params: unknown,
        signal?: AbortSignal,
        _onUpdate?: unknown,
      ): Promise<AgentToolResult<unknown>> => {
        const paramsRecord = isPlainObject(params) ? params : {};
        try {
          const { stdout, stderr, code } = await runMcporterCall({
            toolName: name,
            params: paramsRecord,
            mcporterConfigPath,
            abortSignal: signal,
          });
          if (code !== 0) {
            logDebug(`mcp-local-tools: ${name} failed code=${code} stderr=${stderr.slice(0, 500)}`);
            return jsonResult({
              error: true,
              message: stderr?.trim() || `mcporter call exited with code ${code}`,
              stdout: stdout?.slice(0, 2000),
            });
          }
          const trimmed = stdout?.trim();
          if (!trimmed) {
            return jsonResult({ result: null, raw: "" });
          }
          try {
            const parsed = JSON.parse(trimmed) as unknown;
            return jsonResult(parsed);
          } catch {
            return jsonResult({ result: trimmed, raw: trimmed });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logError(`mcp-local-tools: ${name} error: ${message}`);
          return jsonResult({ error: true, message });
        }
      },
    } satisfies ToolDefinition;
  });
}
