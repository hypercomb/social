// hypercomb-dev/src/app/core/ioc.web.ts
// Legacy fallback — the shared ioc.web.ts (imported in main.ts) is the canonical version.
// This file exists for backward compatibility; the if-guard ensures only one installs.

(() => {
  const instances = new Map<string, unknown>()
  const names = new Map<string, string>()
  const listeners: Array<(key: string, value: unknown) => void> = []

  if (!window.ioc) {
    window.ioc = {
      register(signature: any, value: any, name?: string) {
        const key: string = signature && typeof signature === 'object' && 'key' in signature
          ? signature.key
          : signature

        if (!instances.has(key)) {
          instances.set(key, value)
        }
        if (name && !names.has(name)) {
          names.set(name, key)
        }

        for (const cb of listeners) {
          try { cb(key, value) } catch { /* swallow */ }
        }
      },

      get<T = unknown>(key: any): T | undefined {
        const k: string = key && typeof key === 'object' && 'key' in key
          ? key.key
          : key

        const sig = instances.has(k) ? k : names.get(k)
        return sig ? (instances.get(sig) as T) : undefined
      },

      has(key: any): boolean {
        const k: string = key && typeof key === 'object' && 'key' in key
          ? key.key
          : key

        return instances.has(k) || names.has(k)
      },

      list(): readonly string[] {
        return [...instances.keys()]
      },

      onRegister(cb: (key: string, value: unknown) => void): () => void {
        listeners.push(cb)
        return () => {
          const idx = listeners.indexOf(cb)
          if (idx >= 0) listeners.splice(idx, 1)
        }
      },

      graph(): Record<string, string[]> {
        const result: Record<string, string[]> = {}
        for (const [key, value] of instances) {
          if (value && typeof value === 'object' && 'deps' in value) {
            const deps = (value as any).deps
            if (deps && typeof deps === 'object') {
              result[key] = Object.values(deps) as string[]
            }
          }
        }
        return result
      },
    }

    // Global convenience
    ;(window as any).get = window.ioc.get
    ;(window as any).register = window.ioc.register
    ;(window as any).has = window.ioc.has
    ;(window as any).list = window.ioc.list

    console.log('[hypercomb] ioc installed')
  }
})()
