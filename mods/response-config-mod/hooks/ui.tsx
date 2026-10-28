// Status band, config pane and open-items pane.
// One structure on every surface; the terminal draws a keyboard list (focus marker, hotkeys on
// the focused item), the desktop and VS Code a pointer list (the focused item expands, the
// others show their quick action and reveal the rest on hover). Text is drawn in the surface's
// own font: sans on desktop and VS Code, the terminal's font in the terminal.
import { atom, read, update } from 'claude-code'
import type { On, RenderChildren } from 'claude-code'

import { runWizard } from './wizard'
import {
  cli, commandName, mutateLedger, refresh, save,
} from './engine'
import type { Dollar } from './engine'
// @ts-ignore bundled plain-JS modules without declarations
import { effectiveConfig, modeSummary, wordBudget } from '../engine/lib/hint.mjs'
// @ts-ignore
import { STATUS_EMOJI, applyReplies, openItems } from '../engine/lib/core.mjs'
// @ts-ignore
import { parseUserReplies } from '../engine/lib/parse.mjs'
// @ts-ignore
import { LEVEL_NAMES, PRESET_TEXT, levelOf, levelPairs, resolveLanguage, withDetach } from '../engine/lib/language.mjs'

// The engine reads state statically: each file that reads or writes an atom declares it itself.
const configAtom = atom({ plugin: 'response-config-mod', key: 'config' } as const, null, { shape: 'config-1' })
const ledgerAtom = atom({ plugin: 'response-config-mod', key: 'ledger' } as const, null, { shape: 'ledger-1' })
const styleAtom = atom({ plugin: 'response-config-mod', key: 'style' } as const, 'off')
const targetAtom = atom({ plugin: 'response-config-mod', key: 'target' } as const, 'user')
const focusAtom = atom({ plugin: 'response-config-mod', key: 'focus' } as const, '')
const selectedAtom = atom({ plugin: 'response-config-mod', key: 'selected' } as const, [] as string[])

export const CONFIG_PANE = 'rc-config'
export const ITEMS_PANE = 'rc-items'

const onOff = [{ value: 'on' }, { value: 'off' }]
// One select for the level: off, a CEFR level, plain language only, or a preset.
const LEVEL_LABEL: Record<string, string> = { off: 'off', plain: 'plain language only', simple: 'simple (preset)', global: 'global (preset)', technical: 'technical (preset)' }
const LEVEL_OPTIONS_LANG = (LEVEL_NAMES as string[]).map(value => ({ value, label: LEVEL_LABEL[value] ?? value }))
const LEVEL_OPTIONS = ['off', 'low', 'medium', 'high', 'extreme'].map(value => ({ value }))
const VOCAB_OPTIONS = ['none', 'basic-english', 'globish', 'ste', 'oxford-3000', 'oxford-5000', 'ngsl', 'awl'].map(value => ({ value }))
const READ_OPTIONS = ['none', 'flesch-reading-ease', 'flesch-kincaid', 'gunning-fog', 'smog', 'coleman-liau', 'dale-chall'].map(value => ({ value }))
const flag = (b: boolean | undefined) => (b ? 'on' : 'off')
// Style states that mean the managed file matches the config.
const STYLE_OK = new Set(['in-sync', 'unchanged', 'updated', 'created'])

type ItemType = 'A' | 'S' | 'Q' | 'D'
type Item = { id: string; type: ItemType; text: string; status: string }
type Surface = 'terminal' | 'desktop' | 'vscode' | 'mobile' | string
const SECTIONS = [['A', 'ACTIONS'], ['S', 'SUGGESTIONS'], ['Q', 'QUESTIONS'], ['D', 'DECISIONS']] as const
// Theme keys follow the person's theme on the terminal and desktop. VS Code maps only some of
// them, so it gets fixed mid tones that read on light and dark.
const THEME_COLOR = { A: 'suggestion', S: 'planMode', Q: 'warning', D: 'merged' } as const
const VSCODE_COLOR = { A: '#3794ff', S: '#2aa198', Q: '#d18616', D: '#a371f7' } as const
const typeColor = (t: ItemType, surface: Surface) => (surface === 'vscode' ? VSCODE_COLOR[t] : THEME_COLOR[t])

