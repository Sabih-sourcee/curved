import { BrowserWindow } from 'electron'
import {
  captureScreen,
  launchApp,
  performAction,
  mapToDisplay,
  type ComputerAction,
  type ScreenshotResult,
} from './computer'
import { nextAction, type LlmSettings } from './llm'
import {
  ensureOverlay,
  flyCursor,
  hideCursor,
  hideOverlayForCapture,
  setCursorStatus,
  showCursor,
  showOverlayAfterCapture,
  withInputLock,
} from './cursors'

export interface AgentRunRequest {
  botId: string
  botName: string
  botRole: string
  botColor: string
  goal: string
  settings: LlmSettings
  maxSteps?: number
  autoApprove?: boolean
}

export type AgentEvent =
  | { kind: 'status'; text: string }
  | { kind: 'screenshot'; dataUrl: string; width: number; height: number }
  | { kind: 'action'; action: ComputerAction }
  | { kind: 'approval'; action: ComputerAction; requestId: string }
  | { kind: 'step_result'; detail: string; ok: boolean }
  | { kind: 'done'; summary: string }
  | { kind: 'error'; message: string }
  | { kind: 'cursor'; x: number; y: number; status: string }

type PendingApproval = {
  resolve: (allowed: boolean) => void
}

const pending = new Map<string, PendingApproval>()
const activeRuns = new Map<string, { abort: boolean }>()

export function resolveApproval(requestId: string, allowed: boolean) {
  const p = pending.get(requestId)
  if (!p) return false
  pending.delete(requestId)
  p.resolve(allowed)
  return true
}

export function stopAgent(botId?: string) {
  if (botId) {
    const run = activeRuns.get(botId)
    if (run) run.abort = true
    return
  }
  for (const run of activeRuns.values()) run.abort = true
}

export function getBusyBotIds() {
  return [...activeRuns.keys()]
}

function emit(win: BrowserWindow | null, botId: string, event: AgentEvent) {
  win?.webContents.send('agent:event', { botId, event })
}

async function waitForApproval(
  win: BrowserWindow | null,
  botId: string,
  action: ComputerAction,
): Promise<boolean> {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  emit(win, botId, { kind: 'approval', action, requestId })
  setCursorStatus(botId, 'waiting', 'needs approval')
  return new Promise((resolve) => {
    pending.set(requestId, { resolve })
  })
}

function actionPoint(
  action: ComputerAction,
  shot: ScreenshotResult,
): { x: number; y: number } | null {
  if (action.type === 'click' || action.type === 'scroll') {
    return mapToDisplay(action.x, action.y, shot)
  }
  return null
}

function actionFingerprint(action: ComputerAction): string {
  return JSON.stringify(action)
}

function parseOpenTarget(goal: string): string | null {
  const m = goal.match(/^(?:please\s+)?open\s+(.+?)(?:\s+please)?$/i)
  if (!m) return null
  return m[1].replace(/[.!]+$/, '').trim()
}

async function captureCleanScreen(win: BrowserWindow | null): Promise<ScreenshotResult> {
  const wasOverlay = hideOverlayForCapture()
  const wasMinimized = win?.isMinimized() ?? false
  if (win && !wasMinimized) win.minimize()
  await new Promise((r) => setTimeout(r, 120))
  try {
    return await captureScreen()
  } finally {
    showOverlayAfterCapture(wasOverlay)
    void wasMinimized
  }
}

