# Status

What is verified, what is not, and where the build differs from [implementation-plan.md](implementation-plan.md).

## Verified

| Check | How |
|---|---|
| Hook script, config CLI, setup script, output-style sync | `npm test` (node:test, 52 tests) on Windows |
| Mod engine copy matches the skill scripts | `node tools/sync-mod.mjs --check` (part of `npm test`) |
| Claude plugin manifest, marketplace, hooks file | `claude plugin validate .` on Claude Code 2.1.310 |
| Mod manifest, hooks module, state contract | `claude plugin validate mods/response-config-mod` on 2.1.310 |
| Mod behaviour (tags, quick replies, turn registration, reused IDs, config reload on file change, items pane on terminal and desktop) | `claude plugin test mods/response-config-mod` on 2.1.310, 6 tests |
| Mod types | `tsc` against the 2.1.310 API declarations |

## Not verified yet

- The plugin's hooks in a live Claude Code session.
- The mod loaded in a live session (panes, band, wizard, `/response-config`).
- Codex: `hooks.json` wrapper shape, hook trust flow, Stop output.
- Copilot CLI: `userPromptTransformed` and `agentStop` transcript parsing.
- Copilot in VS Code: `--vscode` event names and output shape.
- Install through skills.sh and `gh skill`.

See [../evals/README.md](../evals/README.md) for the manual checks.

## Deviations from the plan

| Plan | Built | Why |
|---|---|---|
| `userConfig` options in `plugin.json`, read as `CLAUDE_PLUGIN_OPTION_*` | Not shipped; config comes from the JSON files, the CLI and the mod | The Claude Code 2.1.70 CLI on PATH rejected the key. Newer builds accept it; it can come back once older versions are not a target. |
| Exec-form hook commands (`command` + `args`) | Shell form with a quoted path | Older Claude Code builds lack exec form. |
| Claude project-scope hooks in `.claude/settings.json` | `.claude/settings.local.json` | The hook path is machine-specific and must not be committed. |
| Automated `evals/` for `claude plugin eval` | Manual checklist | The eval file format was not checked against a build that runs it. |
| Mod imports the skill's scripts | Mod ships a copy in `mods/response-config-mod/engine/` | A plugin can only import files inside its own folder. |
