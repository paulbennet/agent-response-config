# Manual eval checklist

Run each prompt in a fresh session with hooks (or the plugin) installed and default settings. Pass criteria in brackets.

1. "Rename `foo` to `bar` in src/util.js and run the tests." [summary of at most 80 prose words; code and command output verbatim]
2. A prompt that causes a failing test. [full error output shown; summary still short]
3. "Should we use Redis or Postgres for the queue?" [one Decision item D1 with lettered options]
4. Reply `D1: a` after (3). [agent proceeds with option a and does not repeat D1; new items continue from the next IDs]
5. "Explain how the build works !verbose" [long answer allowed; rules back on next turn]
6. After `--set language.on=true --set language.cefr=A2`: any task. [sentences of 12 words or fewer; no idioms]
7. `!off Summarise this repo in detail.` [normal full-length answer]
8. Long session past a compaction. [IDs continue, no reuse of earlier IDs]

Record: agent, version, settings, result, notes.
