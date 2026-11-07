import { desktopCapturer, screen } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const execFileAsync = promisify(execFile)

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

export interface ScreenshotResult {
  dataUrl: string
  width: number
  height: number
  /** Physical pixel size used by SetCursorPos / overlay */
  displayWidth: number
  displayHeight: number
  scaleFactor: number
  dipWidth: number
  dipHeight: number
}

function powershell(script: string) {
  return execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, maxBuffer: 20 * 1024 * 1024 },
  )
}

/** Physical desktop size — SetCursorPos is in physical pixels. */
export function getPhysicalDisplay() {
  const primary = screen.getPrimaryDisplay()
  const scaleFactor = primary.scaleFactor || 1
  const dipWidth = primary.size.width
  const dipHeight = primary.size.height
  const displayWidth = Math.round(dipWidth * scaleFactor)
  const displayHeight = Math.round(dipHeight * scaleFactor)
  return { dipWidth, dipHeight, displayWidth, displayHeight, scaleFactor, bounds: primary.bounds }
}

export async function captureScreen(): Promise<ScreenshotResult> {
  const { dipWidth, dipHeight, displayWidth, displayHeight, scaleFactor } = getPhysicalDisplay()

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: displayWidth, height: displayHeight },
  })

  const source = sources[0]
  if (!source) throw new Error('No screen source available')

  const image = source.thumbnail
  const size = image.getSize()

  return {
    dataUrl: image.toDataURL(),
    width: size.width,
    height: size.height,
    displayWidth,
    displayHeight,
    scaleFactor,
    dipWidth,
    dipHeight,
  }
}

/** Map screenshot-pixel coords → physical screen coords for mouse/overlay. */
export function mapToDisplay(
  x: number,
  y: number,
  shot: Pick<ScreenshotResult, 'width' | 'height' | 'displayWidth' | 'displayHeight'>,
) {
  const mappedX = Math.round((x / Math.max(1, shot.width)) * shot.displayWidth)
  const mappedY = Math.round((y / Math.max(1, shot.height)) * shot.displayHeight)
  return {
    x: Math.max(0, Math.min(shot.displayWidth - 1, mappedX)),
    y: Math.max(0, Math.min(shot.displayHeight - 1, mappedY)),
  }
}

function sendKeysChord(keys: string[]) {
  const map: Record<string, string> = {
    meta: '^{ESC}', // fallback; Win chords handled separately
    win: '^{ESC}',
    ctrl: '^',
    control: '^',
    alt: '%',
    shift: '+',
    enter: '{ENTER}',
    tab: '{TAB}',
    escape: '{ESC}',
    esc: '{ESC}',
    r: 'r',
  }
  const lower = keys.map((k) => k.toLowerCase())
  // Win+R via Shell.Application is more reliable than SendKeys
  if (
    lower.length === 2 &&
    (lower[0] === 'meta' || lower[0] === 'win') &&
    lower[1] === 'r'
  ) {
    return powershell(`
$shell = New-Object -ComObject Shell.Application
$shell.FileRun()
`)
  }
  if (lower.length === 1 && (lower[0] === 'meta' || lower[0] === 'win')) {
    return powershell(`
Add-Type @"
using System; using System.Runtime.InteropServices;
public class CurvedKey {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public const byte VK_LWIN = 0x5B; public const uint KEYUP = 0x0002;
}
"@
[CurvedKey]::keybd_event([CurvedKey]::VK_LWIN, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 40
[CurvedKey]::keybd_event([CurvedKey]::VK_LWIN, 0, [CurvedKey]::KEYUP, [UIntPtr]::Zero)
`)
  }

  let prefix = ''
  let main = ''
  for (const k of lower) {
    if (k === 'ctrl' || k === 'control' || k === 'alt' || k === 'shift') {
      prefix += map[k]
    } else {
      main += map[k] ?? k
    }
  }
  return powershell(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${(prefix + main).replace(/'/g, "''")}')
`)
}

function sanitizeLaunchTarget(raw: string): string | null {
  const cleaned = raw.replace(/^["']|["']$/g, '').trim()
  // Allow simple app names / exe paths without shell metacharacters
  if (!/^[a-zA-Z0-9._\-\\/: ]+$/.test(cleaned)) return null
  if (cleaned.length > 120) return null
  return cleaned
}

export async function launchApp(target: string) {
  const safe = sanitizeLaunchTarget(target)
  if (!safe) return { ok: false as const, error: 'Unsafe launch target' }
  // Map common aliases
  const aliases: Record<string, string> = {
    notepad: 'notepad.exe',
    calc: 'calc.exe',
    calculator: 'calc.exe',
    paint: 'mspaint.exe',
    cmd: 'cmd.exe',
    terminal: 'wt.exe',
    explorer: 'explorer.exe',
  }
  const exe = aliases[safe.toLowerCase()] ?? safe
  await powershell(`Start-Process -FilePath '${exe.replace(/'/g, "''")}'`)
  return { ok: true as const, detail: `launched ${exe}` }
}

