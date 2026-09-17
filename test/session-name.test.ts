import { beforeEach, describe, expect, it, vi } from "vitest";

import extension from "../src/index";

function makePi() {
  const handlers: Record<string, ((event: any, ctx: any) => Promise<unknown>) | undefined> = {};
  let sessionName: string | undefined;
  const pi = {
    on: vi.fn((event: string, handler: (event: any, ctx: any) => Promise<unknown>) => {
      handlers[event] = handler;
    }),
    getSessionName: vi.fn(() => sessionName),
    setSessionName: vi.fn((name: string) => {
      sessionName = name;
    }),
  };
  return { handlers, pi };
}

/** A streamSimple stub: returns an AssistantMessageEventStream-like object. */
function respond(text: string) {
  return () => ({
    result: async () => ({
      content: [{ type: "text", text }],
      stopReason: "stop",
    }),
  });
}

function fail(message: string) {
  return () => ({
    result: async () => {
      throw new Error(message);
    },
  });
}

function makeCtx(streamSimple?: (...args: any[]) => any) {
  return {
    model: { headers: {}, id: "test-model", provider: "test", baseUrl: "https://example.com" },
    modelRegistry: {
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: "test-key", headers: {} }),
      getProvider: vi.fn(() => ({ streamSimple })),
    },
    sessionManager: { getSessionId: () => "test-session" },
    ui: { setTitle: vi.fn() },
    cwd: "/tmp/demo",
  };
}

describe("pi-session-name", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps retrying with only the first user input", async () => {
    const streamSimple = vi.fn()
      .mockImplementationOnce(fail("first failure"))
      .mockImplementationOnce(fail("second failure"))
      .mockImplementationOnce(respond("first title"));

    const { handlers, pi } = makePi();
    const ctx = makeCtx(streamSimple);
    extension(pi as any);

    await handlers.input?.({ text: "first prompt" }, ctx);
    await handlers.input?.({ text: "second prompt" }, ctx);

    await vi.waitFor(() => {
      expect(streamSimple).toHaveBeenCalledTimes(3);
    });

    expect(streamSimple.mock.calls.map(([, request]) => request.messages[0].content)).toEqual([
      "first prompt",
      "first prompt",
      "first prompt",
    ]);
    expect(pi.setSessionName).toHaveBeenCalledWith("first title");
    expect(ctx.ui.setTitle).toHaveBeenCalledWith("✳ first title - demo");
  });

  it("updates the title prefix based on agent running state", async () => {
    const streamSimple = vi.fn().mockImplementation(respond("run title"));

    const { handlers, pi } = makePi();
    const ctx = makeCtx(streamSimple);
    extension(pi as any);

    await handlers.agent_start?.({}, ctx);
    await handlers.input?.({ text: "first prompt" }, ctx);

    await vi.waitFor(() => {
      expect(pi.setSessionName).toHaveBeenCalledWith("run title");
    });

    expect(ctx.ui.setTitle).toHaveBeenLastCalledWith("· run title - demo");

    await handlers.agent_end?.({}, ctx);

    expect(ctx.ui.setTitle).toHaveBeenLastCalledWith("✳ run title - demo");
  });

  it("retries when the stream resolves with an error message", async () => {
    const streamSimple = vi.fn()
      .mockImplementationOnce(() => ({
        result: async () => ({ content: [], stopReason: "error", errorMessage: "boom" }),
      }))
      .mockImplementationOnce(respond("after error"));

    const { handlers, pi } = makePi();
    const ctx = makeCtx(streamSimple);
    extension(pi as any);

    await handlers.input?.({ text: "first prompt" }, ctx);

    await vi.waitFor(() => {
      expect(pi.setSessionName).toHaveBeenCalledWith("after error");
    });
    expect(streamSimple).toHaveBeenCalledTimes(2);
  });
});