export async function runAgent(win: BrowserWindow | null, req: AgentRunRequest) {
  if (activeRuns.has(req.botId)) {
    emit(win, req.botId, { kind: 'error', message: 'This bot is already running.' })
    return
  }

  ensureOverlay(process.env.VITE_DEV_SERVER_URL)
  showCursor(req.botId, {
    name: req.botName,
    color: req.botColor,
    status: 'idle',
    label: 'starting',
  })

  activeRuns.set(req.botId, { abort: false })
  const history: string[] = []
  const maxSteps = req.maxSteps ?? 20
  let lastShot: ScreenshotResult | null = null
  let lastFingerprint = ''
  let repeatStreak = 0
  const openTarget = parseOpenTarget(req.goal)

  try {
    emit(win, req.botId, { kind: 'status', text: `Cursor online — starting on your PC…` })

    if (openTarget) {
      const launchAction: ComputerAction = {
        type: 'shell',
        command: `launch:${openTarget}`,
      }
      emit(win, req.botId, { kind: 'action', action: launchAction })
      if (!req.autoApprove) {
        const allowed = await waitForApproval(win, req.botId, launchAction)
        if (!allowed) {
          emit(win, req.botId, { kind: 'done', summary: 'Action denied. Agent stopped.' })
          return
        }
      }
      const launched = await withInputLock(async () => {
        setCursorStatus(req.botId, 'acting', `launch ${openTarget}`)
        return launchApp(openTarget)
      })
      emit(win, req.botId, {
        kind: 'step_result',
        ok: launched.ok,
        detail: launched.ok ? launched.detail : launched.error,
      })
      if (launched.ok) {
        await new Promise((r) => setTimeout(r, 600))
        emit(win, req.botId, {
          kind: 'done',
          summary: `Opened ${openTarget} via system launch (not taskbar clicking).`,
        })
        return
      }
      history.push(`shell launch failed: ${launched.error} — falling back to vision agent`)
    }

    for (let step = 0; step < maxSteps; step++) {
      const run = activeRuns.get(req.botId)
      if (!run || run.abort) {
        emit(win, req.botId, { kind: 'done', summary: 'Stopped by user.' })
        break
      }

      emit(win, req.botId, { kind: 'status', text: `Step ${step + 1}/${maxSteps}: capturing screen…` })
      setCursorStatus(req.botId, 'idle', 'looking')
      lastShot = await captureCleanScreen(win)
      emit(win, req.botId, {
        kind: 'screenshot',
        dataUrl: lastShot.dataUrl,
        width: lastShot.width,
        height: lastShot.height,
      })

      emit(win, req.botId, { kind: 'status', text: `Step ${step + 1}/${maxSteps}: thinking…` })
      setCursorStatus(req.botId, 'idle', 'thinking')

      if (repeatStreak >= 2) {
        history.push(
          'SYSTEM: You repeated the same action. Do NOT click those coordinates again. Use shell launch: or hotkey meta+r, or pick a different visible control.',
        )
      }

      let action: ComputerAction = await nextAction({
        settings: req.settings,
        botName: req.botName,
        botRole: req.botRole,
        goal: req.goal,
        history,
        screenshotDataUrl: lastShot.dataUrl,
        shotWidth: lastShot.width,
        shotHeight: lastShot.height,
      })

      const fp = actionFingerprint(action)
      if (fp === lastFingerprint) repeatStreak += 1
      else {
        repeatStreak = 1
        lastFingerprint = fp
      }

      if (repeatStreak >= 3 && action.type === 'click') {
        if (openTarget) {
          const forced: ComputerAction = { type: 'shell', command: `launch:${openTarget}` }
          emit(win, req.botId, {
            kind: 'status',
            text: 'Breaking click loop — launching app directly…',
          })
          action = forced
          repeatStreak = 0
        } else {
          emit(win, req.botId, {
            kind: 'done',
            summary:
              'Stopped: same click repeated 3 times (likely bad coords/strategy). Try a clearer goal or enable Auto-approve and re-run.',
          })
          break
        }
      }

      emit(win, req.botId, { kind: 'action', action })

      if (action.type === 'done') {
        emit(win, req.botId, { kind: 'done', summary: action.summary })
        break
      }
      if (action.type === 'ask_user') {
        emit(win, req.botId, { kind: 'done', summary: `Needs you: ${action.question}` })
        break
      }

      if (!req.autoApprove) {
        const allowed = await waitForApproval(win, req.botId, action)
        if (!allowed) {
          emit(win, req.botId, { kind: 'done', summary: 'Action denied. Agent stopped.' })
          break
        }
      }

      const point = actionPoint(action, lastShot)
      if (point) {
        emit(win, req.botId, { kind: 'cursor', x: point.x, y: point.y, status: 'flying' })
        await flyCursor(req.botId, point.x, point.y, {
          status: 'flying',
          label: action.type,
          durationMs: 320,
        })
      }

      const result = await withInputLock(async () => {
        setCursorStatus(
          req.botId,
          action.type === 'type' ? 'typing' : 'acting',
          action.type,
        )
        if (point) {
          await flyCursor(req.botId, point.x, point.y, {
            status: action.type === 'type' ? 'typing' : 'acting',
            label: action.type,
            durationMs: 60,
          })
        }
        return performAction(action, lastShot!)
      })

      history.push(`${action.type}: ${result.ok ? result.detail : result.error}`)
      emit(win, req.botId, {
        kind: 'step_result',
        ok: result.ok,
        detail: result.ok ? result.detail : result.error,
      })

      if (!result.ok) {
        emit(win, req.botId, { kind: 'error', message: result.error })
        break
      }

      if (step === maxSteps - 1) {
        emit(win, req.botId, { kind: 'done', summary: 'Reached max steps without finishing.' })
      }
    }
  } catch (err) {
    emit(win, req.botId, {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  } finally {
    activeRuns.delete(req.botId)
    hideCursor(req.botId)
    if (win && !win.isDestroyed()) {
      win.restore()
      win.focus()
    }
  }
}
