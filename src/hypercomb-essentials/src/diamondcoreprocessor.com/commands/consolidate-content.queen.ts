// diamondcoreprocessor.com/commands/consolidate-content.queen.ts
//
// /consolidate-content — Phase-1b manual relocation + cleanup for the content
// pools. Copies any sig-named file still living in the legacy `__resources__`
// / `__layers__` pools UP to the flat hive root (`__hive__/<sig>`), then GCs a
// pool once every sig it holds is confirmed at the root AND it holds nothing
// else. New content already writes straight to the hive root and reads resolve
// root-first then fall back to the legacy pool, so this only sweeps the
// pre-migration stragglers and retires the legacy folders for good.
//
// This queen is the ONLY trigger for the relocation. It deliberately does NOT
// run on boot: a whole-pool enumerate-and-copy hammers single-threaded OPFS
// and races first paint (an in-flight copy lands a 0-byte target at the root
// that a concurrent read would resolve as a wiped layer). The hive never scans
// or relocates its own content on its own — relocation is an explicit, offline
// maintenance step, exactly like `/consolidate-history`.
//
// Non-destructive: bytes are COPIED, never dropped, and a pool is removed only
// after every sig it holds is confirmed shadowed at the root (the never-wipe
// gate lives in `Store.#relocatePool`). A partial/failed pass leaves the pools
// in place (safe no-op); the next invocation finishes it.

import { QueenBee } from '@hypercomb/core'

export class ConsolidateContentQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'consolidate-content'
  override readonly aliases = ['retire-content-pools', 'migrate-content']
  override description = 'Relocate leftover __resources__/__layers__ content into the hive root and retire the legacy pools'
  // Maintenance utility — keep it out of autocomplete so a stray tab-complete
  // can't trigger it; still invokable when typed in full.
  override slashHidden = true

  protected execute(_args: string): void {
    void this.#consolidate()
  }

  async #consolidate(): Promise<void> {
    // Structural handle to the shared Store — avoids importing across the
    // shared/essentials boundary (same access pattern as HistoryService).
    const store = get<{ migrateContentPoolToRoot?: () => Promise<void> }>('@hypercomb.social/Store')
    if (!store?.migrateContentPoolToRoot) {
      console.warn('[/consolidate-content] Store not available')
      return
    }
    console.log('[/consolidate-content] relocating legacy content pools to the hive root…')
    await store.migrateContentPoolToRoot()
    console.log('[/consolidate-content] done — see the [store] relocate logs above for per-pool detail.')
  }
}

const _consolidateContent = new ConsolidateContentQueenBee()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/ConsolidateContentQueenBee', _consolidateContent)
