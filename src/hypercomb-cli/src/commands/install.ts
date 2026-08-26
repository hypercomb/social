// hypercomb install — the RESOLVER: signature in, exact install on disk.
//
//   hypercomb install <sig> --from <url> [--from <url>…] --to <dir> [--verify] [--max <n>]
//
// The pull twin of publish-content's push walk (scripts/publish-content.ts).
// Put in a signature and it materializes that signature's full Merkle
// closure as flat sig-named files in the target directory: BFS from the
// head, fetch every referenced sig over the one resolution contract
// (`<base>/<sig>`, plain GET), sha256-verify every byte against its name
// before it touches disk, mine nested refs from text payloads, repeat.
//
// Delta by construction: a sig already on disk is not fetched again —
// unchanged content sits under the same name forever, so resolving a NEW
// signature over an existing folder fetches only what changed, and
// resolving an OLD signature is a rollback. Idempotent; rerun freely.
//
// The output is the pool itself — the same flat layout the engine reads
// natively. Deliberately NO bespoke side-formats (no install.json): the
// communication language is layers, meta layers everywhere; a "what's
// current" pointer belongs to the layer/sigbag doctrine, not to this tool.
// Full design: documentation/read-only-deployment.md.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SIG = /^[a-f0-9]{64}$/
const DEFAULT_MAX_SIGS = 20_000
const FETCH_TIMEOUT_MS = 30_000
const CONCURRENCY = 6

/** How the walk touches the world — injected so the closure logic is
 *  testable with an in-memory universe and reusable off the CLI. */
export interface ResolverIO {
  /** Bytes for a sig, or null when no source has it. NOT yet verified. */
  fetch: (sig: string) => Promise<Uint8Array | null>
  has: (sig: string) => boolean
  read: (sig: string) => Uint8Array
  write: (sig: string, bytes: Uint8Array) => void
}

export interface ResolveStats {
  total: number
  present: number
  fetched: number
  holes: string[]
  refused: string[]
}

const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')

/** Mine every 64-hex reference out of a text payload. Binary payloads
 *  (anything that doesn't survive UTF-8 round-tripping) carry no refs. */
const mineRefs = (bytes: Uint8Array): string[] => {
  const text = new TextDecoder().decode(bytes)
  if (text.includes('�')) return []
  return [...text.matchAll(/[a-f0-9]{64}/g)].map(m => m[0])
}

/** BFS the Merkle closure of `head` into the store behind `io`.
 *  Every byte is verified against its sig before write; mismatches are
 *  refused (never written, never mined). Present files are mined too —
 *  their children may still be missing (the delta case). */
export async function resolveClosure(
  head: string,
  io: ResolverIO,
  opts: { maxSigs?: number; verifyExisting?: boolean } = {},
): Promise<ResolveStats> {
  const maxSigs = opts.maxSigs ?? DEFAULT_MAX_SIGS
  const seen = new Set<string>()
  const queue: string[] = [head]
  const stats: ResolveStats = { total: 0, present: 0, fetched: 0, holes: [], refused: [] }

  const resolveOne = async (sig: string): Promise<void> => {
    let bytes: Uint8Array | null = null
    if (io.has(sig)) {
      bytes = io.read(sig)
      if (opts.verifyExisting && sha256(bytes) !== sig) bytes = null // corrupt — refetch below
      if (bytes) { stats.present++ }
    }
    if (!bytes) {
      bytes = await io.fetch(sig)
      if (!bytes) { stats.holes.push(sig); return }
      if (sha256(bytes) !== sig) { stats.refused.push(sig); return }
      io.write(sig, bytes)
      stats.fetched++
    }
    for (const ref of mineRefs(bytes)) {
      if (!seen.has(ref)) { seen.add(ref); queue.push(ref) }
    }
  }

  seen.add(head)
  while (queue.length && stats.total < maxSigs) {
    const frontier = queue.splice(0, CONCURRENCY).filter(s => SIG.test(s))
    stats.total += frontier.length
    await Promise.all(frontier.map(resolveOne))
  }
  return stats
}

/** Disk + HTTP wiring: flat `<dir>/<sig>` files, sources tried in order
 *  over the one resolution contract `<base>/<sig>`. Writes are staged to a
 *  `.part` name and renamed, so a crash never leaves a torn file that the
 *  delta skip would then trust forever. */
const diskIO = (dir: string, sources: string[]): ResolverIO => ({
  fetch: async (sig) => {
    for (const base of sources) {
      try {
        const res = await fetch(`${base.replace(/\/+$/, '')}/${sig}`, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (res.ok) return new Uint8Array(await res.arrayBuffer())
      } catch { /* try the next source */ }
    }
    return null
  },
  has: (sig) => existsSync(join(dir, sig)),
  read: (sig) => readFileSync(join(dir, sig)),
  write: (sig, bytes) => {
    const part = join(dir, `.part-${sig}`)
    writeFileSync(part, bytes)
    renameSync(part, join(dir, sig))
  },
})

const USAGE = `usage: hypercomb install <sig> --from <url> [--from <url>…] --to <dir> [--verify] [--max <n>]

Resolve a signature's full Merkle closure into a flat sig-file pool.
  --from    content source base URL (repeatable; tried in order per sig)
  --to      target directory (created if missing)
  --verify  re-hash files already on disk; corrupt ones are refetched
  --max     closure size cap (default ${DEFAULT_MAX_SIGS})`

export async function runInstall(args: string[]): Promise<void> {
  const sources: string[] = []
  let dir = ''
  let head = ''
  let maxSigs = DEFAULT_MAX_SIGS
  const verifyExisting = args.includes('--verify')
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from') sources.push(args[++i] ?? '')
    else if (args[i] === '--to') dir = args[++i] ?? ''
    else if (args[i] === '--max') maxSigs = Number(args[++i]) || DEFAULT_MAX_SIGS
    else if (!args[i].startsWith('--') && !head) head = args[i]
  }
  if (!SIG.test(head) || !sources.every(Boolean) || !sources.length || !dir) {
    console.error(USAGE)
    process.exit(1)
  }

  mkdirSync(dir, { recursive: true })
  const io = diskIO(dir, sources)
  const stats = await resolveClosure(head, io, { maxSigs, verifyExisting })

  console.log(`closure ${head.slice(0, 12)}…: ${stats.total} sigs — already had ${stats.present}, fetched ${stats.fetched}, holes ${stats.holes.length}, refused ${stats.refused.length}`)
  if (stats.holes.length) console.warn('holes (no source has them — superseded or never published):', stats.holes.map(s => s.slice(0, 12)).join(', '))
  if (stats.refused.length) console.warn('refused (bytes did not match their signature — a lying source):', stats.refused.map(s => s.slice(0, 12)).join(', '))

  // The head itself missing is not a warning — the install cannot be
  // pointed at, so the whole resolve failed.
  if (!io.has(head)) {
    console.error(`the head ${head.slice(0, 12)}… did not resolve from any source — nothing to install`)
    process.exit(1)
  }
  console.log(`head ${head} verified on disk — the folder is the install`)
}

/** Remove staged `.part-*` leftovers from an interrupted run. Exported for
 *  reuse; runInstall does not call it — a stale .part file is inert. */
export const sweepPartFiles = (dir: string, names: string[]): void => {
  for (const name of names) {
    if (name.startsWith('.part-')) { try { unlinkSync(join(dir, name)) } catch { /* already gone */ } }
  }
}
