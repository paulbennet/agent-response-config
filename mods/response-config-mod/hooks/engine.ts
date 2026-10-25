// Thin bridge between the mod and the bundled engine (../engine, a copy of the skill's scripts).
// Disk work goes through the config CLI via $.process; pure logic is imported directly.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { ModConfig, ModLedger } from '../types'
// @ts-ignore bundled plain-JS module without declarations
import { emptyLedger } from '../engine/lib/core.mjs'

// The engine reads state statically: each file that reads or writes an atom declares it itself.
const configAtom = atom({ plugin: 'response-config-mod', key: 'config' } as const, null, { shape: 'config-1' })
const ledgerAtom = atom({ plugin: 'response-config-mod', key: 'ledger' } as const, null, { shape: 'ledger-1' })
const styleAtom = atom({ plugin: 'response-config-mod', key: 'style' } as const, 'off')
const targetAtom = atom({ plugin: 'response-config-mod', key: 'target' } as const, 'user')

export type Dollar = EngineInterface

type Watched = { path: string; mtimeMs: number | null }

// Config files the last refresh read, with their mtimes. Module state: a reload starts it over,
// and session.start refreshes again anyway.
let watched: Watched[] = []
let markedAt = 0
const MARK_EVERY_MS = 3600 * 1000

// The slash command's name. The response-config plugin's skill takes /response-config when both
// are installed, and the engine refuses a taken name, so the mod falls back to the next one.
export const COMMANDS = ['response-config', 'response-config-mod'] as const
let command: string = COMMANDS[0]
export const commandName = () => command

// A refused name is the expected case with the plugin installed, so it is logged only when
// every name is refused.
export async function registerCommand($: Dollar): Promise<string | null> {
  const errors: string[] = []
  for (const name of COMMANDS) {
    try {
      await $.command.register({
        name,
        description: 'Configure terse, structured, level-controlled replies',
        argumentHint: '[on|off|verbose|terse|reset|wizard|pane|items|style sync|activate|status]',
      })
      command = name
      return name
    } catch (err) {
      errors.push(`/${name}: ${String(err).slice(0, 200)}`)
    }
  }
  $.ui.log(`no slash command registered. ${errors.join(' ')}`)
  return null
}

export async function cli($: Dollar, args: string[]) {
  const cwd = await $.session.root()
  return $.process.run(['node', `${$.plugin.root}/engine/config.mjs`, ...args], { cwd })
}

// Reload the merged config (and style state) from disk into the atoms.
export async function refresh($: Dollar): Promise<ModConfig | null> {
  const r = await cli($, ['--show', '--json'])
  if (r.exitCode !== 0) {
    $.ui.log(`config read failed: ${r.stderr.slice(0, 200)}`)
    return null
  }
  const data = JSON.parse(r.stdout)
  watched = Array.isArray(data.watch) ? data.watch : []
  await update($, configAtom, () => data.config)
  await update($, styleAtom, () => data.style as string)
  if (data.problems?.length) $.ui.toast(`response-config: ${data.problems[0]}`)
  return data.config as ModConfig
}

async function mtime($: Dollar, file: string): Promise<number | null> {
  try {
    // A missing file counts as null. exists() first, so a missing file never relies on a rejection.
    return (await $.fs.exists(file)) ? (await $.fs.stat(file)).mtimeMs : null
  } catch {
    return null
  }
}

// Reload when a config file changed on disk since the last refresh, for example after the agent
// ran `config.mjs --set` in a shell. A stat per file; no process unless something changed.
export async function refreshIfChanged($: Dollar): Promise<boolean> {
  for (const w of watched) {
    if ((await mtime($, w.path)) !== w.mtimeMs) {
      await refresh($)
      return true
    }
  }
  return false
}

// Tell the classic hooks to stand down for this session. The marker expires after a day, so it
// is rewritten at most once an hour while the session is in use.
export async function markActive($: Dollar, force = false) {
  const now = await $.clock.now()
  if (!force && now - markedAt < MARK_EVERY_MS) return
  markedAt = now
  await cli($, ['--mod-active', await $.session.id()])
}

// Persist key=value pairs through the CLI (it validates and syncs the managed style), then reload.
export async function save($: Dollar, pairs: string[]): Promise<boolean> {
  const target = await read($, targetAtom)
  const args = pairs.flatMap(p => ['--set', p])
  if (target === 'project') args.push('--project')
  const r = await cli($, args)
  if (r.exitCode !== 0) {
    $.ui.toast(`Not saved: ${(r.stderr || r.stdout).split('\n')[0]}`)
    return false
  }
  await refresh($)
  const warn = /WARNING: (.*)/.exec(r.stdout)
  if (warn?.[1]) $.ui.toast(warn[1].slice(0, 160))
  return true
}

export async function ensureLedger($: Dollar): Promise<ModLedger> {
  const id = await $.session.id()
  const next = await update($, ledgerAtom, l => l ?? (emptyLedger('claude', id) as ModLedger))
  return next as ModLedger
}

export async function mutateLedger($: Dollar, fn: (l: ModLedger) => void) {
  const id = await $.session.id()
  await update($, ledgerAtom, current => {
    const copy: ModLedger = JSON.parse(JSON.stringify(current ?? emptyLedger('claude', id)))
    fn(copy)
    return copy
  })
}
