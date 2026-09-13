// hypercomb-shared/ui/hosts-panel/hosts-panel.component.ts
//
// THE DOMAINS YOU CARRY — right-docked, `/hosts` opens it.
//
// Lifted out of the publish panel, where it had been a tab. Two things were
// wrong with living there and both are worth stating, because they are the
// reason this file exists rather than a preference about menus:
//
//   · A host is not a publishing setting. It exists before any branch names
//     it and outlives every branch that does, so reaching it through
//     "publish" meant you could only think about hosts while thinking about
//     publishing.
//   · The list did not exist until the publish panel had rendered once. The
//     hosts ARE the data set the publish picker offers, so the set has to be
//     readable on its own terms and not as a by-product of somebody else's
//     sweep.
//
// Shell UI, so it must NOT import essentials. The list arrives on
// `hosts:render` (HostsDrone owns the `community:hosts` pool) and leaves as
// intents: hosts:add, hosts:remove, hosts:close.
//
// WHAT A DOMAIN SHOWS HERE IS ITS CREATIONS — what people made and published,
// shown in your hive shaded until you walk into one. The app's own parts are
// NOT here: they are packages, turned on and off in the Packages window,
// which looks into a domain the same way (documentation/packages-window.md).
// This window used to carry a Builds half — versions of the app per domain,
// switched, confirmed, switched back. That noun is gone (2026-09-13): nothing
// switches; a part is on or off.
//
// The branch count is a DECORATION, not this panel's truth. It is read off
// `publish:render` when one has been seen, and simply absent otherwise —
// never a zero, because "no branches name this host" and "nobody has counted"
// are different facts and only one of them is knowable here.

