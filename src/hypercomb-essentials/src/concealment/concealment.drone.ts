// concealment/concealment.drone.ts
//
// THE ONE OWNER of what has been put away.
//
// Every surface that lists things you did not choose — a host's build ledger,
// a branch's published versions — needs the same two acts and must not each
// grow its own. One pool, one writer, one render: a thing hidden from the
// hosts panel is hidden, full stop, and the delete area is the same delete
// area wherever you reach it from.
//
// Shell parity: the panels are shared Angular components and must not import
// essentials, so the set crosses as a `hidden:render` payload and comes back as
// intents (hidden:conceal, hidden:reveal, hidden:delete).
//
// Doctrine, enforced in concealment.ts rather than here: you cannot delete
// what you did not first hide, and only what its own surface marked deletable
// can be deleted at all.

import { Drone } from '@hypercomb/core'
import {
  conceal,
  deleteConcealed,
  listConcealed,
  reveal,
  type ConcealedItem,
} from './concealment.js'

const STORE_KEY = '@hypercomb.social/Store'

export interface HiddenRenderPayload {
  /** What is hidden — the rows the delete area renders. */
  items: ConcealedItem[]
  /** Signatures that were deleted. Surfaces need these to keep filtering; they
   *  are never rendered anywhere, which is what "deleted" means here. */
  gone: string[]
  /** True once a read has completed, so a surface can tell "nothing hidden"
   *  from "not read yet". */
  loaded: boolean
}

export class ConcealmentDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'concealment'

  public override description =
    'What you have put away. Hide takes a row out of a list; the delete area is the only place a hidden thing can be deleted, and only if its surface said it may be.'

  protected override listens: string[] = [
    'hidden:refresh', 'hidden:conceal', 'hidden:reveal', 'hidden:delete',
  ]
  protected override emits: string[] = ['hidden:render', 'activity:log']

  #items: ConcealedItem[] = []
  #loaded = false

  constructor() {
    super()

    this.onEffect('hidden:refresh', () => { void this.#read() })

    this.onEffect<Partial<ConcealedItem>>('hidden:conceal', (p) => {
      const sig = String(p?.sig ?? '').trim().toLowerCase()
      if (!sig) return
      void (async () => {
        await conceal({
          sig,
          scope: String(p?.scope ?? ''),
          label: String(p?.label ?? ''),
          from: String(p?.from ?? ''),
          // Absent means NOT deletable. A surface that has not thought about
          // whether its rows may be destroyed gets the answer that costs
          // nothing to be wrong about.
          deletable: p?.deletable === true,
        })
        await this.#read()
      })()
    })

    this.onEffect<{ sig?: string }>('hidden:reveal', (p) => {
      const sig = String(p?.sig ?? '').trim().toLowerCase()
      if (!sig) return
      void (async () => { await reveal(sig); await this.#read() })()
    })

    // DELETE — refused unless the thing is already hidden and its surface
    // marked it deletable. Both gates live in the pool module, so a new
    // surface cannot route around them by emitting a different effect.
    this.onEffect<{ sig?: string }>('hidden:delete', (p) => {
      const sig = String(p?.sig ?? '').trim().toLowerCase()
      if (!sig) return
      void (async () => {
        const item = this.#items.find(i => i.sig === sig)
        if (await deleteConcealed(sig)) {
          this.emitEffect('activity:log', {
            message: `${item?.label || sig.slice(0, 8)} deleted — it stays where it was published`,
          })
        }
        await this.#read()
      })()
    })

    // Eager, then again once the Store registers: the first read happens
    // during module load, before the pool can be opened, and a surface that
    // filters on an empty answer would offer a hidden row.
    void this.#read()
    try {
      window.ioc?.whenReady?.(STORE_KEY, () => { void this.#read() })
    } catch { /* no ioc yet — the eager read and any refresh still cover it */ }
  }

  async #read(): Promise<void> {
    try {
      this.#items = await listConcealed()
    } catch {
      // A pool that cannot be read is not an empty pool. Keeping the last good
      // answer keeps a hidden thing hidden.
      this.#items = this.#items ?? []
    }
    this.#loaded = true
    this.#emit()
  }

  #emit(): void {
    const payload: HiddenRenderPayload = {
      items: this.#items.filter(i => i.state === 'hidden').map(i => ({ ...i })),
      gone: this.#items.filter(i => i.state === 'deleted').map(i => i.sig),
      loaded: this.#loaded,
    }
    this.emitEffect('hidden:render', payload)
  }
}

const _concealment = new ConcealmentDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/ConcealmentDrone',
  _concealment,
)
