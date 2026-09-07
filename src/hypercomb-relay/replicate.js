// Pull-based signature replication for the slim storage host.
//
// A replication request contains identity, not content: one root signature
// plus the content origins that may serve it. The host resolves that root's
// reachable signature closure into its own flat heap. Every fetched atom is
// sha256-verified before write; existing atoms are reused and walked, so a
// repeated request is an idempotent delta repair.

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { Agent as HttpAgent, request as httpRequest } from 'node:http'
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'
import { join } from 'node:path'
import { classifyBlockedAddress, guardedLookup } from './address-guard.js'

export const SIGNATURE_RE = /^[a-f0-9]{64}$/
export const DEFAULT_REPLICATION_LIMIT = 20_000
const DEFAULT_CONCURRENCY = 6
const DEFAULT_FETCH_TIMEOUT_MS = 30_000
const DEFAULT_ATOM_LIMIT = 52_428_800
// A job is bounded in three directions, not one: atoms (`limit`), bytes off the
// wire, and wall clock. Twenty thousand atoms of fifty megabytes apiece is a
// terabyte of disk and an afternoon of someone else's bandwidth, so the atom
// count alone was never a cap on the WORK a single request could order.
const DEFAULT_JOB_BYTE_LIMIT = 2_147_483_648
const DEFAULT_JOB_DEADLINE_MS = 600_000

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

// Discovery is the pool itself (documentation/host-packages-pool.md). The
// address is derived here rather than copied from a build so every host and
// every client asks the same meaning for the same directory.
export const HOST_PACKAGES_POOL = sha256(Buffer.from('host:packages', 'utf8'))
const PACKAGE_ENTRY_RE = /^[0-9]{8}$/
const packageEntryName = index => String(index).padStart(8, '0')

/** Append one package to this host's published pool.
 *
 * The staged file is complete before `linkSync` makes it visible. A hard link
 * is also an exclusive create: if another relay process claimed the same next
 * index, EEXIST sends this writer around the loop to re-read the pool. That
 * keeps indices gapless without a process-local mutex or a crash-stale lock.
 * Re-reading also makes publication idempotent across jobs and processes: the
 * first entry naming a signature wins, including its original label. */
export function appendHostPackage(contentDir, packageSig, label) {
  if (!SIGNATURE_RE.test(packageSig)) throw new TypeError('package signature must be a lowercase 64-hex signature')
  const mark = typeof label === 'string' ? label.trim() : ''
  if (!mark || mark.length > 64 || /[\r\n]/.test(mark)) {
    throw new TypeError('package label must contain between 1 and 64 characters on one line')
  }

  const poolDir = join(contentDir, HOST_PACKAGES_POOL)
  mkdirSync(poolDir, { recursive: true })
  const bytes = `${packageSig}\n${mark}`
  const partPath = join(poolDir, `.part-package-${process.pid}-${randomBytes(6).toString('hex')}`)
  writeFileSync(partPath, bytes, { flag: 'wx' })
  try {
    for (;;) {
      let maxIndex = -1
      for (const name of readdirSync(poolDir)) {
        if (!PACKAGE_ENTRY_RE.test(name)) continue
        const index = Number(name)
        if (index > maxIndex) maxIndex = index
        try {
          const heldSig = (readFileSync(join(poolDir, name), 'utf8').split('\n')[0] ?? '').trim().toLowerCase()
          if (heldSig === packageSig) return { appended: false, index, name }
        } catch { /* an unreadable entry still occupies its index */ }
      }

      const index = maxIndex + 1
      if (index > 99_999_999) throw new Error('host package pool exhausted its 8-digit index space')
      const name = packageEntryName(index)
      try {
        // Same-directory hard link: atomic visibility of already-written bytes
        // plus O_EXCL semantics for the destination name on NTFS and POSIX.
        linkSync(partPath, join(poolDir, name))
        return { appended: true, index, name }
      } catch (error) {
        if (error?.code === 'EEXIST') continue
        throw error
      }
    }
  } finally {
    try { rmSync(partPath, { force: true }) } catch {}
  }
}

/** A package becomes discoverable only after the requested root and every
 * atom the closure reached are held and verified. A bounded, holed or refused
 * walk is a useful replication result, but it is not a publishable package. */
export function publishReplicatedPackage(contentDir, request, result) {
  if (!request?.package) return null
  const held = Array.isArray(result?.held) ? result.held : []
  const complete = result?.root === request.signature
    && held.includes(request.signature)
    && result?.limited === false
    && Array.isArray(result?.holes) && result.holes.length === 0
    && Array.isArray(result?.refused) && result.refused.length === 0
    && Number.isSafeInteger(result?.total) && result.total === held.length
  if (!complete) return null
  return appendHostPackage(contentDir, request.signature, request.package.label)
}

