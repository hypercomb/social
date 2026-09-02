// sharing/hosts.drone.ts
//
// THE HOSTS YOU CARRY — their own surface, and the data set everything else
// reads.
//
// This used to be a tab inside the publish panel, which put it in the wrong
// place twice over. A host is not a publishing setting: it is a thing you were
// given or stood up, it exists before any branch names it, and it outlives
// every branch that does. Reaching it through "publish" meant you could only
// think about hosts while thinking about publishing — and it meant the list
// did not exist until the publish panel had rendered once.
//
// So the pool comes first and the panel reads it. `community:hosts` is the one
// data set: this drone owns the reads and the two acts (add, remove), the
// publish panel's per-branch picker offers the same list, and the shim's cold
// boot reads the same pool by ADDRESS (`sign('community:hosts')`) without
// importing anything — which is the only way it could, since essentials is the
// thing being acquired.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not decide where a branch
// publishes. That is a MARK the branch wears (`host:<zone>`, order 0 = the
// primary door), it lives with the branch, and deleting a host from your
// community leaves every one of those marks intact — still naming a host you
// no longer carry, which is the honest state and reads as one. See
// community-hosts.ts for the split and documentation/website-artifact-paradigm.md
// for why it is that way.
//
// Shell parity: the panel is a shared Angular component and must not import
// essentials, so the list crosses as a `hosts:render` payload and comes back
// as intents (hosts:add, hosts:remove).

import { Drone } from '@hypercomb/core'
import {
  addCommunityHost,
  hostZone,
  listCommunityHosts,
  removeCommunityHost,
} from './community-hosts.js'

const STORE_KEY = '@hypercomb.social/Store'

/**
 * THE HOST A COLD CLIENT ALREADY KNOWS.
 *
 * Replication needs somewhere to pull FROM, and a participant who has just
 * arrived carries nothing. Someone has to be reachable before anyone has typed
 * anything, so one known host is seeded on the first read of an empty pool —
 * the first thread, from which the rest is pulled.
 *
 * jwize.com because it is the origin we have actually proven: it serves a
 * manifest, its atoms hash to their names, and it answers cross-origin.
 * hypercomb.com cannot be it while the apex still serves a marketing page.
 *
 * BE CLEAR ABOUT WHAT THIS COSTS: every fresh client contacts this domain on
 * its first run. That is a real, deliberate phone-home, and it is the whole
 * reason it is ONE named constant in one place rather than a list that could
 * quietly grow.
 */
const SEED_HOST = 'jwize.com'

/** Seeded once, ever. Without this the seed would come BACK after a removal,
 *  which is precisely the bug the community/marks split was built to kill: a
 *  host you deleted must stay deleted, even this one. */
const SEEDED_KEY = 'hc:hosts:seeded'

export interface HostsRenderPayload {
  open: boolean
  /** The hosts you carry, in the pool's own stable order. */
  zones: string[]
  /** True once a read has completed, so the panel can tell "none yet" from
   *  "not read yet" and never flash an empty-state over a list that is
   *  about to arrive. */
  loaded: boolean
}

