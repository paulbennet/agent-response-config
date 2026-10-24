// Per-agent stdin normalisation and stdout shaping.
import fs from 'node:fs';

const pick = (o, ...keys) => keys.map((k) => o?.[k]).find((v) => v !== undefined && v !== null);

function common(input) {
  return {
    sessionId: pick(input, 'session_id', 'sessionId') ?? 'unknown',
    cwd: pick(input, 'cwd') ?? process.cwd(),
    source: pick(input, 'source'),
    prompt: pick(input, 'prompt') ?? '',
  };
}

// --- Copilot: read the tail of a transcript file for the last assistant text (best effort) ---

function textOf(v) {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((b) => (typeof b === 'string' ? b : (b?.text ?? ''))).join('\n');
  return '';
}

export function lastAssistantText(jsonl) {
  const lines = String(jsonl).split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let o;
    try {
      o = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const role = String(o.role ?? o.message?.role ?? o.type ?? '');
    if (!/assistant/i.test(role)) continue;
    const t = textOf(o.content) || textOf(o.message?.content) || textOf(o.text) || textOf(o.data?.content);
    if (t.trim()) return t;
  }
  return '';
}

function readTail(file, bytes = 262144) {
  try {
    const fd = fs.openSync(file, 'r');
    const { size } = fs.fstatSync(fd);
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch {
    return '';
  }
}

const CONTEXT_EVENT = { 'session-start': 'SessionStart', prompt: 'UserPromptSubmit' };
const claudeStyle = (event, hint) =>
  hint
    ? JSON.stringify({ hookSpecificOutput: { hookEventName: CONTEXT_EVENT[event], additionalContext: hint } })
    : '';

export const adapters = {
  claude: {
    parse: (event, input) => ({ ...common(input), lastAssistantMessage: pick(input, 'last_assistant_message') ?? '' }),
    format: (event, { hint }) => (event === 'stop' ? '' : claudeStyle(event, hint)),
  },
  codex: {
    parse: (event, input) => ({ ...common(input), lastAssistantMessage: pick(input, 'last_assistant_message') ?? '' }),
    // Codex Stop hooks must print JSON on exit 0.
    format: (event, { hint }) => (event === 'stop' ? '{}' : claudeStyle(event, hint)),
  },
  copilot: {
    parse: (event, input) => {
      const base = common(input);
      const transcript = pick(input, 'transcriptPath', 'transcript_path');
      const fromTranscript = event === 'stop' && transcript ? lastAssistantText(readTail(transcript)) : '';
      return {
        ...base,
        transformedPrompt: pick(input, 'transformedPrompt') ?? base.prompt,
        lastAssistantMessage: pick(input, 'last_assistant_message') ?? fromTranscript,
        // VS Code compatible payloads use PascalCase names and Claude-style output.
        compat: typeof input?.hook_event_name === 'string',
      };
    },
    format: (event, { hint, normalized }) => {
      if (event === 'stop' || !hint) return '';
      if (normalized.compat) return claudeStyle(event === 'prompt-transformed' ? 'prompt' : event, hint);
      if (event === 'session-start') return JSON.stringify({ additionalContext: hint });
      if (event === 'prompt-transformed') {
        return JSON.stringify({ modifiedTransformedPrompt: `${normalized.transformedPrompt}\n\n${hint}` });
      }
      return '';
    },
  },
};