/** Text atoms may refer to more atoms by their 64-hex identities. Opaque
 * binary atoms are leaves. The typed browser walker remains more precise;
 * this host-side fallback deliberately follows only literal signatures. */
export function mineSignatures(bytes) {
  const text = new TextDecoder().decode(bytes)
  if (text.includes('\uFFFD')) return []
  return [...text.matchAll(/[a-f0-9]{64}/g)].map(match => match[0])
}

const barePackageSignature = value =>
  String(value ?? '').trim().toLowerCase().replace(/\.(?:js|json)$/, '')

/** Read only the references that define a package layer. Arbitrary 64-hex
 * text elsewhere in the JSON is not package inventory and must not turn into
 * a hole that prevents publication. */
function packageLayerReferences(bytes) {
  let record
  try { record = JSON.parse(new TextDecoder().decode(bytes)) } catch { return null }
  if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.name !== 'string' || !record.name.trim()) return null
  if (!Array.isArray(record.cells) || !Array.isArray(record.bees) || !Array.isArray(record.dependencies)) return null

  const signatures = (values, cells = false) => {
    const out = []
    for (const value of values) {
      const signature = barePackageSignature(
        typeof value === 'string' ? value : (cells || (value && typeof value === 'object')) ? value?.sig : '',
      )
      if (!SIGNATURE_RE.test(signature)) return null
      out.push(signature)
    }
    return out
  }
  const layers = signatures(record.cells, true)
  const bees = signatures(record.bees)
  const dependencies = signatures(record.dependencies)
  return layers && bees && dependencies ? { layers, bees, dependencies } : null
}

/** Resolve one signature closure through an injected atom store. */
export async function resolveSignatureClosure(root, io, options = {}) {
  if (!SIGNATURE_RE.test(root)) throw new TypeError('root must be a lowercase 64-hex signature')
  const limit = options.limit ?? DEFAULT_REPLICATION_LIMIT
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
  const byteLimit = options.byteLimit ?? DEFAULT_JOB_BYTE_LIMIT
  const deadline = Date.now() + (options.deadlineMs ?? DEFAULT_JOB_DEADLINE_MS)
  const seen = new Set([root])
  const queue = [root]
  const result = { root, total: 0, present: 0, fetched: 0, fetchedBytes: 0, held: [], holes: [], refused: [], limited: false }
  const selectChildren = options.children ?? mineSignatures

  const resolveOne = async (signature) => {
    let bytes = await io.read(signature)
    if (bytes && sha256(bytes) !== signature) bytes = null
    if (bytes) result.present++
    else {
      bytes = await io.fetch(signature)
      if (!bytes) { result.holes.push(signature); return }
      if (sha256(bytes) !== signature) { result.refused.push(signature); return }
      // A destination that refuses the write (a directory at the atom's
      // address) is ONE refused atom, not a failed job: the sibling atoms
      // still land, and the caller reads `refused` exactly as it does for a
      // hash mismatch.
      try { await io.write(signature, bytes) } catch { result.refused.push(signature); return }
      result.fetched++
      result.fetchedBytes += bytes.byteLength
    }
    result.held.push(signature)
    for (const child of selectChildren(bytes, signature)) {
      if (seen.has(child)) continue
      seen.add(child)
      queue.push(child)
    }
  }

  let spent = false
  while (queue.length && result.total < limit) {
    if (result.fetchedBytes >= byteLimit || Date.now() >= deadline) { spent = true; break }
    const room = limit - result.total
    const frontier = queue.splice(0, Math.min(concurrency, room)).filter(sig => SIGNATURE_RE.test(sig))
    result.total += frontier.length
    await Promise.all(frontier.map(resolveOne))
  }
  result.limited = spent || queue.length > 0
  return result
}

/** Resolve a package by its signed structure: child layers through `cells`,
 * then the bees and dependencies those layers declare as exact leaf atoms.
 * This is the Node twin of runtime's `deriveInventory`; unlike generic
 * replication it never mines unrelated signature-looking text. */