// Item text as plain words: markdown code ticks and bold marks dropped.
const plain = (t: string) => t.replace(/`([^`]*)`/g, '$1').replace(/\*\*/g, '')
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t)

// "License: (a) MIT (b) Apache-2.0" -> head "License", options a: MIT, b: Apache-2.0.
// A question's "(yes/no)" answer form is dropped from the head when it gets Yes/No buttons.
export function splitItem(text: string) {
  const t = plain(text)
  const options = [...t.matchAll(/\(([a-h])\)\s*([^()]*?)\s*(?=\([a-h]\)|$)/g)]
    .map(m => ({ key: m[1] as string, label: clip((m[2] as string).replace(/[,;.]+$/, '').trim(), 28) || (m[1] as string) }))
  const first = t.search(/\([a-h]\)/)
  const yesNo = /\(yes\/no\)/i.test(t)
  let head = (first > 0 ? t.slice(0, first) : t).replace(/\(yes\/no\)/i, '').trim().replace(/[:\-–—]+$/, '').trim()
  if (!head) head = t
  return { head, options, yesNo }
}

type Action = { key: string; label: string; hotkey?: string; primary?: boolean; quick?: boolean; run: () => void }

// Panes open as tall as their content, so an inline pane is not cut to a third of the screen:
// the config pane's rows, and per item type a heading, its rows and a gap, plus the hint line
// and room for the bulk bar.
const CONFIG_ROWS = 25
export async function openItemsPane($: Dollar) {
  const ledger = await read($, ledgerAtom)
  const open: Item[] = ledger ? openItems(ledger) : []
  const types = new Set(open.map(i => i.type)).size
  await $.ui.open({ id: ITEMS_PANE, title: 'Open items', focus: true, rows: Math.max(4, open.length + types * 2 + 3) })
}
export async function openConfigPane($: Dollar) {
  await $.ui.open({ id: CONFIG_PANE, title: 'Response config', focus: true, rows: CONFIG_ROWS })
}

export function installUi(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const cfg = await read($, configAtom)
    if (!cfg || e.props.hasSurvey) return next(e)
    const led = await read($, ledgerAtom)
    const eff = effectiveConfig(cfg, led?.session.overrides ?? {})
    const style = await read($, styleAtom)
    const open: Item[] = led ? openItems(led) : []
    const count = (t: string) => open.filter(i => i.type === t).length
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" columnGap={1} alignItems="center">
        <Text dimColor>reply</Text>
        <Text>{modeSummary(eff)}</Text>
        {eff.enabled && cfg.structured.on && (
          <Box flexDirection="row" columnGap={1}>
            <Text dimColor>· open</Text>
            {SECTIONS.map(([t]) => <Text key={`band-${t}`} color={typeColor(t, e.surface)}>{t}{count(t)}</Text>)}
            {cfg.structured.statusEmoji && open.some(i => i.status === 'in-progress') && (
              <Text>{STATUS_EMOJI['in-progress']}{open.filter(i => i.status === 'in-progress').length}</Text>
            )}
          </Box>
        )}
        {style === 'drifted' && <Text color="warning">· style edited by hand</Text>}
        <Box flexGrow={1} />
        {/* The terminal has no route from the band into a pane (a band press keeps the keys, and
            no chord moves them), so it names the commands, which open the pane with the keys. */}
        {e.surface === 'terminal'
          ? <Text dimColor>/{commandName()} items · pane</Text>
          : (
            <Box flexDirection="row" columnGap={1}>
              <Button key="rc-open-items" label="Items" onPress={() => { void openItemsPane($) }} />
              <Button key="rc-open-config" label="Config" variant="secondary" onPress={() => { void openConfigPane($) }} />
            </Box>
          )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: CONFIG_PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    if (!('Input' in els) || !('Select' in els)) {
      return <Text>This surface has no form controls. Use /{commandName()} on|off|verbose|terse|style.</Text>
    }
    const { Input, Select } = els
    const cfg = await read($, configAtom)
    if (!cfg) return <Text dimColor>Loading config...</Text>
    const style = await read($, styleAtom)
    const target = await read($, targetAtom)
    const terminal = e.surface === 'terminal'
    const m = cfg.minimal
    const l = cfg.language
    // The fields as a preset sets them; changing one writes the preset out first (withDetach).
    const shown = resolveLanguage(l)
    const readability = shown.readability
    const saveLang = (pairs: string[]) => save($, withDetach(l, pairs))
    const level = levelOf(l)
    const heading = (text: string) => <Text bold dimColor size="caption">{text}</Text>
    // A label column of fixed width, then the control, so every row lines up; a pointer surface
    // also caps the control's width so a select does not stretch across the pane.
    const field = (key: string, label: string, control: RenderChildren, after?: RenderChildren) => (
      // Top-aligned on the terminal, where an open select lists its options in place below it.
      <Box key={`row-${key}`} flexDirection="row" columnGap={1} alignItems={terminal ? 'flex-start' : 'center'}>
        <Box width={terminal ? 22 : '40%'} flexShrink={0}><Text>{label}</Text></Box>
        <Box flexDirection="row" columnGap={1} alignItems={terminal ? 'flex-start' : 'center'} flexShrink={1}>
          <Box width={terminal ? undefined : '45%'} flexShrink={1}>{control}</Box>
          {after}
        </Box>
      </Box>
    )
    const muted = terminal ? { variant: 'secondary' as const } : e.surface === 'vscode' ? { plain: true as const } : { variant: 'secondary' as const }

    return (
      <Box flexDirection="column" gap={1}>
        {field('target', 'Save to', <Select key="target" value={target} options={[{ value: 'user' }, { value: 'project' }]}
          onSelect={v => { void update($, targetAtom, () => v as 'user' | 'project') }} />)}
        <Box flexDirection="column">
          {heading('REPLIES')}
          {field('enabled', 'Enabled', <Select key="enabled" value={flag(cfg.enabled)} options={onOff}
            onSelect={v => { void save($, [`enabled=${v === 'on'}`]) }} />)}
          {field('brevity', 'Brevity', <Select key="brevity" value={m.on ? m.level : 'off'} options={LEVEL_OPTIONS}
            onSelect={v => { void save($, v === 'off' ? ['minimal.on=false'] : ['minimal.on=true', `minimal.level=${v}`]) }} />)}
          {field('maxWords', 'Max prose words', <Input key="maxWords" value={m.maxWords == null ? '' : String(m.maxWords)}
            placeholder={`${wordBudget(m)} for this level`} submitLabel="save"
            onSubmit={v => {
              const n = Number(v)
              if (!v.trim()) void save($, ['minimal.maxWords=null'])
              else if (!Number.isInteger(n) || n < 10 || n > 1000) $.ui.toast('Enter a whole number from 10 to 1000, or leave it empty for the level default.')
              else void save($, [`minimal.maxWords=${n}`])
            }} />)}
          {field('structured', 'Structured A/S/Q/D', <Select key="structured" value={flag(cfg.structured.on)} options={onOff}
            onSelect={v => { void save($, [`structured.on=${v === 'on'}`]) }} />)}
          {field('emoji', 'Status emojis', <Select key="emoji" value={flag(cfg.structured.statusEmoji)} options={onOff}
            onSelect={v => { void save($, [`structured.statusEmoji=${v === 'on'}`]) }} />)}
        </Box>
        <Box flexDirection="column">
          {heading('LANGUAGE')}
          {field('cefr', 'English level', <Select key="cefr" value={level} options={LEVEL_OPTIONS_LANG}
            onSelect={v => { void save($, levelPairs(v)) }} />,
          PRESET_TEXT[level] && <Text dimColor>{PRESET_TEXT[level]}</Text>)}
          {field('readability', 'Readability', <Select key="readability" value={readability?.standard ?? 'none'} options={READ_OPTIONS}
            onSelect={v => {
              void saveLang(v === 'none'
                ? ['language.readability=null']
                : ['language.on=true', `language.readability=${JSON.stringify({ standard: v, target: readability?.target ?? 8 })}`])
            }} />)}
          {readability && field('target-score', 'Readability target', <Input key="target-score" value={String(readability.target ?? '')} submitLabel="save"
            onSubmit={v => {
              const n = Number(v)
              if (!Number.isFinite(n)) $.ui.toast('Enter a number.')
              else void saveLang([`language.readability=${JSON.stringify({ standard: readability.standard, target: n })}`])
            }} />)}
          {field('vocab', 'Vocabulary', <Select key="vocab" value={shown.vocabulary ?? 'none'} options={VOCAB_OPTIONS}
            onSelect={v => { void saveLang(v === 'none' ? ['language.vocabulary=null'] : ['language.on=true', `language.vocabulary=${JSON.stringify(v)}`]) }} />)}
          {field('plain', 'Plain language', <Select key="plain" value={flag(shown.plainLanguage)} options={onOff}
            onSelect={v => { void saveLang(v === 'on' ? ['language.on=true', 'language.plainLanguage=true'] : ['language.plainLanguage=false']) }} />)}
        </Box>
        <Box flexDirection="column">
          {heading('OUTPUT STYLE')}
          {field('style-manage', 'Managed style', <Select key="style-manage" value={flag(cfg.claude.outputStyle.manage)} options={onOff}
            onSelect={v => { void save($, [`claude.outputStyle.manage=${v === 'on'}`]) }} />,
          cfg.claude.outputStyle.manage && (
            <Text color={STYLE_OK.has(style) ? 'success' : 'warning'}>● {STYLE_OK.has(style) ? 'in sync' : style}</Text>
          ))}
          <Box flexDirection="row" columnGap={1} flexWrap="wrap">
            <Button key="style-sync" label="Sync" variant="primary" onPress={async () => { const r = await cli($, ['--style', 'sync']); $.ui.toast(r.stdout.split('\n')[0] ?? ''); await refresh($) }} />
            <Button key="style-force" label="Force sync" {...muted} onPress={async () => { const r = await cli($, ['--style', 'sync', '--force']); $.ui.toast(r.stdout.split('\n')[0] ?? ''); await refresh($) }} />
            <Button key="style-activate" label="Activate" {...muted} onPress={async () => {
              if ((await $.ui.ask('Set the managed style as your active output style?', ['Yes', 'No'])) === 'Yes') {
                const r = await cli($, ['--style', 'activate'])
                $.ui.toast(r.stdout.split('\n')[0] ?? '')
              }
            }} />
            <Button key="wizard" label="Run wizard" {...muted} onPress={() => { void runWizard($) }} />
          </Box>
        </Box>
        <Text dimColor>Changes save at once to your {target} config.</Text>
      </Box>
    )
  })

  // Remember which item holds the focus ring, so its buttons get hotkeys and, on a pointer
  // surface, it expands.
  on('ui.focus', { component: 'Pane', requestId: ITEMS_PANE }, async ($, e, next) => {
    const id = /^([ASQD]\d+)-/.exec(e.element ?? '')?.[1] ?? ''
    if (id && id !== (await read($, focusAtom))) await update($, focusAtom, () => id)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: ITEMS_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const led = await read($, ledgerAtom)
    const emoji = Boolean((await read($, configAtom))?.structured.statusEmoji)
    const open: Item[] = led ? openItems(led) : []
    // A prompt the mod submits skips its own prompt.submit hook, so the reply is applied to the
    // ledger here, and the pane drops a closed item at once.
    const send = (text: string) => {
      void (async () => {
        await mutateLedger($, l => { applyReplies(l, parseUserReplies(text)) })
        await $.prompt.submit({ text, asUser: true })
      })()
    }
    if (open.length === 0) return <Text dimColor>No open items. They appear after the agent lists A/S/Q/D items.</Text>
    const terminal = e.surface === 'terminal'
    const stored = await read($, focusAtom)
    const focused = open.some(i => i.id === stored) ? stored : (open[0]?.id ?? '')
    // Bulk select: picked items share one reply ("done A1, A2"). While any are picked, the
    // d/s/o keys act on them, not on the focused item.
    const picked = (await read($, selectedAtom)).filter(id => open.some(i => i.id === id))
    const bulk = picked.length > 0
    const isPicked = (item: Item) => picked.includes(item.id)
    const toggle = (item: Item) => {
      void update($, selectedAtom, s => (s.includes(item.id) ? s.filter(x => x !== item.id) : [...s, item.id]))
    }
    const sendAll = (verb: string, ids: string[]) => {
      send(`${verb} ${ids.join(', ')}`)
      void update($, selectedAtom, () => [])
    }

    // Done is the one main action of an action or suggestion. On the terminal every answer button
    // is drawn in the accent color, as the design's colored labels; elsewhere answers are plain
    // buttons (VS Code draws every variant alike, so its secondary ones go without chrome).
    const actions = (item: Item): Action[] => {
      const { options, yesNo } = splitItem(item.text)
      const answer: Action = { key: 'ans', label: options.length ? 'Other…' : 'Answer', hotkey: 'r', quick: !yesNo && !options.length, run: () => { void $.prompt.fill({ text: `${item.id}: ` }) } }
      if (item.type === 'A' || item.type === 'S') {
        const done: Action = { key: 'done', label: terminal ? 'done' : 'Done', hotkey: 'd', primary: true, quick: true, run: () => send(`done ${item.id}`) }
        const doIt: Action = { key: 'do', label: terminal ? 'do' : 'Do it', hotkey: 'o', run: () => send(`do ${item.id}`) }
        const skip: Action = { key: 'skip', label: terminal ? 'skip' : 'Skip', hotkey: 's', run: () => send(`skip ${item.id}`) }
        return terminal ? [done, skip, doIt] : [done, doIt, skip]
      }
      const out: Action[] = []
      if (yesNo) {
        out.push({ key: 'yes', label: terminal ? 'yes' : 'Yes', hotkey: 'y', primary: terminal, quick: true, run: () => send(`${item.id}: yes`) })
        out.push({ key: 'no', label: terminal ? 'no' : 'No', hotkey: 'n', primary: terminal, quick: true, run: () => send(`${item.id}: no`) })
      }
      for (const o of options) {
        out.push({ key: o.key, label: terminal ? o.key : `${o.key} · ${o.label}`, hotkey: o.key, primary: terminal, quick: true, run: () => send(`${item.id}: ${o.key}`) })
      }
      out.push({ ...answer, label: terminal ? answer.label.toLowerCase() : answer.label })
      return out
    }
    // The terminal toggles a pick with x; a pointer surface has the box before the ID.
    const withPick = (item: Item): Action[] => (terminal
      ? [...actions(item), { key: 'sel', label: isPicked(item) ? 'unselect' : 'select', hotkey: 'x', run: () => toggle(item) }]
      : actions(item))
    const BULK_KEYS = new Set(['d', 's', 'o'])

    const look = (a: Action) => {
      if (a.primary) return { variant: 'primary' as const }
      return e.surface === 'vscode' && a.key !== 'yes' && a.key !== 'no' && a.key.length > 1
        ? { plain: true as const }
        : { variant: 'secondary' as const }
    }
    // Hotkeys only where keys drive the pane: the terminal's focused item, less the bulk bar's.
    const button = (item: Item, a: Action, withHotkey: boolean) => (
      <Button key={`${item.id}-${a.key}`} label={a.label} onPress={a.run} {...look(a)}
        {...(terminal && withHotkey && a.hotkey && !(bulk && BULK_KEYS.has(a.hotkey)) ? { hotkey: a.hotkey } : {})} />
    )
    const pickBox = (item: Item) => (terminal
      ? <Box flexShrink={0} width={1}><Text color="claude">{isPicked(item) ? '☑' : ' '}</Text></Box>
      : <Button key={`${item.id}-sel`} label={isPicked(item) ? '☑' : '☐'} plain dimColor={!isPicked(item)} onPress={() => toggle(item)} />)

    const bulkBar = () => {
      if (!bulk) return null
      const doable = picked.filter(id => id[0] === 'A' || id[0] === 'S')
      const keys = (k: string) => (terminal ? { hotkey: k } : {})
      const label = (t: string, n?: number) => `${terminal ? t.toLowerCase() : t}${n == null ? '' : ` ${n}`}`
      return (
        <Box key="bulk" flexDirection="row" columnGap={1} flexWrap="wrap" alignItems="center">
          <Text bold>{picked.length} selected</Text>
          <Button key="bulk-done" label={label('Done', picked.length)} variant="primary" {...keys('d')} onPress={() => sendAll('done', picked)} />
          <Button key="bulk-skip" label={label('Skip', picked.length)} variant="secondary" {...keys('s')} onPress={() => sendAll('skip', picked)} />
          {doable.length > 0 && (
            <Button key="bulk-do" label={label('Do', doable.length)} variant="secondary" {...keys('o')} onPress={() => sendAll('do', doable)} />
          )}
          {picked.length < open.length && (
            <Button key="bulk-all" label={label('All')} variant="secondary" {...keys('l')}
              onPress={() => { void update($, selectedAtom, () => open.map(i => i.id)) }} />
          )}
          <Button key="bulk-clear" label={label('Clear')} variant="secondary" {...keys('u')}
            onPress={() => { void update($, selectedAtom, () => []) }} />
        </Box>
      )
    }
    // With status emojis on, the emoji leads the ID; otherwise an in-progress item says so after its text.
    const idCell = (item: Item) => (
      <Box flexShrink={0}>
        <Text bold color={typeColor(item.type, e.surface)}>
          {emoji ? `${STATUS_EMOJI[item.status as keyof typeof STATUS_EMOJI] ?? ''} ` : ''}{item.id}
        </Text>
      </Box>
    )
    const status = (item: Item) => (!emoji && item.status === 'in-progress' ? ' (in progress)' : '')

    const terminalRow = (item: Item) => {
      const isFocused = item.id === focused
      return (
        <Box key={item.id} flexDirection="row" columnGap={1}>
          <Box flexShrink={0}><Text color="claude">{isFocused ? '▸' : ' '}</Text></Box>
          {pickBox(item)}
          {idCell(item)}
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text wrap="truncate-end">{splitItem(item.text).head}{status(item)}</Text>
          </Box>
          <Box flexDirection="row" columnGap={1} flexShrink={0}>
            {withPick(item).map(a => button(item, a, isFocused))}
          </Box>
        </Box>
      )
    }

    // Pointer surfaces: a head line with the quick actions; the focused item (or a decision,
    // whose options are its answer) shows every action on a second line, the others on hover.
    const pointerRow = (item: Item) => {
      const expanded = item.id === focused
      const all = actions(item)
      const showBelow = expanded || item.type === 'D'
      const inline = item.type === 'D' ? [] : all.filter(a => a.quick)
      const below = showBelow ? all : all.filter(a => !a.quick)
      return (
        <Box key={item.id} flexDirection="column" gap="xs">
          <Box flexDirection="row" columnGap="sm" alignItems="center">
            {pickBox(item)}
            {idCell(item)}
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              <Text wrap={expanded ? 'wrap' : 'truncate-end'}>{splitItem(item.text).head}{status(item)}</Text>
            </Box>
            {!expanded && inline.length > 0 && (
              <Box flexDirection="row" columnGap="xs" flexShrink={0}>{inline.map(a => button(item, a, false))}</Box>
            )}
          </Box>
          {below.length > 0 && (
            <Box flexDirection="row" columnGap="sm" flexWrap="wrap" paddingLeft={4}
              display={showBelow ? 'flex' : 'none'} hover={showBelow ? undefined : { display: 'flex' }}>
              {below.map(a => button(item, a, expanded))}
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {bulkBar()}
        {SECTIONS.map(([type, label]) => {
          const items = open.filter(i => i.type === type)
          if (items.length === 0) return null
          return (
            <Box key={`sec-${type}`} flexDirection="column" gap={terminal ? 0 : 'xs'}>
              <Text bold dimColor size="caption">{label}</Text>
              {items.map(item => (terminal ? terminalRow(item) : pointerRow(item)))}
            </Box>
          )
        })}
        {terminal && (
          <Text dimColor>
            {!e.props.isFocused
              ? `no keys here: open it with /${commandName()} items to use the keyboard`
              : bulk
                ? `d/s/o act on the ${picked.length} selected · x select · l all · u clear · y/n · a-h option · r answer`
                : 'tab/↑↓ move · enter press · d done · s skip · o do · x select · y/n · a-h option · r answer'}
          </Text>
        )}
      </Box>
    )
  })
}
