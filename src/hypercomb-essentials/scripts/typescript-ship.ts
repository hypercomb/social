// hypercomb-essentials/scripts/typescript-ship.ts
//
// THE SOURCE ATOMS REACH THIS MACHINE'S HOST ON PUBLISH (owner, 2026-11-16:
// "Host the package's TypeScript without installing it, fetched only when a
// file is opened"). The build leaves them in dist/.typescript/
// (typescript-atoms.ts); a publish copies them, flat and named by signature,
// into the relay's content dir, which is where the public host's farm reads
// from. A plain build copies none, and the mirrored dev feed never gets one.
//
// Its own file, apart from the ship's targets and its pool.
//
// NEVER THROWS. The TypeScript is an extra: a publish must ship the package
// exactly as before whatever happens here, so every failure is counted and
// returned for the caller to log.
//
// The in-flight suffix is NOT `.partial`: another session's ship sweeps every
// `.partial` in the same directory (atomic-copy.ts sweepPartials), and would
// delete this copy mid-flight or trip on it.

import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, utimesSync } from 'node:fs'
import { join } from 'node:path'

/** Suffix of an atom being copied. Never a 64-hex name, so nothing reads one as content. */
export const TYPESCRIPT_INCOMING = '.typescript-incoming'

/** A copy left behind longer than this was abandoned by a ship that died. Its
 *  age is its modified time, which the ship sets when it makes the copy. */
export const ABANDONED_MS = 10 * 60 * 1000

const SIG_NAME = /^[0-9a-f]{64}$/

export type TypescriptShip = {
  /** Source atoms in the staging dir. */
  named: number
  /** Their total size. */
  bytes: number
  /** Copies written, counted per target. */
  copied: number
  /** Copies already complete, counted per target. */
  held: number
  failed: { sig: string; why: string }[]
}

const sizeOf = (path: string): number | null => {
  try { const stat = statSync(path); return stat.isFile() ? stat.size : null } catch { return null }
}

const sweepAbandoned = (dir: string, now: number): void => {
  let names: string[]
  try { names = readdirSync(dir) } catch { return }
  for (const name of names) {
    if (!name.endsWith(TYPESCRIPT_INCOMING)) continue
    const path = join(dir, name)
    try { if (now - statSync(path).mtimeMs > ABANDONED_MS) unlinkSync(path) } catch { /* another ship took it */ }
  }
}

/** Copy every source atom in `stagingDir` into each of `targetDirs`. */
export const shipTypescript = (stagingDir: string, targetDirs: readonly string[], now: () => number = Date.now): TypescriptShip => {
  const ship: TypescriptShip = { named: 0, bytes: 0, copied: 0, held: 0, failed: [] }
  let atoms: string[]
  try { atoms = existsSync(stagingDir) ? readdirSync(stagingDir).filter(name => SIG_NAME.test(name)).sort() : [] } catch { atoms = [] }
  if (!atoms.length) return ship

  for (const dir of targetDirs) sweepAbandoned(dir, now())

  for (const sig of atoms) {
    const src = join(stagingDir, sig)
    const size = sizeOf(src)
    if (size === null) continue
    ship.named++
    ship.bytes += size
    for (const dir of targetDirs) {
      const tgt = join(dir, sig)
      // The name is the signature, so equal size is a complete copy: the same
      // test the ship itself uses (atomic-copy.ts entryComplete).
      if (sizeOf(tgt) === size) { ship.held++; continue }
      const tmp = `${tgt}.${process.pid}${TYPESCRIPT_INCOMING}`
      try {
        mkdirSync(dir, { recursive: true })
        copyFileSync(src, tmp)
        // A copy keeps its source's modified time, and an atom unchanged
        // since an earlier build is older than ABANDONED_MS. Without this
        // stamp another session's ship, sweeping this directory, would read
        // the copy in flight as abandoned and delete it before the rename.
        const made = new Date(now())
        utimesSync(tmp, made, made)
        if (sizeOf(tmp) !== size) throw new Error('short copy')
        renameSync(tmp, tgt)
        ship.copied++
      } catch (error) {
        try { unlinkSync(tmp) } catch { /* nothing landed */ }
        // Another session may have landed the same bytes while this one tried.
        if (sizeOf(tgt) === size) ship.held++
        else ship.failed.push({ sig, why: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  return ship
}

/** What the ship says. One line when all is well, two when something was not copied. */
export const typescriptShipLines = (ship: TypescriptShip, targetDirs: readonly string[]): string[] => {
  const mb = (ship.bytes / 1024 / 1024).toFixed(1)
  if (!ship.named) return ['[copy-content] TypeScript — this build names no source atoms']
  const lines = [`[copy-content] TypeScript — ${ship.named} source atom(s), ${mb} MB: ${ship.copied} copied, ${ship.held} already held → ${targetDirs.join(', ')} (before the pool was read)`]
  if (ship.failed.length) {
    const first = ship.failed[0]!
    lines.push(`[copy-content] TypeScript — ${ship.failed.length} source atom(s) NOT copied (first: ${first.sig.slice(0, 12)}… — ${first.why}); the package ships as before`)
  }
  return lines
}
