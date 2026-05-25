// diamondcoreprocessor.com/commands/sweep.queen.ts
//
// /sweep — clean OPFS state to the architectural invariant: only
// underscored `__*__` system folders at the root. Anything else at the
// OPFS root is legacy drift (the old `hypercomb.io/` user-content dir,
// stray top-level `0000` markers from buggy commits, etc.) and gets
// moved into `__temporary__/<timestamp>/` rather than hard-deleted —
// soft-delete keeps the bytes recoverable if something downstream still
// reached for them.
//
// Why soft-delete: a `removeEntry` on a directory the user might
// secretly depend on is a footgun. Soft-delete to `__temporary__` is
// reversible. The user can `__temporary__` themselves once they confirm
// nothing visible relies on the moved data.
//
// Destructive — hidden from autocomplete; the user types the full
// `/sweep` to invoke. Output toast lists what was moved and where.

import { QueenBee } from '@hypercomb/core'

const TEMP_DIR = '__temporary__'

export class SweepQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'sweep'
  override readonly aliases = []
  override description = 'Move non-underscored OPFS root entries into __temporary__/'
  // Destructive (soft) — hide from autocomplete so the user types it
  // deliberately. Same posture as /flatten and /collapse-history.
  override slashHidden = true

  protected async execute(_args: string): Promise<void> {
    const root = await navigator.storage.getDirectory().catch(() => null)
    if (!root) {
      this.#toast('warning', 'Sweep failed', 'OPFS root unavailable.')
      return
    }

    // 1) Snapshot the violations: every root entry whose name is not
    //    `__*__`. Done before we start moving so a directory we just
    //    created (e.g. __temporary__) isn't iterated as a violation.
    const violations: { name: string; kind: FileSystemHandle['kind'] }[] = []
    for await (const [name, handle] of (root as unknown as { entries: () => AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      const isUnderscored = name.startsWith('__') && name.endsWith('__')
      if (isUnderscored) continue
      violations.push({ name, kind: handle.kind })
    }

    if (violations.length === 0) {
      this.#toast('success', 'Sweep: root is clean',
        'Every OPFS root entry already conforms to the __*__ invariant.')
      return
    }

    // 2) Ensure __temporary__ + a fresh dated bucket so multiple sweeps
    //    in one session don't collide. Format: __temporary__/sweep-{ts}/.
    const tempRoot = await root.getDirectoryHandle(TEMP_DIR, { create: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const bucket = await tempRoot.getDirectoryHandle(`sweep-${stamp}`, { create: true })

    // 3) Move each violation. OPFS has no native rename across handles,
    //    so we recurse-copy then recurse-delete. For files at the root
    //    (e.g. stray `0000`) this is a single file move.
    const moved: string[] = []
    const failed: { name: string; err: string }[] = []
    for (const v of violations) {
      try {
        if (v.kind === 'file') {
          await moveFile(root, bucket, v.name)
        } else {
          await moveDir(root, bucket, v.name)
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
        `${moved.length} entr${moved.length === 1 ? 'y' : 'ies'} moved to ${TEMP_DIR}/sweep-${stamp}/. ${detail}`)
    }
  }

  #toast(type: 'info' | 'success' | 'tip' | 'warning', title: string, message: string): void {
    void (window as { __hypercombEffectBus?: { emit: (e: string, p: unknown) => void } })
      .__hypercombEffectBus?.emit?.('toast:show', { type, title, message })
  }
}

// ── helpers (file / dir copy) ──────────────────────────────────────

async function moveFile(
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
}

async function moveDir(
  parent: FileSystemDirectoryHandle,
  dstParent: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  const srcDir = await parent.getDirectoryHandle(name, { create: false })
  const dstDir = await dstParent.getDirectoryHandle(name, { create: true })
  for await (const [childName, handle] of (srcDir as unknown as { entries: () => AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (handle.kind === 'file') {
      await moveFile(srcDir, dstDir, childName)
    } else {
      await moveDir(srcDir, dstDir, childName)
    }
  }
}

const _sweep = new SweepQueenBee()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/SweepQueenBee', _sweep)
