import { contextBridge, ipcRenderer } from 'electron'

export type CursorState = {
  botId: string
  name: string
  color: string
  x: number
  y: number
  visible: boolean
  status: 'idle' | 'flying' | 'acting' | 'typing' | 'waiting'
  label?: string
}

export type CurvedApi = {
  getSettings: () => Promise<{ apiKey: string; baseUrl: string; model: string }>
  setSettings: (s: { apiKey: string; baseUrl: string; model: string }) => Promise<boolean>
  getSettingPresets: () => Promise<{
    defaults: { apiKey: string; baseUrl: string; model: string }
    models: Array<{ id: string; label: string }>
  }>
  loadBots: () => Promise<unknown>
  saveBots: (bots: unknown) => Promise<boolean>
  syncCursors: (bots: Array<{ id: string; name: string; color: string }>) => Promise<CursorState[]>
  chatReply: (payload: {
    settings: { apiKey: string; baseUrl: string; model: string }
    botName: string
    botRole: string
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  }) => Promise<string>
  screenshot: () => Promise<{
    dataUrl: string
    width: number
    height: number
    displayWidth: number
    displayHeight: number
    scaleFactor: number
  }>
  runAgent: (req: {
    botId: string
    botName: string
    botRole: string
    botColor: string
    goal: string
    settings: { apiKey: string; baseUrl: string; model: string }
    maxSteps?: number
    autoApprove?: boolean
  }) => Promise<boolean>
  stopAgent: (botId?: string) => Promise<boolean>
  getBusyBots: () => Promise<string[]>
  approveAction: (requestId: string, allowed: boolean) => Promise<boolean>
  onAgentEvent: (cb: (payload: { botId: string; event: unknown }) => void) => () => void
  onCursorState: (cb: (list: CursorState[]) => void) => () => void
  onCursorFly: (
    cb: (payload: {
      botId: string
      from: { x: number; y: number }
      to: { x: number; y: number }
      duration: number
      color: string
      name: string
      status: string
      label?: string
    }) => void,
  ) => () => void
}

const api: CurvedApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  getSettingPresets: () => ipcRenderer.invoke('settings:presets'),
  loadBots: () => ipcRenderer.invoke('bots:load'),
  saveBots: (bots) => ipcRenderer.invoke('bots:save', bots),
  syncCursors: (bots) => ipcRenderer.invoke('bots:sync-cursors', bots),
  chatReply: (payload) => ipcRenderer.invoke('chat:reply', payload),
  screenshot: () => ipcRenderer.invoke('computer:screenshot'),
  runAgent: (req) => ipcRenderer.invoke('agent:run', req),
  stopAgent: (botId) => ipcRenderer.invoke('agent:stop', botId),
  getBusyBots: () => ipcRenderer.invoke('agent:busy'),
  approveAction: (requestId, allowed) => ipcRenderer.invoke('agent:approve', requestId, allowed),
  onAgentEvent: (cb) => {
    const listener = (_: unknown, payload: { botId: string; event: unknown }) => cb(payload)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.removeListener('agent:event', listener)
  },
  onCursorState: (cb) => {
    const listener = (_: unknown, list: CursorState[]) => cb(list)
    ipcRenderer.on('cursors:state', listener)
    return () => ipcRenderer.removeListener('cursors:state', listener)
  },
  onCursorFly: (cb) => {
    const listener = (
      _: unknown,
      payload: {
        botId: string
        from: { x: number; y: number }
        to: { x: number; y: number }
        duration: number
        color: string
        name: string
        status: string
        label?: string
      },
    ) => cb(payload)
    ipcRenderer.on('cursors:fly', listener)
    return () => ipcRenderer.removeListener('cursors:fly', listener)
  },
}

contextBridge.exposeInMainWorld('curved', api)
