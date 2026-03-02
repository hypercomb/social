// runtime/ioc.ts

import type { Visibility } from './service-key.js'

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
const privates = new Set<string>()

// -------------------------------------------------
// public API
// -------------------------------------------------

export const register = (
  signature: string | ServiceToken<any>,
  value: unknown,
  opts?: string | { name?: string; visibility?: Visibility }
): void => {
  const key = signature instanceof ServiceToken ? signature.key : signature

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

  if (visibility !== 'private' && name) {
    if (names.has(name)) {
      console.warn(`[ioc] alias collision: "${name}" → ${key} (already → ${names.get(name)})`)
    } else {
      names.set(name, key)
    }
  }
}

export const get = <T = unknown>(
  key: string | ServiceToken<T>
): T | undefined => {
  const k = key instanceof ServiceToken ? key.key : key

  if (instances.has(k)) return instances.get(k) as T

  const aliased = names.get(k)
  if (aliased) return instances.get(aliased) as T

  // suffix fallback
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
}

export const has = (key: string | ServiceToken<any>): boolean => {
  const k = key instanceof ServiceToken ? key.key : key
  if (instances.has(k)) return true
  if (names.has(k)) return true

  if (!k.startsWith('@')) {
    const suffix = '/' + k
    for (const full of instances.keys()) {
      if (full.endsWith(suffix) && !privates.has(full)) return true
    }
  }

  return false
}

export const list = (): readonly string[] =>
  [...instances.keys()]
