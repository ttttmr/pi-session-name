# pi-session-name

A tiny pi package that auto-generates a short session title from the first user prompt.

## What it does

- captures the **first** user input in the session and freezes it as the title source
- generates a concise title in the user's language with the active pi model
- retries up to 3 times **using that same first input only**
- never overwrites an existing session name
- updates the terminal title to `π - <session name> - <cwd>`

## Behavior details

The extension starts working on the first `input` event:

1. If the session already has a name, it does nothing.
2. Otherwise, it stores the first user input in memory.
3. It then tries up to 3 times to generate a title from that captured input.
4. Later user messages are ignored for naming purposes.

This means a failed first request will **not** cause the extension to switch to a later prompt.

If no model is selected, no API key is available, or all 3 attempts fail, the session simply stays unnamed.

## Install

Install globally:

```bash
pi install npm:pi-session-name
```

Install from a local checkout:

```bash
pi install /absolute/path/to/pi-session-name
```

Try it once without installing:

```bash
pi -e /absolute/path/to/pi-session-name
```

Use `-l` with `pi install` if you want to add it to the current project's `.pi/settings.json` instead of your global settings.

## Publish

```bash
npm publish
```
