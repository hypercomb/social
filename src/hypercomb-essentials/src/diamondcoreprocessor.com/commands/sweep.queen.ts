// diamondcoreprocessor.com/commands/sweep.queen.ts
//
// /sweep — quarantine STRAY entries at the OPFS root. The root's legit
// inventory under the pools-of-meaning model is:
//
//   • sig-named FILES  (64-hex)  — content bytes (layers, resources)
//   • sig-named DIRS   (64-hex)  — lineage sigbags AND sign(meaning) pools
//   • marker FILES     (000x)    — root sigbag markers (max marker = current)
//   • legacy `__*__` DIRS        — drain sources owned by the self-cleaning
//                                  absorbs/relocation in Store; they remove
//                                  themselves once fully drained
//   • `hypercomb.io/`            — the pre-flat-root legacy content root,
//                                  same drain lifecycle
//   • `overrides/`, `translations/` — legacy non-signed i18n dirs, now
//                                  sign(meaning) pools; same drain lifecycle
//                                  (Store's boot absorb removes them)
//
// NONE of those are ever touched here — removing a sig file wipes content,
// removing a sig dir wipes a lineage or a pool, and removing a drain source
// destroys bytes the self-clean hasn't confirmed copied yet. Only entries
// matching nothing above (stray named files/dirs from old experiments or
// interrupted writes) are quarantined — and quarantine means soft-delete:
// copied (with per-file verification) into a dated bucket inside the
// sign('temporary') pool of meaning, then removed only after the copy is
// confirmed. When in doubt, an entry is left in place and reported.
//
// Destructive-ish — hidden from autocomplete; the user types the full
// `/sweep` to invoke. Output toast lists what was moved and where.

import { QueenBee, SignatureService } from '@hypercomb/core'

// Quarantine destination: the sign('temporary') pool of meaning. Derived,
// never hardcoded — sha256 of the UTF-8 bytes of the meaning string, so
// every tier computes the identical address (no typed `__temporary__`
// folder, which is itself a retired drain source now).
const TEMPORARY_MEANING = 'temporary'

const SIG_RE = /^[0-9a-f]{64}$/
// Sigbag marker files: `0000` … `000x` (hex). The max marker IS the
// current root, so a root-level marker is live data, never a stray.
// (Until its own drain runs, the substrate registry also lives in root
// `0000` — one more reason marker-shaped names are untouchable.)
const MARKER_RE = /^[0-9a-f]{4}$/

/** Root entries that are legit besides sig/marker names: legacy drain
 *  sources (self-cleaning owns their removal) and known exceptions. */
const isLegitName = (name: string, kind: FileSystemHandle['kind']): boolean => {
  if (SIG_RE.test(name)) return true                                   // content / sigbag / pool
  if (kind === 'file' && MARKER_RE.test(name)) return true             // root sigbag marker
  if (name.startsWith('__') && name.endsWith('__')) return true        // legacy drain source
  if (name === 'hypercomb.io') return true                             // legacy content root (drain)
  if (name === 'overrides' || name === 'translations') return true     // legacy i18n dirs (self-cleaning drain)
  if (name.endsWith('.crswap')) return true                            // Chrome in-flight write artifact
  return false
}

