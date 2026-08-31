// hypercomb-shared/core/ioc.web.ts

const instances = new Map<string, unknown>()
const listeners: Array<(key: string, value: unknown) => void> = []
const pendingReady = new Map<string, Set<(value: unknown) => void>>()

if (!window.ioc) {
  window.ioc = {

    register(signature: any, value: any) {
      const key: string = signature && typeof signature === 'object' && 'key' in signature
        ? signature.key
        : signature

      if (instances.has(key)) {
        // First-wins: the key keeps its original instance. A REJECTED
        // newcomer is a ghost — it was already constructed (its
        // constructor may have wired EffectBus listeners) but will never
        // be the canonical instance. Dispose it on the spot so those
        // listeners unhook; otherwise two live instances of the same
        // drone fight over the canvas (tiles render, then the ghost's
        // pass tears them down). Happens when a superseded generation of
        // a bee bundle evaluates alongside the current one. Re-registering
        // the SAME instance under an alias key is a plain no-op.
        const existing = instances.get(key)
        if (value !== existing && typeof (value as any)?.markDisposed === 'function') {
          try { (value as any).markDisposed() } catch { /* best-effort ghost cleanup */ }
        }
        return
      }

      instances.set(key, value)

      for (const cb of listeners) {
        try { cb(key, value) } catch { /* swallow */ }
      }

      // Fire one-shot whenReady callbacks
      const waiting = pendingReady.get(key)
      if (waiting) {
        for (const cb of waiting) {
          try { cb(value) } catch { /* swallow */ }
        }
        pendingReady.delete(key)
      }
    },

    unregister(key: any): void {
      const k: string = key && typeof key === 'object' && 'key' in key
        ? key.key
        : key
      instances.delete(k)
    },

    get<T = unknown>(key: any): T | undefined {
      const k: string = key && typeof key === 'object' && 'key' in key
        ? key.key
        : key
      return instances.get(k) as T | undefined
    },

    has(key: any): boolean {
      const k: string = key && typeof key === 'object' && 'key' in key
        ? key.key
        : key
      return instances.has(k)
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

    whenReady<T = unknown>(key: string, callback: (value: T) => void): void {
      const existing = instances.get(key)
      if (existing !== undefined) {
        callback(existing as T)
        return
      }
      if (!pendingReady.has(key)) pendingReady.set(key, new Set())
      pendingReady.get(key)!.add(callback as (value: unknown) => void)
    },

    graph(): Record<string, { deps: string[]; listens: string[]; emits: string[] }> {
      const result: Record<string, { deps: string[]; listens: string[]; emits: string[] }> = {}
      for (const [key, value] of instances) {
        if (!value || typeof value !== 'object') continue

        const v = value as any
        const hasDeps = v.deps && typeof v.deps === 'object'
        const hasListens = Array.isArray(v.listens)
        const hasEmits = Array.isArray(v.emits)

        if (hasDeps || hasListens || hasEmits) {
          result[key] = {
            deps: hasDeps ? Object.values(v.deps) as string[] : [],
            listens: hasListens ? v.listens : [],
            emits: hasEmits ? v.emits : [],
          }
        }
      }
      return result
    },
  }

  ;(window as any).get = window.ioc.get
  ;(window as any).register = window.ioc.register
  ;(window as any).has = window.ioc.has
  ;(window as any).list = window.ioc.list

  console.log('[hypercomb] ioc installed')
}
