// First-run / on-demand setup wizard built on $.ui.ask dialogs (works on every surface).
import { cli, refresh, save } from './engine'
import type { Dollar } from './engine'

const LEVELS = ['low', 'medium', 'high', 'extreme']
const CEFR = ['A1', 'A2', 'B1', 'B2']

async function ask($: Dollar, question: string, options: string[], header: string) {
  try {
    return await $.ui.ask(question, { options, header })
  } catch {
    return undefined // dismissed
  }
}

export async function runWizard($: Dollar): Promise<boolean> {
  const brevity = await ask(
    $,
    'Hello! How chatty should your agent be?',
    ['Terse (high)', 'Very terse (extreme)', 'Balanced (medium)', 'Keep it chatty'],
    'Brevity',
  )
  if (brevity === undefined) return false
  const pairs: string[] = []
  if (brevity.startsWith('Keep')) pairs.push('minimal.on=false')
  else {
    const level = brevity.startsWith('Very') ? 'extreme' : brevity.startsWith('Balanced') ? 'medium' : 'high'
    pairs.push('minimal.on=true', `minimal.level=${level}`)
  }

  const structured = await ask(
    $,
    'Number the follow-ups (A1 actions, S1 suggestions, Q1 questions, D1 decisions) so you can reply "Q1: yes"?',
    ['Yes, number them', 'No thanks'],
    'Structure',
  )
  if (structured === undefined) return false
  pairs.push(`structured.on=${structured.startsWith('Yes')}`)

  const language = await ask(
    $,
    'Simplify the English? Pick a writing level, or leave it natural.',
    ['Natural', 'A2 (very simple)', 'B1 (simple)', 'B2 (clear)'],
    'Language',
  )
  if (language === undefined) return false
  if (language === 'Natural') pairs.push('language.on=false')
  else {
    const cefr = CEFR.find(c => language.startsWith(c)) ?? 'B2'
    pairs.push('language.on=true', `language.cefr=${cefr}`)
  }

  const style = await ask(
    $,
    'Also keep a generated Claude output style in sync with these settings?',
    ['Yes, for me (user)', 'Yes, for this project', 'No'],
    'Output style',
  )
  if (style === undefined) return false
  if (style.startsWith('Yes')) {
    pairs.push('claude.outputStyle.manage=true', `claude.outputStyle.scope=${style.includes('project') ? 'project' : 'user'}`)
  }

  const ok = await save($, pairs)
  if (!ok) return false
  if (style.startsWith('Yes')) {
    const res = await cli($, ['--style', 'sync'])
    $.ui.log(res.stdout.trim())
  }
  await refresh($)
  $.ui.toast('All set. /response-config opens the panel any time.')
  return true
}

// Shown once per session until answered: set up now, later, or never.
// Two dismissals without an answer count as "never", so it stops interrupting.
export async function firstRun($: Dollar) {
  const pick = await ask($, 'response-config is installed. Set up your reply style now?', ['Set up now', 'Later', 'Never ask'], 'Setup')
  if (pick === 'Never ask') {
    await $.store.set('wizardDone', true)
    return
  }
  if (pick === undefined) {
    const dismissed = Number((await $.store.get('wizardDismissed')) ?? 0) + 1
    await $.store.set('wizardDismissed', dismissed)
    if (dismissed >= 2) await $.store.set('wizardDone', true)
    return
  }
  if (pick === 'Later') return
  if (await runWizard($)) await $.store.set('wizardDone', true)
}

export { LEVELS }
