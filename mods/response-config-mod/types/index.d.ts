export type ModItem = {
  id: string
  type: 'A' | 'S' | 'Q' | 'D'
  n: number
  text: string
  status: 'open' | 'in-progress' | 'done' | 'skipped' | 'answered' | 'superseded'
  answer?: string
  turn: number
}

export type ModLedger = {
  agent: string
  sessionId: string
  counters: { A: number; S: number; Q: number; D: number }
  items: ModItem[]
  reused: { id: string; text: string }[]
  session: { overrides: Record<string, unknown>; rulesSentAt: number; rulesTurn: number }
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
      // The open item whose button holds the items pane's focus ring ('' when none).
      focus: string
      // Open item IDs picked in the items pane for one bulk reply.
      selected: string[]
    }
  }
}
