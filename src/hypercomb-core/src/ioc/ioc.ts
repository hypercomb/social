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

  if (instances.has(key)) {
    console.warn(`[ioc] duplicate key: ${key}`)
    return
  }

  instances.set(key, value)
}

export const get = <T = unknown>(
  key: string | ServiceToken<T>
): T | undefined => {
  const k = key instanceof ServiceToken ? key.key : key
  return instances.get(k) as T | undefined
}

export const has = (key: string | ServiceToken<any>): boolean => {
  const k = key instanceof ServiceToken ? key.key : key
  return instances.has(k)
}

export const list = (): readonly string[] =>
  [...instances.keys()]
