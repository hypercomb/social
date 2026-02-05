// @hypercomb/core/src/ioc/ioc.ts
export const register = <T>(
  signature: string,
  value: T,
  name?: string
): void => {
  window.ioc.register(signature, value, name)
}

export const get = <T = unknown>(key: string): T | undefined =>
  window.ioc.get<T>(key)

export const has = (key: string): boolean =>
  window.ioc.has(key)

export const list = (): readonly string[] =>
  window.ioc.list()
