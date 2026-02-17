// src/global.d.ts

// -------------------------------------------------
// global window extensions
// -------------------------------------------------

interface Window {
  ioc: {
    register<T>(signature: string, value: T, name?: string): void
    get<T = unknown>(key: string): T | undefined
    has(key: string): boolean
    list(): readonly string[]
  }
}

