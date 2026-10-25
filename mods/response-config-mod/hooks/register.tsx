// response-config mod: rules in the system prompt, quick replies and tags on submit,
// item ledger on turn end, a status band, panes, a wizard and /response-config.
import { atom, read } from 'claude-code'
import type { Register } from 'claude-code'

import {
  COMMANDS, cli, commandName, ensureLedger, markActive, mutateLedger, refresh, refreshIfChanged, registerCommand,
} from './engine'
import type { Dollar } from './engine'
import { installUi, openConfigPane, openItemsPane } from './ui'
import { firstRun, runWizard } from './wizard'
// @ts-ignore bundled plain-JS modules without declarations
import { applyReplies, registerItems, takeReused } from '../engine/lib/core.mjs'
// @ts-ignore
import { effectiveConfig, modeSummary, renderPromptHint, renderRules } from '../engine/lib/hint.mjs'
// @ts-ignore
import { hasTags, parseAssistantItems, parseTags, parseUserReplies } from '../engine/lib/parse.mjs'

// The engine reads state statically: each file that reads or writes an atom declares it itself.
const configAtom = atom({ plugin: 'response-config-mod', key: 'config' } as const, null, { shape: 'config-1' })
const ledgerAtom = atom({ plugin: 'response-config-mod', key: 'ledger' } as const, null, { shape: 'ledger-1' })
const styleAtom = atom({ plugin: 'response-config-mod', key: 'style' } as const, 'off')

async function overrides($: Dollar) {
  return (await read($, ledgerAtom))?.session.overrides ?? {}
}

async function setOverride($: Dollar, patch: Record<string, unknown> | null) {
  await mutateLedger($, l => {
    l.session.overrides = patch === null ? {} : { ...l.session.overrides, ...patch }
  })
}

export const register: Register = on => {
  installUi(on)

  on('session.start', async ($, e, next) => {
    await markActive($, true) // classic response-config hooks stand down for this session
    await refresh($)
    await ensureLedger($)
    const name = await registerCommand($)
    // Said once, not every session.
    if (name && name !== COMMANDS[0] && (await $.store.get('commandNotice')) !== name) {
      $.ui.toast(`/${COMMANDS[0]} is taken by the response-config plugin's skill; use /${name}.`)
      await $.store.set('commandNotice', name)
    }
    if ((await read($, styleAtom)) === 'drifted') {
      $.ui.toast(`Managed output style was hand-edited. /${commandName()} style sync --force regenerates it.`)
    }
    if (e.isInteractive && e.surface !== null && !(await $.store.get('wizardDone'))) {
      void (async () => {
        await $.clock.sleep(1500)
        await firstRun($)
      })()
    }
    return next(e)
  })

  // Rules live in the system prompt for the whole session.
  on('prompt.compose', async ($, e, next) => {
    const base = await next(e)
    const cfg = await read($, configAtom)
    if (!cfg) return base
    const eff = effectiveConfig(cfg, await overrides($))
    if (!eff.enabled) return base
    const text = `[response-config] Follow these rules for every reply in this session.\n${renderRules(eff)}`
    return { sections: [...base.sections, { id: 'response-config:rules', text, scope: 'session' as const }] }
  })

  // Tags and quick replies are handled when the person sends a prompt.
  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta) return next(e)
    await markActive($)
    await refreshIfChanged($)
    const cfg = await read($, configAtom)
    if (!cfg) return next(e)
    const parsed = cfg.overrides.inlineTags ? parseTags(e.text) : { text: e.text, tags: {} }
    const replies = cfg.structured.on ? parseUserReplies(e.text) : []
    let resolved: unknown[] = []
    let reused: unknown[] = []
    await mutateLedger($, l => {
      l.turn += 1
      resolved = applyReplies(l, replies)
      reused = takeReused(l)
    })
    const led = await ensureLedger($)
    const tagged = hasTags(parsed.tags)
    const eff = effectiveConfig(cfg, led.session.overrides, parsed.tags)
    // The full rules are already in the system prompt (prompt.compose), so only the short hint goes here.
    const hint = renderPromptHint(eff, led, { resolved, reused, tags: tagged ? parsed.tags : {} })
    return next({
      ...e,
      // Only rewrite the text when a tag was removed; otherwise pass it through untouched.
      ...(tagged ? { text: parsed.text } : {}),
      ...(hint ? { context: [...(e.context ?? []), hint] } : {}),
    })
  })

  // Register the numbered items the assistant just produced.
  on('turn.complete', async ($, e, next) => {
    // Only finished main-loop answers: an interrupted turn may hold a half-written list.
    if (e.reason === 'answer' && e.agentId === undefined && e.answer) {
      const items = parseAssistantItems(e.answer)
      if (items.length) await mutateLedger($, l => { registerItems(l, items) })
    }
    return next(e)
  })

  on('command.run', { command: 'response-config' }, ($, e) => runCommand($, e.args))
  on('command.run', { command: 'response-config-mod' }, ($, e) => runCommand($, e.args))
}

async function runCommand($: Dollar, args: string): Promise<{ text: string }> {
  const [sub = 'status', ...rest] = args.trim().split(/\s+/)
  switch (sub) {
    case 'on':
    case 'off':
      await setOverride($, { enabled: sub === 'on' })
      return { text: `response-config ${sub} for this session.` }
    case 'verbose':
      await setOverride($, { minimal: { on: false } })
      return { text: 'Minimal mode off for this session.' }
    case 'terse':
      await setOverride($, { minimal: { on: true } })
      return { text: 'Minimal mode on for this session.' }
    case 'reset':
      await setOverride($, null)
      return { text: 'Session overrides cleared.' }
    case 'wizard':
      void runWizard($)
      return { text: 'Wizard started.' }
    case 'pane':
      await openConfigPane($)
      return { text: 'Config pane opened.' }
    case 'items':
      await openItemsPane($)
      return { text: 'Items pane opened.' }
    case 'style': {
      const action = rest[0] ?? 'status'
      if (!['status', 'sync', 'activate', 'remove'].includes(action)) return { text: 'Use: style status|sync|activate|remove [--force]' }
      const r = await cli($, ['--style', action, ...rest.slice(1).filter(a => a === '--force')])
      await refresh($)
      return { text: (r.stdout || r.stderr).trim() }
    }
    default: {
      await refresh($)
      const cfg = await read($, configAtom)
      const eff = cfg ? effectiveConfig(cfg, await overrides($)) : null
      return { text: eff ? `response-config: ${modeSummary(eff)}` : 'response-config: config not loaded.' }
    }
  }
}
