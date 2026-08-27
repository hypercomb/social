// Pull-based signature replication for the slim storage host.
//
// A replication request contains identity, not content: one root signature
// plus the content origins that may serve it. The host resolves that root's
// reachable signature closure into its own flat heap. Every fetched atom is
// sha256-verified before write; existing atoms are reused and walked, so a
// repeated request is an idempotent delta repair.

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const SIGNATURE_RE = /^[a-f0-9]{64}$/
export const DEFAULT_REPLICATION_LIMIT = 20_000
const DEFAULT_CONCURRENCY = 6
const DEFAULT_FETCH_TIMEOUT_MS = 30_000

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** Text atoms may refer to more atoms by their 64-hex identities. Opaque
 * binary atoms are leaves. The typed browser walker remains more precise;
 * this host-side fallback deliberately follows only literal signatures. */
export function mineSignatures(bytes) {
  const text = new TextDecoder().decode(bytes)
  if (text.includes('\uFFFD')) return []
  return [...text.matchAll(/[a-f0-9]{64}/g)].map(match => match[0])
}

/** Resolve one signature closure through an injected atom store. */
export async function resolveSignatureClosure(root, io, options = {}) {
  if (!SIGNATURE_RE.test(root)) throw new TypeError('root must be a lowercase 64-hex signature')
  const limit = options.limit ?? DEFAULT_REPLICATION_LIMIT
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
  const seen = new Set([root])
  const queue = [root]
  const result = { root, total: 0, present: 0, fetched: 0, holes: [], refused: [], limited: false }

  const resolveOne = async (signature) => {
    let bytes = await io.read(signature)
    if (bytes && sha256(bytes) !== signature) bytes = null
    if (bytes) result.present++
    else {
      bytes = await io.fetch(signature)
      if (!bytes) { result.holes.push(signature); return }
      if (sha256(bytes) !== signature) { result.refused.push(signature); return }
      await io.write(signature, bytes)
      result.fetched++
    }
    for (const child of mineSignatures(bytes)) {
      if (seen.has(child)) continue
      seen.add(child)
      queue.push(child)
    }
  }

  while (queue.length && result.total < limit) {
    const room = limit - result.total
    const frontier = queue.splice(0, Math.min(concurrency, room)).filter(sig => SIGNATURE_RE.test(sig))
    result.total += frontier.length
    await Promise.all(frontier.map(resolveOne))
  }
  result.limited = queue.length > 0
  return result
}

/** Normalize the deliberately small wire contract. Sources are bases: an
 * atom is fetched as `<source>/<signature>`. */
export function parseReplicationRequest(value) {
  const root = String(value?.signature ?? '').trim().toLowerCase()
  if (!SIGNATURE_RE.test(root)) throw new TypeError('signature must be 64 hexadecimal characters')
  if (!Array.isArray(value?.sources) || value.sources.length === 0 || value.sources.length > 16) {
    throw new TypeError('sources must contain between 1 and 16 HTTP origins')
  }
  const sources = [...new Set(value.sources.map(raw => {
    const url = new URL(String(raw))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError('sources must use HTTP or HTTPS')
    url.hash = ''
    url.search = ''
    if (url.username || url.password) throw new TypeError('sources must not contain credentials')
    return url.toString().replace(/\/+$/, '')
  }))]
  const requestedLimit = Number(value?.limit)
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, DEFAULT_REPLICATION_LIMIT)
    : DEFAULT_REPLICATION_LIMIT
  return { signature: root, sources, limit }
}

/** HTTP source reader. Wrong bytes are returned to the resolver so they are
 * recorded as refused; a source cannot poison the destination. */
export function httpSignatureFetcher(sources, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  return async (signature) => {
    for (const source of sources) {
      try {
        const response = await fetch(`${source}/${signature}`, { signal: AbortSignal.timeout(timeoutMs) })
        if (response.ok) return Buffer.from(await response.arrayBuffer())
      } catch { /* next source */ }
    }
    return null
  }
}

/** Flat sig-file destination with staged, atomic writes. `resolveExisting`
 * lets the relay reuse legacy typed pools while all new atoms land flat. */
export function contentDirectoryIO(contentDir, sources, resolveExisting = null) {
  const existingPath = (signature) => resolveExisting?.(signature)?.path ?? join(contentDir, signature)
  return {
    fetch: httpSignatureFetcher(sources),
    read: async (signature) => {
      const path = existingPath(signature)
      if (!existsSync(path)) return null
      try { return readFileSync(path) } catch { return null }
    },
    write: async (signature, bytes) => {
      mkdirSync(contentDir, { recursive: true })
      const finalPath = join(contentDir, signature)
      if (existsSync(finalPath)) return
      const partPath = join(contentDir, `.part-${signature}-${randomBytes(6).toString('hex')}`)
      try {
        writeFileSync(partPath, bytes)
        if (!existsSync(finalPath)) renameSync(partPath, finalPath)
      } finally {
        try { rmSync(partPath, { force: true }) } catch { /* already renamed */ }
      }
    },
  }
}
