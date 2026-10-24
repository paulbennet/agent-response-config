// response-config mod: rules in the system prompt, quick replies and tags on submit,
// item ledger on turn end, a status band, panes, a wizard and /response-config.
import { read } from 'claude-code'
import type { Register } from 'claude-code'

import {
  Dollar, cli, configAtom, ensureLedger, ledgerAtom, mutateLedger, refresh, styleAtom,
} from './engine'
import { CONFIG_PANE, ITEMS_PANE, installUi } from './ui'
import { runWizard } from './wizard'
// @ts-ignore bundled plain-JS modules without declarations
import { applyReplies, registerItems } from '../engine/lib/core.mjs'
// @ts-ignore
import { effectiveConfig, modeSummary, renderPromptHint, renderRules } from '../engine/lib/hint.mjs'
// @ts-ignore
import { hasTags, parseAssistantItems, parseTags, parseUserReplies } from '../engine/lib/parse.mjs'

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
    const id = await $.session.id()
    await cli($, ['--mod-active', id]) // classic response-config hooks stand down for this session
    await refresh($)
    await ensureLedger($)
    await $.command.register({
      name: 'response-config',
      description: 'Configure terse, structured, level-controlled replies',
      argumentHint: '[on|off|verbose|terse|reset|wizard|pane|items|style sync|activate|status]',
    })
    if ((await read($, styleAtom)) === 'drifted') {
      $.ui.toast('Managed output style was hand-edited. /response-config style sync --force regenerates it.')
    }
    if (e.isInteractive && !(await $.store.get('wizardDone'))) {
      void (async () => {
        await $.clock.sleep(1500)
        if (await runWizard($)) await $.store.set('wizardDone', true)
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
    const cfg = await read($, configAtom)
    if (!cfg) return next(e)
    const parsed = cfg.overrides.inlineTags ? parseTags(e.text) : { text: e.text, tags: {} }
    const replies = cfg.structured.on ? parseUserReplies(e.text) : []
    let resolved: unknown[] = []
    await mutateLedger($, l => {
      l.turn += 1
      resolved = applyReplies(l, replies)
    })
    const led = await ensureLedger($)
    const eff = effectiveConfig(cfg, led.session.overrides, parsed.tags)
    const hint = renderPromptHint(eff, led, { resolved, tags: hasTags(parsed.tags) ? parsed.tags : {} })
    return next({
      ...e,
      text: parsed.text || e.text,
      ...(hint ? { context: [...(e.context ?? []), hint] } : {}),
    })
  })

  // Register the numbered items the assistant just produced.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.answer) {
      const items = parseAssistantItems(e.answer)
      if (items.length) await mutateLedger($, l => { registerItems(l, items) })
    }
    return next(e)
  })

  on('command.run', { command: 'response-config' }, async ($, e) => {
    const [sub = 'status', ...rest] = e.args.trim().split(/\s+/)
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
        await $.ui.open({ id: CONFIG_PANE, title: 'Response config', focus: true })
        return { text: 'Config pane opened.' }
      case 'items':
        await $.ui.open({ id: ITEMS_PANE, title: 'Open items', focus: true })
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
  })
}

