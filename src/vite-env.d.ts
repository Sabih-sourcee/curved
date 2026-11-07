/// <reference types="vite/client" />

import type { CurvedApi } from '../electron/preload'

declare global {
  interface Window {
    curved: CurvedApi
  }
}

export {}