export async function resolvePackageClosure(root, io, options = {}) {
  const layerSignatures = new Set([root])
  const leafSignatures = new Set()
  const invalidLayers = new Set()
  const children = (bytes, signature) => {
    // Bees and dependencies are exact leaves even when their bytes happen to
    // parse as JSON and contain a `cells` field.
    if (!layerSignatures.has(signature)) return []
    const references = packageLayerReferences(bytes)
    if (!references) { invalidLayers.add(signature); return [] }

    for (const child of references.layers) {
      if (leafSignatures.has(child)) invalidLayers.add(signature)
      layerSignatures.add(child)
    }
    for (const leaf of [...references.bees, ...references.dependencies]) {
      if (layerSignatures.has(leaf)) invalidLayers.add(signature)
      leafSignatures.add(leaf)
    }
    return [...new Set([...references.layers, ...references.bees, ...references.dependencies])]
  }

  const result = await resolveSignatureClosure(root, io, { ...options, children })
  for (const signature of invalidLayers) {
    if (!result.refused.includes(signature)) result.refused.push(signature)
  }
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
  const byteLimit = options.byteLimit ?? DEFAULT_JOB_BYTE_LIMIT
  const deadline = Date.now() + (options.deadlineMs ?? DEFAULT_JOB_DEADLINE_MS)
  const result = { ...rootResult, total: 1, limited: exact.size > selected.length }
  for (let offset = 0; offset < selected.length; offset += DEFAULT_CONCURRENCY) {
    if (result.fetchedBytes >= byteLimit || Date.now() >= deadline) { result.limited = true; break }
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
        try { await io.write(signature, atom) } catch { result.refused.push(signature); return }
        result.fetched++
        result.fetchedBytes += atom.byteLength
      }
      result.held.push(signature)
    }))
  }
  return result
}

/** Normalize the deliberately small wire contract. Sources are bases: an
 * atom is fetched as `<source>/<signature>`.
 *
 * `options.allowedOrigins` is an operator-configured origin set; empty means
 * "any origin that survives the address screen". `options.allowPrivate` is the
 * dev-only escape that lets a source point into private space at all. Literal
 * addresses are refused HERE so the caller gets a 400 instead of a job that
 * quietly returns nothing; hostnames are screened again at connect time. */
export function parseReplicationRequest(value, options = {}) {
  const allowedOrigins = options.allowedOrigins ?? new Set()
  const allowPrivate = options.allowPrivate === true
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
    if (allowedOrigins.size && !allowedOrigins.has(url.origin)) {
      throw new TypeError(`${url.origin} is not an allowed replication origin`)
    }
    // An origin the OPERATOR named is not the threat the screen exists for —
    // the threat is a CALLER choosing where the host's socket goes. So naming
    // an internal mirror in --replication-origins is a way to reach it without
    // opening the screen for everything else.
    if (!allowPrivate && !allowedOrigins.has(url.origin)) {
      const literal = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname
      // A name is not an address; only a literal can be judged synchronously.
      const reason = classifyBlockedAddress(literal)
      if (reason && reason !== 'not a resolved IP address') {
        throw new TypeError(`${url.origin} is refused — ${literal} is ${reason}`)
      }
    }
    return url.toString().replace(/\/+$/, '')
  }))]
  const requestedLimit = Number(value?.limit)
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, DEFAULT_REPLICATION_LIMIT)
    : DEFAULT_REPLICATION_LIMIT
  const inventory = value?.inventory === true
  let packageMetadata = null
  if (value?.package !== undefined) {
    if (!value.package || typeof value.package !== 'object' || Array.isArray(value.package)) {
      throw new TypeError('package metadata must be an object containing label')
    }
    if (typeof value.package.label !== 'string') throw new TypeError('package label must be a string')
    const label = value.package.label.trim()
    if (!label || label.length > 64 || /[\r\n]/.test(label)) {
      throw new TypeError('package label must contain between 1 and 64 characters on one line')
    }
    if (inventory) throw new TypeError('package publication cannot use inventory mode')
    packageMetadata = { label }
  }
  return { signature: root, sources, limit, inventory, package: packageMetadata }
}

// Replication keeps its OWN connection pools, and a screened pool is never the
// same object as an exempt one. Node keys a pooled socket by host and port, not
// by the `lookup` that made it, so sharing the global agent would let a socket
// opened under one screening decision serve a request made under another. A
// private pool can only ever hold sockets its own guard cleared.
const AGENTS = {
  'https:screened': new HttpsAgent({ keepAlive: true, maxSockets: 8 }),
  'https:exempt': new HttpsAgent({ keepAlive: true, maxSockets: 8 }),
  'http:screened': new HttpAgent({ keepAlive: true, maxSockets: 8 }),
  'http:exempt': new HttpAgent({ keepAlive: true, maxSockets: 8 }),
}
const replicationAgent = (secure, allowPrivate) =>
  AGENTS[`${secure ? 'https' : 'http'}:${allowPrivate ? 'exempt' : 'screened'}`]

