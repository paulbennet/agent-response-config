# Status

What is verified, what is not, and where the build differs from [implementation-plan.md](implementation-plan.md).

## Verified

| Check | How |
|---|---|
| Hook script, config CLI, setup script, output-style sync | `npm test` (node:test, 77 tests) on Windows |
| Install, plugin and setup flows end to end | `npm run test:e2e` |
| `npm test` and e2e on Linux (with `XDG_CONFIG_HOME`), macOS and Windows | GitHub Actions, `.github/workflows/test.yml` (N3, N4) |
| Claude plugin manifest, marketplace, hooks file | `claude plugin validate .` on Claude Code 2.1.310 |
| Plugin hooks and setup hooks in live Claude Code sessions (terminal, desktop, VS Code) | [testing-plan.md](testing-plan.md) section G |
| Codex hooks: `hooks.json` shape, trust flow, session start, per-prompt hint, Stop | Section I, Codex CLI |
| Copilot CLI and Copilot in VS Code hooks | Sections J and K |
| Reply quality on Claude Code, Codex and Copilot | `npm run evals` ([../evals/README.md](../evals/README.md)), section M; language levels in [language-level-tests.md](language-level-tests.md) |

## Release scope

V1 ships the skill, the hooks, the Claude plugin and the output style. The Claude mod (`mods/response-config-mod/`) is V2: its code stays in the repo, it is not listed in the marketplace, and `npm test` and `npm run validate` leave it out. Its status and plan are in [v2-mod.md](v2-mod.md).

## Pending for V1

Every open item, by its case ID in [testing-plan.md](testing-plan.md). When one is done, set its Result there and remove its row here.

| ID | What | Blocked by | To unblock |
|---|---|---|---|
| A4 | Claude Code loads the skill from "keep answers short" without its name | Needs a live session outside Claude Code | Run in a normal terminal, skill only, no hooks |
| A5 | Codex lists the skill and runs `$response-config` | Live Codex session | Run in Codex CLI |
| A6 | Copilot lists the skill from `.agents/skills` and `~/.copilot/skills` | Live Copilot session | Run in Copilot CLI |
| B10 | "Use B1 English from now on" makes the agent run `config.mjs --level B1` | Live agent session | Run with G, I or J |
| B14 | "Configure response-config" runs the guided settings flow | Live agent session | Run with G, I or J |
| L5 | `npx skills add paulbennet/agent-response-config` from GitHub, project and `-g` | Repo is private | Make the repo public |
| L6 | skills.sh page and README badge appear | L5 | Run L5 first |
| L7 | `gh skill install` from GitHub | Repo is private; `gh` is 2.69, needs 2.90+ | Make the repo public; upgrade `gh` |
| L8 | Claude marketplace install of the plugin | Repo is private | Make the repo public |
| N5 | One live agent on macOS or Linux, G5 to G8 | Only Windows here | A macOS or Linux machine |

## Deviations from the plan

| Plan | Built | Why |
|---|---|---|
| `userConfig` options in `plugin.json`, read as `CLAUDE_PLUGIN_OPTION_*` | Not shipped; config comes from the JSON files and the CLI | The Claude Code 2.1.70 CLI on PATH rejected the key. Newer builds accept it; it can come back once older versions are not a target. |
| Exec-form hook commands (`command` + `args`) | Shell form with a quoted path | Older Claude Code builds lack exec form. |
| Claude project-scope hooks in `.claude/settings.json` | `.claude/settings.local.json` | The hook path is machine-specific and must not be committed. |
| Automated `evals/` for `claude plugin eval` | `tools/evals.mjs`, headless runs of Claude Code, Codex and Copilot | One runner covers all three agents; `claude plugin eval` covers Claude only. |
| Mod imports the skill's scripts | Mod ships a copy in `mods/response-config-mod/engine/` | A plugin can only import files inside its own folder. |
| Mod released with the plugin | Mod held back to V2 | Its terminal UI does not fit an inline pane yet; see [v2-mod.md](v2-mod.md). |
