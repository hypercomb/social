// hypercomb-shared/core/ioc.web.ts

const instances = new Map<string, unknown>()
const names = new Map<string, string>()
const privates = new Set<string>()
const listeners: Array<(key: string, value: unknown) => void> = []

if (!window.ioc) {
  window.ioc = {

    /**
     * Register a service in the IoC container.
     *
     * @param signature  Fully-qualified key (`@domain/Name`) or plain string.
     * @param value      The instance to register.
     * @param opts       Backward-compatible: pass a string for a short-name alias,
     *                   or an object `{ name?, visibility? }`.
     *                   - visibility 'public' (default): alias is registered so
     *                     `get('@domain/Name')` resolves via short name.
     *                   - visibility 'private': only resolvable by full key.
     */
    register(
      signature: any,
      value: any,
      opts?: string | { name?: string; visibility?: 'public' | 'private' }
    ) {
      const key: string = signature && typeof signature === 'object' && 'key' in signature
        ? signature.key
        : signature

      const name = typeof opts === 'string' ? opts : opts?.name
      const visibility = typeof opts === 'string' ? 'public' : (opts?.visibility ?? 'public')

      if (instances.has(key)) {
        console.warn(`[ioc] duplicate key: ${key}`)
        return
      }

      instances.set(key, value)

      if (visibility === 'private') {
        privates.add(key)
      }

      // register short-name alias for public services
      if (visibility !== 'private' && name) {
        if (names.has(name)) {
          console.warn(`[ioc] alias collision: "${name}" → ${key} (already → ${names.get(name)})`)
        } else {
          names.set(name, key)
        }
      }

      // notify listeners
      for (const cb of listeners) {
        try { cb(key, value) } catch { /* swallow */ }
      }
    },

    /**
     * Resolve a service by key.
     *
     * Resolution order:
     * 1. Exact match on full key
     * 2. Exact match on short-name alias
     * 3. Suffix scan — if key is unqualified, find `@…/key` (warn on ambiguity)
     */
    get<T = unknown>(key: any): T | undefined {
      const k: string = key && typeof key === 'object' && 'key' in key
        ? key.key
        : key

      // 1. exact match (full key)
      if (instances.has(k)) return instances.get(k) as T

      // 2. alias lookup
      const aliased = names.get(k)
      if (aliased) return instances.get(aliased) as T

      // 3. suffix fallback for unqualified names
      if (!k.startsWith('@')) {
        const suffix = '/' + k
        const matches: string[] = []
        for (const full of instances.keys()) {
          if (full.endsWith(suffix) && !privates.has(full)) matches.push(full)
        }
        if (matches.length === 1) return instances.get(matches[0]) as T
        if (matches.length > 1) {
          console.warn(`[ioc] ambiguous key "${k}": ${matches.join(', ')}`)
        }
      }

      return undefined
    },

    has(key: any): boolean {
      const k: string = key && typeof key === 'object' && 'key' in key
        ? key.key
        : key

      if (instances.has(k)) return true
      if (names.has(k)) return true

      // suffix fallback
      if (!k.startsWith('@')) {
        const suffix = '/' + k
        for (const full of instances.keys()) {
          if (full.endsWith(suffix) && !privates.has(full)) return true
        }
      }

      return false
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

  // Global convenience — use get('@hypercomb.social/Store') anywhere without window.ioc prefix
  ;(window as any).get = window.ioc.get
  ;(window as any).register = window.ioc.register
  ;(window as any).has = window.ioc.has
  ;(window as any).list = window.ioc.list

  console.log('[hypercomb] ioc installed')
}
