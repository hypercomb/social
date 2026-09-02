// hypercomb-shared/ui/presence-banner/presence-banner.component.ts
//
// Quiet, top-centered strip that surfaces who is at the current
// composedSig. Hidden when there's no swarm context. Renders one
// initials badge per participant — you first, then each peer — with a
// distinct fluorescent text colour derived from identity, so the set
// of people present is glanceable at a stroke.
//
// Your own badge is click-to-name: tapping it opens an inline field
// that writes through SwarmDrone.setMyLabel(), which persists to
// localStorage. The name is sticky across sessions — set it once, and
// every future arrival stamps it onto your outgoing layers.
//
// Clicking a peer badge expands the participant panel: one row per
// peer with two icon toggles — subscribe (data flow + consent
// handshake) and follow (navigation sync).
//
// Source: SwarmDrone effects + APIs. The strip stays inert without a
// SwarmDrone in IoC, so non-swarm shells pay zero cost.
//
// Private mode gate: presence is a public (swarm) concept. In private
// mode the mesh network is disabled, so no peer can ever surface — it's
// only you. Showing a participant badge for yourself alone is noise, so
// the whole strip stays hidden until mesh-public is on. Driven by the
// processor's 'mesh:public-changed' broadcast (last-value replay →
// correct on mount, even if we subscribe after the initial emit).

import { registerShellSurface } from '../../core/shell-surface-registry'
import { Component, ElementRef, inject, signal, computed, effect, viewChild, type OnDestroy, type OnInit } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

interface PresencePayload {
  sig?: string
  peerCount?: number
  alone?: boolean
  peers?: readonly string[]
  reason?: string
}

interface SwarmLabelApi {
  labelFor: (pubkey: string) => string
  myLabel: () => string
  setMyLabel: (label: string) => void
}

interface SwarmConsumerApi extends SwarmLabelApi {
  subscribedTo: () => string
  following: () => string
  subscribeTo: (pubkey: string | null) => Promise<void>
  follow: (pubkey: string | null) => Promise<void>
}

/** The participant filter (essentials SwarmFilterService), consumed via
 *  IoC at runtime — shared never imports modules. */
interface SwarmFilterApi {
  selected: ReadonlySet<string>
  toggle: (pubkey: string) => void
}

/** One participant chip in the top strip. */
interface Badge {
  /** Stable track key — pubkey for peers, 'self' for you. */
  key: string
  /** Two-letter initials (or '+' for an unnamed self badge). */
  initials: string
  /** Fluorescent text colour, hashed from identity. */
  color: string
  /** Matching neon glow for text-shadow. */
  glow: string
  isSelf: boolean
  /** True on the self badge when no label is set yet — renders the
   *  "add name" affordance instead of letters. */
  unnamed: boolean
  /** True when this peer is in the participant-filter selection. */
  selected: boolean
}

const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const SWARM_FILTER_KEY = '@diamondcoreprocessor.com/SwarmFilterService'

@Component({
  selector: 'hc-presence-banner',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './presence-banner.component.html',
  styleUrls: ['./presence-banner.component.scss'],
})
export class PresenceBannerComponent implements OnInit, OnDestroy {

  #unsubs: (() => void)[] = []

