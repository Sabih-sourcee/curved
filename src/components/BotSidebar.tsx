import { useState } from 'react'
import { useCurved } from '../store'

export function BotSidebar() {
  const bots = useCurved((s) => s.bots)
  const activeBotId = useCurved((s) => s.activeBotId)
  const setActiveBot = useCurved((s) => s.setActiveBot)
  const addBot = useCurved((s) => s.addBot)
  const removeBot = useCurved((s) => s.removeBot)
  const setSettingsOpen = useCurved((s) => s.setSettingsOpen)
  const busyBotIds = useCurved((s) => s.busyBotIds)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState('')

  return (
    <aside className="sidebar">
      <div className="brand">
        <h1>Curved</h1>
        <span>{typeof window.curved !== 'undefined' ? 'desktop · local PC' : 'browser only · no control'}</span>
      </div>

      <div className="bot-list">
        {bots.map((bot) => (
          <button
            key={bot.id}
            className={`bot-item ${bot.id === activeBotId ? 'active' : ''}`}
            onClick={() => setActiveBot(bot.id)}
            type="button"
          >
            <span className="bot-dot" style={{ background: bot.color }} />
            <span className="bot-meta">
              <strong>
                {bot.name}
                {busyBotIds.includes(bot.id) ? ' · cursor' : ''}
              </strong>
              <small>{bot.role}</small>
            </span>
            <span
              className="bot-remove"
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                removeBot(bot.id)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.stopPropagation()
                  removeBot(bot.id)
                }
              }}
              title="Remove bot"
            >
              ×
            </span>
          </button>
        ))}
      </div>

      <div className="sidebar-actions">
        {creating ? (
          <div className="modal" style={{ width: '100%', padding: 12 }}>
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Pixel" />
            </label>
            <label>
              Role
              <input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Design helper, email triage…"
              />
            </label>
            <div className="modal-actions">
              <button className="btn" type="button" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button
                className="btn primary"
                type="button"
                onClick={() => {
                  addBot(name, role)
                  setName('')
                  setRole('')
                  setCreating(false)
                }}
              >
                Create
              </button>
            </div>
          </div>
        ) : (
          <button className="btn primary" type="button" onClick={() => setCreating(true)}>
            + New bot
          </button>
        )}
        <button className="btn" type="button" onClick={() => setSettingsOpen(true)}>
          Settings
        </button>
      </div>
    </aside>
  )
}
