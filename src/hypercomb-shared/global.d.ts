// hypercomb-shared/global.d.ts

// -------------------------------------------------
// window.ioc container
// -------------------------------------------------

interface Window {
  ioc: {
    register<T>(signature: string, value: T): void
    get<T = unknown>(key: string): T | undefined
    has(key: string): boolean
    list(): readonly string[]
    onRegister(cb: (key: string, value: unknown) => void): () => void
    whenReady<T = unknown>(key: string, callback: (value: T) => void): void
    graph(): Record<string, { deps: string[]; listens: string[]; emits: string[] }>
  }
}

// -------------------------------------------------
// global convenience functions
// -------------------------------------------------

declare function get<T = unknown>(key: string): T | undefined
declare function register<T>(signature: string, value: T): void
declare function has(key: string): boolean
declare function list(): readonly string[]
