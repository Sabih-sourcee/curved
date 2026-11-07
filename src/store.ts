import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type { Bot, LlmSettings, Message, AgentEvent, ComputerAction } from './types'

const COLORS = ['#5eead4', '#93c5fd', '#f9a8d4', '#fcd34d', '#c4b5fd', '#86efac', '#fdba74']

function defaultBots(): Bot[] {
  return [
    {
      id: uuid(),
      name: 'Atlas',
      role: 'General computer operator — opens apps, navigates UI, gets things done.',
      color: COLORS[0],
      messages: [
        {
          id: uuid(),
          role: 'assistant',
          content:
            "Hey — I'm Atlas. Chat normally, or `/agent …` and my on-screen cursor will drive your PC. Run other bots at the same time — each has its own cursor.",
          createdAt: Date.now(),
          kind: 'chat',
        },
      ],
      createdAt: Date.now(),
    },
    {
      id: uuid(),
      name: 'Nova',
      role: 'Research and writing specialist.',
      color: COLORS[1],
      messages: [
        {
          id: uuid(),
          role: 'assistant',
          content:
            'Nova here. I have my own colored cursor. Start me with `/agent` while Atlas works — both cursors stay on screen.',
          createdAt: Date.now(),
          kind: 'chat',
        },
      ],
      createdAt: Date.now(),
    },
  ]
}

interface ApprovalState {
  botId: string
  requestId: string
  action: ComputerAction
}

interface CurvedState {
  bots: Bot[]
  activeBotId: string | null
  settings: LlmSettings
  settingsOpen: boolean
  busyBotIds: string[]
  liveScreenshot: string | null
  liveScreenshotBotId: string | null
  approvals: ApprovalState[]
  autoApprove: boolean
  hydrated: boolean
  hydrate: () => Promise<void>
  setActiveBot: (id: string) => void
  addBot: (name: string, role: string) => void
  removeBot: (id: string) => void
  appendMessage: (botId: string, message: Omit<Message, 'id' | 'createdAt'> & { id?: string }) => void
  setSettings: (s: LlmSettings) => Promise<void>
  setSettingsOpen: (open: boolean) => void
  setAutoApprove: (v: boolean) => void
  handleAgentEvent: (botId: string, event: AgentEvent) => void
  dismissApproval: (requestId: string) => void
}

async function persist(bots: Bot[]) {
  try {
    await window.curved?.saveBots(bots)
    await window.curved?.syncCursors(bots.map((b) => ({ id: b.id, name: b.name, color: b.color })))
  } catch {
    /* ignore while not in electron */
  }
}

export const useCurved = create<CurvedState>((set, get) => ({
  bots: [],
  activeBotId: null,
  settings: {
    apiKey: '',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.1-flash-lite',
  },
  settingsOpen: false,
  busyBotIds: [],
  liveScreenshot: null,
  liveScreenshotBotId: null,
  approvals: [],
  autoApprove: false,
  hydrated: false,

  hydrate: async () => {
    if (!window.curved) {
      const bots = defaultBots()
      set({ bots, activeBotId: bots[0].id, hydrated: true })
      return
    }
    const [settings, saved] = await Promise.all([
      window.curved.getSettings(),
      window.curved.loadBots(),
    ])
    const bots = (saved as Bot[] | null)?.length ? (saved as Bot[]) : defaultBots()
    set({
      settings,
      bots,
      activeBotId: bots[0]?.id ?? null,
      hydrated: true,
    })
    if (!(saved as Bot[] | null)?.length) await persist(bots)
    else {
      await window.curved.syncCursors(bots.map((b) => ({ id: b.id, name: b.name, color: b.color })))
    }
  },

  setActiveBot: (id) => set({ activeBotId: id }),

  addBot: (name, role) => {
    const bots = get().bots
    const bot: Bot = {
      id: uuid(),
      name: name.trim() || `Bot ${bots.length + 1}`,
      role: role.trim() || 'General assistant',
      color: COLORS[bots.length % COLORS.length],
      messages: [
        {
          id: uuid(),
          role: 'assistant',
          content: `I'm ${name.trim() || 'a new bot'}. I get my own on-screen cursor — use /agent to put me to work.`,
          createdAt: Date.now(),
          kind: 'chat',
        },
      ],
      createdAt: Date.now(),
    }
    const next = [...bots, bot]
    set({ bots: next, activeBotId: bot.id })
    void persist(next)
  },

  removeBot: (id) => {
    const next = get().bots.filter((b) => b.id !== id)
    const activeBotId = get().activeBotId === id ? next[0]?.id ?? null : get().activeBotId
    set({ bots: next, activeBotId })
    void persist(next)
  },

  appendMessage: (botId, message) => {
    const next = get().bots.map((b) => {
      if (b.id !== botId) return b
      return {
        ...b,
        messages: [
          ...b.messages,
          {
            id: message.id ?? uuid(),
            createdAt: Date.now(),
            role: message.role,
            content: message.content,
            kind: message.kind ?? 'chat',
          },
        ],
      }
    })
    set({ bots: next })
    void persist(next)
  },

  setSettings: async (s) => {
    set({ settings: s })
    await window.curved?.setSettings(s)
  },

  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setAutoApprove: (v) => set({ autoApprove: v }),
  dismissApproval: (requestId) =>
    set({ approvals: get().approvals.filter((a) => a.requestId !== requestId) }),

  handleAgentEvent: (botId, event) => {
    const append = (content: string, kind: Message['kind'] = 'status') => {
      get().appendMessage(botId, { role: 'assistant', content, kind })
    }
    const markBusy = () => {
      if (!get().busyBotIds.includes(botId)) {
        set({ busyBotIds: [...get().busyBotIds, botId] })
      }
    }
    const markIdle = () => {
      set({
        busyBotIds: get().busyBotIds.filter((id) => id !== botId),
        approvals: get().approvals.filter((a) => a.botId !== botId),
        liveScreenshotBotId:
          get().liveScreenshotBotId === botId ? null : get().liveScreenshotBotId,
        liveScreenshot: get().liveScreenshotBotId === botId ? null : get().liveScreenshot,
      })
    }

    switch (event.kind) {
      case 'status':
        append(event.text, 'status')
        markBusy()
        break
      case 'screenshot':
        set({ liveScreenshot: event.dataUrl, liveScreenshotBotId: botId })
        markBusy()
        break
      case 'action':
        append(`→ ${event.action.type}: ${JSON.stringify(event.action)}`, 'agent')
        break
      case 'cursor':
        append(`cursor → ${Math.round(event.x)},${Math.round(event.y)} (${event.status})`, 'agent')
        break
      case 'approval':
        set({
          approvals: [
            ...get().approvals.filter((a) => a.requestId !== event.requestId),
            { botId, requestId: event.requestId, action: event.action },
          ],
        })
        markBusy()
        append(`Waiting for approval: ${event.action.type}`, 'status')
        break
      case 'step_result':
        append(event.ok ? `✓ ${event.detail}` : `✗ ${event.detail}`, 'agent')
        break
      case 'done':
        append(event.summary, 'chat')
        markIdle()
        break
      case 'error':
        append(`Error: ${event.message}`, 'status')
        markIdle()
        break
    }
  },
}))
