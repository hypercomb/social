// hypercomb-runtime/src/globals.d.ts
//
// THE AMBIENT SHELL CONTRACT. `ioc.web` installs `window.ioc` and the bare
// `get`/`register` globals, and every module in this package uses them at
// module scope — which is why import ORDER matters and why `ioc.web` is the
// first thing any host loads.
//
// Declared here rather than imported from hypercomb-shared: these are globals,
// not exports, and a published package cannot reach into a monorepo folder for
// its own type environment. Kept byte-identical in shape to
// hypercomb-shared/global.d.ts — if the two ever disagree, this one is the
// contract the runtime actually compiles against.

interface Window {
  ioc: {
    register<T>(signature: string, value: T): void
    unregister(key: string): void
    get<T = unknown>(key: string): T | undefined
    has(key: string): boolean
    list(): readonly string[]
    onRegister(cb: (key: string, value: unknown) => void): () => void
    whenReady<T = unknown>(key: string, callback: (value: T) => void): void
    graph(): Record<string, { deps: string[]; listens: string[]; emits: string[] }>
  }
}

declare function get<T = unknown>(key: string): T | undefined
declare function register<T>(signature: string, value: T): void
declare function has(key: string): boolean
declare function list(): readonly string[]

// `FileSystemDirectoryHandle.entries()` is real in every browser that has OPFS
// but is missing from the DOM lib. The store, the walker and the pools all
// iterate pools and sigbags with it.
interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
}
