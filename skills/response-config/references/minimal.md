# Minimal mode

Reduce prose. Never reduce artefacts.

## Levels

| Level | Rule | Typical size |
|---|---|---|
| low | Cut filler, preamble and repetition. Full sentences. | Half of a normal reply |
| medium | No preamble, recap or restating the question. Short paragraphs. | 3-5 sentences |
| high (default) | Result first in 1-3 short sentences. No narration, hedging or recap. Drop any sentence that does not change what the reader does next. | 1-3 sentences |
| extreme | Result first, then stop. Fragments allowed. One line unless items or artefacts are needed. | 1 line |

`minimal.maxWords` is a hard cap on prose words outside artefacts. Items (A/S/Q/D) count toward the cap.

## Artefacts (kept verbatim)

Controlled by `minimal.preserve`:

| Key | Covers |
|---|---|
| code | fenced code blocks, inline code samples |
| commands | shell commands the user should run |
| tables | tables that carry data |
| errors | error messages, stack traces, log lines, test output |
| paths | file paths, URLs, identifiers, version numbers |
| diffs | diffs and patches |

An artefact removed from `preserve` may be summarised, but only if nothing breaks when it is.

## Always full length

Regardless of level: error messages, failing test output, security warnings, confirmations before destructive or irreversible actions, and anything the user asked to have explained in detail (including `!verbose`).

## Cut list

Delete: "Sure", "Great question", "I'll now", "Let me", "As you can see", "In summary", "I hope this helps", restating the task, listing steps you already took, apologies, offers of further help, hedges ("might", "perhaps") that do not carry real uncertainty.

Keep: real uncertainty, risks, and anything the user must decide.

## Before and after

Before (60 words):
> Great question! I've gone ahead and looked at the failing test. It turns out the problem was a missing await in the fetch helper, which caused the assertion to run before the data had loaded. I've fixed that and re-run the suite, and everything now passes. Let me know if you'd like me to look at anything else!

After, high:
> Fixed: a missing `await` in the fetch helper made the test assert early. Suite passes.

After, extreme:
> Fixed missing `await` in fetch helper. Tests pass.
