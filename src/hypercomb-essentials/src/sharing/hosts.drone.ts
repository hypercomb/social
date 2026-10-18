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
// The window is the host directory (host-directory.view.ts), an element that
// reads the list off `hosts:render` and hands back intents (hosts:add,
// hosts:remove, hosts:close) — this drone stays the pool's one writer.

import { Drone, isWindowShowing } from '@hypercomb/core'
import {
  addCommunityHost,
  hostZone,
  listCommunityHosts,
  removeCommunityHost,
} from './community-hosts.js'
import { updateScout } from './update-scout.service.js'
import { ATTESTATION_IOC_KEY } from '@hypercomb/core'
import { packageAttestation } from './package-attestation.js'

const STORE_KEY = '@hypercomb.social/Store'

// THE DIRECTORY ARRIVES WITH ITS OPEN, not at boot (atomic-modules-plan.md,
// "adopt the proper load"). The view is 60 KB nothing needs until the window
// is asked for, so its surface registers by TAG at boot — the shell's host
// makes it with createElement — and the element is defined from one cached
// import() when the window is asked for. The element already in the page
// then upgrades in place, subscribes, and the bus replays what it missed:
// `hosts:render` is state (open or not), never a stamp, so a slow first load
// cannot outlive the ask. The tag and the key are spelled here because
// importing even a const from the view would keep it on the boot path.
const HOST_DIRECTORY_SURFACE = 'hc-host-directory'
const HOST_DIRECTORY_VIEW_KEY = '@diamondcoreprocessor.com/HostDirectoryView'
/** Where the directory was when a change restarted the app. The view reads
 *  and clears it; this bee only asks whether it is there, and loads. */
const REOPEN_KEY = 'hc:hosts:reopen'

type HostDirectoryView = typeof import('./host-directory.view.js')
let directory: Promise<HostDirectoryView> | null = null
/** The view once it is here, for the IoC face to forward to. */
let directoryView: HostDirectoryView | null = null
const loadDirectory = (): Promise<HostDirectoryView> => directory ??= import('./host-directory.view.js').then(view => {
  const { HostDirectoryElement } = view
  if (!customElements.get(HOST_DIRECTORY_SURFACE)) customElements.define(HOST_DIRECTORY_SURFACE, HostDirectoryElement)
  directoryView = view
  return view
}).catch(error => { directory = null; throw error })

const reopening = (): boolean => {
  try { return !!sessionStorage.getItem(REOPEN_KEY) } catch { return false }
}

// NO HOST IS SEEDED (jwize, 2026-10-11: "Let's just make sure that there
// isn't a default host"). An empty pool stays empty until the participant adds
// a host. A cold install still has somewhere to read from — the shell's
// DEFAULT_HOST_ZONES, a READ source only (ensure-install.ts) — and the swarm's
// upload host is never this pool (swarm-hosts.ts: publish marks, else the host
// field, else none). A pool an older package seeded keeps its member: nothing
// is removed and no key is cleared; it is simply a host you read from.

/** YOUR OWN HOST — the domain this participant serves from: host-sync's
 *  backup target and the content broker's first door. Set in the host
 *  directory (`hosts:own-host`); it was the swarm selector's "host" field
 *  until 2026-10-12, when the selector came to show only what defines a
 *  meeting (meeting point, room, secret, code) — a host is replication,
 *  never who meets. The key every reader reads (host-sync, the broker,
 *  feature availability) is unchanged. */
const OWN_HOST_KEY = 'hc:nostrmesh:self-domain'
/** Host-sync is the key's one writer (setOwnHost) — the module that already
 *  wrote it for `enable`; this drone only names what it is told. */
