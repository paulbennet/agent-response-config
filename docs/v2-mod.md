# V2: the Claude mod

The mod in `mods/response-config-mod/` is held back from V1. Its code, tests and design canvas stay; it is not in the marketplace. This file holds what V2 has to do and what was learned before it was held back.

- Design canvas: [response-config mod UI](https://claude.ai/artifact/68CBhgmdXwSvcVbpmp6kKr) (terminal, VS Code, desktop artboards).
- Official docs: [interface](https://code.claude.com/docs/en/plugins/mods/interface.md), [gallery](https://code.claude.com/docs/en/plugins/mods/gallery.md), [reference](https://code.claude.com/docs/en/plugins/mods/reference.md). Checked 2026-11-09 against the local types of Claude Code 2.1.319.

## Bringing it back

1. `node tools/sync-mod.mjs` to refresh the engine copy, then `npm run test:mod` and `npm run validate:mod`.
2. Add the `response-config-mod` entry back to `.claude-plugin/marketplace.json`, and the install row and mod section to the README.
3. Run the open cases below live.

## Open cases

| ID | What |
|---|---|
| H22 | Bulk select live in the terminal, desktop and VS Code |
| H24 | Level select, preset fields and wizard language steps live |
| UI-1 | Terminal panes fit an inline pane (below) |
| UI-2 | VS Code: no hover-only controls (below) |
| UI-3 | Desktop pass against its artboards |

## Custom drawing: what the API allows

There is no HTML canvas, webview or scripted iframe on any surface.

| Surface | Beyond Box, Text, Button, Input, Select, Link, Code, Markdown | Limits |
|---|---|---|
| Terminal | `Raster` (cell grid), `Image` (PNG/RGBA; kitty, Ghostty, iTerm2), `Client` (own module: `onKey`, `onPointer`, timers, `post`) | `Client` gets keys only after a click, which needs fullscreen rendering |
| Desktop | `Svg` (`isInteractive`: hover, CSS, SMIL; no script), `Client` | `Client` draws with the standard elements only |
| VS Code | `Svg`, as a static image | No `Client`; ignores Box `hover` and `position`, Button `variant`, `plain` and `hotkey`, Text `size`; inline panes show 12 rows, then scroll |

Mods cannot bind Tab or the arrow keys. `Text` `bold` is deprecated for `weight="semibold"`. A `Button` with children (2.1.295+) makes a whole row one press target.

## Terminal findings (live, 2026-11-09, no fullscreen)

An inline pane gets about a third of the screen: 4 to 5 body rows in a 27-row window, whatever `rows` asks. The canvas assumed about 20.

| Area | Seen | Planned fix |
|---|---|---|
| Items pane | Headings and gap rows use the room; only the Actions show | When content exceeds `scroll.bodyRows`, drop headings and gaps; the ID colour gives the type |
| Item rows | Four buttons (`[ unselect ]` is 12 columns); 🔵 on every row | Three buttons tinted by type, as on the canvas; the pick mark in the focus column; the emoji only for ⏳ |
| Bulk bar | Takes the one visible row | One header row: `2 picked [ done ] [ skip ] [ do ] [ all ] [ clear ]` |
| Config pane | An open select shows one option; values sit far from labels | Canvas cyclers `‹ high ›` (Enter steps on) with a dim option strip; `saves to ‹ user ›` in the header row |
| Band | `open A2 S1` reads like item IDs: the canvas redesign (`eb64a24`) undid the MOD-2 fix | `A:2 S:1 Q:2 D:1` |

Open choices:

- Whether Ctrl+X ↑ on a pane keeps its size across reopenings. If it does, the compact layout is a fallback; if not, it is the norm.
- Long value lists (English level has 13): a `‹ B1 ›` cycler with a dropdown only on a wide or tall pane, cyclers only, or dropdowns.
- Add a "compact inline" artboard to the canvas once the terminal layout is settled.

## VS Code findings (from the code and docs, not yet seen live)

- The items pane hides Do and Skip on unfocused rows behind `display: none` with a hover reveal; VS Code ignores `hover`, so they never show.
- `plain` and `variant` are ignored, so every button looks the same; `size="caption"` headings draw at body size.
- The docs do not list VS Code as an `AbovePrompt` (band) site, though H20 passed live on an earlier build.
