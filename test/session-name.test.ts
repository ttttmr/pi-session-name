import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAssistantMessageEventStream, createModels, createProvider } from "@earendil-works/pi-ai";

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
      streamSimple: vi.fn((...args: any[]) => streamSimple?.(...args)),
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

  it("uses the registry entry point so title instructions are normalized", async () => {
    const streamSimple = vi.fn().mockImplementation(respond("Jev 模型调研"));
    const { handlers, pi } = makePi();
    const ctx = makeCtx(streamSimple);
    extension(pi as any);
    await handlers.input?.({ text: "帮我调研 Jev" }, ctx);
    await vi.waitFor(() => expect(pi.setSessionName).toHaveBeenCalled());
    expect(ctx.modelRegistry.streamSimple).toHaveBeenCalledOnce();
    expect(ctx.modelRegistry.getProvider).not.toHaveBeenCalled();
    expect(streamSimple.mock.calls[0][1].systemPrompt).toContain("Return only the title");
  });

  it.each([
    "可以，不过需要先确认你说的 **“JEV”** 是哪个模型。以免查错。",
    "x".repeat(61),
    "Title\nHere is an explanation",
    "**Jev model research**",
  ])("retries invalid title output: %s", async (invalid) => {
    const streamSimple = vi.fn().mockImplementationOnce(respond(invalid))
      .mockImplementationOnce(respond("Jev 模型调研"));
    const { handlers, pi } = makePi();
    const ctx = makeCtx(streamSimple);
    extension(pi as any);
    await handlers.input?.({ text: "帮我调研 Jev" }, ctx);
    await vi.waitFor(() => expect(pi.setSessionName).toHaveBeenCalled());
    expect(pi.setSessionName).toHaveBeenCalledExactlyOnceWith("Jev 模型调研");
    expect(streamSimple).toHaveBeenCalledTimes(2);
  });

  it("does not overwrite a name set while generation is pending", async () => {
    let finish!: (response: any) => void;
    const streamSimple = vi.fn(() => ({ result: () => new Promise(resolve => { finish = resolve; }) }));
    const { handlers, pi } = makePi();
    extension(pi as any);
    await handlers.input?.({ text: "first prompt" }, makeCtx(streamSimple));
    await vi.waitFor(() => expect(streamSimple).toHaveBeenCalledOnce());
    pi.setSessionName("manual name");
    finish({ stopReason: "stop", content: [{ type: "text", text: "generated name" }] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(pi.getSessionName()).toBe("manual name");
  });

  it("leaves the session unnamed after three invalid responses", async () => {
    const streamSimple = vi.fn().mockImplementation(respond("x".repeat(100)));
    const { handlers, pi } = makePi();
    extension(pi as any);
    const ctx = makeCtx(streamSimple);
    await handlers.input?.({ text: "first prompt" }, ctx);
    await vi.waitFor(() => expect(streamSimple).toHaveBeenCalledTimes(3));
    await handlers.input?.({ text: "second prompt" }, ctx);
    expect(pi.setSessionName).not.toHaveBeenCalled();
    expect(streamSimple).toHaveBeenCalledTimes(3);
  });

  it("skips already named sessions", async () => {
    const streamSimple = vi.fn().mockImplementation(respond("generated"));
    const { handlers, pi } = makePi();
    pi.setSessionName("existing");
    extension(pi as any);
    await handlers.input?.({ text: "first prompt" }, makeCtx(streamSimple));
    expect(streamSimple).not.toHaveBeenCalled();
    expect(pi.getSessionName()).toBe("existing");
  });

  it("preserves opencode session headers and the token budget", async () => {
    const streamSimple = vi.fn().mockImplementation(respond("valid title"));
    const { handlers, pi } = makePi();
    const ctx = makeCtx(streamSimple);
    ctx.model.provider = "opencode";
    extension(pi as any);
    await handlers.input?.({ text: "first prompt" }, ctx);
    await vi.waitFor(() => expect(streamSimple).toHaveBeenCalledOnce());
    expect(streamSimple.mock.calls[0][2]).toMatchObject({
      maxTokens: 2048, headers: { "x-opencode-session": "test-session", "x-opencode-client": "pi" },
    });
  });

  it("delivers title instructions and resolved auth to a custom provider through real Models", async () => {
    const registry = createModels();
    const streamSimple = vi.fn((_model, _context, _options) => {
      const output = createAssistantMessageEventStream();
      const response = {
        role: "assistant", content: [{ type: "text", text: "Jev 模型调研" }],
        stopReason: "stop", provider: "test", model: "test-model", api: "openai-responses",
        timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      } as const;
      queueMicrotask(() => {
        output.push({ type: "done", reason: "stop", message: response as any });
        output.end(response as any);
      });
      return output;
    });
    registry.setProvider(createProvider({
      id: "test", models: [],
      auth: { apiKey: { name: "Offline test", resolve: async () => ({
        auth: { apiKey: "test-key", headers: { "x-auth": "resolved" } }, source: "test",
      }) } },
      api: { stream: streamSimple, streamSimple },
    }));
    const { handlers, pi } = makePi();
    const ctx = makeCtx();
    extension(pi as any);
    await handlers.input?.({ text: "帮我调研 Jev" }, { ...ctx, modelRegistry: registry });
    await vi.waitFor(() => expect(pi.setSessionName).toHaveBeenCalledWith("Jev 模型调研"));
    const [, transcript, options] = streamSimple.mock.calls[0];
    expect(transcript.messages.map((message: any) => message.role)).toEqual(["system", "user"]);
    expect(transcript.messages[0].content).toContain("Return only the title");
    expect(transcript.messages[1].content).toBe("帮我调研 Jev");
    expect(options).toMatchObject({ apiKey: "test-key", headers: { "x-auth": "resolved" } });
  });

  it.each(["length", "aborted"])("does not save %s responses", async (stopReason) => {
    const streamSimple = vi.fn().mockImplementationOnce(() => ({ result: async () => ({
      stopReason, content: [{ type: "text", text: "Incomplete title" }],
    }) })).mockImplementationOnce(respond("Complete title"));
    const { handlers, pi } = makePi();
    extension(pi as any);
    await handlers.input?.({ text: "first prompt" }, makeCtx(streamSimple));
    await vi.waitFor(() => expect(pi.setSessionName).toHaveBeenCalledExactlyOnceWith("Complete title"));
  });

  it("accepts quoted Unicode titles at the code-point limit", async () => {
    const title = "🔬".repeat(60);
    const streamSimple = vi.fn().mockImplementation(respond(`\n“${title}”\n`));
    const { handlers, pi } = makePi();
    extension(pi as any);
    await handlers.input?.({ text: "first prompt" }, makeCtx(streamSimple));
    await vi.waitFor(() => expect(pi.setSessionName).toHaveBeenCalledWith(title));
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