const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'

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
    'hosts:view-toggle', 'hosts:open', 'hosts:close', 'hosts:refresh', 'hosts:add', 'hosts:remove', 'hosts:own-host', 'packages:open',
  ]
  protected override emits: string[] = ['hosts:render', 'activity:log']

  #open = false
  #loaded = false
  #zones: string[] = []

  constructor() {
    super()

    // A press is a press NOW: the bus replays the last toggle to a listener
    // as it subscribes, and a drone loading after some earlier press would
    // open the directory nobody just asked for. `hosts:open` and
    // `packages:open` keep their replay — they are the late-load door.
    let live = false
    this.onEffect('hosts:view-toggle', () => {
      if (!live) return
      // THE ICON ASKS THE SCREEN, NEVER THE FLAG.
      //
      // A docked panel is PARKED — not closed — whenever another window opens
      // (window-rule.ts): its DOM goes, this drone is never told, and `#open`
      // stays true over an empty edge. The next press on the glyph then only
      // cleared a flag nobody could see, and it took a SECOND press to get the
      // panel back. `isWindowShowing` is the panel's own registration in the
      // window session, dropped the moment it stops showing — so parked and
      // closed read alike, which is exactly what the participant means.
      this.#open = !isWindowShowing('hosts-panel')
      this.#emit()
      if (this.#open) { this.#loadView(); void this.#read() }
    })
    live = true

    // Cross-surface navigation is an OPEN, never a toggle. A docked panel can
    // be parked while its drone remains open; toggling from Publish would then
    // close the very directory the participant asked to see.
    this.onEffect('hosts:open', () => {
      this.#open = true
      this.#emit()
      this.#loadView()
      void this.#read()
    })

    // THE UPDATE DOOR. `packages:open` (the shell's pill, /upgrade, every
    // "packages on this host" door) is answered by the view, which scopes its
    // list and asks for `hosts:open`; it loads with the door, and the bus
    // replays the door to it. This listener stays for good: the shell's floor
    // asks the bus whether anything answers the door (package-floor.ts), and a
    // package whose door goes unanswered is moved as too old to update itself.
    this.onEffect('packages:open', () => this.#loadView())

    // Back where a change restarted the app from: the view reopens itself
    // from the note it left, once its code is here to read it.
    if (reopening()) this.#loadView()

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
    // YOUR OWN HOST — named in the directory, kept as its bare zone; an
    // empty name clears it. Nothing else changes with it: it is where your
    // backup goes, never who you meet.
    this.onEffect<{ host?: unknown }>('hosts:own-host', (p) => {
      const raw = String(p?.host ?? '').trim()
      const zone = raw ? hostZone(raw) : ''
      if (raw && !zone) { this.emitEffect('activity:log', { message: `${raw} is not a host` }); return }
      let held = ''
      try { held = hostZone(localStorage.getItem(OWN_HOST_KEY) ?? '') } catch { return }
      if (zone === held) return
      const hostSync = window.ioc?.get?.(HOST_SYNC_KEY) as { setOwnHost?: (host: string) => void } | undefined
      if (typeof hostSync?.setOwnHost !== 'function') return
      hostSync.setOwnHost(zone)
      this.emitEffect('activity:log', { message: zone ? `your own host is ${zone}` : 'no own host' })
    })

    // There is deliberately no hosting switch here, and no effect for one.
    // Publishing arms the gate itself, and switching it off never took a
    // published site down — see the ratchet in community-hosts-panel.spec.ts.

    // First read is eager rather than deferred to the first open: the publish
    // picker offers this same list, and it must not be empty just because
    // nobody happened to look at the hosts panel first.
    //
    // It runs AGAIN once the Store registers. The eager read happens during
    // module load, before the Store exists, so it can list nothing. Reading
    // twice is cheap; a list that stays empty when hosts are carried is not.
    void this.#read()
    try {
      window.ioc?.whenReady?.(STORE_KEY, () => { void this.#read() })
    } catch { /* no ioc yet — the eager read and the panel's open still cover it */ }
  }

  /** Fetch the directory's code once; the replayed `hosts:render` shows it.
   *  A failed load says so and reads as closed, and the next ask tries again. */
  #loadView(): void {
    const starting = !directory
    const loading = loadDirectory()
    if (!starting) return
    loading.catch(error => {
      this.emitEffect('activity:log', { message: `Could not load the host directory: ${error instanceof Error ? error.message : String(error)}` })
      if (!this.#open) return
      this.#open = false
      this.#emit()
    })
  }

  async #read(): Promise<void> {
    try {
      this.#zones = await listCommunityHosts()
    } catch {
      // A pool that cannot be read is not an empty pool. Keep the last good
      // list rather than claiming you carry nothing.
      this.#zones = this.#zones ?? []
    }
    this.#loaded = true
    this.#emit()
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

// THE BEE WIRES (atomic-modules-plan.md): a dependency registers nothing;
// its owner bee registers it.
window.ioc.register('@diamondcoreprocessor.com/UpdateScoutService', updateScout)
window.ioc.register(ATTESTATION_IOC_KEY, packageAttestation)

// The host directory's IoC face (atomic-modules-plan.md), registered ONCE and
// forwarding: a key keeps its first value, so a stand-in swapped for the real
// face after the load would answer "closed" for good.
window.ioc.register(HOST_DIRECTORY_VIEW_KEY, {
  get open(): boolean { return directoryView?.hostDirectoryFacade.open ?? false },
})
// THE BEE WIRES (atomic-modules-plan.md): the view is a dependency; this bee
// adds its tag to the shell's surface registry — never a tag in either
// app.html — and defines the element when the window is first asked for.
window.ioc.whenReady('@hypercomb.social/ShellSurfaceRegistry', (registry: { add(s: unknown): void }) => {
  try {
    registry.add({ name: HOST_DIRECTORY_SURFACE, owner: HOST_DIRECTORY_VIEW_KEY, element: HOST_DIRECTORY_SURFACE, order: 144 })
  } catch {
    // duplicate add (hot reload) — the mounted surface is already live
  }
})

const _hosts = new HostsDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/HostsDrone',
  _hosts,
)
