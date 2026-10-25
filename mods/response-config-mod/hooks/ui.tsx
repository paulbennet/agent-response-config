// Status band, config pane and open-items pane.
// One structure on every surface; the terminal draws a keyboard list (focus marker, hotkeys on
// the focused item), the desktop and VS Code a pointer list (the focused item expands, the
// others show their quick action and reveal the rest on hover). Text is drawn in the surface's
// own font: sans on desktop and VS Code, the terminal's font in the terminal.
import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import { runWizard } from './wizard'
import {
  cli, commandName, refresh, save,
} from './engine'
// @ts-ignore bundled plain-JS modules without declarations
import { effectiveConfig, modeSummary } from '../engine/lib/hint.mjs'
// @ts-ignore
import { openItems } from '../engine/lib/core.mjs'

// The engine reads state statically: each file that reads or writes an atom declares it itself.
const configAtom = atom({ plugin: 'response-config-mod', key: 'config' } as const, null, { shape: 'config-1' })
const ledgerAtom = atom({ plugin: 'response-config-mod', key: 'ledger' } as const, null, { shape: 'ledger-1' })
const styleAtom = atom({ plugin: 'response-config-mod', key: 'style' } as const, 'off')
const targetAtom = atom({ plugin: 'response-config-mod', key: 'target' } as const, 'user')
const focusAtom = atom({ plugin: 'response-config-mod', key: 'focus' } as const, '')

export const CONFIG_PANE = 'rc-config'
export const ITEMS_PANE = 'rc-items'

