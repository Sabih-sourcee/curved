export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
  kind?: 'chat' | 'agent' | 'status'
}

export interface Bot {
  id: string
  name: string
  role: string
  color: string
  messages: Message[]
  createdAt: number
}

export interface LlmSettings {
  apiKey: string
  baseUrl: string
  model: string
}

export type ComputerAction =
  | { type: 'click'; x: number; y: number; button?: 'left' | 'right' | 'double' }
  | { type: 'type'; text: string }
  | { type: 'key'; key: string }
  | { type: 'hotkey'; keys: string[] }
  | { type: 'scroll'; x: number; y: number; dy: number; dx?: number }
  | { type: 'shell'; command: string }
  | { type: 'wait'; ms: number }
  | { type: 'done'; summary: string }
  | { type: 'ask_user'; question: string }

export type AgentEvent =
  | { kind: 'status'; text: string }
  | { kind: 'screenshot'; dataUrl: string; width: number; height: number }
  | { kind: 'action'; action: ComputerAction }
  | { kind: 'approval'; action: ComputerAction; requestId: string }
  | { kind: 'step_result'; detail: string; ok: boolean }
  | { kind: 'done'; summary: string }
  | { kind: 'error'; message: string }
  | { kind: 'cursor'; x: number; y: number; status: string }
