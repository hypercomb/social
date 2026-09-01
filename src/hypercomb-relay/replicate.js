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
const DEFAULT_ATOM_LIMIT = 52_428_800

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
  const result = { root, total: 0, present: 0, fetched: 0, held: [], holes: [], refused: [], limited: false }

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
    result.held.push(signature)
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

/** Resolve an ActiveGenome record without recursively mining the atoms it
 * names. This is intentionally a one-level exact inventory: carried layer
 * roots can refer to stale leaf generations that are not part of the live
 * genome. The verified record itself is the inventory identity. */
export async function resolveSignatureInventory(root, io, options = {}) {
  const rootResult = await resolveSignatureClosure(root, io, { ...options, limit: 1, concurrency: 1 })
  if (!rootResult.held.includes(root)) return rootResult
  const bytes = await io.read(root)
  let record
  try { record = JSON.parse(new TextDecoder().decode(bytes)) } catch {
    rootResult.refused.push(root)
    return rootResult
  }
  const exact = new Set()
  for (const head of Array.isArray(record?.heads) ? record.heads : []) {
    if (SIGNATURE_RE.test(head?.marker)) exact.add(head.marker)
    if (SIGNATURE_RE.test(head?.layer)) exact.add(head.layer)
  }
  for (const object of Array.isArray(record?.objects) ? record.objects : []) {
    if (SIGNATURE_RE.test(object?.sig)) exact.add(object.sig)
  }
  exact.delete(root)
  const limit = Math.max(0, (options.limit ?? DEFAULT_REPLICATION_LIMIT) - 1)
  const selected = [...exact].slice(0, limit)
  const result = { ...rootResult, total: 1, limited: exact.size > selected.length }
  for (let offset = 0; offset < selected.length; offset += DEFAULT_CONCURRENCY) {
    const frontier = selected.slice(offset, offset + DEFAULT_CONCURRENCY)
    result.total += frontier.length
    await Promise.all(frontier.map(async signature => {
      let atom = await io.read(signature)
      if (atom && sha256(atom) !== signature) atom = null
      if (atom) result.present++
      else {
        atom = await io.fetch(signature)
        if (!atom) { result.holes.push(signature); return }
        if (sha256(atom) !== signature) { result.refused.push(signature); return }
        await io.write(signature, atom)
        result.fetched++
      }
      result.held.push(signature)
    }))
  }
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
  return { signature: root, sources, limit, inventory: value?.inventory === true }
}

/** HTTP source reader. Wrong bytes are returned to the resolver so they are
 * recorded as refused; a source cannot poison the destination. */
export function httpSignatureFetcher(sources, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, maxBytes = DEFAULT_ATOM_LIMIT) {
  return async (signature) => {
    for (const source of sources) {
      try {
        const response = await fetch(`${source}/${signature}`, { signal: AbortSignal.timeout(timeoutMs) })
        if (!response.ok) continue
        const declared = Number(response.headers.get('content-length'))
        if (Number.isFinite(declared) && declared > maxBytes) { try { await response.body?.cancel() } catch {}; continue }
        if (!response.body) return Buffer.alloc(0)
        const chunks = []
        let size = 0
        const reader = response.body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > maxBytes) { await reader.cancel(); throw new RangeError('atom exceeds byte limit') }
          chunks.push(Buffer.from(value))
        }
        return Buffer.concat(chunks)
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
      const partPath = join(contentDir, `.part-${signature}-${randomBytes(6).toString('hex')}`)
      const oldPath = join(contentDir, `.old-${signature}-${randomBytes(6).toString('hex')}`)
      try {
        writeFileSync(partPath, bytes)
        if (existsSync(finalPath)) renameSync(finalPath, oldPath)
        renameSync(partPath, finalPath)
      } finally {
        try { rmSync(partPath, { force: true }) } catch { /* already renamed */ }
        try { rmSync(oldPath, { force: true }) } catch {}
      }
    },
  }
}
