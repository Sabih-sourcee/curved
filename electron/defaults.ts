import type { LlmSettings } from './llm'

/** Google AI Studio OpenAI-compatible endpoint + Gemini 3.1 Flash. */
export const DEFAULT_SETTINGS: LlmSettings = {
  apiKey: '',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  model: 'gemini-3.1-flash-lite',
}

export const MODEL_PRESETS = [
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite (recommended)' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
] as const
