# Changelog

## Unreleased

Fixes from [docs/review-0.1.0.md](docs/review-0.1.0.md):

- Setup, `--set` and `--style activate` no longer overwrite a settings file that does not parse.
- The mod is listed in the marketplace, loads, validates and has tests.
- Project-scope hooks no longer write machine paths into committed files.
- Rules reach the model even when the session-start hook did not run.
- Stricter item and reply parsing; reused IDs are renumbered; the agent can close items.
- Tags no longer alter the rest of the prompt.
- CI on Ubuntu and Windows.

## 0.1.0

- Skill `response-config`: minimal, structured (A/S/Q/D IDs) and language-level reply rules, with references.
- Hook script for Claude Code, Codex and GitHub Copilot (session start, each prompt, ledger on stop).
- `config.mjs` CLI, `setup.mjs` installer, JSON schema, managed Claude output style with drift detection.
- Claude plugin packaging and the optional `response-config-mod` mod.