export async function performAction(
  action: ComputerAction,
  shot?: Pick<ScreenshotResult, 'width' | 'height' | 'displayWidth' | 'displayHeight'>,
): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  try {
    switch (action.type) {
      case 'click': {
        if (!shot) return { ok: false, error: 'Missing screenshot metrics for click' }
        const { x, y } = mapToDisplay(action.x, action.y, shot)
        const button = action.button ?? 'left'
        const flags =
          button === 'right'
            ? { down: 0x0008, up: 0x0010 }
            : { down: 0x0002, up: 0x0004 }
        const clicks = button === 'double' ? 2 : 1
        await powershell(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CurvedMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
[CurvedMouse]::SetCursorPos(${x}, ${y})
for ($i = 0; $i -lt ${clicks}; $i++) {
  [CurvedMouse]::mouse_event(${flags.down}, 0, 0, 0, [UIntPtr]::Zero)
  [CurvedMouse]::mouse_event(${flags.up}, 0, 0, 0, [UIntPtr]::Zero)
  if ($i -lt ${clicks - 1}) { Start-Sleep -Milliseconds 60 }
}
`)
        return { ok: true, detail: `${button === 'double' ? 'double-' : button === 'right' ? 'right-' : ''}clicked ${x},${y}` }
      }
      case 'type': {
        const tmp = path.join(os.tmpdir(), `curved-type-${Date.now()}.txt`)
        fs.writeFileSync(tmp, action.text, 'utf8')
        await powershell(`
Add-Type -AssemblyName System.Windows.Forms
$t = Get-Content -Raw -Encoding UTF8 '${tmp.replace(/'/g, "''")}'
[System.Windows.Forms.SendKeys]::SendWait(($t -replace '([+\\^%~(){}\\[\\]])', '{$1}'))
Remove-Item -Force '${tmp.replace(/'/g, "''")}'
`)
        return { ok: true, detail: `typed ${action.text.length} chars` }
      }
      case 'key': {
        const map: Record<string, string> = {
          Enter: '{ENTER}',
          Tab: '{TAB}',
          Escape: '{ESC}',
          Backspace: '{BACKSPACE}',
          Delete: '{DELETE}',
          Up: '{UP}',
          Down: '{DOWN}',
          Left: '{LEFT}',
          Right: '{RIGHT}',
          Home: '{HOME}',
          End: '{END}',
          Space: ' ',
        }
        const send = map[action.key] ?? action.key
        await powershell(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${send.replace(/'/g, "''")}')
`)
        return { ok: true, detail: `pressed ${action.key}` }
      }
      case 'hotkey': {
        await sendKeysChord(action.keys)
        return { ok: true, detail: `hotkey ${action.keys.join('+')}` }
      }
      case 'shell': {
        // Prefer structured launch: "launch:notepad" or raw Start-Process only
        if (action.command.toLowerCase().startsWith('launch:')) {
          return launchApp(action.command.slice('launch:'.length).trim())
        }
        const m = action.command.match(/^Start-Process\s+(.+)$/i)
        if (m) return launchApp(m[1].trim())
        return { ok: false, error: 'Only launch:<app> or Start-Process <app> allowed' }
      }
      case 'scroll': {
        if (!shot) return { ok: false, error: 'Missing screenshot metrics for scroll' }
        const { x, y } = mapToDisplay(action.x, action.y, shot)
        const wheel = Math.round(action.dy)
        await powershell(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CurvedScroll {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  public const uint WHEEL = 0x0800;
}
"@
[CurvedScroll]::SetCursorPos(${x}, ${y})
[CurvedScroll]::mouse_event([CurvedScroll]::WHEEL, 0, 0, [uint]${wheel < 0 ? 0xffffffff - Math.abs(wheel) + 1 : wheel}, [UIntPtr]::Zero)
`)
        return { ok: true, detail: `scrolled ${wheel} at ${x},${y}` }
      }
      case 'wait': {
        await new Promise((r) => setTimeout(r, Math.min(10000, Math.max(0, action.ms))))
        return { ok: true, detail: `waited ${action.ms}ms` }
      }
      case 'done':
        return { ok: true, detail: action.summary }
      case 'ask_user':
        return { ok: true, detail: action.question }
      default:
        return { ok: false, error: 'Unknown action' }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
