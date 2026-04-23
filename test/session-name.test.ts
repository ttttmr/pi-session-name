import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@mariozechner/pi-ai", () => ({
  completeSimple: vi.fn(),
}));

import { completeSimple } from "@mariozechner/pi-ai";
import extension from "../src/index";

describe("pi-session-name", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps retrying with only the first user input", async () => {
    const completeSimpleMock = vi.mocked(completeSimple)
      .mockRejectedValueOnce(new Error("first failure"))
      .mockRejectedValueOnce(new Error("second failure"))
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "first title" }],
      } as any);

    let inputHandler: ((event: any, ctx: any) => Promise<unknown>) | undefined;
    let sessionName: string | undefined;
    const setTitle = vi.fn();

    const pi = {
      on: vi.fn((event: string, handler: (event: any, ctx: any) => Promise<unknown>) => {
        if (event === "input") inputHandler = handler;
      }),
      getSessionName: vi.fn(() => sessionName),
      setSessionName: vi.fn((name: string) => {
        sessionName = name;
      }),
    };

    extension(pi as any);

    const ctx = {
      model: { headers: {}, id: "test-model", provider: "test" },
      modelRegistry: {
        getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: "test-key", headers: {} }),
      },
      ui: { setTitle },
      cwd: "/tmp/demo",
    };

    await inputHandler?.({ text: "first prompt" }, ctx);
    await inputHandler?.({ text: "second prompt" }, ctx);

    await vi.waitFor(() => {
      expect(completeSimpleMock).toHaveBeenCalledTimes(3);
    });

    expect(completeSimpleMock.mock.calls.map(([, request]) => request.messages[0].content)).toEqual([
      "first prompt",
      "first prompt",
      "first prompt",
    ]);
    expect(pi.setSessionName).toHaveBeenCalledWith("first title");
    expect(setTitle).toHaveBeenCalledWith("π - first title - demo");
  });
});