export class SweepQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'sweep'
  override readonly aliases = []
  override description = 'Quarantine stray OPFS root entries into the temporary pool'
  override examples = [
    { input: '/sweep', result: 'Moves stray OPFS root entries into the sign(temporary) pool' },
  ]
  // Destructive (soft) — hide from autocomplete so the user types it
  // deliberately. Same posture as /flatten and /collapse-history.
  override slashHidden = true

  protected async execute(_args: string): Promise<void> {
    const root = await navigator.storage.getDirectory().catch(() => null)
    if (!root) {
      this.#toast('warning', 'Sweep failed', 'OPFS root unavailable.')
      return
    }

    // 1) Snapshot the strays: every root entry the legit inventory above
    //    doesn't cover. Snapshotted before we start moving so the pool
    //    bucket we create below is never iterated as a candidate (it is
    //    sig-named anyway, so it would pass the filter regardless).
    const strays: { name: string; kind: FileSystemHandle['kind'] }[] = []
    for await (const [name, handle] of (root as unknown as { entries: () => AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (isLegitName(name, handle.kind)) continue
      strays.push({ name, kind: handle.kind })
    }

    if (strays.length === 0) {
      this.#toast('success', 'Sweep: root is clean',
        'Every OPFS root entry is a sig file, sig dir, marker, or known drain source.')
      return
    }

    // 2) Open the sign('temporary') pool + a fresh SIG-NAMED bucket so
    //    multiple sweeps in one session don't collide. The bucket dir is
    //    signed too — sign('sweep-{ts}') — so even the quarantine holding
    //    pen obeys the no-non-signed-folder standard; the timestamp keeps
    //    each run's address distinct.
    const poolSig = await SignatureService.sign(new TextEncoder().encode(TEMPORARY_MEANING).buffer as ArrayBuffer)
    const tempPool = await root.getDirectoryHandle(poolSig, { create: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const bucketSig = await SignatureService.sign(new TextEncoder().encode(`sweep-${stamp}`).buffer as ArrayBuffer)
    const bucket = await tempPool.getDirectoryHandle(bucketSig, { create: true })

    // 3) Quarantine each stray: copy (verified per file) into the bucket,
    //    THEN remove the original. A copy failure leaves the original in
    //    place — nothing is ever deleted before its bytes are confirmed
    //    in the quarantine.
    const moved: string[] = []
    const failed: { name: string; err: string }[] = []
    for (const v of strays) {
      try {
        if (v.kind === 'file') {
          await copyFileVerified(root, bucket, v.name)
        } else {
          await copyDirVerified(root, bucket, v.name)
        }
        await root.removeEntry(v.name, { recursive: v.kind === 'directory' })
        moved.push(v.name)
      } catch (err) {
        failed.push({ name: v.name, err: String((err as Error)?.message ?? err) })
      }
    }

    const detail = moved.length > 0 ? `Moved: ${moved.join(', ')}` : ''
    if (failed.length > 0) {
      this.#toast('warning', 'Sweep partial',
        `${moved.length} moved, ${failed.length} failed. First failure: ${failed[0].name} (${failed[0].err}).`)
    } else {
      this.#toast('success', 'Sweep complete',
        `${moved.length} entr${moved.length === 1 ? 'y' : 'ies'} quarantined in the temporary pool, bucket sign(sweep-${stamp}) = ${bucketSig.slice(0, 12)}…. ${detail}`)
    }
  }

  #toast(type: 'info' | 'success' | 'tip' | 'warning', title: string, message: string): void {
    void (window as { __hypercombEffectBus?: { emit: (e: string, p: unknown) => void } })
      .__hypercombEffectBus?.emit?.('toast:show', { type, title, message })
  }
}

// ── helpers (verified file / dir copy) ─────────────────────────────
// Copy → verify → (caller removes). A copy that can't be verified throws,
// so the caller never deletes an original whose bytes aren't confirmed.

async function copyFileVerified(
  src: FileSystemDirectoryHandle,
  dst: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  const srcHandle = await src.getFileHandle(name)
  const file = await srcHandle.getFile()
  const bytes = await file.arrayBuffer()
  const dstHandle = await dst.getFileHandle(name, { create: true })
  const writable = await dstHandle.createWritable()
  try { await writable.write(bytes) } finally { await writable.close() }
  // Verify: the quarantined copy must hold every byte before the caller
  // may remove the original.
  const written = await (await dst.getFileHandle(name)).getFile()
  if (written.size !== bytes.byteLength) {
    throw new Error(`verify failed for ${name}: wrote ${written.size} of ${bytes.byteLength} bytes`)
  }
}

async function copyDirVerified(
  parent: FileSystemDirectoryHandle,
  dstParent: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  const srcDir = await parent.getDirectoryHandle(name, { create: false })
  const dstDir = await dstParent.getDirectoryHandle(name, { create: true })
  for await (const [childName, handle] of (srcDir as unknown as { entries: () => AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (handle.kind === 'file') {
      await copyFileVerified(srcDir, dstDir, childName)
    } else {
      await copyDirVerified(srcDir, dstDir, childName)
    }
  }
}

const _sweep = new SweepQueenBee()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/SweepQueenBee', _sweep)
