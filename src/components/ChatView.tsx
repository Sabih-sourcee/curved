import { useEffect, useMemo, useRef, useState } from 'react'
import { useCurved } from '../store'

export function ChatView() {
  const bots = useCurved((s) => s.bots)
  const activeBotId = useCurved((s) => s.activeBotId)
  const settings = useCurved((s) => s.settings)
  const appendMessage = useCurved((s) => s.appendMessage)
  const busyBotIds = useCurved((s) => s.busyBotIds)
  const autoApprove = useCurved((s) => s.autoApprove)
  const setAutoApprove = useCurved((s) => s.setAutoApprove)
  const liveScreenshot = useCurved((s) => s.liveScreenshot)
  const liveScreenshotBotId = useCurved((s) => s.liveScreenshotBotId)

  const bot = useMemo(() => bots.find((b) => b.id === activeBotId) ?? null, [bots, activeBotId])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [bot?.messages.length, liveScreenshot])

  if (!bot) {
    return <div className="empty">Create a bot to get started.</div>
  }

  const busy = busyBotIds.includes(bot.id)
  const previewBot = bots.find((b) => b.id === liveScreenshotBotId)

  async function send() {
    const content = text.trim()
    if (!content || !bot || sending) return
    setText('')
    appendMessage(bot.id, { role: 'user', content, kind: 'chat' })

    const isAgent = content.toLowerCase().startsWith('/agent')
    const goal = isAgent ? content.replace(/^\/agent\s*/i, '').trim() || content : content

    if (isAgent) {
      if (!window.curved) {
        appendMessage(bot.id, {
          role: 'assistant',
          content:
            'This tab is not the Curved desktop app (window.curved missing). Close the browser tab and use the Electron window from `npm run dev` — look for a window titled Curved, not localhost in Chrome/Edge.',
          kind: 'status',
        })
        return
      }
      appendMessage(bot.id, {
        role: 'assistant',
        content: `Spawning ${bot.name}'s cursor for: ${goal}`,
        kind: 'status',
      })
      await window.curved.runAgent({
        botId: bot.id,
        botName: bot.name,
        botRole: bot.role,
        botColor: bot.color,
        goal,
        settings,
        autoApprove,
        maxSteps: 20,
      })
      return
    }

    setSending(true)
    try {
      if (!window.curved) {
        appendMessage(bot.id, {
          role: 'assistant',
          content: 'Renderer-only mode — open via Electron to chat with the model.',
          kind: 'chat',
        })
        return
      }
      const history = [...bot.messages, { role: 'user' as const, content }]
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-16)
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
      const reply = await window.curved.chatReply({
        settings,
        botName: bot.name,
        botRole: bot.role,
        messages: history,
      })
      appendMessage(bot.id, { role: 'assistant', content: reply, kind: 'chat' })
    } catch (err) {
      appendMessage(bot.id, {
        role: 'assistant',
        content: err instanceof Error ? err.message : String(err),
        kind: 'status',
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="chat-shell">
      <div className="topbar">
        <div>
          <h2 style={{ color: bot.color }}>{bot.name}</h2>
          <p>
            {bot.role}
            {busyBotIds.length > 1 ? ` · ${busyBotIds.length} cursors active` : ''}
          </p>
        </div>
        <div className="topbar-actions">
          <label className="toggle">
            <input
              type="checkbox"
              checked={autoApprove}
              onChange={(e) => setAutoApprove(e.target.checked)}
            />
            Auto-approve actions
          </label>
          {busy && (
            <button
              className="btn danger"
              type="button"
              onClick={() => window.curved?.stopAgent(bot.id)}
            >
              Stop cursor
            </button>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: liveScreenshot ? '1fr 320px' : '1fr',
          minHeight: 0,
        }}
      >
        <div className="chat">
          {bot.messages.map((m) => (
            <div
              key={m.id}
              className={`bubble ${m.role} ${m.kind === 'status' || m.kind === 'agent' ? m.kind : ''}`}
            >
              {m.content}
            </div>
          ))}
          <div ref={endRef} />
        </div>
        {liveScreenshot && (
          <aside className="preview">
            <header>Live · {previewBot?.name ?? 'cursor'}</header>
            <img src={liveScreenshot} alt="Live desktop capture" />
          </aside>
        )}
      </div>

      <div className="composer">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Message ${bot.name}…  (/agent to send this bot's cursor)`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          disabled={busy || sending}
        />
        <div className="composer-actions">
          <button
            className="btn primary"
            type="button"
            disabled={busy || sending || !text.trim()}
            onClick={() => void send()}
          >
            Send
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy || sending || !text.trim()}
            onClick={() => {
              if (!text.trim().toLowerCase().startsWith('/agent')) {
                setText(`/agent ${text.trim()}`)
              } else {
                void send()
              }
            }}
          >
            Cursor
          </button>
        </div>
      </div>
    </div>
  )
}
