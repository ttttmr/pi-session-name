import path from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model, ThinkingLevel } from "@earendil-works/pi-ai";

const MAX_TITLE_CHARACTERS = 60;

const TITLE_PROMPT = [
  "Generate a short session title describing the user’s task. Do not answer the task.",
  "Return only the title.",
  "Keep the user's language.",
  "No quotes. No trailing punctuation.",
  `Use one plain-text line of at most ${MAX_TITLE_CHARACTERS} characters. No Markdown.`,
].join("\n");

function formatTitle(ctx: ExtensionContext, sessionName: string, isRunning: boolean) {
  const prefix = isRunning ? "·" : "✳";
  return `${prefix} ${sessionName} - ${path.basename(ctx.cwd)}`;
}

// opencode-zen/go refuses requests without a session header (400 MissingSessionID).
// The agent path injects it via attribution headers; side calls must add it themselves.
function opencodeSessionHeaders(model: Model<Api>, sessionId: string | undefined) {
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

// Reject malformed output rather than turning the first line of an answer into
// a permanent session name. Quotes around an otherwise valid title are harmless.
function sanitizeTitle(text: string) {
  const raw = text.trim();
  if (/[\u0000-\u001f\u007f\u2028\u2029]/u.test(raw) || /\*\*|__|```|^#{1,6}\s/u.test(raw)) return "";
  const title = raw.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "").trim();
  return Array.from(title).length <= MAX_TITLE_CHARACTERS ? title : "";
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

      // Use the public registry entry point: it normalizes systemPrompt into
      // transcript messages before dispatching to built-in or custom providers,
      // and resolves configured authentication, headers, base URL, and env.
      const headers = opencodeSessionHeaders(model, ctx.sessionManager?.getSessionId?.());

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await ctx.modelRegistry.streamSimple(
            model,
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
              headers,
            },
          ).result();

          // Do not commit errors, aborted responses, or token-truncated titles.
          if (response.stopReason !== "stop") continue;

          const text = response.content.flatMap(part => part.type === "text" ? [part.text] : []).join("\n");
          const title = sanitizeTitle(text);
          if (!title) continue;

          // A manual rename may have happened while the request was in flight.
          if (pi.getSessionName()) return;
          pi.setSessionName(title);
          syncTitle(ctx);
          return;
        } catch { }
      }
    })();
  });
}
