import { useEffect, useState } from 'react'
import { useCurved } from '../store'

const FALLBACK_MODELS = [
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
]

export function SettingsModal() {
  const open = useCurved((s) => s.settingsOpen)
  const settings = useCurved((s) => s.settings)
  const setSettings = useCurved((s) => s.setSettings)
  const setSettingsOpen = useCurved((s) => s.setSettingsOpen)
  const [draft, setDraft] = useState(settings)
  const [models, setModels] = useState(FALLBACK_MODELS)

  useEffect(() => {
    if (open) setDraft(settings)
  }, [open, settings])

  useEffect(() => {
    if (!open || !window.curved?.getSettingPresets) return
    void window.curved.getSettingPresets().then((p) => {
      if (p.models?.length) setModels(p.models)
    })
  }, [open])

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Settings</h3>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>
          Uses Google AI Studio. Paste an API key from{' '}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--accent)' }}
          >
            aistudio.google.com/apikey
          </a>
          . Default model is Gemini 3.1 Flash-Lite (vision).
        </p>
        <label>
          AI Studio API key
          <input
            type="password"
            value={draft.apiKey}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
            placeholder="AIza…"
          />
        </label>
        <label>
          Base URL
          <input
            value={draft.baseUrl}
            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            placeholder="https://generativelanguage.googleapis.com/v1beta/openai"
          />
        </label>
        <label>
          Model
          <select
            value={models.some((m) => m.id === draft.model) ? draft.model : '__custom__'}
            onChange={(e) => {
              if (e.target.value === '__custom__') return
              setDraft({ ...draft, model: e.target.value })
            }}
            style={{
              borderRadius: 10,
              border: '1px solid var(--line)',
              background: 'var(--bg)',
              color: 'var(--text)',
              padding: '10px 12px',
            }}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            {!models.some((m) => m.id === draft.model) && (
              <option value="__custom__">Custom: {draft.model}</option>
            )}
          </select>
        </label>
        <label>
          Custom model id (optional)
          <input
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            placeholder="gemini-3.1-flash-lite"
          />
        </label>
        <div className="modal-actions">
          <button className="btn" type="button" onClick={() => setSettingsOpen(false)}>
            Cancel
          </button>
          <button
            className="btn primary"
            type="button"
            onClick={async () => {
              await setSettings(draft)
              setSettingsOpen(false)
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
