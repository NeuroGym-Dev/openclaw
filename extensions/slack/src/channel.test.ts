import { describe, expect, it, vi } from "vitest";

const handleSlackActionMock = vi.fn();

vi.mock("./runtime.js", () => ({
  getSlackRuntime: () => ({
    channel: {
      slack: {
        handleSlackAction: handleSlackActionMock,
      },
    },
  }),
}));

import { slackPlugin } from "./channel.js";

type SlackAccountArg = Parameters<NonNullable<typeof slackPlugin.config>["isConfigured"]>[0];

function createAccount(overrides: Partial<SlackAccountArg> = {}): SlackAccountArg {
  const { config, ...rest } = overrides;
  const account = {
    accountId: "default",
    enabled: true,
    botTokenSource: "none",
    appTokenSource: "none",
    ...rest,
  } as SlackAccountArg;
  account.config = {
    ...(config ?? {}),
  };
  return account;
}

describe("slackPlugin actions", () => {
  it("forwards read threadId to Slack action handler", async () => {
    handleSlackActionMock.mockResolvedValueOnce({ messages: [], hasMore: false });
    const handleAction = slackPlugin.actions?.handleAction;
    expect(handleAction).toBeDefined();

    await handleAction!({
      action: "read",
      channel: "slack",
      accountId: "default",
      cfg: {},
      params: {
        channelId: "C123",
        threadId: "1712345678.123456",
      },
    });

    expect(handleSlackActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "readMessages",
        channelId: "C123",
        threadId: "1712345678.123456",
      }),
      {},
      undefined,
    );
  });
});

describe("slackPlugin configuration", () => {
  it("treats socket mode as configured only with bot + app tokens", () => {
    const isConfigured = slackPlugin.config?.isConfigured;
    expect(isConfigured).toBeDefined();

    expect(
      isConfigured!(
        createAccount({
          botToken: "xoxb-test",
          appToken: "xapp-test",
          config: { mode: "socket" },
        }),
      ),
    ).toBe(true);
    expect(
      isConfigured!(
        createAccount({
          botToken: "xoxb-test",
          config: { mode: "socket" },
        }),
      ),
    ).toBe(false);
  });

  it("treats HTTP mode as configured with bot token + signing secret", () => {
    const isConfigured = slackPlugin.config?.isConfigured;
    expect(isConfigured).toBeDefined();

    expect(
      isConfigured!(
        createAccount({
          botToken: "xoxb-test",
          config: { mode: "http", signingSecret: "secret" },
        }),
      ),
    ).toBe(true);
    expect(
      isConfigured!(
        createAccount({
          botToken: "xoxb-test",
          config: { mode: "http" },
        }),
      ),
    ).toBe(false);
  });

  it("reports HTTP mode accounts as configured in status snapshots", () => {
    const buildAccountSnapshot = slackPlugin.status?.buildAccountSnapshot;
    expect(buildAccountSnapshot).toBeDefined();

    const snapshot = buildAccountSnapshot!({
      account: createAccount({
        botToken: "xoxb-test",
        config: { mode: "http", signingSecret: "secret" },
      }),
      runtime: undefined,
      probe: undefined,
    });
    expect(snapshot.configured).toBe(true);
  });
});

describe("slackPlugin outbound", () => {
  const cfg = {
    channels: {
      slack: {
        botToken: "xoxb-test",
        appToken: "xapp-test",
      },
    },
  };

  it("uses threadId as threadTs fallback for sendText", async () => {
    const sendSlack = vi.fn().mockResolvedValue({ messageId: "m-text" });
    const sendText = slackPlugin.outbound?.sendText;
    expect(sendText).toBeDefined();

    const result = await sendText!({
      cfg,
      to: "C123",
      text: "hello",
      accountId: "default",
      threadId: "1712345678.123456",
      deps: { sendSlack },
    });

    expect(sendSlack).toHaveBeenCalledWith(
      "C123",
      "hello",
      expect.objectContaining({
        threadTs: "1712345678.123456",
      }),
    );
    expect(result).toEqual({ channel: "slack", messageId: "m-text" });
  });

  it("prefers replyToId over threadId for sendMedia", async () => {
    const sendSlack = vi.fn().mockResolvedValue({ messageId: "m-media" });
    const sendMedia = slackPlugin.outbound?.sendMedia;
    expect(sendMedia).toBeDefined();

    const result = await sendMedia!({
      cfg,
      to: "C999",
      text: "caption",
      mediaUrl: "https://example.com/image.png",
      accountId: "default",
      replyToId: "1712000000.000001",
      threadId: "1712345678.123456",
      deps: { sendSlack },
    });

    expect(sendSlack).toHaveBeenCalledWith(
      "C999",
      "caption",
      expect.objectContaining({
        mediaUrl: "https://example.com/image.png",
        threadTs: "1712000000.000001",
      }),
    );
    expect(result).toEqual({ channel: "slack", messageId: "m-media" });
  });
});
