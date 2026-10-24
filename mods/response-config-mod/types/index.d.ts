export type ModItem = {
  id: string
  type: 'A' | 'S' | 'Q' | 'D'
  n: number
  text: string
  status: 'open' | 'in-progress' | 'done' | 'skipped' | 'answered'
  answer?: string
  turn: number
}

export type ModLedger = {
  agent: string
  sessionId: string
  counters: { A: number; S: number; Q: number; D: number }
  items: ModItem[]
  renumbered: { from: string; to: string }[]
  session: { overrides: Record<string, unknown>; rulesSentAt: number }
  turn: number
  updatedAt: number
}

// The merged response-config JSON (see skills/response-config/config.schema.json).
export type ModConfig = Record<string, any>

declare module 'claude-code' {
  interface PluginState {
    'response-config-mod': {
      config: Shaped<ModConfig | null>
      ledger: Shaped<ModLedger | null>
      style: string
      target: 'user' | 'project'
    }
  }
}
