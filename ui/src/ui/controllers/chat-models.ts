import type { GatewayBrowserClient } from "../gateway.ts";

export type ChatModelsListState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  chatModelsList: Array<{ provider: string; id: string; name?: string }> | null;
  chatModelsListLoading: boolean;
};

export async function loadChatModels(state: ChatModelsListState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.chatModelsListLoading) {
    return;
  }
  state.chatModelsListLoading = true;
  try {
    const res = await state.client.request<{ models?: Array<{ provider?: string; id?: string; name?: string }> }>(
      "models.list",
      {},
    );
    const raw = Array.isArray(res?.models) ? res.models : [];
    state.chatModelsList = raw
      .map((m) => {
        const provider = typeof m?.provider === "string" ? m.provider.trim() : "";
        const id = typeof m?.id === "string" ? m.id.trim() : "";
        if (!provider || !id) {
          return null;
        }
        return {
          provider,
          id,
          name: typeof m?.name === "string" ? m.name.trim() : undefined,
        };
      })
      .filter((m): m is { provider: string; id: string; name?: string } => m !== null);
  } finally {
    state.chatModelsListLoading = false;
  }
}