/** One GET against one source, through a screened resolver.
 *
 * `node:http` rather than `fetch` for one reason: it takes a `lookup`, and the
 * screen has to live in the socket's own name resolution. A resolve-then-fetch
 * check clears an address and then lets the stack resolve the name a SECOND
 * time — and the caller owns that name, so the second answer can be 10.0.0.5.
 * Here the address the guard cleared is the address the socket connects to.
 *
 * A redirect is never followed. A 3xx is a destination the caller did not name
 * and the operator never allowed, so it is treated as a miss: an atom is served
 * at its address or it is not served. */
export async function fetchSignatureFromSource(source, signature, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_ATOM_LIMIT
  const allowPrivate = options.allowPrivate === true
  const url = new URL(`${source}/${signature}`)
  const secure = url.protocol === 'https:'
  const transport = secure ? httpsRequest : httpRequest
  return await new Promise((resolve, reject) => {
    let settled = false
    const finish = (value) => { if (!settled) { settled = true; resolve(value) } }
    const fail = (error) => { if (!settled) { settled = true; reject(error) } }
    const request = transport(url, {
      method: 'GET',
      agent: replicationAgent(secure, allowPrivate),
      lookup: guardedLookup(allowPrivate),
      headers: { accept: '*/*' },
    }, response => {
      const status = response.statusCode ?? 0
      if (status < 200 || status >= 300) { response.resume(); finish(null); return }
      const declared = Number(response.headers['content-length'])
      if (Number.isFinite(declared) && declared > maxBytes) { response.destroy(); finish(null); return }
      const chunks = []
      let size = 0
      response.on('data', chunk => {
        size += chunk.length
        if (size > maxBytes) { response.destroy(); finish(null); return }
        chunks.push(chunk)
      })
      response.on('end', () => finish(Buffer.concat(chunks)))
      response.on('error', () => finish(null))
    })
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`source timeout: ${source}`)))
    request.on('error', fail)
    request.end()
  })
}

/** HTTP source reader. Wrong bytes are returned to the resolver so they are
 * recorded as refused; a source cannot poison the destination. A refused
 * DESTINATION is not a silent skip — it is logged, because a writer probing
 * the operator's network is exactly what an operator wants to read about. */
export function httpSignatureFetcher(sources, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, maxBytes = DEFAULT_ATOM_LIMIT, options = {}) {
  const allowedOrigins = options.allowedOrigins ?? new Set()
  const exempt = (source) => {
    if (options.allowPrivate === true) return true
    try { return allowedOrigins.has(new URL(source).origin) } catch { return false }
  }
  return async (signature) => {
    for (const source of sources) {
      try {
        const bytes = await fetchSignatureFromSource(source, signature, { timeoutMs, maxBytes, allowPrivate: exempt(source) })
        if (bytes) return bytes
      } catch (error) {
        if (error?.name === 'BlockedAddressError') console.warn(`[replicate] ${error.message}`)
        /* next source */
      }
    }
    return null
  }
}

/** Flat sig-file destination with staged, atomic writes. `resolveExisting`
 * lets the relay reuse legacy typed pools while all new atoms land flat. */
export function contentDirectoryIO(contentDir, sources, resolveExisting = null, options = {}) {
  const existingPath = (signature) => resolveExisting?.(signature)?.path ?? join(contentDir, signature)
  return {
    fetch: httpSignatureFetcher(sources, DEFAULT_FETCH_TIMEOUT_MS, DEFAULT_ATOM_LIMIT, {
      allowPrivate: options.allowPrivate === true,
      allowedOrigins: options.allowedOrigins,
    }),
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
      // THE ENTRY DECIDES. `existsSync` is true for a DIRECTORY, and the content
      // root demonstrably holds sig-named directories — pools and lineage bags,
      // the very ones the listing branch serves. Renaming one aside and dropping
      // an atom in its place, then `rmSync` on the "old" path, was the host-side
      // twin of the /flatten hazard: a whole pool gone for one replicated atom.
      // A directory at an atom's address is refused, never replaced.
      // `sign('host:packages')` is also explicitly reserved before the first
      // package creates its directory. Its known hash preimage is the meaning
      // itself, so allowing that one flat atom would let an earlier generic
      // replication permanently occupy the pool's path.
      if (signature === HOST_PACKAGES_POOL) {
        throw new Error(`refusing to write atom ${signature.slice(0, 8)}… over the reserved host:packages pool`)
      }
      if (existsSync(finalPath) && statSync(finalPath).isDirectory()) {
        throw new Error(`refusing to write atom ${signature.slice(0, 8)}… over a directory`)
      }
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
