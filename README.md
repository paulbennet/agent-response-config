# response-config (Claude plugin directory edition)

Makes Claude Code replies short, structured and easy to act on. Replies lead with the result and keep a small prose budget. They end with numbered Actions, Suggestions, Questions and Decisions that you answer by ID ("do A2", "D3: b"). An optional English level (CEFR, readability, controlled vocabulary, plain language) keeps the wording simple.

Install: `/plugin install response-config@claude-plugins-official`

This edition holds the skill and the output style. It has no hooks and no scripts. Settings are JSON files that Claude reads and edits for you: ask "configure response-config".

The full edition adds hooks that repeat the rules on every prompt and keep the item ledger, a config CLI, and Codex and Copilot support: https://github.com/paulbennet/agent-response-config

Version 1.2.0. MIT license.
