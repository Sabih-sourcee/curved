import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chatReply, type LlmSettings } from './llm'
import { runAgent, resolveApproval, stopAgent, getBusyBotIds } from './agent'
import { captureScreen } from './computer'
import { ensureOverlay, listCursors, syncBotCursors } from './cursors'
import { DEFAULT_SETTINGS } from './defaults'
import { apiKeyFromEnv, loadProjectEnv } from './env'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

loadProjectEnv()

// Isolate Chromium caches so overlay + main + prior crashes don't fight (Access is denied 0x5)
const userData = path.join(app.getPath('appData'), 'Curved')
app.setPath('userData', userData)
app.setPath('sessionData', path.join(userData, 'Session'))
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
app.commandLine.appendSwitch('disk-cache-dir', path.join(userData, 'Cache'))

// In packaged builds, keep a single instance. In Vite/Electron dev, skipping the
// lock avoids: second `npm run dev` → Electron quits → plugin taskkill →
// "ERROR: The process … not found" and the whole Vite process dying.
const isDevRuntime = !app.isPackaged
const gotLock = isDevRuntime ? true : app.requestSingleInstanceLock()
if (!gotLock) {
  app.exit(0)
}

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(__dirname, '../public')

let win: BrowserWindow | null = null

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json')
const botsPath = () => path.join(app.getPath('userData'), 'bots.json')

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

function resolveSettings(): LlmSettings {
  const saved = readJson<Partial<LlmSettings>>(settingsPath(), {})
  const envKey = apiKeyFromEnv()
  const envBase = (process.env.CURVED_BASE_URL || '').trim()
  const envModel = (process.env.CURVED_MODEL || '').trim()
  const merged: LlmSettings = {
    ...DEFAULT_SETTINGS,
    ...saved,
    apiKey: (saved.apiKey && saved.apiKey.trim()) || envKey || '',
  }

  // Migrate leftover OpenRouter defaults to Gemini AI Studio
  if (
    !saved.baseUrl ||
    saved.baseUrl.includes('openrouter.ai') ||
    saved.model?.includes('openai/gpt')
  ) {
    if (!saved.baseUrl || saved.baseUrl.includes('openrouter.ai')) {
      merged.baseUrl = envBase || DEFAULT_SETTINGS.baseUrl
    }
    if (!saved.model || saved.model.includes('openai/gpt')) {
      merged.model = envModel || DEFAULT_SETTINGS.model
    }
  }
  if (envBase && (!saved.baseUrl || saved.baseUrl.includes('openrouter.ai'))) {
    merged.baseUrl = envBase
  }
  if (envModel && (!saved.model || saved.model.includes('openai/gpt'))) {
    merged.model = envModel
  }

  return merged
}

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.cjs')
  if (!fs.existsSync(preloadPath)) {
    console.error('[curved] Missing preload at', preloadPath)
  }

  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'Curved',
    backgroundColor: '#0b0d10',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition: 'persist:curved-main',
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(process.env.DIST!, 'index.html'))
  }

  win.webContents.on('preload-error', (_event, pPath, error) => {
    console.error('[curved] preload-error', pPath, error)
  })

  win.webContents.on('did-finish-load', () => {
    win?.show()
    win?.focus()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('closed', () => {
    win = null
  })
}

if (gotLock) {
  app.whenReady().then(() => {
    createWindow()
    ensureOverlay(process.env.VITE_DEV_SERVER_URL)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })

    app.on('second-instance', () => {
      if (win) {
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

ipcMain.handle('settings:get', () => resolveSettings())

ipcMain.handle('settings:set', (_e, settings: LlmSettings) => {
  writeJson(settingsPath(), settings)
  return true
})

ipcMain.handle('settings:presets', () => ({
  defaults: DEFAULT_SETTINGS,
  models: [
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
  ],
}))

ipcMain.handle('bots:load', () => {
  return readJson(botsPath(), null)
})

ipcMain.handle('bots:save', (_e, bots: unknown) => {
  writeJson(botsPath(), bots)
  const list = Array.isArray(bots)
    ? (bots as Array<{ id: string; name: string; color: string }>)
    : []
  syncBotCursors(
    list.map((b) => ({ id: b.id, name: b.name, color: b.color })),
    { showIdle: false },
  )
  return true
})

ipcMain.handle('bots:sync-cursors', (_e, bots: Array<{ id: string; name: string; color: string }>) => {
  ensureOverlay(process.env.VITE_DEV_SERVER_URL)
  syncBotCursors(bots, { showIdle: false })
  return listCursors()
})

ipcMain.handle('chat:reply', async (_e, payload) => {
  return chatReply(payload)
})

ipcMain.handle('computer:screenshot', async () => {
  return captureScreen()
})

ipcMain.handle('agent:run', async (_e, req) => {
  ensureOverlay(process.env.VITE_DEV_SERVER_URL)
  void runAgent(win, req)
  return true
})

ipcMain.handle('agent:stop', (_e, botId?: string) => {
  stopAgent(botId)
  return true
})

ipcMain.handle('agent:busy', () => getBusyBotIds())

ipcMain.handle('agent:approve', (_e, requestId: string, allowed: boolean) => {
  return resolveApproval(requestId, allowed)
})

ipcMain.handle('cursors:list', () => listCursors())
