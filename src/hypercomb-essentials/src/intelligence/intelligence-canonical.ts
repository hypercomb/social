// The same argument bytes scripts/intelligence/disk.cjs hashes.
// Sorted keys, no undefined, UTF-8. A member's name is SHA-256 of this text.

const HASH = /^[0-9a-f]{64}$/

export const canonical = (value: unknown): string => {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('arguments must be finite')
    return JSON.stringify(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => canonical(item)).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).filter(key => record[key] !== undefined).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
  }
  throw new Error('arguments must be canonical JSON')
}

export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export const hashArguments = async (value: unknown): Promise<string> =>
  sha256Hex(new TextEncoder().encode(canonical(value)))

export const slug = (name: string): string => {
  const out = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!out || HASH.test(out)) throw new Error('a group needs a name')
  return out
}

export const poolMeaning = (name: string): string => `intelligence:${slug(name)}`

export const poolAddress = (name: string): Promise<string> => sha256Hex(new TextEncoder().encode(poolMeaning(name)))
