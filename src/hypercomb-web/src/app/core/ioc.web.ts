// src/app/core/ioc.web.ts

const instances = new Map<string, unknown>()
const names = new Map<string, string>()

if (!window.ioc) {
  window.ioc = {
    register<T>(signature: string, value: T, name?: string) {
      if (!instances.has(signature)) {
        instances.set(signature, value)
      }
      if (name && !names.has(name)) {
        names.set(name, signature)
      }
    },

    get<T = unknown>(key: string): T | undefined {
      const sig = instances.has(key) ? key : names.get(key)
      return sig ? (instances.get(sig) as T) : undefined
    },

    has(key: string): boolean {
      return instances.has(key) || names.has(key)
    },

    list(): readonly string[] {
      return [...instances.keys()]
    },
  }

  console.log('[hypercomb] IOC installed')
}
