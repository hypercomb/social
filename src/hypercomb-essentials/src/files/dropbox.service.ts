// files/dropbox.service.ts
//
// Tracks which locations are typed dropboxes and answers, synchronously,
// whether the CURRENT view sits inside one (here or via an ancestor —
// cascading, top-down). The drop handlers call active()/accepts() on the
// drop event, which can't await, so resolution must be sync.
//
// State is an in-memory map of `joined-segments → accept[]`, kept current
// two ways — mirroring decoration-kind-index.ts:
//   • live: `decorations:changed` carries the decoration sig; we fetch the
//     record directly and update the map. This is COMMIT-INDEPENDENT, so a
//     freshly-declared `/dropbox` makes the gate active immediately (the
//     bug was re-reading the not-yet-committed layer and finding nothing).
//   • hydration: on `render:cell-count` we walk the current lineage and
//     populate the map from committed layers, catching dropboxes declared
//     in a prior session.

import { EffectBus } from '@hypercomb/core'
import { listDropboxHere, FILES_DROPBOX_KIND } from './files-attachment.js'
import { accepts as matchAccepts } from './file-types.js'

const get = (key: string): any => (window as any).ioc?.get?.(key)

type LineageLike = { explorerSegments?: () => readonly string[] }
type StoreLike = { getResource(sig: string): Promise<Blob | null> }

const keyOf = (segs: readonly string[]): string => segs.join('\u0000')

export class DropboxService {
  /** joined-segments → accept list (a dropbox lives at this location). */
  #boxes = new Map<string, readonly string[]>()
  /** decoration sig → joined-segments key (so removeSig can subtract). */
  #sigKey = new Map<string, string>()
  /** hydration guard — keys already walked from committed layers. */
  #checked = new Set<string>()

  constructor() {
    EffectBus.on('render:cell-count', () => this.#hydrate())
    EffectBus.on('decorations:changed', (p) => { void this.#onDecorations(p as any) })
  }

  /** Is the current view inside a dropbox (here or an ancestor)? */
  active(): boolean { return this.#resolve() !== null }

  /** The resolved dropbox's accept list (empty when inactive). */
  acceptList(): readonly string[] { return this.#resolve() ?? [] }

  /** Does the active dropbox accept this file? */
  accepts(file: { name: string; type?: string }): boolean {
    const a = this.#resolve()
    return a !== null && matchAccepts(a, file)
  }

  /** Known dropbox decoration sigs declared AT this exact location. */
  sigsAt(segments: readonly string[]): string[] {
    const key = keyOf(segments.map(String))
    return [...this.#sigKey.entries()].filter(([, k]) => k === key).map(([sig]) => sig)
  }

  // ── internals ─────────────────────────────────────────────────

  #currentSegments(): string[] {
    const lineage = get('@hypercomb.social/Lineage') as LineageLike | undefined
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  /** Nearest dropbox covering the current view — self, then ancestors. */
  #resolve(): readonly string[] | null {
    const segs = this.#currentSegments()
    for (let depth = segs.length; depth >= 0; depth--) {
      const accept = this.#boxes.get(keyOf(segs.slice(0, depth)))
      if (accept) return accept
    }
    return null
  }

  async #onDecorations(p?: { segments?: readonly string[]; op?: string; sig?: string }): Promise<void> {
    if (!p?.segments || !p?.sig || !p?.op) return
    const key = keyOf(p.segments.map(String))
    if (p.op === 'append') {
      const rec = await this.#fetchRecord(p.sig)
      if (rec?.kind === FILES_DROPBOX_KIND) {
        this.#boxes.set(key, Array.isArray(rec.payload?.accept) ? rec.payload!.accept! : [])
        this.#sigKey.set(p.sig, key)
      }
    } else if (p.op === 'removeSig') {
      const k = this.#sigKey.get(p.sig)
      if (k !== undefined) {
        this.#sigKey.delete(p.sig)
        // drop the box only when no other sig still maps to this location
        if (![...this.#sigKey.values()].includes(k)) this.#boxes.delete(k)
      }
    }
  }

  #hydrate(): void {
    const segs = this.#currentSegments()
    for (let depth = segs.length; depth >= 0; depth--) {
      const sub = segs.slice(0, depth)
      const key = keyOf(sub)
      if (this.#checked.has(key)) continue
      this.#checked.add(key)
      void this.#hydrateKey(sub, key)
    }
  }

  async #hydrateKey(sub: string[], key: string): Promise<void> {
    try {
      const found = await listDropboxHere(sub)
      if (found.length) {
        this.#boxes.set(key, found[0].record.payload?.accept ?? [])
        for (const f of found) this.#sigKey.set(f.sig, key)
      }
    } catch {
      this.#checked.delete(key)  // transient read error — allow a retry
    }
  }

  async #fetchRecord(sig: string): Promise<{ kind?: string; payload?: { accept?: readonly string[] } } | null> {
    const store = get('@hypercomb.social/Store') as StoreLike | undefined
    if (!store?.getResource) return null
    try {
      const blob = await store.getResource(sig)
      return blob ? JSON.parse(await blob.text()) : null
    } catch { return null }
  }
}

const _dropbox = new DropboxService()
window.ioc.register('@diamondcoreprocessor.com/DropboxService', _dropbox)
