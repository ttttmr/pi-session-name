import path from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model, ThinkingLevel } from "@earendil-works/pi-ai";

const TITLE_PROMPT = [
  "Generate a concise title that labels the user's task; write a title, not a reply.",
  "Extract the core goal from the user's input instead of repeating its conversational wording.",
  "Use a compact noun phrase or action phrase. Never address the user, ask a question, or add conversational framing (such as 'I can help' or 'Here is').",
  "Keep the user's language and focus on the main goal.",
  "Return only the title, usually 3–8 words or the natural equivalent in that language.",
  "No quotes. No trailing punctuation.",
].join("\n");

function formatTitle(ctx: ExtensionContext, sessionName: string, isRunning: boolean) {
  const prefix = isRunning ? "·" : "✳";
  return `${prefix} ${sessionName} - ${path.basename(ctx.cwd)}`;
}

// opencode-zen/go refuses requests without a session header (400 MissingSessionID).
// The agent path injects it via attribution headers; side calls must add it themselves.
function opencodeSessionHeaders(model: Model<any>, sessionId: string | undefined) {
  if (!sessionId) return undefined;
  let isOpencode = model.provider === "opencode" || model.provider === "opencode-go";
  if (!isOpencode) {
    try {
      isOpencode = new URL(model.baseUrl).hostname === "opencode.ai";
    } catch { }
  }
  if (!isOpencode) return undefined;
  return { "x-opencode-session": sessionId, "x-opencode-client": "pi" };
}

// Models don't always obey "one line, no quotes": keep the first non-empty
// line and strip wrapping quotes.
function sanitizeTitle(text: string) {
  const line = text.split("\n").find(l => l.trim().length > 0) ?? "";
  return line.trim().replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "").trim();
}

export default function (pi: ExtensionAPI) {
  let firstPrompt: string | null = null;
  let started = false;
  let isRunning = false;

  function syncTitle(ctx: ExtensionContext) {
    const sessionName = pi.getSessionName();
    if (!sessionName) return;
    ctx.ui.setTitle(formatTitle(ctx, sessionName, isRunning));
  }

  pi.on("agent_start", async (_event, ctx) => {
    isRunning = true;
    syncTitle(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    isRunning = false;
    syncTitle(ctx);
  });

  pi.on("input", async (event, ctx) => {
    if (pi.getSessionName()) return;

    firstPrompt ??= event.text.trim();
    if (started) return;
    started = true;

    void (async () => {
      const model = ctx.model;
      if (!model) return;

      // The composed provider's streamSimple dispatches to the right
      // implementation — built-in API adapter or extension-registered custom
      // stream (e.g. devin) — and maps `reasoning` to per-API thinking options.
      const provider = ctx.modelRegistry.getProvider(model.provider);
      if (!provider) return;

      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) return;

      const headers = {
        ...opencodeSessionHeaders(model, ctx.sessionManager?.getSessionId?.()),
        ...(model.headers ?? {}),
        ...(auth.headers ?? {}),
      };
      const requestModel = auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await provider.streamSimple(
            requestModel,
            {
              systemPrompt: TITLE_PROMPT,
              messages: [{ role: "user", content: firstPrompt, timestamp: Date.now() }],
            },
            {
              // Reasoning models can burn a small cap on thinking before
              // emitting text; keep room for a short title after it. "off"
              // is not in ThinkingLevel but adapters handle it. Must stay
              // above 1024 — baseten-hosted reasoning models reject smaller
              // max_output_tokens outright.
              maxTokens: 2048,
              reasoning: "off" as ThinkingLevel,
              apiKey: auth.apiKey,
              headers,
              env: auth.env,
            },
          ).result();

          // Stream errors resolve as messages with stopReason "error".
          if (response.stopReason === "error") continue;

          const part = response.content.toReversed().find(part => part.type === "text");
          const title = part ? sanitizeTitle(part.text) : "";
          if (!title) continue;

          pi.setSessionName(title);
          syncTitle(ctx);
          return;
        } catch { }
      }
    })();
  });
}