const onOff = [{ value: 'on' }, { value: 'off' }]
const CEFR_OPTIONS = ['off', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map(value => ({ value }))
const LEVEL_OPTIONS = ['off', 'low', 'medium', 'high', 'extreme'].map(value => ({ value }))
const VOCAB_OPTIONS = ['none', 'basic-english', 'globish', 'ste', 'oxford-3000', 'oxford-5000', 'ngsl', 'awl'].map(value => ({ value }))
const READ_OPTIONS = ['none', 'flesch-reading-ease', 'flesch-kincaid', 'gunning-fog', 'smog', 'coleman-liau', 'dale-chall'].map(value => ({ value }))
const flag = (b: boolean | undefined) => (b ? 'on' : 'off')

type ItemType = 'A' | 'S' | 'Q' | 'D'
type Item = { id: string; type: ItemType; text: string; status: string }
const SECTIONS = [['A', 'ACTIONS'], ['S', 'SUGGESTIONS'], ['Q', 'QUESTIONS'], ['D', 'DECISIONS']] as const
// Theme keys, so each surface paints them in the person's theme.
const TYPE_COLOR = { A: 'suggestion', S: 'planMode', Q: 'warning', D: 'merged' } as const

// Item text as plain words: markdown code ticks and bold marks dropped.
const plain = (t: string) => t.replace(/`([^`]*)`/g, '$1').replace(/\*\*/g, '')

// "License: (a) MIT (b) Apache-2.0" -> head "License", options a: MIT, b: Apache-2.0.
// A question's "(yes/no)" answer form is dropped from the head when it gets Yes/No buttons.
export function splitItem(text: string) {
  const t = plain(text)
  const options = [...t.matchAll(/\(([a-h])\)\s*([^()]*?)\s*(?=\([a-h]\)|$)/g)]
    .map(m => ({ key: m[1] as string, label: (m[2] as string).replace(/[,;.]+$/, '').trim().slice(0, 32) || (m[1] as string) }))
  const first = t.search(/\([a-h]\)/)
  const yesNo = /\(yes\/no\)/i.test(t)
  let head = (first > 0 ? t.slice(0, first) : t).replace(/\(yes\/no\)/i, '').trim().replace(/[:\-–—]+$/, '').trim()
  if (!head) head = t
  return { head, options, yesNo }
}

type Action = { key: string; label: string; hotkey?: string; primary?: boolean; quick?: boolean; run: () => void }

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
            {SECTIONS.map(([t]) => <Text key={`band-${t}`} color={TYPE_COLOR[t]}>{t}{count(t)}</Text>)}
          </Box>
        )}
        {style === 'drifted' && <Text color="warning">· style edited by hand</Text>}
        <Box flexGrow={1} />
        <Button key="rc-open-items" label="Items" onPress={() => $.ui.open({ id: ITEMS_PANE, title: 'Open items', focus: true })} />
        <Button key="rc-open-config" label="Config" variant="secondary" onPress={() => $.ui.open({ id: CONFIG_PANE, title: 'Response config', focus: true })} />
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
    const m = cfg.minimal
    const l = cfg.language
    const readability = l.readability
    const heading = (text: string) => <Text bold dimColor size="caption">{text}</Text>
    const styleState = style === 'unchanged' || style === 'updated' || style === 'created' ? 'in sync' : style

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" columnGap={1} alignItems="center">
          <Text bold weight="semibold">Response config</Text>
          <Box flexGrow={1} />
          <Select key="target" label="Save to" value={target} options={[{ value: 'user' }, { value: 'project' }]}
            onSelect={v => { void update($, targetAtom, () => v as 'user' | 'project') }} />
        </Box>
        <Box flexDirection="column">
          {heading('REPLIES')}
          <Select key="enabled" label="Enabled" value={flag(cfg.enabled)} options={onOff}
            onSelect={v => { void save($, [`enabled=${v === 'on'}`]) }} />
          <Select key="brevity" label="Brevity" value={m.on ? m.level : 'off'} options={LEVEL_OPTIONS}
            onSelect={v => { void save($, v === 'off' ? ['minimal.on=false'] : ['minimal.on=true', `minimal.level=${v}`]) }} />
          <Input key="maxWords" label="Max prose words" value={String(m.maxWords)} submitLabel="save"
            onSubmit={v => {
              const n = Number(v)
              if (!Number.isInteger(n) || n < 10 || n > 1000) $.ui.toast('Enter a whole number from 10 to 1000.')
              else void save($, [`minimal.maxWords=${n}`])
            }} />
          <Select key="structured" label="Structured A/S/Q/D" value={flag(cfg.structured.on)} options={onOff}
            onSelect={v => { void save($, [`structured.on=${v === 'on'}`]) }} />
        </Box>
        <Box flexDirection="column">
          {heading('LANGUAGE')}
          <Select key="cefr" label="English level (CEFR)" value={l.on ? l.cefr ?? 'off' : 'off'} options={CEFR_OPTIONS}
            onSelect={v => { void save($, v === 'off' ? ['language.on=false'] : ['language.on=true', `language.cefr=${v}`]) }} />
          <Select key="readability" label="Readability" value={readability?.standard ?? 'none'} options={READ_OPTIONS}
            onSelect={v => {
              void save($, v === 'none'
                ? ['language.readability=null']
                : [`language.readability=${JSON.stringify({ standard: v, target: readability?.target ?? 8 })}`])
            }} />
          <Input key="target-score" label="Readability target" value={String(readability?.target ?? '')} submitLabel="save"
            onSubmit={v => {
              const n = Number(v)
              if (!readability) $.ui.toast('Pick a readability standard first.')
              else if (!Number.isFinite(n)) $.ui.toast('Enter a number.')
              else void save($, [`language.readability=${JSON.stringify({ standard: readability.standard, target: n })}`])
            }} />
          <Select key="vocab" label="Vocabulary" value={l.vocabulary ?? 'none'} options={VOCAB_OPTIONS}
            onSelect={v => { void save($, [`language.vocabulary=${v === 'none' ? 'null' : JSON.stringify(v)}`]) }} />
          <Select key="plain" label="Plain language" value={flag(l.plainLanguage)} options={onOff}
            onSelect={v => { void save($, [`language.plainLanguage=${v === 'on'}`]) }} />
        </Box>
        <Box flexDirection="column">
          {heading('OUTPUT STYLE')}
          <Box flexDirection="row" columnGap={1} alignItems="center">
            <Select key="style-manage" label="Managed style" value={flag(cfg.claude.outputStyle.manage)} options={onOff}
              onSelect={v => { void save($, [`claude.outputStyle.manage=${v === 'on'}`]) }} />
            {cfg.claude.outputStyle.manage && (
              <Text color={styleState === 'in sync' ? 'success' : 'warning'}>● {styleState}</Text>
            )}
          </Box>
          <Box flexDirection="row" columnGap={1} flexWrap="wrap">
            <Button key="style-sync" label="Sync" variant="primary" onPress={async () => { const r = await cli($, ['--style', 'sync']); $.ui.toast(r.stdout.split('\n')[0] ?? ''); await refresh($) }} />
            <Button key="style-force" label="Force sync" variant="secondary" onPress={async () => { const r = await cli($, ['--style', 'sync', '--force']); $.ui.toast(r.stdout.split('\n')[0] ?? ''); await refresh($) }} />
            <Button key="style-activate" label="Activate" variant="secondary" onPress={async () => {
              if ((await $.ui.ask('Set the managed style as your active output style?', ['Yes', 'No'])) === 'Yes') {
                const r = await cli($, ['--style', 'activate'])
                $.ui.toast(r.stdout.split('\n')[0] ?? '')
              }
            }} />
            <Button key="wizard" label="Run wizard" variant="secondary" onPress={() => { void runWizard($) }} />
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
    const open: Item[] = led ? openItems(led) : []
    const send = (text: string) => { void $.prompt.submit({ text, asUser: true }) }
    if (open.length === 0) return <Text dimColor>No open items. They appear after the agent lists A/S/Q/D items.</Text>
    const terminal = e.surface === 'terminal'
    const stored = await read($, focusAtom)
    const focused = open.some(i => i.id === stored) ? stored : (open[0]?.id ?? '')

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
        out.push({ key: 'yes', label: terminal ? 'yes' : 'Yes', hotkey: 'y', primary: true, quick: true, run: () => send(`${item.id}: yes`) })
        out.push({ key: 'no', label: terminal ? 'no' : 'No', hotkey: 'n', primary: true, quick: true, run: () => send(`${item.id}: no`) })
      }
      for (const o of options) {
        out.push({ key: o.key, label: terminal ? o.key : `${o.key} · ${o.label}`, hotkey: o.key, primary: true, quick: true, run: () => send(`${item.id}: ${o.key}`) })
      }
      out.push({ ...answer, label: terminal ? answer.label.toLowerCase() : answer.label })
      return out
    }

    const button = (item: Item, a: Action, withHotkey: boolean) => (
      <Button key={`${item.id}-${a.key}`} label={a.label} onPress={a.run}
        {...(a.primary ? { variant: 'primary' as const } : { variant: 'secondary' as const })}
        {...(withHotkey && a.hotkey ? { hotkey: a.hotkey } : {})} />
    )

    const terminalRow = (item: Item) => {
      const isFocused = item.id === focused
      return (
        <Box key={item.id} flexDirection="row" columnGap={1}>
          <Text color="claude">{isFocused ? '▸' : ' '}</Text>
          <Text bold color={TYPE_COLOR[item.type]}>{item.id}</Text>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end">{splitItem(item.text).head}{item.status === 'in-progress' ? ' (in progress)' : ''}</Text>
          </Box>
          <Box flexDirection="row" columnGap={1} flexShrink={0}>
            {actions(item).map(a => button(item, a, isFocused))}
          </Box>
        </Box>
      )
    }

    // Pointer surfaces: a head line with the quick actions; the focused item (or a decision,
    // whose options are its answer) shows every action on a second line, the others on hover.
    const pointerRow = (item: Item) => {
      const expanded = item.id === focused
      const all = actions(item)
      const quick = all.filter(a => a.quick)
      const rest = all.filter(a => !a.quick)
      const showBelow = expanded || item.type === 'D'
      const inline = item.type === 'D' ? [] : quick
      const below = showBelow ? all : rest
      return (
        <Box key={item.id} flexDirection="column" paddingY={0} gap="xs">
          <Box flexDirection="row" columnGap="sm" alignItems="center">
            <Text bold color={TYPE_COLOR[item.type]}>{item.id}</Text>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap={expanded ? 'wrap' : 'truncate-end'}>{splitItem(item.text).head}{item.status === 'in-progress' ? ' (in progress)' : ''}</Text>
            </Box>
            {!expanded && inline.map(a => button(item, a, false))}
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
        <Box flexDirection="row" columnGap={1}>
          <Text bold weight="semibold">Open items</Text>
          <Text dimColor>{open.length}</Text>
        </Box>
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
            {e.props.isFocused
              ? 'tab/↑↓ move · enter press · d done · s skip · o do · y/n · a-h option · r answer'
              : 'ctrl+x tab focuses this pane'}
          </Text>
        )}
      </Box>
    )
  })
}
