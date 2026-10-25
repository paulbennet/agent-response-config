# Reply-quality evals

`tools/evals.mjs` runs the section M cases of [docs/testing-plan.md](../docs/testing-plan.md) against a live agent, headless, and scores the replies.

```
npm run evals -- --agent claude
npm run evals -- --agent codex
npm run evals -- --agent copilot
npm run evals -- --agent claude --cases M1,M13
```

Before a run:

- Install the agent's response-config hooks for your user with `setup.mjs --agent claude|codex|copilot --scope user`, from this checkout, so the run tests this code. Claude runs turn the plugin and the mod off through `--settings` (the plugin's cached copy may be older; the mod would take over from the hooks).
- Run it from a normal terminal, not inside an agent session.

Each case gets a throwaway project (a tiny Node package with a test, a `build/` folder and a git repo) and its own `RC_CONFIG_DIR` holding only that case's settings, so your config and ledgers are untouched. Follow-up turns resume the same session (`claude --resume`, `codex exec resume --last`, `copilot --continue`). M8 (compaction) runs on Claude only; M9 to M22 run on Claude only, as the plan asks.

Results go to `evals/results/<agent>-<time>/` (not committed): `report.md` with one row per case, and one transcript per case with the config, prompts, replies and measures. A case is `pass` or `fail` by a measured rule, or `review` where a person has to judge (M11, M15, M17, M18).

Measures, over the reply's prose (fenced code, tables, headings and inline code removed): prose words, sentences, longest and average sentence in words, Flesch-Kincaid grade, section headings found, open item IDs, and whether it says "you".
