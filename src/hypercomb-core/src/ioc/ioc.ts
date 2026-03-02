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
const names = new Map<string, string>()

// -------------------------------------------------
// public API
// -------------------------------------------------

export const register = (
  signature: string | ServiceToken<any>,
  value: unknown,
  name?: string
): void => {
  const key = signature instanceof ServiceToken ? signature.key : signature
  instances.set(key, value)
  if (name) names.set(name, key)
}

export const get = <T = unknown>(
  key: string | ServiceToken<T>
): T | undefined => {
  const k = key instanceof ServiceToken ? key.key : key
  const signature = instances.has(k)
    ? k
    : names.get(k)

  return signature
    ? (instances.get(signature) as T | undefined)
    : undefined
}

export const has = (key: string | ServiceToken<any>): boolean => {
  const k = key instanceof ServiceToken ? key.key : key
  return instances.has(k) || names.has(k)
}

export const list = (): readonly string[] =>
  [...instances.keys()]
