import { expect, test } from 'claude-code/testing'

// Merged config as `config.mjs --show --json` reports it (defaults).
const CONFIG = {
  enabled: true,
  minimal: { on: true, level: 'high', maxWords: 80, preserve: ['code', 'commands', 'tables', 'errors', 'paths', 'diffs'] },
  structured: { on: true, sections: ['actions', 'suggestions', 'questions', 'decisions'], showEmptySections: false, replyHint: true, statusEmoji: true },
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

const USER_FILE = '/home/u/.config/response-config/config.json'
// The engine may hand paths over in the platform's own spelling.
const isUserFile = (p: string) => p.split('\\').join('/').endsWith('.config/response-config/config.json')

// Everything beneath the mod: the engine's answers to the calls the mod makes.
// `disk` stands for the user config file: its content and mtime.
function engine(on: any, seen: { submitted?: any; runs?: string[][]; taken?: string[] }, disk = { config: CONFIG, mtimeMs: 1 }) {
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.root', () => ({ value: '/proj' }))
  on('store.get', () => ({ value: true })) // wizard already done
  on('command.register', (_: unknown, e: any) => {
    if (seen.taken?.includes(e.name)) throw new Error(`"/${e.name}" refused: it is the plugin's /${e.name}:${e.name}`)
    return { value: { command: e.name } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: 1_000 }))
  on('fs.exists', (_: unknown, e: any) => ({ value: isUserFile(e.path) }))
  on('fs.stat', (_: unknown, e: any) => {
    return { value: { kind: 'file', size: 10, mtimeMs: disk.mtimeMs, isLink: false } }
  })
  on('process.run', (_: unknown, e: any) => {
    ;(seen.runs ??= []).push(e.argv)
    return ok(e.argv.includes('--show')
      ? JSON.stringify({
        config: disk.config, sources: ['defaults', 'user'], problems: [], style: 'off',
        watch: [{ path: USER_FILE, mtimeMs: disk.mtimeMs }, { path: '/proj/.response-config.json', mtimeMs: null }],
      })
      : 'marked')
  })
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
  await $.turn.complete(turn('Done.\n\nActions\n- A1 Run tests\nQuestions\n- Q1 Keep flag? (yes/no)'))
  await $.prompt.submit({ text: 'Q1: yes', wait: false, origin: { kind: 'composer' } })
  const hint = String(seen.submitted.context?.[0])
  expect(hint).toMatch(/User answered Q1/)
  expect(hint).toMatch(/Open: A1/)
  expect(hint).toMatch(/Next IDs: A2 S1 Q2 D1/)
})

test('the items pane groups open items by type with reply buttons, on terminal and desktop', async ($, on) => {
  engine(on, {})
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: false })
  await $.turn.complete(turn('Actions\n- A1 Run `npm test`\nDecisions\n- D1 Format (a) JSON (b) text'))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...ITEMS, surface })
    expect(await ui.find({ type: 'Text', text: 'ACTIONS' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'DECISIONS' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /Run npm test/ }))?.text).toBe('Run npm test')
    expect(await ui.find({ key: 'D1-ans' })).toBeDefined()
    expect(await ui.find({ key: 'A1-done' })).toBeDefined()
    expect(await ui.find({ key: 'D1-a' })).toBeDefined()
    await ui.unmount()
  }
})

test('items pane design: hotkeys on the focused terminal item, labelled options on desktop', async ($, on) => {
  engine(on, {})
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: false })
  await $.turn.complete(turn('Actions\n- A1 Run tests\n- A2 Lint\nQuestions\n- Q1 Ship it? (yes/no)\nDecisions\n- D1 License: (a) MIT (b) Apache-2.0'))
  const term = await $.ui.mount({ ...ITEMS, surface: 'terminal' })
  expect((await term.find({ key: 'A1-done' }))?.props.hotkey).toBe('d') // the first item holds the focus
  expect((await term.find({ key: 'A2-done' }))?.props.hotkey).toBeUndefined()
  expect((await term.find({ type: 'Text', text: 'Ship it?' }))?.text).toBe('Ship it?') // "(yes/no)" left to the buttons
  await term.unmount()
  const desk = await $.ui.mount({ ...ITEMS, surface: 'desktop' })
  expect((await desk.find({ key: 'D1-a' }))?.props.label).toBe('a · MIT')
  expect((await desk.find({ key: 'D1-b' }))?.props.label).toBe('b · Apache-2.0')
  expect((await desk.find({ type: 'Text', text: 'License' }))?.text).toBe('License')
  await desk.unmount()
})

test('a config file changed on disk mid-session reaches the next prompt (review 0.1.1 N5)', async ($, on) => {
  const seen: { submitted?: any; runs?: string[][] } = {}
  const disk = { config: CONFIG, mtimeMs: 1 }
  engine(on, seen, disk)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: false })
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  expect(String(seen.submitted.context?.[0])).toMatch(/brevity high/)
  const shows = () => (seen.runs ?? []).filter(a => a.includes('--show')).length
  const before = shows()
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  expect(shows()).toBe(before) // nothing changed: no reload
  disk.config = { ...CONFIG, minimal: { ...CONFIG.minimal, level: 'low' } }
  disk.mtimeMs = 2
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  expect(shows()).toBe(before + 1)
  expect(String(seen.submitted.context?.[0])).toMatch(/brevity low/)
})

test('a reused ID keeps the displayed ID and the hint says so (review 0.1.1 N1)', async ($, on) => {
  const seen: { submitted?: any } = {}
  engine(on, seen)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: false })
  await $.turn.complete(turn('Actions\n- A1 Run tests'))
  await $.prompt.submit({ text: 'done A1', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete(turn('Actions\n- A1 Deploy staging\n- A3 Tag release'))
  await $.prompt.submit({ text: 'done A3', wait: false, origin: { kind: 'composer' } })
  const hint = String(seen.submitted.context?.[0])
  expect(hint).toMatch(/reused A1 for a new item/)
  expect(hint).toMatch(/User finished A3: Tag release/)
  expect(hint).toMatch(/Open: A1/)
})

test('/response-config taken by the plugin skill: the mod serves /response-config-mod and still starts (live H8)', async ($, on) => {
  const seen: { submitted?: any; taken?: string[] } = { taken: ['response-config'] }
  engine(on, seen)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: false })
  const { text } = await $.command.run({ command: 'response-config-mod', args: '' })
  expect(text).toMatch(/^response-config: /)
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  expect(String(seen.submitted.context?.[0])).toMatch(/\[response-config\]/)
})
