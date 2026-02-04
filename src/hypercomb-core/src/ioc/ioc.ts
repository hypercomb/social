// runtime/ioc.ts

const instances = new Map<string, unknown>()
const names = new Map<string, string>()

export const register = (
  signature: string,
  value: unknown,
  name?: string
): void => {
  instances.set(signature, value)
  if (name) names.set(name, signature)
}

export const get = <T = unknown>(
  key: string
): T | undefined => {
  const signature = instances.has(key)
    ? key
    : names.get(key)

  return signature
    ? (instances.get(signature) as T | undefined)
    : undefined
}

export const has = (key: string): boolean =>
  instances.has(key) || names.has(key)

export const list = (): readonly string[] =>
  [...instances.keys()]
