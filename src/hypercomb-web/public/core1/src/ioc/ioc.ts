// runtime/ioc.ts

const registry = new Map<string, unknown>()

export const register = (key: string, value: unknown): void => {
  registry.set(key, value)
}

export const get = <T = unknown>(key: string): T | undefined =>
  registry.get(key) as T | undefined

export const has = (key: string): boolean =>
  registry.has(key)

export const list = (): readonly string[] =>  
  [...registry.keys()]
  