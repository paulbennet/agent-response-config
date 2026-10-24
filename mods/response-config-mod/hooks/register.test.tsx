import { expect, test } from 'claude-code/testing'

// Merged config as `config.mjs --show --json` reports it (defaults).
const CONFIG = {
  enabled: true,
  minimal: { on: true, level: 'high', maxWords: 80, preserve: ['code', 'commands', 'tables', 'errors', 'paths', 'diffs'] },
  structured: { on: true, sections: ['actions', 'suggestions', 'questions', 'decisions'], showEmptySections: false, replyHint: true },
  language: { on: false, cefr: 'B2', readability: null, vocabulary: null, plainLanguage: false },
  hooks: { sessionStart: true, eachPrompt: true, ledger: true },
  overrides: { inlineTags: true },
  claude: { outputStyle: { manage: false, scope: 'user', activate: false } },
}

const ITEMS = {
  plugin: 'response-config-mod',
  component: 'Pane',
  requestId: 'rc-items',
  props: {
    title: 'Open items',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const ok = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

// Everything beneath the mod: the engine's answers to the calls the mod makes.
function engine(on: any, seen: { submitted?: any }) {
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.root', () => ({ value: '/proj' }))
  on('store.get', () => ({ value: true })) // wizard already done
  on('command.register', () => ({ value: { command: 'response-config' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_: unknown, e: any) =>
    ok(e.argv.includes('--show') ? JSON.stringify({ config: CONFIG, sources: ['defaults'], problems: [], style: 'off' }) : 'marked'),
  )
  on('prompt.submit', (_: unknown, e: any) => {
    seen.submitted = e
    return { text: e.text, context: e.context }
  })
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
}

const turn = (answer: string, reason: 'answer' | 'aborted' = 'answer') => ({
  answer, durationMs: 1, isAborted: reason === 'aborted', turnId: `t-${Math.random()}`, reason,
})

test('a prompt without tags passes through untouched, indentation included', async ($, on) => {
  const seen: { submitted?: any } = {}
  engine(on, seen)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: false })
  const code = 'fix this:\n    if (x) {\n        y()\n    }'
  await $.prompt.submit({ text: code, wait: false, origin: { kind: 'composer' } })
  expect(seen.submitted.text).toBe(code)
  expect(String(seen.submitted.context?.[0])).toMatch(/\[response-config\]/)
})

test('a tag is removed from the prompt and named in the hint', async ($, on) => {
  const seen: { submitted?: any } = {}
  engine(on, seen)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: false })
  await $.prompt.submit({ text: 'explain the build !verbose', wait: false, origin: { kind: 'composer' } })
  expect(seen.submitted.text).toBe('explain the build ')
  expect(String(seen.submitted.context?.[0])).toMatch(/Tags this turn only: !verbose/)
})

test('finished turns register items; interrupted ones do not; a quick reply resolves one', async ($, on) => {
  const seen: { submitted?: any } = {}
  engine(on, seen)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: false })
  await $.turn.complete(turn('- A1 half written', 'aborted'))
  await $.turn.complete(turn('Done.\n- A1 Run tests\n- Q1 Keep flag? (yes/no)'))
  await $.prompt.submit({ text: 'Q1: yes', wait: false, origin: { kind: 'composer' } })
  const hint = String(seen.submitted.context?.[0])
  expect(hint).toMatch(/User answered Q1/)
  expect(hint).toMatch(/Open: A1/)
  expect(hint).toMatch(/Next IDs: A2 S1 Q2 D1/)
})

test('the items pane lists open items with reply buttons, on terminal and desktop', async ($, on) => {
  engine(on, {})
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: false })
  await $.turn.complete(turn('- A1 Run tests\n- D1 Format (a) JSON (b) text'))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...ITEMS, surface })
    expect((await ui.find({ type: 'Text', text: /A1: Run tests/ }))?.text).toBe('A1: Run tests')
    expect(await ui.find({ key: 'A1-done' })).toBeDefined()
    expect(await ui.find({ key: 'D1-a' })).toBeDefined()
    await ui.unmount()
  }
})
