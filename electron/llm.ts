import type { ComputerAction } from './computer'

export interface LlmSettings {
  apiKey: string
  baseUrl: string
  model: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
}

const SYSTEM_PROMPT = `You are a computer-use agent inside Curved on Windows.
Choose ONE JSON action per turn (no markdown).

Actions:
{"type":"shell","command":"launch:notepad"}
{"type":"hotkey","keys":["meta","r"]}
{"type":"click","x":123,"y":456,"button":"left"|"right"|"double"}
{"type":"type","text":"..."}
{"type":"key","key":"Enter"|"Tab"|"Escape"|"Backspace"|"Delete"|"Up"|"Down"|"Left"|"Right"|"Home"|"End"|"Space"}
{"type":"scroll","x":123,"y":456,"dy":-120}
{"type":"wait","ms":500}
{"type":"ask_user","question":"..."}
{"type":"done","summary":"..."}

Critical rules:
- Coordinates are in the SCREENSHOT pixel space (origin top-left). Screenshot size is given each turn.
- To OPEN an app (Notepad, Calculator, etc.): FIRST use {"type":"shell","command":"launch:<name>"}. Do NOT hunt the taskbar.
- Alternate: hotkey Win+R → type app → Enter.
- NEVER repeat the exact same click coordinates twice. If a click did nothing, change strategy (shell/hotkey/other UI).
- After the goal is clearly achieved (e.g. Notepad window visible), return done.
- Do not click the Curved app chrome. Work on the desktop/other apps.
- No destructive system actions unless explicitly asked.`

function extractJson(text: string): ComputerAction {
  const cleaned = text
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) {
    throw new Error(`Model did not return JSON action: ${cleaned.slice(0, 200)}`)
  }
  let slice = cleaned.slice(start, end + 1)
  // Gemini sometimes emits trailing commas or unquoted keys
  slice = slice
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
  try {
    const parsed = JSON.parse(slice) as ComputerAction
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
      throw new Error('Invalid action payload')
    }
    return parsed
  } catch (err) {
    throw new Error(
      `Bad action JSON (${err instanceof Error ? err.message : String(err)}): ${slice.slice(0, 240)}`,
    )
  }
}

export async function nextAction(opts: {
  settings: LlmSettings
  botName: string
  botRole: string
  goal: string
  history: string[]
  screenshotDataUrl: string
  shotWidth: number
  shotHeight: number
}): Promise<ComputerAction> {
  const { settings } = opts
  if (!settings.apiKey) {
    throw new Error('Missing API key. Open Settings and add one.')
  }

  const base = settings.baseUrl.replace(/\/$/, '')
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${SYSTEM_PROMPT}\n\nYou are the bot named "${opts.botName}". Role: ${opts.botRole || 'general assistant'}.`,
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            `Goal: ${opts.goal}`,
            `Screenshot size: ${opts.shotWidth}x${opts.shotHeight}`,
            opts.history.length
              ? `Recent actions:\n${opts.history.slice(-12).join('\n')}`
              : 'No actions yet.',
            'Choose the next single action as JSON.',
          ].join('\n\n'),
        },
        {
          type: 'image_url',
          image_url: { url: opts.screenshotDataUrl },
        },
      ],
    },
  ]

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(formatLlmError(res.status, body, settings))
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('Empty LLM response')
  return extractJson(content)
}

function formatLlmError(status: number, body: string, settings: LlmSettings) {
  const hint =
    status === 401 || status === 403
      ? ' Check your Google AI Studio API key.'
      : status === 404
        ? ` Model "${settings.model}" may be wrong — try gemini-3.1-flash-lite or gemini-3-flash-preview.`
        : ''
  return `LLM error ${status}: ${body.slice(0, 400)}${hint}`
}

export async function chatReply(opts: {
  settings: LlmSettings
  botName: string
  botRole: string
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
}): Promise<string> {
  const { settings } = opts
  if (!settings.apiKey) {
    throw new Error('Missing API key. Open Settings and add one.')
  }
  const base = settings.baseUrl.replace(/\/$/, '')
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.5,
      messages: [
        {
          role: 'system',
          content: `You are ${opts.botName} in Curved, a multi-bot desktop teammate. Role: ${opts.botRole || 'helpful assistant'}. Be concise. If the user asks you to do something on their computer, tell them to use Agent mode (or they can prefix with /agent).`,
        },
        ...opts.messages,
      ],
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(formatLlmError(res.status, body, settings))
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return data.choices?.[0]?.message?.content?.trim() || '(no reply)'
}