import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import { Component, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { hostZone } from '@hypercomb/runtime/host-zones'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { signalSession } from '../window-session'

/** The guide stays open until it is put away, and stays put away. */
const GUIDE_KEY = 'hc:hosts:guide-closed'

const readGuideOpen = (): boolean => {
  try { return localStorage.getItem(GUIDE_KEY) !== '1' } catch { return true }
}

/** Mirrors HostsRenderPayload in sharing/hosts.drone.ts — shared cannot import
 *  essentials, so the shape is kept field-for-field by hand. */
interface HostsRenderPayload {
  open: boolean
  zones: string[]
  loaded: boolean
}

/** The only part of `publish:render` this panel reads. */
interface PublishRenderish {
  rows?: { zones?: string[] }[]
}

/** Mirrors HostCreationRow in essentials/sharing/static-peers.drone.ts —
 *  shared cannot import essentials, so the shape is kept field-for-field by
 *  hand. `offer` is opaque here on purpose: the panel sends it back exactly
 *  as it arrived, and only the drone knows how a plate becomes one. */
interface CreationRow {
  name: string
  title: string
  lineage: string
  host: string
  url: string
  publisherLabel: string
  offered: boolean
  offer: unknown | null
}

/** Mirrors HostCreationsRender. */
interface CreationsRenderish {
  zone?: string
  rows?: CreationRow[]
  answered?: boolean
}

/** One creation you carry, as `community:offers-render` reports it. */
interface MineRow {
  name: string
  pubkey: string
  lineageKey: string
  host: string
  hosts: string[]
}

interface OffersRenderish {
  offers?: MineRow[]
}

@Component({
  selector: 'hc-hosts-panel',
  standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './hosts-panel.component.html',
  styleUrls: ['./hosts-panel.component.scss'],
})
export class HostsPanelComponent implements OnDestroy {

  readonly visible = signal(false)

  /** Put away while the hive is covered, brought back on the way home. */
  readonly session = signalSession(this.visible, undefined, { close: () => this.close() })

  readonly zones = signal<string[]>([])
  readonly loaded = signal(false)
  readonly selectedZone = signal('')
  readonly addError = signal(false)

  /** The domain this app is running on. Not a row of its own and not called
   *  anything — the one thing it changes is that Visit is never drawn on it,
   *  because a second tab on your own hive is a second writer on one store. */
  readonly home = hostZone(location.host)
  /** Is the three-line guide showing? Open until put away. */
  readonly guideOpen = signal(readGuideOpen())

  /** zone → how many branches name it. Empty until a publish sweep has been
   *  seen; a missing entry renders as nothing at all. */
  readonly naming = signal<Record<string, number>>({})

  // ── the creations ────────────────────────────────────────────────────────
  //
  // A domain serves what people made and published, taken one tile at a time
  // by the swarm's own grammar. The creations are the reason a person adds
  // somebody's domain at all.

  /** zone → what it serves. Absent = never asked. */
  readonly creations = signal<Record<string, { rows: CreationRow[]; answered: boolean }>>({})
  /** What you carry, and whether that has been reported yet. */
  readonly mine = signal<MineRow[]>([])
  readonly mineKnown = signal(false)
  /** Is your own list unfolded? It is the answer to "what did I take", which
   *  is a question you ask on purpose. */
  readonly mineOpen = signal(false)

  #cleanups: (() => void)[] = []

  constructor() {
    this.#cleanups.push(EffectBus.on<HostsRenderPayload>('hosts:render', (p) => {
      this.visible.set(!!p?.open)
      const zones = Array.isArray(p?.zones) ? p.zones : []
      this.zones.set(zones)
      this.loaded.set(!!p?.loaded)
      if (this.selectedZone() && !zones.includes(this.selectedZone())) this.selectedZone.set('')
    }))

    // WHAT A DOMAIN SERVES. Asked when you look into one, answered by the
    // drone that owns the offers document — so the switch's state and the
    // list it sits in can never disagree.
    this.#cleanups.push(EffectBus.on<CreationsRenderish>('hosts:creations:render', (p) => {
      const zone = String(p?.zone ?? '')
      if (!zone) return
      this.creations.set({ ...this.creations(), [zone]: { rows: p?.rows ?? [], answered: !!p?.answered } })
    }))

    // WHAT YOU CARRY — the creations you have asked to see, wherever you
    // asked from. Replayed, so opening the panel never shows an empty list
    // it has not actually read.
    this.#cleanups.push(EffectBus.on<OffersRenderish>('community:offers-render', (p) => {
      this.mine.set(Array.isArray(p?.offers) ? p!.offers! : [])
      this.mineKnown.set(true)
    }))

    // Decoration only — see the note at the top. EffectBus replays the last
    // value, so if publish has ever swept, the counts are here immediately.
    this.#cleanups.push(EffectBus.on<PublishRenderish>('publish:render', (p) => {
      const counts: Record<string, number> = {}
      for (const row of p?.rows ?? []) {
        for (const zone of row?.zones ?? []) counts[zone] = (counts[zone] ?? 0) + 1
      }
      this.naming.set(counts)
    }))
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
    this.#cleanups = []
  }

  close(): void {
    EffectBus.emit('hosts:close', {})
  }

  // ── the guide, and the list ──────────────────────────────────────────────

  toggleGuide(): void {
    const open = !this.guideOpen()
    this.guideOpen.set(open)
    try { localStorage.setItem(GUIDE_KEY, open ? '0' : '1') } catch { /* storage unavailable */ }
  }

  /** Is this the domain the app is running on? Only Visit asks. */
  isHome(zone: string): boolean {
    return !!this.home && hostZone(zone) === this.home
  }

  /** Where a domain is tried on its own terms. */
  visitUrl(zone: string): string {
    return `https://${zone}/`
  }

  /** Take a host into your community. Normalization happens where the
   *  signature is minted, so `HYPERCOMB.com` and `https://hypercomb.com/`
   *  are the one host they obviously are — and a value that is not a
   *  hostname is refused there, with nothing added here. */
  add(input: HTMLInputElement): void {
    const zone = hostZone(input.value)
    if (!zone) {
      this.addError.set(true)
      input.focus()
      return
    }
    this.addError.set(false)
    EffectBus.emit('hosts:add', { zone })
    input.value = ''
  }

  /** Drop a host. A DELETE of the artifact — branches that name it keep their
   *  marks, still saying where they publish, which stays true of a host you no
   *  longer carry. */
  remove(zone: string): void {
    if (this.selectedZone() === zone) this.selectedZone.set('')
    EffectBus.emit('hosts:remove', { zone })
  }

  /** How many branches name this host, or 0 when no publish sweep has been
   *  seen — the template shows the count only when it is a real one. */
  branchCount(zone: string): number {
    return this.naming()[zone] ?? 0
  }

  /** Look into a domain: what it serves is asked at that moment and answered
   *  by the drone that owns the offers. Looking again closes it. */
  look(zone: string): void {
    if (this.selectedZone() === zone) { this.selectedZone.set(''); return }
    this.selectedZone.set(zone)
    EffectBus.emit('hosts:creations', { zone })
  }

  /** The app's parts a domain serves are packages — the same list, there. */
  packages(zone: string): void {
    EffectBus.emit('packages:open', { zone })
  }

  // ── the creations a domain serves, and the one switch on each ────────────

  /** The rows this domain serves, or [] while the answer is still coming. */
  creationsOf(zone: string): CreationRow[] {
    return this.creations()[zone]?.rows ?? []
  }

  /** Has this domain's ledger been heard from at all? */
  creationsKnown(zone: string): boolean {
    return zone in this.creations()
  }

  /** The ledger answered and listed nothing — distinct from not answering. */
  creationsAnswered(zone: string): boolean {
    return this.creations()[zone]?.answered === true
  }

  /**
   * THE ONE ACT ON A CREATION: show it in your hive, or stop showing it.
   *
   * Never "adopt this branch". An offer puts the creation in your hive as a
   * shaded tile and nothing else happens until you walk into it — every step
   * from there is yours (see static-peers.ts). A row whose plate carries no
   * verified head has no offer to send, and its switch is not drawn.
   */
  toggleCreation(row: CreationRow): void {
    if (row.offered) { EffectBus.emit('community:withdraw', { name: row.name }); return }
    if (!row.offer) return
    EffectBus.emit('community:offer', row.offer)
  }

  /** What your hive carries, from every domain at once — the list you are
   *  left with "when you're done". */
  mineCount(): number {
    return this.mine().length
  }

  toggleMine(): void {
    this.mineOpen.set(!this.mineOpen())
  }

  /** Stop showing one. The publisher keeps publishing it; your hive stops
   *  carrying it, and anything you already TOOK from it stays yours. */
  withdraw(row: MineRow): void {
    EffectBus.emit('community:withdraw', { name: row.name })
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts). 144 puts it immediately before
// the publish panel (145), which is where it was reached from until now and
// where a reader will look for it first.
registerShellSurface({
  name: 'hc-hosts-panel',
  owner: '@hypercomb.shared/HostsPanelComponent',
  component: HostsPanelComponent,
  order: 144,
})
