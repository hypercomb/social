// Shared by the mail Worker tests: an in-memory stand-in for the R2 bucket, and two small helpers.
// Not a test file itself (the relay's `npm test` runs *.test.js).

export const latin1 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return s }

/** A readable stream of these bytes. (Not Blob.stream(): a DOM test environment's Blob has none.) */
export const streamOf = bytes => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } })

export const quiet = async fn => { const e = console.error; console.error = () => {}; try { return await fn() } finally { console.error = e } }

// R2's `onlyIf` as the Worker uses it: "write only if absent" (If-None-Match: *), given as Headers or as
// { etagDoesNotMatch: '*' }.
const onlyIfAbsent = onlyIf => {
  if (!onlyIf) return false
  if (typeof onlyIf.get === 'function') return onlyIf.get('if-none-match') === '*'
  return onlyIf.etagDoesNotMatch === '*'
}

// head, get (body, json, arrayBuffer), put (with `onlyIf` absent → null when the key exists, as R2 answers a
// failed precondition), delete (a key or a list) and a prefix list with a cursor and R2's `startAfter`.
// `failPut` makes puts throw: true for all of them, or a function of the key to fail only some. `calls`
// counts every list, so a test can hold the Worker to a bound on its calls.
export class FakeR2 {
  constructor() { this.map = new Map(); this.failPut = false; this.calls = { list: 0 } }
  async head(key) { return this.map.has(key) ? { key } : null }
  async put(key, value, options = {}) {
    if (typeof this.failPut === 'function' ? this.failPut(key) : this.failPut) throw new Error('bucket unavailable')
    if (onlyIfAbsent(options.onlyIf) && this.map.has(key)) return null
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value).slice()
    this.map.set(key, { bytes, customMetadata: { ...(options.customMetadata || {}) } })
    return { key }
  }
  async get(key) {
    const entry = this.map.get(key)
    if (!entry) return null
    return {
      key,
      body: streamOf(entry.bytes),
      customMetadata: entry.customMetadata,
      json: async () => JSON.parse(new TextDecoder().decode(entry.bytes)),
      arrayBuffer: async () => entry.bytes.slice().buffer,
    }
  }
  async delete(key) { for (const k of Array.isArray(key) ? key : [key]) this.map.delete(k) }
  async list({ prefix = '', limit = 1000, cursor, startAfter } = {}) {
    this.calls.list++
    const keys = [...this.map.keys()].filter(k => k.startsWith(prefix) && (startAfter === undefined || k > startAfter)).sort()
    const start = cursor ? keys.findIndex(k => k > cursor) : 0
    const slice = start < 0 ? [] : keys.slice(start, start + limit)
    const truncated = start >= 0 && start + limit < keys.length
    return {
      objects: slice.map(key => ({ key, customMetadata: this.map.get(key).customMetadata })),
      truncated,
      cursor: truncated ? slice[slice.length - 1] : undefined,
    }
  }
}