export class HostsDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'The hosts you carry, as their own surface: the `community:hosts` pool read as a list, with add and remove. The data set the publish picker offers and the shim reads by pool address on a cold boot.'

  protected override listens: string[] = [
    'hosts:view-toggle', 'hosts:open', 'hosts:close', 'hosts:refresh', 'hosts:add', 'hosts:remove',
  ]
  protected override emits: string[] = ['hosts:render', 'activity:log']

  #open = false
  #loaded = false
  #zones: string[] = []

  constructor() {
    super()

    this.onEffect('hosts:view-toggle', () => {
      this.#open = !this.#open
      this.#emit()
      if (this.#open) void this.#read()
    })

    // Cross-surface navigation is an OPEN, never a toggle. A docked panel can
    // be parked while its drone remains open; toggling from Publish would then
    // close the very directory the participant asked to see.
    this.onEffect('hosts:open', () => {
      this.#open = true
      this.#emit()
      void this.#read()
    })

    this.onEffect('hosts:close', () => {
      if (!this.#open) return
      this.#open = false
      this.#emit()
    })

    this.onEffect('hosts:refresh', () => { void this.#read() })

    // ADD — the text is normalized where the signature is minted, never here,
    // so `HYPERCOMB.com` and `https://hypercomb.com/` are the one host they
    // obviously are. A value that is not a hostname mints nothing and says so
    // rather than adding an entry that can never resolve.
    this.onEffect<{ zone?: string }>('hosts:add', (p) => {
      const raw = String(p?.zone ?? '').trim()
      if (!raw) return
      void (async () => {
        const zone = await addCommunityHost(raw)
        if (!zone) {
          this.emitEffect('activity:log', { message: `${raw} is not a host` })
          return
        }
        this.emitEffect('activity:log', { message: `${zone} joined your community` })
        await this.#read()
      })()
    })

    // REMOVE — a DELETE of the artifact, not a withdrawal of a claim. Branches
    // that name it keep their marks; see the note at the top.
    this.onEffect<{ zone?: string }>('hosts:remove', (p) => {
      const raw = String(p?.zone ?? '').trim()
      if (!raw) return
      void (async () => {
        if (await removeCommunityHost(raw)) {
          this.emitEffect('activity:log', { message: `${hostZone(raw) || raw} left your community` })
        }
        await this.#read()
      })()
    })
    // There is deliberately no hosting switch here, and no effect for one.
    // Publishing arms the gate itself, and switching it off never took a
    // published site down — see the ratchet in community-hosts-panel.spec.ts.

    // First read is eager rather than deferred to the first open: the publish
    // picker offers this same list, and it must not be empty just because
    // nobody happened to look at the hosts panel first.
    //
    // It runs AGAIN once the Store registers. The eager read happens during
    // module load, before the Store exists, so it can list nothing and — more
    // to the point — cannot WRITE the seed. Reading twice is cheap; arriving
    // with no host to replicate from is not.
    void this.#read()
    try {
      window.ioc?.whenReady?.(STORE_KEY, () => { void this.#read() })
    } catch { /* no ioc yet — the eager read and the panel's open still cover it */ }
  }

  async #read(): Promise<void> {
    try {
      this.#zones = await listCommunityHosts()
      if (this.#zones.length === 0) await this.#seedOnce()
    } catch {
      // A pool that cannot be read is not an empty pool. Keep the last good
      // list rather than claiming you carry nothing.
      this.#zones = this.#zones ?? []
    }
    this.#loaded = true
    this.#emit()
  }

  /**
   * Put the one known host in an empty pool, once ever.
   *
   * Guarded by a flag rather than by emptiness alone: "the pool is empty"
   * is also true of a participant who deliberately removed every host,
   * and re-adding it there would make this entry the one host you cannot
   * get rid of — the exact shape of the bug that the community/marks split
   * was built to kill. Emptiness gets you the seed once; the flag makes
   * sure it is once.
   */
  async #seedOnce(): Promise<void> {
    try {
      if (localStorage.getItem(SEEDED_KEY) === '1') return
    } catch {
      // No storage means no way to remember having seeded, and a seed that
      // cannot be remembered is a seed that comes back. Don't plant it.
      return
    }

    const zone = await addCommunityHost(SEED_HOST)

    // THE FLAG IS SPENT ONLY ON SUCCESS. `addCommunityHost` answers '' when
    // the pool cannot be opened, which is exactly what happens on the eager
    // first read — the Store has not registered yet. Marking the seed done
    // before it landed burns the one chance and the participant is left with
    // nothing to replicate from, silently and for good. Leave the flag unset
    // and a later read plants it (adding is idempotent — the record is named
    // by its own content, so a double add is one member).
    if (!zone) return
    try { localStorage.setItem(SEEDED_KEY, '1') } catch { /* in-session only */ }

    this.#zones = await listCommunityHosts()
    this.emitEffect('activity:log', { message: `${zone} joined your community` })
  }

  #emit(): void {
    const payload: HostsRenderPayload = {
      open: this.#open,
      zones: [...this.#zones],
      loaded: this.#loaded,
    }
    this.emitEffect('hosts:render', payload)
  }
}

const _hosts = new HostsDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/HostsDrone',
  _hosts,
)
