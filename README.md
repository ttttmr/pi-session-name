# pi-session-name

[![npm version](https://img.shields.io/npm/v/pi-session-name)](https://www.npmjs.com/package/pi-session-name)
[![license](https://img.shields.io/npm/l/pi-session-name)](./LICENSE)

A pi extension that auto-generates a concise, meaningful session title from the first user prompt.

---

## What it does

- Captures the **first** user input in a session and freezes it as the title source
- Generates a short title in the user's language using the active pi model
- Retries up to 3 times, **always with only the original first input**
- Never overwrites an already-set session name
- Updates the terminal title in real time:
  - `· <session name> - <cwd>` — while the agent is running
  - `✳ <session name> - <cwd>` — while idle

## Behavior details

The extension listens for `input`, `agent_start`, and `agent_end` events:

1. On the first `input` event, if the session already has a name → does nothing.
2. Otherwise, stores the first user input in memory and starts title generation.
3. Tries up to 3 times to generate a title from only that first input.
4. All subsequent user messages are **ignored** — a failed first request will not cause the extension to switch to a later prompt.
5. On `agent_start` / `agent_end`, the title prefix toggles between `·` (busy) and `✳` (idle).

**Failure modes**: if no model is selected, no API key is available, or all 3 attempts fail, the session simply stays unnamed — no error, no noise.

## Install

### From npm (global)

```bash
pi install npm:pi-session-name
```

### From a local checkout

```bash
pi install /absolute/path/to/pi-session-name
```

### Try without installing

```bash
pi -e /absolute/path/to/pi-session-name
```

Use `-l` with `pi install` to install into the **current project's** `.pi/settings.json` instead of your global settings.

## Development

```bash
# Clone
git clone https://github.com/ttttmr/pi-session-name.git
cd pi-session-name

# Install dependencies
npm install

# Run tests
npm test

# Test locally in pi
pi -e .
```

## Publish

```bash
npm publish
```

## License

[MIT](./LICENSE)
