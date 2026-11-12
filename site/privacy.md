---
title: Privacy
description: response-config collects no data and makes no network requests.
---

# Privacy

Last updated: 12 November 2026.

response-config is a skill, an output style and a set of hooks. They run on your computer.

- **No data collection.** The plugin collects no personal data, analytics or telemetry.
- **No network requests.** The skill scripts and the hooks do not connect to any server.
- **Local files only.** The config and the per-session item ledger stay in `~/.config/response-config/` (or `$XDG_CONFIG_HOME/response-config/`). An optional project file `.response-config.json` stays in your project. You can delete these files at any time.
- **Your agent.** Claude Code, Codex or Copilot sends your conversation to its own provider. Their privacy policies apply to that. response-config adds only short rule text to the context.

Questions: open an issue at [github.com/paulbennet/agent-response-config/issues](https://github.com/paulbennet/agent-response-config/issues).
