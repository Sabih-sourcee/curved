import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Load project .env into process.env (no dependency). Does not overwrite existing env. */
export function loadProjectEnv() {
  const candidates = [
    path.join(__dirname, '../.env'),
    path.join(process.cwd(), '.env'),
  ]
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!(key in process.env) || process.env[key] === '') {
        process.env[key] = value
      }
    }
    break
  }
}

export function apiKeyFromEnv(): string {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    process.env.CURVED_API_KEY ||
    ''
  ).trim()
}
