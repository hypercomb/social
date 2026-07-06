// diamondcoreprocessor.com/commands/consolidate-content.queen.ts
//
// /consolidate-content — MANUAL force-run of the content relocation. Copies any
// sig-named file still living in the legacy content sources (`__resources__`,
// `__layers__`, `__optimized__`, `__hive__/`, `hypercomb.io/` — the latter two
// including their lineage sigbags, union-merged) UP to the flat OPFS root, then
// GCs a source once every sig it holds is confirmed at the root AND it holds
// nothing else. New content already writes straight to the root and reads
// resolve root-first then fall back to the legacy sources, so this only sweeps
// pre-migration stragglers and retires the legacy folders for good.
//
// In the self-cleaning era the same pass (`Store.migrateContentPoolToRoot`) is
// scheduled automatically — detached and delayed ~20s after Store init whenever
// a legacy content source is found. This queen exists so the drain can be
// forced on demand. Neither path runs on the boot/render hot path: a whole-pool
// enumerate-and-copy hammers single-threaded OPFS and races first paint (an
// in-flight copy lands a 0-byte target at the root that a concurrent read would
// resolve as a wiped layer — the read-path's incomplete-write guard falls
// through to wherever the complete bytes still live).
//
// Non-destructive: bytes are COPIED, never dropped, and a source is removed only
// after every sig it holds is confirmed shadowed at the root (the never-wipe
// gate lives in `Store.#relocatePool` / `#relocateScopeDir`). A partial/failed
// pass leaves the sources in place (safe no-op); the next run finishes it.

import { QueenBee } from '@hypercomb/core'

export class ConsolidateContentQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'consolidate-content'
  override readonly aliases = ['retire-content-pools', 'migrate-content']
  override description = 'Relocate leftover legacy content (resources, layers, hive roots) up to the flat OPFS root and retire the drained folders'
  override examples = [{ input: '/consolidate-content', result: 'Copies legacy content up to the flat OPFS root' }]
  // Maintenance utility — keep it out of autocomplete so a stray tab-complete
  // can't trigger it; still invokable when typed in full.
  override slashHidden = true

  protected execute(_args: string): void {
    void this.#consolidate()
  }

  async #consolidate(): Promise<void> {
    const store = get<{ migrateContentPoolToRoot?: () => Promise<void> }>('@hypercomb.social/Store')
    if (!store?.migrateContentPoolToRoot) {
      console.warn('[/consolidate-content] Store not available')
      return
    }
    console.log('[/consolidate-content] relocating legacy content sources to the flat OPFS root…')
    await store.migrateContentPoolToRoot()
    console.log('[/consolidate-content] done — see the [store] relocate logs above for per-pool detail.')
  }
}

const _consolidateContent = new ConsolidateContentQueenBee()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/ConsolidateContentQueenBee', _consolidateContent)
