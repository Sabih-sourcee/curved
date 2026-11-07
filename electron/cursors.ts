import { BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export type CursorStatus = 'idle' | 'flying' | 'acting' | 'typing' | 'waiting'

export interface CursorState {
  botId: string
  name: string
  color: string
  x: number
  y: number
  visible: boolean
  status: CursorStatus
  label?: string
}

let overlay: BrowserWindow | null = null
const cursors = new Map<string, CursorState>()
let inputChain: Promise<unknown> = Promise.resolve()

export function withInputLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = inputChain.then(fn, fn)
  inputChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function broadcast() {
  const list = [...cursors.values()]
  overlay?.webContents.send('cursors:state', list)
}

export function getOverlayWindow() {
  return overlay
}

export function ensureOverlay(devServerUrl?: string) {
  if (overlay && !overlay.isDestroyed()) {
    overlay.showInactive()
    return overlay
  }

  const display = screen.getPrimaryDisplay()
  const { x, y, width, height } = display.bounds

  overlay = new BrowserWindow({
    x,
    y,
    width,
    height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition: 'persist:curved-overlay',
    },
  })

  overlay.setIgnoreMouseEvents(true, { forward: true })
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  try {
    overlay.setContentProtection(true)
  } catch {
    /* older electron */
  }

  const url = devServerUrl
    ? `${devServerUrl.replace(/\/$/, '')}/overlay.html`
    : path.join(__dirname, '../dist/overlay.html')

  if (devServerUrl) {
    void overlay.loadURL(url)
  } else {
    void overlay.loadFile(url)
  }

  overlay.once('ready-to-show', () => {
    overlay?.showInactive()
    broadcast()
  })

  overlay.on('closed', () => {
    overlay = null
  })

  return overlay
}

export function hideOverlayForCapture() {
  if (overlay && !overlay.isDestroyed() && overlay.isVisible()) {
    overlay.hide()
    return true
  }
  return false
}

export function showOverlayAfterCapture(wasVisible: boolean) {
  if (wasVisible && overlay && !overlay.isDestroyed()) {
    overlay.showInactive()
  }
}

export function syncBotCursors(
  bots: Array<{ id: string; name: string; color: string }>,
  opts?: { showIdle?: boolean },
) {
  const keep = new Set(bots.map((b) => b.id))
  for (const id of [...cursors.keys()]) {
    if (!keep.has(id)) cursors.delete(id)
  }

  const display = screen.getPrimaryDisplay()
  const w = display.bounds.width
  const h = display.bounds.height

  bots.forEach((bot, i) => {
    const existing = cursors.get(bot.id)
    if (existing) {
      existing.name = bot.name
      existing.color = bot.color
    } else {
      const angle = (i / Math.max(bots.length, 1)) * Math.PI * 2
      cursors.set(bot.id, {
        botId: bot.id,
        name: bot.name,
        color: bot.color,
        x: Math.round(w * 0.5 + Math.cos(angle) * 120),
        y: Math.round(h * 0.5 + Math.sin(angle) * 80),
        visible: Boolean(opts?.showIdle),
        status: 'idle',
      })
    }
  })

  broadcast()
}

export function showCursor(botId: string, patch?: Partial<CursorState>) {
  const display = screen.getPrimaryDisplay()
  const existing = cursors.get(botId)
  if (!existing) {
    cursors.set(botId, {
      botId,
      name: patch?.name ?? 'Bot',
      color: patch?.color ?? '#5eead4',
      x: patch?.x ?? Math.round(display.bounds.width / 2),
      y: patch?.y ?? Math.round(display.bounds.height / 2),
      visible: true,
      status: patch?.status ?? 'idle',
      label: patch?.label,
    })
  } else {
    Object.assign(existing, patch, { visible: true })
  }
  broadcast()
}

export function hideCursor(botId: string) {
  const c = cursors.get(botId)
  if (!c) return
  c.visible = false
  c.status = 'idle'
  c.label = undefined
  broadcast()
}

export function setCursorStatus(botId: string, status: CursorStatus, label?: string) {
  const c = cursors.get(botId)
  if (!c) return
  c.status = status
  c.label = label
  c.visible = true
  broadcast()
}

export async function flyCursor(
  botId: string,
  toX: number,
  toY: number,
  opts?: { status?: CursorStatus; label?: string; durationMs?: number },
) {
  const c = cursors.get(botId)
  if (!c) return

  c.visible = true
  c.status = opts?.status ?? 'flying'
  c.label = opts?.label
  const duration = opts?.durationMs ?? 420

  overlay?.webContents.send('cursors:fly', {
    botId,
    from: { x: c.x, y: c.y },
    to: { x: toX, y: toY },
    duration,
    color: c.color,
    name: c.name,
    status: c.status,
    label: c.label,
  })

  c.x = toX
  c.y = toY
  broadcast()

  await new Promise((r) => setTimeout(r, duration))
}

export function listCursors() {
  return [...cursors.values()]
}
