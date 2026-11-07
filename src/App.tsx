import { useEffect } from 'react'
import { BotSidebar } from './components/BotSidebar'
import { ChatView } from './components/ChatView'
import { SettingsModal } from './components/SettingsModal'
import { ApprovalCard } from './components/ApprovalCard'
import { useCurved } from './store'
import type { AgentEvent } from './types'

export default function App() {
  const hydrate = useCurved((s) => s.hydrate)
  const hydrated = useCurved((s) => s.hydrated)
  const handleAgentEvent = useCurved((s) => s.handleAgentEvent)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    if (!window.curved) return
    return window.curved.onAgentEvent(({ botId, event }) => {
      handleAgentEvent(botId, event as AgentEvent)
    })
  }, [handleAgentEvent])

  if (!hydrated) {
    return <div className="empty">Loading Curved…</div>
  }

  const desktop = typeof window.curved !== 'undefined'

  return (
    <div className="app">
      <BotSidebar />
      <main className="main" style={{ display: 'block', minWidth: 0, minHeight: 0 }}>
        {!desktop && (
          <div
            style={{
              margin: '12px 16px 0',
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid rgba(251,113,133,0.45)',
              background: 'rgba(251,113,133,0.1)',
              color: '#fecdd3',
              fontSize: '0.9rem',
            }}
          >
            You are in a browser tab — computer control will not work. Close this tab and use the
            <strong> Curved desktop window</strong> opened by <code>npm run dev</code> (title bar says
            Curved, not Chrome/Edge).
          </div>
        )}
        <ChatView />
      </main>
      <SettingsModal />
      <ApprovalCard />
    </div>
  )
}