  /** The strip's own element — the containment test for the
   *  dismiss-on-outside-pointer handler. */
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef)

  /** Whether the swarm has connected at any point this session.
   *  Gates rendering — until the first presence event lands, the
   *  strip stays hidden (no flashing on cold boot). */
  readonly #seen = signal(false)

  /** True while mesh-public (swarm) mode is on. Private mode can never
   *  have peers, so the strip stays hidden — presence is a public-only
   *  affordance. Seeded from the processor's 'mesh:public-changed'
   *  broadcast (last-value replay makes it correct on mount). */
  readonly #public = signal(false)

  /** Pubkeys of the live participants at our location. Sorted by
   *  the swarm drone (freshest first). */
  readonly #peers = signal<readonly string[]>([])

  /** True when the swarm published a presence event and we're alone. */
  readonly #alone = signal(true)

  /** Our own chosen label. Seeded from the swarm on mount, updated
   *  locally the instant we rename (setMyLabel persists it). */
  readonly #myLabel = signal('')

  /** Bumped whenever a peer's label lands, forcing badge recompute so
   *  a peer that arrived unlabelled gets re-lettered on their next
   *  event. */
  readonly #labelVersion = signal(0)

  /** Expanded participant panel state. Toggles on peer-badge click. */
  readonly expanded = signal(false)

  /** Inline name editor state + draft. */
  readonly editingName = signal(false)
  readonly draftName = signal('')

  /** The inline name field, present only while editing. Angular signal
   *  queries can't sit on an ES-private (`#`) member, so this stays a
   *  public readonly field per the codebase's viewChild convention. */
  readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput')

  constructor() {
    // Focus + select the field the moment it renders — the HTML
    // `autofocus` attribute doesn't fire on dynamically-inserted nodes.
    effect(() => {
      if (!this.editingName()) return
      const el = this.nameInput()?.nativeElement
      if (el) queueMicrotask(() => { el.focus(); el.select() })
    })
  }

  /** Live subscribe + follow targets — mirrored from swarm via
   *  EffectBus so the row indicators update without polling. */
  readonly #subscribedTo = signal('')
  readonly #following = signal('')

  /** Participant-filter selection, mirrored from `swarm:filter`
   *  (SwarmFilterService owns the truth; empty = everyone shows). */
  readonly #selected = signal<ReadonlySet<string>>(new Set())

  readonly visible = computed(() => this.#seen() && this.#public())
  readonly alone = computed(() => this.#alone())
  readonly peerCount = computed(() => this.#peers().length)

  /** The full badge strip — you first, then each peer. Recomputes on
   *  peer changes, label arrivals, and self renames. */
  readonly badges = computed<readonly Badge[]>(() => {
    this.#labelVersion() // dependency: re-run when any label lands
    const swarm = this.#swarm()
    const out: Badge[] = []

    // Self badge always leads the strip.
    const myLabel = this.#myLabel().trim()
    out.push({
      key: 'self',
      ...this.#chip(myLabel || 'me'),
      initials: myLabel ? this.#initials(myLabel) : '+',
      isSelf: true,
      unnamed: !myLabel,
      selected: false,
    })

    const selected = this.#selected()
    for (const pk of this.#peers()) {
      const label = (swarm?.labelFor?.(pk) ?? '').trim()
      out.push({
        key: pk,
        // Colour seeds from the stable pubkey, not the label — a peer
        // keeps their hue even before (and across) a rename.
        ...this.#chip(pk),
        initials: label ? this.#initials(label) : pk.slice(0, 2).toUpperCase(),
        isSelf: false,
        unnamed: false,
        selected: selected.has(pk),
      })
    }
    return out
  })

  // (The bulk adopt chip is retired with the adopt button — visiting a
  // peer's tiles is the acquisition now. The participant filter itself
  // stays: selecting peers still scopes the canvas to their tiles.)

  /** Per-row participant data for the expanded panel. Labels
   *  collide-safe: when two peers share a label, we suffix the
   *  pubkey to disambiguate ("Alice • a1b2"). */
  readonly rows = computed<readonly { pubkey: string; label: string; subscribed: boolean; following: boolean; selected: boolean }[]>(() => {
    this.#labelVersion()
    const peers = this.#peers()
    const swarm = this.#swarm()
    const subscribedTo = this.#subscribedTo()
    const following = this.#following()
    const selected = this.#selected()
    const raw = peers.map(pk => ({
      pubkey: pk,
      label: (swarm?.labelFor?.(pk) ?? '').trim() || `${pk.slice(0, 6)}…`,
    }))
    const labelCount = new Map<string, number>()
    for (const r of raw) labelCount.set(r.label, (labelCount.get(r.label) ?? 0) + 1)
    return raw.map(r => ({
      pubkey: r.pubkey,
      label: (labelCount.get(r.label) ?? 0) > 1
        ? `${r.label} • ${r.pubkey.slice(0, 4)}`
        : r.label,
      subscribed: r.pubkey === subscribedTo && !!subscribedTo,
      following: r.pubkey === following && !!following,
      selected: selected.has(r.pubkey),
    }))
  })

  ngOnInit(): void {
    const swarm = this.#swarm()
    if (swarm) {
      try { this.#myLabel.set(swarm.myLabel() ?? '') } catch { /* default empty */ }
      try { this.#subscribedTo.set(swarm.subscribedTo() ?? '') } catch { /* default empty */ }
      try { this.#following.set(swarm.following() ?? '') } catch { /* default empty */ }
    }

    this.#unsubs.push(
      EffectBus.on<PresencePayload>('swarm:presence-changed', (payload) => {
        // The swarm exists by the time it reports presence. On the web
        // shell the drones arrive from OPFS AFTER this strip mounted, so
        // the one-time read in ngOnInit found no swarm and left the label
        // empty for the whole session — the badge offered "+" to someone
        // who had named themselves. Seed it here once the swarm is there.
        if (!this.#myLabel()) {
          try { const l = this.#swarm()?.myLabel?.() ?? ''; if (l) this.#myLabel.set(l) } catch { /* default empty */ }
        }
        const peers = Array.isArray(payload?.peers) ? payload.peers : []
        const alone = payload?.alone ?? peers.length === 0
        this.#peers.set(peers)
        this.#alone.set(alone)
        this.#seen.set(true)
        // Last peer left: the caret unmounts with them, so an expanded
        // panel would have no way left to close. Collapse with them.
        if (alone) this.expanded.set(false)
      }),

      // A label arrived (or changed) — force badge/row recompute. Our OWN
      // rename lands here too (`self`) when it was saved through the mesh
      // selector rather than this strip's inline field.
      EffectBus.on<{ label?: string; self?: boolean }>('swarm:label-changed', (p) => {
        if (p?.self && typeof p.label === 'string') this.#myLabel.set(p.label)
        this.#labelVersion.update(v => v + 1)
      }),

      // Subscribe/follow target changes — mirror into local signals
      // so row state lights up the moment the swarm flips.
      EffectBus.on<{ pubkey?: string }>('swarm:subscription-changed', (p) => {
        this.#subscribedTo.set(String(p?.pubkey ?? ''))
      }),
      EffectBus.on<{ pubkey?: string }>('swarm:following-changed', (p) => {
        this.#following.set(String(p?.pubkey ?? ''))
      }),

      // Public/private toggle — presence is public-only, so the strip
      // hides the instant mesh-public goes off (and reappears on).
      EffectBus.on<{ public?: boolean }>('mesh:public-changed', ({ public: pub }) => {
        this.#public.set(!!pub)
      }),

      // Participant-filter selection — mirror so badges/rows relight
      // (the service reconciles departures on peers-changed itself).
      EffectBus.on<{ participants?: readonly string[] }>('swarm:filter', (p) => {
        this.#selected.set(new Set((p?.participants ?? []).map(String)))
      }),
    )

    // The panel is dismissible from anywhere: a pointer down outside
    // the strip, or Escape, collapses it. The caret alone was the only
    // way out — a small target that is easy to miss on a phone, which
    // is why the panel read as stuck open once shown.
    const onPointerDown = (ev: Event) => {
      if (!this.expanded()) return
      const root = this.#host.nativeElement as HTMLElement
      if (root.contains(ev.target as Node)) return
      this.expanded.set(false)
    }
    const onKeydown = (ev: KeyboardEvent) => {
      if (!this.expanded() || ev.key !== 'Escape') return
      ev.stopPropagation()
      this.expanded.set(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeydown, true)
    this.#unsubs.push(() => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeydown, true)
    })

    // Seed from the live service — the replayed effect covers most
    // mounts, but a fresh mount before any toggle has no last value.
    const filter = this.#filter()
    if (filter) this.#selected.set(new Set(filter.selected))
  }

  /** Click a peer badge (or their row name) → toggle that participant
   *  in the canvas filter. No selection = everyone shows. */
  onPeerBadgeClick(pubkey: string): void {
    this.#filter()?.toggle(pubkey)
  }

  /** The caret toggles the expanded participant panel (expansion no
   *  longer rides badge clicks — those select). */
  onCaretClick(): void {
    if (this.#alone()) return
    this.expanded.set(!this.expanded())
  }

  /** Click your own badge → open the inline name editor. */
  onSelfBadgeClick(): void {
    this.draftName.set(this.#myLabel())
    this.editingName.set(true)
  }

  /** Commit the drafted name. Writes through the swarm (persists to
   *  localStorage) and updates the local mirror so the badge reletters
   *  immediately. Empty input clears the name. Guarded on the editor
   *  being open so the blur that follows Enter/Escape is a no-op. */
  commitName(): void {
    if (!this.editingName()) return
    const next = this.draftName().trim().slice(0, 64)
    const swarm = this.#swarm()
    try { swarm?.setMyLabel?.(next) } catch { /* best-effort */ }
    this.#myLabel.set(next)
    this.editingName.set(false)
  }

  /** Close without saving. Flips the flag first so the blur-triggered
   *  commit early-returns. */
  cancelName(): void {
    this.editingName.set(false)
  }

  /** Keep the editor's keystrokes out of the app's global shortcuts;
   *  Enter commits, Escape cancels. */
  onNameKeydown(ev: KeyboardEvent): void {
    ev.stopPropagation()
    if (ev.key === 'Enter') { ev.preventDefault(); this.commitName() }
    else if (ev.key === 'Escape') { ev.preventDefault(); this.cancelName() }
  }

  onNameInput(ev: Event): void {
    this.draftName.set((ev.target as HTMLInputElement)?.value ?? '')
  }

  /** Row action: flip subscribe for this pubkey. Single-target — if
   *  already subscribed to someone else, the swarm switches. Calling
   *  with the same pubkey unsubscribes (toggle semantics). */
  onSubscribeToggle(pubkey: string): void {
    const swarm = this.#swarm()
    if (!swarm?.subscribeTo) return
    const current = swarm.subscribedTo()
    void swarm.subscribeTo(current === pubkey ? null : pubkey)
  }

  /** Row action: flip follow (nav-sync) for this pubkey. */
  onFollowToggle(pubkey: string): void {
    const swarm = this.#swarm()
    if (!swarm?.follow) return
    const current = swarm.following()
    void swarm.follow(current === pubkey ? null : pubkey)
  }

  ngOnDestroy(): void {
    for (const u of this.#unsubs) u()
    this.#unsubs.length = 0
  }

  // ── helpers ───────────────────────────────────────────

  #swarm(): SwarmConsumerApi | undefined {
    return (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(SWARM_KEY) as SwarmConsumerApi | undefined
  }

  #filter(): SwarmFilterApi | undefined {
    return (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(SWARM_FILTER_KEY) as SwarmFilterApi | undefined
  }

  /** Two-letter initials from a label. Two+ words → first letter of
   *  each of the first two words; one word → its first two characters.
   *  Codepoint-safe so emoji/astral names don't split mid-surrogate. */
  #initials(label: string): string {
    const parts = label.trim().split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      return (this.#head(parts[0]) + this.#head(parts[1])).toUpperCase()
    }
    return Array.from(parts[0] ?? '').slice(0, 2).join('').toUpperCase()
  }

  #head(s: string): string {
    return Array.from(s)[0] ?? ''
  }

  /** Fluorescent chip colour + glow, hashed from a seed so each
   *  identity gets a stable, distinct neon hue. */
  #chip(seed: string): { color: string; glow: string } {
    const hue = this.#hue(seed)
    return {
      color: `hsl(${hue} 100% 64%)`,
      glow: `0 0 6px hsl(${hue} 100% 58% / 0.7), 0 0 2px hsl(${hue} 100% 74% / 0.85)`,
    }
  }

  /** DJB2 → hue in [0, 360). */
  #hue(seed: string): number {
    let h = 5381
    for (let i = 0; i < seed.length; i++) {
      h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0
    }
    return h % 360
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-presence-banner',
  owner: '@hypercomb.shared/PresenceBannerComponent',
  component: PresenceBannerComponent,
  order: 330,
})
