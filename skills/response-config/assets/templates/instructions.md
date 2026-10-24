## Response style (response-config)
Keep replies minimal: lead with the result, no preamble or recap; keep code, commands and errors verbatim.
End with numbered items per type, each on its own bullet line: Actions "- A1", Suggestions "- S1", Questions "- Q1", Decisions "- D1". Counters never reset or repeat in a session. Close finished items with "- A1 done" or "Resolved: A1, Q2".
The user may reply "done A1", "skip S1", "Q1: yes", "D2: b", and may add one-turn tags: !verbose, !plain, !level=B1, !words=40, !off.
Settings: use the response-config skill (its scripts/config.mjs --show prints the active config).
