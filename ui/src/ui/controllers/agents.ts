import type { GatewayBrowserClient } from "../gateway.ts";
import type { AgentsListResult, ToolsCatalogResult } from "../types.ts";

export type AgentsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  agentsLoading: boolean;
  agentsCreating?: boolean;
  agentsError: string | null;
  agentsList: AgentsListResult | null;
  agentsSelectedId: string | null;
  toolsCatalogLoading: boolean;
  toolsCatalogError: string | null;
  toolsCatalogResult: ToolsCatalogResult | null;
};

function toWorkspaceSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "agent";
}

export async function loadAgents(state: AgentsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.agentsLoading) {
    return;
  }
  state.agentsLoading = true;
  state.agentsError = null;
  try {
    const res = await state.client.request<AgentsListResult>("agents.list", {});
    if (res) {
      state.agentsList = res;
      const selected = state.agentsSelectedId;
      const known = res.agents.some((entry) => entry.id === selected);
      if (!selected || !known) {
        state.agentsSelectedId = res.defaultId ?? res.agents[0]?.id ?? null;
      }
    }
  } catch (err) {
    state.agentsError = String(err);
  } finally {
    state.agentsLoading = false;
  }
}

export async function createAgent(state: AgentsState, name: string, role?: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const trimmed = name.trim();
  if (!trimmed) {
    state.agentsError = "Agent name is required.";
    return;
  }
  if (state.agentsCreating) {
    return;
  }
  state.agentsCreating = true;
  state.agentsError = null;
  try {
    const result = await state.client.request<{ agentId?: string }>("agents.create", {
      name: trimmed,
      workspace: `~/.openclaw/workspace-${toWorkspaceSlug(trimmed)}`,
      ...(role?.trim() ? { role: role.trim() } : {}),
    });
    await loadAgents(state);
    const createdId = typeof result?.agentId === "string" ? result.agentId : null;
    if (createdId) {
      state.agentsSelectedId = createdId;
    }
  } catch (err) {
    state.agentsError = String(err);
  } finally {
    state.agentsCreating = false;
  }
}

export async function loadToolsCatalog(state: AgentsState, agentId?: string | null) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.toolsCatalogLoading) {
    return;
  }
  state.toolsCatalogLoading = true;
  state.toolsCatalogError = null;
  try {
    const res = await state.client.request<ToolsCatalogResult>("tools.catalog", {
      agentId: agentId ?? state.agentsSelectedId ?? undefined,
      includePlugins: true,
    });
    if (res) {
      state.toolsCatalogResult = res;
    }
  } catch (err) {
    state.toolsCatalogError = String(err);
  } finally {
    state.toolsCatalogLoading = false;
  }
}
