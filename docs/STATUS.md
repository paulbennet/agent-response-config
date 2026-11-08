# Status

What is verified, what is not, and where the build differs from [implementation-plan.md](implementation-plan.md).

## Verified

| Check | How |
|---|---|
| Hook script, config CLI, setup script, output-style sync | `npm test` (node:test, 77 tests) on Windows |
| Mod engine copy matches the skill scripts | `node tools/sync-mod.mjs --check` (part of `npm test`) |
| Install, plugin and setup flows end to end | `npm run test:e2e` |
| Claude plugin manifest, marketplace, hooks file | `claude plugin validate .` on Claude Code 2.1.310 |
| Mod manifest, hooks module, state contract, behaviour | `claude plugin validate` and `claude plugin test mods/response-config-mod` (8 tests) on 2.1.310; `tsc` against its API |
| Plugin hooks, setup hooks and the mod in live Claude Code sessions (terminal, desktop, VS Code) | [testing-plan.md](testing-plan.md) sections G and H |
| Codex hooks: `hooks.json` shape, trust flow, session start, per-prompt hint, Stop | Section I, Codex CLI |
| Copilot CLI and Copilot in VS Code hooks | Sections J and K |
| Reply quality on Claude Code, Codex and Copilot | `npm run evals` ([../evals/README.md](../evals/README.md)), section M |

## Not verified yet

- Install from GitHub through skills.sh and `gh skill`, and the Claude marketplace from a public repo (section L, after the repo is public).
- macOS and Linux (section N).

## Deviations from the plan

| Plan | Built | Why |
|---|---|---|
| `userConfig` options in `plugin.json`, read as `CLAUDE_PLUGIN_OPTION_*` | Not shipped; config comes from the JSON files, the CLI and the mod | The Claude Code 2.1.70 CLI on PATH rejected the key. Newer builds accept it; it can come back once older versions are not a target. |
| Exec-form hook commands (`command` + `args`) | Shell form with a quoted path | Older Claude Code builds lack exec form. |
| Claude project-scope hooks in `.claude/settings.json` | `.claude/settings.local.json` | The hook path is machine-specific and must not be committed. |
| Automated `evals/` for `claude plugin eval` | `tools/evals.mjs`, headless runs of Claude Code, Codex and Copilot | One runner covers all three agents; `claude plugin eval` covers Claude only. |
| Mod imports the skill's scripts | Mod ships a copy in `mods/response-config-mod/engine/` | A plugin can only import files inside its own folder. |
