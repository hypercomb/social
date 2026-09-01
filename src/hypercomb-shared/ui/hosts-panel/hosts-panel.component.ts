// hypercomb-shared/ui/hosts-panel/hosts-panel.component.ts
//
// THE HOSTS YOU CARRY — right-docked, `/hosts` opens it.
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
// The branch count is a DECORATION, not this panel's truth. It is read off
// `publish:render` when one has been seen, and simply absent otherwise —
// never a zero, because "no branches name this host" and "nobody has counted"
// are different facts and only one of them is knowable here.

import { registerShellSurface } from '../../core/shell-surface-registry'
import { Component, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
// The SAME reader the shim uses on a cold boot. It lives in runtime precisely
// so there is one answer to "what does this domain publish" — essentials
// cannot reach runtime (it imports core and nothing else), which is why this
// call sits in the panel rather than in HostsDrone.
import { listHostPackages, type HostPackage } from '@hypercomb/runtime/host-packages'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { signalSession } from '../window-session'

/** What one host publishes, once asked. `null` while in flight. */
type Offer = { packages: HostPackage[]; shown: HostPackage[] } | null

/** How many packages a host lists before the row says "and N more". A manifest
 *  can hold hundreds (jwize.com publishes 171), and a picker that printed all
 *  of them would be a scroll, not a choice. The count is always stated — a
 *  silently truncated list reads as "this is everything". */
const OFFERS_SHOWN = 8

/** Mirrors HostsRenderPayload in sharing/hosts.drone.ts — shared cannot import
 *  essentials, so the shape is kept field-for-field by hand. */
interface HostsRenderPayload {
  open: boolean
  zones: string[]
  loaded: boolean
  hosting: boolean
}

/** The only part of `publish:render` this panel reads. */
interface PublishRenderish {
  rows?: { zones?: string[] }[]
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

  /** THE SWITCH — whether this participant publishes bytes to a public host
   *  at all. One global state; there is no `/host` behaviour and no
   *  per-branch version of this question. */
  readonly hosting = signal(false)

  /** zone → how many branches name it. Empty until a publish sweep has been
   *  seen; a missing entry renders as nothing at all. */
  readonly naming = signal<Record<string, number>>({})

  #cleanups: (() => void)[] = []

  constructor() {
    this.#cleanups.push(EffectBus.on<HostsRenderPayload>('hosts:render', (p) => {
      this.visible.set(!!p?.open)
      this.zones.set(Array.isArray(p?.zones) ? p.zones : [])
      this.loaded.set(!!p?.loaded)
      this.hosting.set(!!p?.hosting)
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

  /** Take a host into your community. Normalization happens where the
   *  signature is minted, so `HYPERCOMB.com` and `https://hypercomb.com/`
   *  are the one host they obviously are — and a value that is not a
   *  hostname is refused there, with nothing added here. */
  add(input: HTMLInputElement): void {
    const zone = input.value.trim()
    if (!zone) return
    EffectBus.emit('hosts:add', { zone })
    input.value = ''
  }

  /** Drop a host. A DELETE of the artifact — branches that name it keep their
   *  marks, still saying where they publish, which stays true of a host you no
   *  longer carry. */
  remove(zone: string): void {
    EffectBus.emit('hosts:remove', { zone })
  }

  /** Flip public hosting. Turning it ON prompts for consent in the drone —
   *  the panel only states the intent. The signal is NOT set optimistically:
   *  it moves when the drone says it moved, so a declined consent leaves the
   *  switch where it was rather than showing a state that never happened. */
  toggleHosting(): void {
    EffectBus.emit('hosts:set-hosting', { on: !this.hosting() })
  }

  /** How many branches name this host, or 0 when no publish sweep has been
   *  seen — the template shows the count only when it is a real one. */
  branchCount(zone: string): number {
    return this.naming()[zone] ?? 0
  }

  // ── what this host publishes ──────────────────────────────────────────────
  //
  // ON DEMAND, never on open. A manifest is not small — jwize.com's is 3.4 MB
  // — so asking every carried host the moment the panel appears would spend
  // megabytes to answer a question nobody asked. One host, when you look at it.

  /** zone → what it offers. Absent = never asked; null = asking. */
  readonly offers = signal<Record<string, Offer>>({})
  /** Zones asked at least once, so "nothing" reads as an answer, not a blank. */
  readonly asked = signal<Set<string>>(new Set())

  isProbing(zone: string): boolean {
    return zone in this.offers() && this.offers()[zone] === null
  }

  wasAsked(zone: string): boolean {
    return this.asked().has(zone)
  }

  offerOf(zone: string): Offer {
    return this.offers()[zone] ?? null
  }

  /** How many were NOT shown, so a truncated list never reads as the whole. */
  moreCount(zone: string): number {
    const offer = this.offers()[zone]
    return offer ? offer.packages.length - offer.shown.length : 0
  }

  /**
   * Ask a domain what it publishes. Toggles closed if it is already open, so
   * the same control opens and puts away.
   *
   * Unreachable, not-a-host and publishes-nothing all land as an empty list.
   * That is deliberate: this is a picker, and the three have the same thing to
   * show. Telling them apart is the host check's job (`check-host.mjs`), which
   * says WHICH rule an origin misses and what to change.
   */
  async look(zone: string): Promise<void> {
    if (zone in this.offers()) {
      const next = { ...this.offers() }
      delete next[zone]
      this.offers.set(next)
      return
    }

    this.offers.set({ ...this.offers(), [zone]: null })
    const packages = await listHostPackages(zone)
    this.asked.set(new Set([...this.asked(), zone]))
    this.offers.set({
      ...this.offers(),
      [zone]: { packages, shown: packages.slice(0, OFFERS_SHOWN) },
    })
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
