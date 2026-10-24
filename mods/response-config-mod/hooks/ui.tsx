// Status band, config pane and open-items pane.
import { read, update } from 'claude-code'
import type { On } from 'claude-code'

import { runWizard } from './wizard'
import {
  Dollar, cli, configAtom, ledgerAtom, refresh, save, styleAtom, targetAtom,
} from './engine'
// @ts-ignore bundled plain-JS modules without declarations
import { effectiveConfig, modeSummary } from '../engine/lib/hint.mjs'
// @ts-ignore
import { openItems } from '../engine/lib/core.mjs'

export const CONFIG_PANE = 'rc-config'
export const ITEMS_PANE = 'rc-items'

const onOff = [{ value: 'on' }, { value: 'off' }]
const CEFR_OPTIONS = ['off', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map(value => ({ value }))
const LEVEL_OPTIONS = ['off', 'low', 'medium', 'high', 'extreme'].map(value => ({ value }))
const VOCAB_OPTIONS = ['none', 'basic-english', 'globish', 'ste', 'oxford-3000', 'oxford-5000', 'ngsl', 'awl'].map(value => ({ value }))
const READ_OPTIONS = ['none', 'flesch-reading-ease', 'flesch-kincaid', 'gunning-fog', 'smog', 'coleman-liau', 'dale-chall'].map(value => ({ value }))
const flag = (b: boolean | undefined) => (b ? 'on' : 'off')

export function installUi(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const cfg = await read($, configAtom)
    if (!cfg || e.props.hasSurvey) return next(e)
    const led = await read($, ledgerAtom)
    const eff = effectiveConfig(cfg, led?.session.overrides ?? {})
    const style = await read($, styleAtom)
    const open = led ? openItems(led) : []
    const count = (t: string) => open.filter((i: { type: string }) => i.type === t).length
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text dimColor>reply: {modeSummary(eff)} </Text>
        {eff.enabled && cfg.structured.on && (
          <Text dimColor>| A{count('A')} S{count('S')} Q{count('Q')} D{count('D')} </Text>
        )}
        {style === 'drifted' && <Text bold>style drift </Text>}
        <Button key="rc-open-config" label="Config" onPress={() => $.ui.open({ id: CONFIG_PANE, title: 'Response config', focus: true })} />
        <Button key="rc-open-items" label="Items" onPress={() => $.ui.open({ id: ITEMS_PANE, title: 'Open items', focus: true })} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: CONFIG_PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    if (!('Input' in els) || !('Select' in els)) {
      return <Text>This surface has no form controls. Use /response-config on|off|verbose|terse|style.</Text>
    }
    const { Input, Select } = els
    const cfg = await read($, configAtom)
    if (!cfg) return <Text dimColor>Loading config...</Text>
    const style = await read($, styleAtom)
    const target = await read($, targetAtom)
    const m = cfg.minimal
    const l = cfg.language
    const readability = l.readability

    return (
      <Box flexDirection="column">
        <Text bold>Response config</Text>
        <Select key="target" label="Save to" value={target} options={[{ value: 'user' }, { value: 'project' }]}
          onSelect={v => { void update($, targetAtom, () => v as 'user' | 'project') }} />
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
        <Select key="structured" label="Structured (A/S/Q/D)" value={flag(cfg.structured.on)} options={onOff}
          onSelect={v => { void save($, [`structured.on=${v === 'on'}`]) }} />
        <Select key="cefr" label="English level" value={l.on ? l.cefr ?? 'off' : 'off'} options={CEFR_OPTIONS}
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
        <Select key="style-manage" label="Managed output style" value={flag(cfg.claude.outputStyle.manage)} options={onOff}
          onSelect={v => { void save($, [`claude.outputStyle.manage=${v === 'on'}`]) }} />
        <Text dimColor>style state: {style}</Text>
        <Box>
          <Button key="style-sync" label="Sync style" onPress={async () => { const r = await cli($, ['--style', 'sync']); $.ui.toast(r.stdout.split('\n')[0] ?? ''); await refresh($) }} />
          <Button key="style-force" label="Force sync" onPress={async () => { const r = await cli($, ['--style', 'sync', '--force']); $.ui.toast(r.stdout.split('\n')[0] ?? ''); await refresh($) }} />
          <Button key="style-activate" label="Activate style" onPress={async () => {
            if ((await $.ui.ask('Set the managed style as your active output style?', ['Yes', 'No'])) === 'Yes') {
              const r = await cli($, ['--style', 'activate'])
              $.ui.toast(r.stdout.split('\n')[0] ?? '')
            }
          }} />
          <Button key="wizard" label="Wizard" onPress={() => { void runWizard($) }} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: ITEMS_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const led = await read($, ledgerAtom)
    const open = led ? openItems(led) : []
    const send = (text: string) => { void $.prompt.submit({ text, asUser: true }) }
    if (open.length === 0) return <Text dimColor>No open items. They appear after the agent lists A/S/Q/D items.</Text>
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 3)

    return (
      <Box flexDirection="column">
        {open.slice(-room).map((item: { id: string; type: string; text: string; status: string }) => {
          const options = item.type === 'D' ? [...item.text.matchAll(/\(([a-z])\)/g)].map(x => x[1]) : []
          const isYesNo = item.type === 'Q' && /yes\/no/i.test(item.text)
          return (
            <Box key={item.id} flexDirection="column">
              <Text>{item.id}{item.status === 'in-progress' ? ' (in progress)' : ''}: {item.text}</Text>
              <Box>
                {(item.type === 'A' || item.type === 'S') && (
                  <>
                    <Button key={`${item.id}-do`} label="Do" onPress={() => send(`do ${item.id}`)} />
                    <Button key={`${item.id}-done`} label="Done" onPress={() => send(`done ${item.id}`)} />
                    <Button key={`${item.id}-skip`} label="Skip" onPress={() => send(`skip ${item.id}`)} />
                  </>
                )}
                {isYesNo && (
                  <>
                    <Button key={`${item.id}-yes`} label="Yes" onPress={() => send(`${item.id}: yes`)} />
                    <Button key={`${item.id}-no`} label="No" onPress={() => send(`${item.id}: no`)} />
                  </>
                )}
                {options.map(o => (
                  <Button key={`${item.id}-${o}`} label={o} onPress={() => send(`${item.id}: ${o}`)} />
                ))}
                {item.type === 'Q' && !isYesNo && (
                  <Button key={`${item.id}-ans`} label="Answer" onPress={() => { void $.prompt.fill({ text: `${item.id}: ` }) }} />
                )}
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
