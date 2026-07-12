// runtime/ioc.ts

// -------------------------------------------------
// typed service token
// -------------------------------------------------

export class ServiceToken<T> {
  constructor(public readonly key: string, public readonly ngType?: any) {}
  toString(): string { return this.key }
}

// -------------------------------------------------
// internal state
// -------------------------------------------------

const instances = new Map<string, unknown>()

// -------------------------------------------------
// public API
// -------------------------------------------------

export const register = (
  signature: string | ServiceToken<any>,
  value: unknown,
): void => {
  const key = signature instanceof ServiceToken ? signature.key : signature

  if (instances.has(key)) return

  instances.set(key, value)
}

export const get = <T = unknown>(
  key: string | ServiceToken<T>
): T | undefined => {
  const k = key instanceof ServiceToken ? key.key : key
  const own = instances.get(k) as T | undefined
  if (own !== undefined) return own
  // Bridge to the shell registry: web shells register every service via
  // `window.ioc` (ioc.web's OWN map), not this module's map — so a module
  // that imported THIS `get` (instead of using the global one ioc.web
  // exposes) resolved nothing and silently broke ("core services are not
  // ready yet" from a fully-booted app). Own map stays authoritative;
  // the fallback only answers what was registered on the shell side.
  try {
    return (globalThis as unknown as { ioc?: { get?: (k: string) => unknown } })
      .ioc?.get?.(k) as T | undefined
  } catch { return undefined }
}

export const has = (key: string | ServiceToken<any>): boolean => {
  const k = key instanceof ServiceToken ? key.key : key
  return instances.has(k)
}

export const list = (): readonly string[] =>
  [...instances.keys()]
