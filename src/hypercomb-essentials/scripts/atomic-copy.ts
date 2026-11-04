// hypercomb-essentials/scripts/atomic-copy.ts
//
// COPYING A CONTENT-ADDRESSED ENTRY, SO THAT A TORN COPY HEALS.
//
// A sig-named entry is named by its content, which makes the NAME a claim and
// not a proof: a copy that died half-way leaves a file with the right name and
// the wrong bytes, and "the name is there, skip it" then trusts it forever.
// Two rules close that:
//
//   1. A target is COMPLETE only when its bytes say so — a file by equal size
//      (content-addressed, so equal size to the source is the completeness
//      proof a short write cannot fake), a bag directory by every source member
//      being complete. Presence of the name proves nothing.
//   2. A copy lands ATOMICALLY — written beside the target under a temp name
//      that is not a signature, verified, then renamed into place. A reader
//      sees the old target or the whole new one, never half a file, and a
//      crash leaves only a `.partial` that is never mistaken for content.
//
// copy-content.ts is the caller; this lives apart so it can be tested without
// running a ship.

import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Suffix of an in-flight copy. Never a 64-hex name, so no walker treats one
 *  as content and stale removal (which only touches signatures) leaves it. */
export const PARTIAL_SUFFIX = '.partial'

/** Copy `src` to `tgt` through a temp name and a rename. Throws, leaving the
 *  target as it was, when the bytes that landed are not the bytes sent. */
export const copyFileAtomic = (src: string, tgt: string): void => {
  const tmp = `${tgt}${PARTIAL_SUFFIX}`
  try {
    copyFileSync(src, tmp)
    if (statSync(tmp).size !== statSync(src).size) throw new Error(`short copy of ${src}`)
    renameSync(tmp, tgt)
  } catch (error) {
    try { unlinkSync(tmp) } catch { /* nothing landed */ }
    throw error
  }
}

/** Write `text` to `path` through a temp name and a rename — a pool entry or a
 *  listing a reader fetches mid-ship is the old bytes or the new, never half. */
export const writeFileAtomic = (path: string, text: string): void => {
  const tmp = `${path}${PARTIAL_SUFFIX}`
  try {
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, path)
  } catch (error) {
    try { unlinkSync(tmp) } catch { /* nothing landed */ }
    throw error
  }
}

/** Is `tgt` a complete copy of `src`? A file by size; a directory when every
 *  member of `src` is complete beneath it (extra target members are fine — a
 *  pool grows). */
export const entryComplete = (src: string, tgt: string): boolean => {
  if (!existsSync(tgt)) return false
  const st = statSync(src)
  const tt = statSync(tgt)
  if (st.isDirectory() !== tt.isDirectory()) return false
  if (!st.isDirectory()) return tt.size === st.size
  return readdirSync(src).every(name => entryComplete(join(src, name), join(tgt, name)))
}

/** Bring `tgt` up to `src`: copy what is missing, REPLACE what is short.
 *  Returns how many files were written — 0 means it was already complete. */
export const healEntry = (src: string, tgt: string): number => {
  const st = statSync(src)
  if (!st.isDirectory()) {
    if (existsSync(tgt) && !statSync(tgt).isDirectory() && statSync(tgt).size === st.size) return 0
    // A directory squatting on a file's name is not content; clear it first.
    if (existsSync(tgt) && statSync(tgt).isDirectory()) rmSync(tgt, { recursive: true, force: true })
    copyFileAtomic(src, tgt)
    return 1
  }
  mkdirSync(tgt, { recursive: true })
  let written = 0
  for (const name of readdirSync(src)) written += healEntry(join(src, name), join(tgt, name))
  sweepPartials(tgt)
  return written
}

/** Remove the `.partial` leftovers a crashed copy left directly in `dir`. */
export const sweepPartials = (dir: string): number => {
  let swept = 0
  if (!existsSync(dir)) return 0
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(PARTIAL_SUFFIX)) continue
    rmSync(join(dir, name), { recursive: true, force: true })
    swept++
  }
  return swept
}
