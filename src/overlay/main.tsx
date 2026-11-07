import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

type CursorStatus = 'idle' | 'flying' | 'acting' | 'typing' | 'waiting'

interface CursorState {
  botId: string
  name: string
  color: string
  x: number
  y: number
  visible: boolean
  status: CursorStatus
  label?: string
}

interface Flight {
  botId: string
  from: { x: number; y: number }
  to: { x: number; y: number }
  duration: number
  startedAt: number
}

function OverlayApp() {
  const [cursors, setCursors] = useState<CursorState[]>([])
  const [flights, setFlights] = useState<Record<string, Flight>>({})
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!window.curved?.onCursorState) return
    const offState = window.curved.onCursorState((list) => setCursors(list))
    const offFly = window.curved.onCursorFly?.((payload) => {
      setFlights((prev) => ({
        ...prev,
        [payload.botId]: {
          botId: payload.botId,
          from: payload.from,
          to: payload.to,
          duration: payload.duration,
          startedAt: performance.now(),
        },
      }))
    })
    return () => {
      offState()
      offFly?.()
    }
  }, [])

  useEffect(() => {
    let raf = 0
    const loop = () => {
      setTick((t) => t + 1)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const now = performance.now()

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      {cursors
        .filter((c) => c.visible)
        .map((c) => {
          const flight = flights[c.botId]
          let x = c.x
          let y = c.y
          let scale = 1
          if (flight) {
            const t = Math.min(1, (now - flight.startedAt) / flight.duration)
            const ease = 1 - Math.pow(1 - t, 3)
            const midX = (flight.from.x + flight.to.x) / 2
            const midY = Math.min(flight.from.y, flight.to.y) - 80
            const omt = 1 - ease
            x = omt * omt * flight.from.x + 2 * omt * ease * midX + ease * ease * flight.to.x
            y = omt * omt * flight.from.y + 2 * omt * ease * midY + ease * ease * flight.to.y
            scale = 1 + Math.sin(ease * Math.PI) * 0.35
            if (t >= 1 && flights[c.botId]) {
              // clear finished flight next paint
              queueMicrotask(() => {
                setFlights((prev) => {
                  if (!prev[c.botId]) return prev
                  const next = { ...prev }
                  delete next[c.botId]
                  return next
                })
              })
            }
          }

          return (
            <div
              key={c.botId}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                transform: `translate(-20%, -10%) scale(${scale})`,
                transition: flight ? undefined : 'left 80ms linear, top 80ms linear',
                filter: `drop-shadow(0 0 10px ${c.color}) drop-shadow(0 8px 18px rgba(0,0,0,0.35))`,
                zIndex: c.status === 'acting' ? 20 : 10,
              }}
            >
              <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden>
                <path
                  d="M8 4 L36 22 L20 24 L16 38 Z"
                  fill={c.color}
                  stroke="rgba(0,0,0,0.35)"
                  strokeWidth="1.5"
                />
              </svg>
              <div
                style={{
                  marginTop: -6,
                  marginLeft: 18,
                  padding: '3px 8px',
                  borderRadius: 999,
                  background: 'rgba(10,12,16,0.82)',
                  border: `1px solid ${c.color}`,
                  color: '#fff',
                  fontFamily: 'Segoe UI, sans-serif',
                  fontSize: 11,
                  whiteSpace: 'nowrap',
                  maxWidth: 220,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                <strong style={{ color: c.color }}>{c.name}</strong>
                {c.label ? ` · ${c.label}` : c.status !== 'idle' ? ` · ${c.status}` : ''}
              </div>
            </div>
          )
        })}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OverlayApp />
  </StrictMode>,
)
