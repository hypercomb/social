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
// LOOKING INTO A HOST answers two questions and offers one act: which build
// you are on, which build is newest there, and Update. A host's manifest can
// list hundreds of builds and every one of them is a valid root forever, but
// a list of 175 identical-looking rows each with its own button is not a
// choice anyone can make — the question a participant actually has is "am I
// current, and if not, make me current". The full ledger stays a fold away
// for pinning and rollback, which is where "every root stays valid" earns
// its keep.
//
// The branch count is a DECORATION, not this panel's truth. It is read off
// `publish:render` when one has been seen, and simply absent otherwise —
// never a zero, because "no branches name this host" and "nobody has counted"
// are different facts and only one of them is knowable here.

import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import { Component, signal, type OnDestroy } from '@angular/core'
import { ATTESTATION_IOC_KEY, EffectBus, type AttestationVerdict, type PackageAttestation } from '@hypercomb/core'
// The SAME reader the shim uses on a cold boot. It lives in runtime precisely
// so there is one answer to "what does this domain publish" — essentials
// cannot reach runtime (it imports core and nothing else), which is why this
// call sits in the panel rather than in HostsDrone.
import { askHostPackages, type HostPackage } from '@hypercomb/runtime/host-packages'
import { hostZone } from '@hypercomb/runtime/host-zones'
// The build this shell is RUNNING — the one stamp every activation path
// leaves, read here so "you are on build N" is a fact and not a guess.
import { installedPackageSig } from '@hypercomb/runtime/installed-package'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { signalSession } from '../window-session'

/** What one host publishes, once asked. `null` while in flight. Packages
 *  arrive newest first — the manifest reader sorts by generation. */
/** What a host offers, and whether it answered at all — "publishes nothing
 *  here" and "does not answer" are different facts. */
type Offer = { packages: HostPackage[]; answered: boolean } | null

type IntakeState = {
  phase: 'applying' | 'applied' | 'failed'
  detail?: string
}

/** How many builds the ledger fold shows before its "show all" control. The
 *  count is always stated, so a collapsed list never reads as the whole. */
const OFFERS_SHOWN = 8

// ── switching, and the way back ─────────────────────────────────────────────
//
// A BUILD FROM ANOTHER DOMAIN IS A SWITCH, NOT AN UPDATE. It restarts the app
// on somebody else's version, and the first thing a participant saw afterwards
// was a hive that looked emptied — every tile still on disk, none of them
// shown by the build now running. Nothing was lost and nothing said so. So a
// switch is named before it happens, the build it left is remembered, and the
// window reopens after the restart with one button that goes back.

/** The build a switch left, so going back is one press. Written only after a
 *  switch has verified and activated; cleared by going back, by updating from
 *  your own domain, or by choosing to keep the new build. */
const SWITCHED_KEY = 'hc:hosts:switched-from'

/** Set just before the restart a switch causes and read once on the next
 *  boot: the window reopens, so what changed and the way back are the first
 *  things on screen. Session-scoped — it never outlives the tab. */
const REOPEN_KEY = 'hc:hosts:reopen-after-switch'

/** The guide stays open until it is put away, and stays put away. */
const GUIDE_KEY = 'hc:hosts:guide-closed'

const PACKAGE_SIG = /^[a-f0-9]{64}$/

interface SwitchRecord {
  /** The build you were on before any switch — the one your tiles look right in. */
  from: string
  /** The domain that lists it, when one was seen to. */
  fromZone: string
  /** The build the last switch took you to. */
  to: string
  toZone: string
}

const readSwitch = (): SwitchRecord | null => {
  try {
    const raw = JSON.parse(localStorage.getItem(SWITCHED_KEY) ?? 'null')
    if (!raw || !PACKAGE_SIG.test(String(raw.from)) || !PACKAGE_SIG.test(String(raw.to))) return null
    return { from: raw.from, fromZone: hostZone(raw.fromZone), to: raw.to, toZone: hostZone(raw.toZone) }
  } catch { return null }
}

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

/** Mirrors ConcealedItem in essentials/concealment/concealment.ts — shared
 *  cannot import essentials, so the shape is kept field-for-field by hand. */
interface HiddenItem {
  sig: string
  scope: string
  label: string
  from: string
  deletable: boolean
}

/** Mirrors HiddenRenderPayload in concealment/concealment.drone.ts. */
interface HiddenRenderish {
  items?: HiddenItem[]
  gone?: string[]
}

/** The scope this panel's rows are hidden under, so the delete area can tell
 *  a build from a published version. */
const BUILD_SCOPE = 'host-build'

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
  /** The zone whose full build ledger is unfolded. */
  readonly expandedZone = signal('')
  /** Whether the ledger fold is open at all — closed by default, because the
   *  answer to "am I current" is two lines, not a list. */
  readonly ledgerOpen = signal(false)
  readonly addError = signal(false)

  /** The domain this app is running on. A build from here is an update; a
   *  build from anywhere else is a switch, and says so before it happens. */
  readonly home = hostZone(location.host)
  /** Is the four-line guide showing? Open until put away. */
  readonly guideOpen = signal(readGuideOpen())
  /** A switch waiting for its yes — the confirm sheet shows while set. */
  readonly pending = signal<HostPackage | null>(null)
  /** The build a switch left, when one did. */
  readonly switched = signal<SwitchRecord | null>(readSwitch())
  /** Looking for the build to go back to. */
  readonly returnFinding = signal(false)
  /** Where it was looked for and not found: the zones, '-' for nowhere to
   *  look, '' while there is nothing to report. */
  readonly returnMissing = signal('')
  /** Builds already confirmed this session, so a Retry does not ask twice. */
  #confirmed = new Set<string>()
  /** Manifests in flight, so a second asker waits on the first. */
  #asking = new Map<string, Promise<void>>()

  /** Builds you have put away, this panel's scope only. */
  readonly hidden = signal<HiddenItem[]>([])
  /** Every signature that must not be offered — hidden AND deleted. Deleted
   *  ones are in here and nowhere else, which is what deleted means. */
  readonly concealed = signal<Set<string>>(new Set())
  /** Is the delete area open? Closed by default: it is somewhere you go. */
  readonly hiddenOpen = signal(false)

  /** zone → how many branches name it. Empty until a publish sweep has been
   *  seen; a missing entry renders as nothing at all. */
  readonly naming = signal<Record<string, number>>({})

  // ── the creations half ───────────────────────────────────────────────────
  //
  // A DOMAIN SERVES TWO LISTS AND THEY ARE NOT THE SAME KIND OF THING.
  // Builds are the app itself, taken by replication; creations are what
  // people made and published, taken one tile at a time by the swarm's own
  // grammar. The creations come first here because they are the reason a
  // person adds somebody's domain at all.

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
      // Your own domain stays open whether or not you carry it.
      if (this.selectedZone() && !zones.includes(this.selectedZone()) && !this.isHome(this.selectedZone())) {
        this.selectedZone.set('')
        this.expandedZone.set('')
        this.ledgerOpen.set(false)
      }
    }))

    // WHAT HAS BEEN PUT AWAY. One pool, one owner, one render — a build
    // hidden here is hidden, and the delete area is the same everywhere.
    this.#cleanups.push(EffectBus.on<HiddenRenderish>('hidden:render', (p) => {
      const items = (p?.items ?? []).filter(i => i?.scope === BUILD_SCOPE)
      this.hidden.set(items)
      this.concealed.set(new Set([
        ...items.map(i => i.sig),
        ...(p?.gone ?? []),
      ]))
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

    // BACK FROM A SWITCH. The restart a switch causes is the moment tiles can
    // seem to vanish, so the window that explains it opens by itself — once.
    try {
      if (sessionStorage.getItem(REOPEN_KEY) === '1') {
        sessionStorage.removeItem(REOPEN_KEY)
        EffectBus.emit('hosts:open', {})
      }
    } catch { /* storage unavailable */ }
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
    this.#cleanups = []
  }

  close(): void {
    this.pending.set(null)
    EffectBus.emit('hosts:close', {})
  }

  // ── the guide, and your own domain ───────────────────────────────────────

  toggleGuide(): void {
    const open = !this.guideOpen()
    this.guideOpen.set(open)
    try { localStorage.setItem(GUIDE_KEY, open ? '0' : '1') } catch { /* storage unavailable */ }
  }

  /** Is this the domain the app is running on? */
  isHome(zone: string): boolean {
    return !!this.home && hostZone(zone) === this.home
  }

  /** Your own domain first — it is the one you come back to — and listed
   *  whether or not you carry it. The origin you are running on serves the
   *  build it was deployed with, and taking that build needs no signature
   *  (the self door), so leaving it off the list left a freshly deployed
   *  domain with no way to update from itself. */
  orderedZones(): string[] {
    const zones = this.zones()
    const home = zones.find(z => this.isHome(z)) ?? this.home
    const others = zones.filter(z => !this.isHome(z))
    return home ? [home, ...others] : others
  }

  /** Only a host you carry is an artifact you can drop. */
  isCarried(zone: string): boolean {
    return this.zones().includes(zone)
  }

  /** The sentence that opens a domain's builds: your own domain is where you
   *  return to, anyone else's is a switch to their version. */
  buildsNoteKey(zone: string): string {
    return this.isHome(zone) ? 'hosts.builds.home' : 'hosts.builds.foreign'
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
    if (this.selectedZone() === zone) {
      this.selectedZone.set('')
      this.expandedZone.set('')
      this.ledgerOpen.set(false)
    }
    EffectBus.emit('hosts:remove', { zone })
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
  /** The build this shell is running. Re-read on every look, since an
   *  activation elsewhere in the session (an `/upgrade`) changes the answer. */
  readonly installed = signal<string | null>(installedPackageSig())

  isProbing(zone: string): boolean {
    return zone in this.offers() && this.offers()[zone] === null
  }

  wasAsked(zone: string): boolean {
    return this.asked().has(zone)
  }

  offerOf(zone: string): Offer {
    return this.offers()[zone] ?? null
  }

  // ── the two facts and the one act ────────────────────────────────────────

  /**
   * What this host offers YOU: everything it lists, minus what you put away.
   *
   * Every read of the ledger goes through here — the count, the fold, the
   * newest, the one Update button. That is the point of hiding: a build you
   * never want to apply must not be reachable by the button whose whole job is
   * "make me current", or hiding it would only have moved the accident.
   */
  offeredOf(zone: string): HostPackage[] {
    const packages = this.offers()[zone]?.packages ?? []
    const concealed = this.concealed()
    return concealed.size === 0 ? packages : packages.filter(p => !concealed.has(p.packageSig))
  }

  /** Did the door answer at all when asked? False is a network fact, not a
   *  publishing one. */
  offerAnswered(zone: string): boolean {
    return this.offers()[zone]?.answered === true
  }

  /** The newest build this host offers, or null when it offers nothing. */
  newestOf(zone: string): HostPackage | null {
    return this.offeredOf(zone)[0] ?? null
  }

  /** The build you are on, as this host lists it — null when this shell has
   *  no stamp or is on a build the host does not carry. */
  installedOn(zone: string): HostPackage | null {
    const sig = this.installed()
    if (!sig) return null
    return this.offers()[zone]?.packages.find(p => p.packageSig === sig) ?? null
  }

  isCurrent(pkg: HostPackage): boolean {
    return pkg.packageSig === this.installed()
  }

  /** The domain's own door. Someone else's build is tried THERE — the
   *  browser's origin isolation runs it against their storage, never yours —
   *  and applied HERE only once a publisher you follow has signed it
   *  (runtime activation-authority.ts refuses the rest by name). */
  visitUrl(zone: string): string {
    const bare = hostZone(zone) || String(zone ?? '').trim()
    const scheme = /^(localhost|127(?:\.\d+){3})(:\d{1,5})?$/.test(bare) ? 'http' : 'https'
    return `${scheme}://${bare}`
  }

  /** When a build was made, short enough for a row: month, day and time in
   *  the reader's locale. The manifest stamps a local ISO string. */
  when(pkg: HostPackage): string {
    const date = new Date(pkg.at)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  /** THE NAME IS THE HEADING, THE DATES ARE THE LIST. A build carries a name
   *  (the label its build stamped) and a moment. On a host that has only ever
   *  cut one line, that is one heading with every build dated under it; a
   *  RENAME simply starts a new heading, newest first, with its own dates —
   *  nothing to migrate, nothing to explain. Groups are cut from the SHOWN
   *  slice, so the fold still folds. */
  groupsOf(zone: string): { name: string; packages: HostPackage[] }[] {
    const groups: { name: string; packages: HostPackage[] }[] = []
    for (const pkg of this.packagesShown(zone)) {
      const last = groups[groups.length - 1]
      if (last && last.name === pkg.label) last.packages.push(pkg)
      else groups.push({ name: pkg.label, packages: [pkg] })
    }
    return groups
  }

  // ── signed before offered ────────────────────────────────────────────────
  //
  // A DOMAIN'S NEWEST IS NOT ALWAYS SIGNED. A build reaches a host the moment
  // it is copied there and is signed only when its stamp lands, so a host can
  // head with a build no publisher you follow has named. The gate refuses it
  // on the press (activation-authority.ts), and while it was the one button's
  // target the window's only act was a refusal Retry could never turn around.
  // So the publisher is asked when you look, and the button takes the newest
  // build it HAS signed.

  /** packageSig → what the followed publisher said about it, or 'asking'. */
  readonly signed = signal<Record<string, 'asking' | AttestationVerdict>>({})

  /** Ask once whether another domain's newest is signed. Your own domain's
   *  build needs no signature, and with no attester loaded there is nobody to
   *  ask — the press still goes through the gate, which says why. */
  async #checkSigned(zone: string): Promise<void> {
    const newest = this.newestOf(zone)
    if (this.isHome(zone) || !newest || this.isCurrent(newest) || newest.packageSig in this.signed()) return
    const attester = window.ioc?.get?.<PackageAttestation>(ATTESTATION_IOC_KEY)
    if (typeof attester?.attest !== 'function') return
    const sig = newest.packageSig
    this.signed.set({ ...this.signed(), [sig]: 'asking' })
    const verdict = await attester.attest(sig, [zone])
      .catch((): AttestationVerdict => ({ ok: false, reason: 'unreachable' }))
    this.signed.set({ ...this.signed(), [sig]: verdict })
  }

  /** The refusal for this domain's newest, once one came back. An unreachable
   *  index says nothing about the build — Retry can still succeed — so it is
   *  not a refusal here. */
  unsignedOf(zone: string): Extract<AttestationVerdict, { ok: false }> | null {
    const newest = this.newestOf(zone)
    const verdict = newest ? this.signed()[newest.packageSig] : undefined
    return verdict && verdict !== 'asking' && !verdict.ok && verdict.reason !== 'unreachable' ? verdict : null
  }

  /** The build the one button takes: the newest here, unless the publisher
   *  you follow refused it — then the build that publisher does name, when
   *  this domain lists it, or nothing. */
  targetOf(zone: string): HostPackage | null {
    const refused = this.unsignedOf(zone)
    if (!refused) return this.newestOf(zone)
    return this.offeredOf(zone).find(p => p.packageSig === refused.named) ?? null
  }

  /** Update is on offer when the build the button takes is not what you are
   *  running. A shell with no stamp at all is offered it too — taking it is
   *  how a stamp comes to exist. */
  updateAvailable(zone: string): boolean {
    const target = this.targetOf(zone)
    return !!target && !this.isCurrent(target)
  }

  /** A GENERATION AND A SIGNATURE ARE NOT THE SAME KIND OF THING.
   *
   *  A build carries a generation only when the build that cut it stamped
   *  one; a package from a host that does not count them carries none. Both
   *  of these lines used to drop `generation ?? packageSig.slice(0, 8)` into
   *  a slot in a sentence that already said the word "build" — so a host with
   *  no generations rendered "Newest here: build 87474539", naming a build by
   *  eight characters of a hash as though that were its number, and the line
   *  above it read "You are on build" with nothing after it at all, because
   *  `null ?? ''` is a blank. Neither is a formatting slip: one states a
   *  falsehood and the other states half a sentence. The fix is a second key
   *  per line, chosen by whether the fact exists. */
  yoursKey(zone: string): string {
    if (!this.installed()) return 'hosts.offer.yours-none'
    const mine = this.installedOn(zone)
    if (!mine) return 'hosts.offer.yours-elsewhere'
    return mine.generation !== null ? 'hosts.offer.yours' : 'hosts.offer.yours-sig'
  }

  yoursParams(zone: string): Record<string, string | number> {
    const mine = this.installedOn(zone)
    return {
      generation: mine?.generation ?? '',
      sig: (this.installed() ?? '').slice(0, 8),
    }
  }

  /** The same split for the host's newest build. */
  newestKey(zone: string): string {
    const newest = this.newestOf(zone)
    return newest && newest.generation !== null
      ? 'hosts.offer.newest'
      : 'hosts.offer.newest-sig'
  }

  newestParams(zone: string): Record<string, string | number> {
    const newest = this.newestOf(zone)
    return {
      generation: newest?.generation ?? '',
      sig: (newest?.packageSig ?? '').slice(0, 8),
    }
  }

  /** What the one button says. Intake state first — it is the same
   *  acquisition whichever build it is taking — then current or update. */
  updateKey(zone: string): string {
    const target = this.targetOf(zone)
    if (!target) return this.newestOf(zone) ? 'hosts.offer.not-signed' : 'hosts.offer.update'
    const phase = this.intakeOf(target)?.phase
    if (phase === 'applying') return 'hosts.offer.applying'
    if (phase === 'applied') return 'hosts.offer.applied'
    if (phase === 'failed') return 'hosts.offer.retry'
    if (!this.updateAvailable(zone)) return 'hosts.offer.current'
    // A signed build that is not the newest shown above it is named, so the
    // button never reads as taking the build the line above calls newest.
    if (!this.isHome(zone) && target.packageSig !== this.newestOf(zone)?.packageSig) return 'hosts.offer.switch-signed'
    // SAY WHAT IT DOES. Newer from your own domain is an update; anything
    // from another domain is a switch to their version of the app.
    return this.isHome(zone) ? 'hosts.offer.update' : 'hosts.offer.switch'
  }

  updateParams(zone: string): Record<string, string> {
    return { sig: (this.targetOf(zone)?.packageSig ?? '').slice(0, 8) }
  }

  updateDisabled(zone: string): boolean {
    const target = this.targetOf(zone)
    if (!target || !this.updateAvailable(zone)) return true
    // Still asking whether the newest is signed: a press now could only be refused.
    const newest = this.newestOf(zone)
    if (newest && this.signed()[newest.packageSig] === 'asking') return true
    return this.intakeDisabled(target)
  }

  update(zone: string): void {
    const target = this.targetOf(zone)
    if (target) this.apply(target)
  }

  // ── the ledger fold: every build, for pinning and rollback ───────────────

  packagesShown(zone: string): HostPackage[] {
    const packages = this.offeredOf(zone)
    return this.expandedZone() === zone ? packages : packages.slice(0, OFFERS_SHOWN)
  }

  /** How many builds the ledger is offering — the number the fold's own label
   *  states, so it can never disagree with the rows underneath it. */
  offeredCount(zone: string): number {
    return this.offeredOf(zone).length
  }

  /** How many are behind the explicit fold. */
  moreCount(zone: string): number {
    return this.offers()[zone] && this.expandedZone() !== zone
      ? Math.max(0, this.offeredCount(zone) - OFFERS_SHOWN)
      : 0
  }

  hasFold(zone: string): boolean {
    return this.offeredCount(zone) > OFFERS_SHOWN
  }

  toggleAll(zone: string): void {
    this.expandedZone.set(this.expandedZone() === zone ? '' : zone)
  }

  // ── hide, and the delete area ────────────────────────────────────────────
  //
  // HIDE FIRST, DELETE SECOND. The ledger offers only hide: it is a list of
  // things you did not choose, so the act on offer there must be the one that
  // costs nothing to get wrong. Deleting lives in the delete area — a fold you
  // open on purpose, holding only what you already put away.
  //
  // Deleting a build is a LOCAL forget. The build stays on the host that
  // published it, still valid and still fetchable by anyone who names its
  // signature; what ends is this shell ever listing it again.

  /** Put one build away. It leaves the ledger, the fold and the newest — so
   *  Update cannot reach it — and turns up in the delete area. */
  hide(pkg: HostPackage): void {
    if (this.isCurrent(pkg)) return
    EffectBus.emit('hidden:conceal', {
      sig: pkg.packageSig,
      scope: BUILD_SCOPE,
      label: `${pkg.label} ${this.when(pkg) || pkg.packageSig.slice(0, 8)}`,
      from: pkg.zone,
      // A host's builds may be forgotten: the bytes are not ours and are not
      // going anywhere, so nothing irreplaceable can be lost here.
      deletable: true,
    })
  }

  /** The host lists builds, and you have hidden every one of them. Distinct
   *  from "publishes nothing": one is about the host, the other is about you. */
  allHidden(zone: string): boolean {
    return (this.offers()[zone]?.packages.length ?? 0) > 0 && this.offeredCount(zone) === 0
  }

  /** What you have put away on THIS host. */
  hiddenFor(zone: string): HiddenItem[] {
    return this.hidden().filter(i => i.from === zone)
  }

  /**
   * THE DELETE AREA READS LIKE THE LEDGER: the name once, its dates under it.
   *
   * The rows are cut from the host's OWN list rather than from the stored
   * labels, so a hidden build is described exactly as it was described when it
   * was on offer — same name, same date, same order. A build whose host has
   * not been asked yet (or no longer lists it) still shows, under the label it
   * was hidden with: it is yours to delete either way.
   */
  hiddenGroupsFor(zone: string): { name: string; rows: { item: HiddenItem; pkg: HostPackage | null }[] }[] {
    const put = new Map(this.hiddenFor(zone).map(i => [i.sig, i]))
    const groups: { name: string; rows: { item: HiddenItem; pkg: HostPackage | null }[] }[] = []
    const push = (name: string, row: { item: HiddenItem; pkg: HostPackage | null }) => {
      const last = groups[groups.length - 1]
      if (last && last.name === name) last.rows.push(row)
      else groups.push({ name, rows: [row] })
    }
    for (const pkg of this.offers()[zone]?.packages ?? []) {
      const item = put.get(pkg.packageSig)
      if (!item) continue
      put.delete(pkg.packageSig)
      push(pkg.label, { item, pkg })
    }
    // Anything the host no longer lists keeps the label it was hidden with.
    for (const item of put.values()) push(item.label, { item, pkg: null })
    return groups
  }

  /** The date a hidden row shows — the same string the ledger showed. */
  hiddenWhen(row: { item: HiddenItem; pkg: HostPackage | null }): string {
    return row.pkg ? (this.when(row.pkg) || row.pkg.packageSig.slice(0, 8)) : row.item.sig.slice(0, 8)
  }

  /**
   * Hide a WHOLE NAME at once.
   *
   * The ledger's unit is not the row, it is the heading: a name you stopped
   * using has a run of dates under it and you want the run gone, not fifteen
   * presses. A rename starts a new heading, so this is exactly "everything I
   * published while it was called that".
   */
  hideGroup(group: { name: string; packages: HostPackage[] }): void {
    for (const pkg of group.packages) this.hide(pkg)
  }

  /** Every build under this heading, hidden or not — what "hide the name"
   *  actually costs, stated before you press it. */
  groupHideable(group: { name: string; packages: HostPackage[] }): number {
    return group.packages.filter(p => !this.isCurrent(p)).length
  }

  restoreGroup(rows: { item: HiddenItem }[]): void {
    for (const row of rows) this.restore(row.item)
  }

  deleteGroup(rows: { item: HiddenItem }[]): void {
    for (const row of rows) this.destroy(row.item)
  }

  toggleHiddenArea(): void {
    this.hiddenOpen.set(!this.hiddenOpen())
  }

  /** Take a build back. Nothing was ever removed from the host's list, so this
   *  is simply the filter letting go. */
  restore(item: HiddenItem): void {
    EffectBus.emit('hidden:reveal', { sig: item.sig })
  }

  /** Forget a build for good — locally. Refused by the pool unless it is
   *  already hidden and was marked deletable, so this button cannot be the
   *  thing that makes deletion reachable from a list. */
  destroy(item: HiddenItem): void {
    if (!item.deletable) return
    EffectBus.emit('hidden:delete', { sig: item.sig })
  }

  toggleLedger(): void {
    this.ledgerOpen.set(!this.ledgerOpen())
    if (!this.ledgerOpen()) this.expandedZone.set('')
  }

  /**
   * Ask a domain what it publishes. Exactly one host is inspected at a time;
   * prior answers stay cached so returning to one does not fetch its manifest
   * again.
   *
   * Unreachable, not-a-host and publishes-nothing all land as an empty list.
   * That is deliberate: this is a picker, and the three have the same thing to
   * show. Telling them apart is the host check's job (`check-host.mjs`), which
   * says WHICH rule an origin misses and what to change.
   */
  async look(zone: string): Promise<void> {
    this.installed.set(installedPackageSig())
    if (this.selectedZone() === zone) {
      this.selectedZone.set('')
      this.expandedZone.set('')
      this.ledgerOpen.set(false)
      return
    }
    this.selectedZone.set(zone)
    this.expandedZone.set('')
    this.ledgerOpen.set(false)
    // What this domain SERVES is asked at the same moment and answered
    // separately: the ledger is one small file and the manifest is megabytes,
    // so the creations are on screen long before the builds are.
    EffectBus.emit('hosts:creations', { zone })
    await this.#ask(zone)
    await this.#checkSigned(zone)
  }

  /** Fetch one domain's manifest, once. A second asker — Switch back looking
   *  for your build while you opened the same domain — waits on the first
   *  rather than reading a half-answered null. */
  #ask(zone: string): Promise<void> {
    const flying = this.#asking.get(zone)
    if (flying) return flying
    if (zone in this.offers()) return Promise.resolve()
    const run = (async () => {
      this.offers.set({ ...this.offers(), [zone]: null })
      let packages: HostPackage[] = []
      let answered = false
      try { ({ packages, answered } = await askHostPackages(zone)) } catch { /* no answer */ }
      this.asked.set(new Set([...this.asked(), zone]))
      this.offers.set({
        ...this.offers(),
        [zone]: { packages, answered },
      })
    })()
    this.#asking.set(zone, run)
    void run.finally(() => this.#asking.delete(zone))
    return run
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

  // Acquisition is loaded only when somebody asks for a package. The host
  // directory stays light, and the replication machinery does not inflate
  // the shell's initial bundle merely because this surface is mounted.
  readonly intake = signal<Record<string, IntakeState>>({})
  readonly activeIntake = signal('')

  intakeOf(pkg: HostPackage): IntakeState | undefined {
    return this.intake()[pkg.packageSig]
  }

  /** The ledger row's button: SWITCH, or the intake phase it is in. Switch,
   *  never Add or Apply: a ledger row can be older than what you are running,
   *  or somebody else's version entirely, and taking it replaces the app you
   *  are running — a word that says "add" hides that. */
  intakeActionKey(pkg: HostPackage): string {
    switch (this.intakeOf(pkg)?.phase) {
      case 'applying': return 'hosts.offer.applying'
      case 'applied': return 'hosts.offer.applied'
      case 'failed': return 'hosts.offer.retry'
      default: return 'hosts.offer.apply'
    }
  }

  intakeDisabled(pkg: HostPackage): boolean {
    const state = this.intakeOf(pkg)?.phase
    return state === 'applying' || state === 'applied'
      || (!!this.activeIntake() && this.activeIntake() !== pkg.packageSig)
  }

  /**
   * The one door every build button goes through. A build from your own
   * domain goes straight on; any other domain's waits for a yes on the
   * confirm sheet first.
   */
  apply(pkg: HostPackage): void {
    if (this.intakeDisabled(pkg) || this.isCurrent(pkg)) return
    if (this.#needsConfirm(pkg)) { this.pending.set(pkg); return }
    void this.#switch(pkg)
  }

  /** Your own domain's build is an update. Any other domain's is a switch to
   *  somebody else's version of the app, and that is said before it happens —
   *  once per build, so a Retry does not ask twice. Going back to the build
   *  you were on never asks: it is the undo. */
  #needsConfirm(pkg: HostPackage): boolean {
    if (this.isHome(pkg.zone)) return false
    if (this.#confirmed.has(pkg.packageSig)) return false
    return pkg.packageSig !== this.switched()?.from
  }

  confirmSwitch(): void {
    const pkg = this.pending()
    this.pending.set(null)
    if (!pkg) return
    this.#confirmed.add(pkg.packageSig)
    void this.#switch(pkg)
  }

  cancelSwitch(): void {
    this.pending.set(null)
  }

  // ── the way back ─────────────────────────────────────────────────────────

  /** The note after a switch shows while you run the build it took you to,
   *  and through the restart that goes back, so "Switched — restarting" has
   *  somewhere to be said. */
  returnable(): SwitchRecord | null {
    const record = this.switched()
    if (!record) return null
    if (record.to === this.installed()) return record
    return this.intake()[record.from]?.phase === 'applied' ? record : null
  }

  returnBusy(): boolean {
    const record = this.switched()
    const phase = record ? this.intake()[record.from]?.phase : undefined
    return this.returnFinding() || phase === 'applying' || phase === 'applied'
  }

  returnKey(): string {
    const record = this.switched()
    const phase = record ? this.intake()[record.from]?.phase : undefined
    if (this.returnFinding()) return 'hosts.return.finding'
    if (phase === 'applying') return 'hosts.offer.applying'
    if (phase === 'applied') return 'hosts.offer.applied'
    if (phase === 'failed') return 'hosts.offer.retry'
    return 'hosts.return.go'
  }

  /** Find the build you were on — where it was seen listed, then your own
   *  domain — and switch to it. Its bytes are usually still here; the host is
   *  asked only for the manifest that names them. */
  async switchBack(): Promise<void> {
    const record = this.returnable()
    if (!record || this.returnBusy()) return
    this.returnFinding.set(true)
    this.returnMissing.set('')
    const places = [...new Set([record.fromZone, this.home].filter(Boolean))]
    try {
      for (const zone of places) {
        await this.#ask(zone)
        const pkg = this.offers()[zone]?.packages.find(p => p.packageSig === record.from)
        if (!pkg) continue
        this.returnFinding.set(false)
        this.apply(pkg)
        return
      }
      this.returnMissing.set(places.length ? places.join(', ') : '-')
    } finally {
      this.returnFinding.set(false)
    }
  }

  /** Stay on the new build: the note goes, and so does the way back. */
  keepSwitch(): void {
    try { localStorage.removeItem(SWITCHED_KEY) } catch { /* storage unavailable */ }
    this.switched.set(null)
    this.returnMissing.set('')
  }

  /**
   * Remember the way back, once a switch has activated. Answers whether there
   * is now a note to show after the restart.
   *
   * Going back, or updating from your own domain, IS the way back, so the
   * note goes (the signal keeps it until the restart, for the "restarting"
   * line). Switching onward keeps the ORIGINAL build — the one your tiles
   * look right in — rather than the build you passed through.
   */
  #remember(left: string | null, pkg: HostPackage): boolean {
    const record = this.switched()
    try {
      if ((record && pkg.packageSig === record.from) || this.isHome(pkg.zone)) {
        localStorage.removeItem(SWITCHED_KEY)
        return false
      }
      if (!left || left === pkg.packageSig) return false
      const next: SwitchRecord = record && record.to === left
        ? { ...record, to: pkg.packageSig, toZone: hostZone(pkg.zone) }
        : { from: left, fromZone: this.#zoneListing(left), to: pkg.packageSig, toZone: hostZone(pkg.zone) }
      localStorage.setItem(SWITCHED_KEY, JSON.stringify(next))
      this.switched.set(next)
      return true
    } catch { return false /* storage unavailable — the switch still happened */ }
  }

  /** The domain seen listing a build, your own first; '' when none was. */
  #zoneListing(sig: string): string {
    const listing = Object.entries(this.offers())
      .filter(([, offer]) => offer?.packages.some(p => p.packageSig === sig))
      .map(([zone]) => zone)
    return listing.find(z => this.isHome(z)) ?? listing[0] ?? this.home
  }

  /**
   * Make a host's package ours through the one verified acquisition path.
   * Every carried host is offered as a source for the same signature, so a
   * missing atom on one can fall through to another. Activation happens only
   * after the complete-or-absent gate; then we restart because an import map
   * cannot be replaced underneath a running module graph.
   */
  async #switch(pkg: HostPackage): Promise<void> {
    if (this.intakeDisabled(pkg) || this.isCurrent(pkg)) return
    const sig = pkg.packageSig
    // Read fresh, not from the signal: the way back must name the build that
    // is actually live at the moment of the switch.
    const left = installedPackageSig()
    this.activeIntake.set(sig)
    this.intake.set({ ...this.intake(), [sig]: { phase: 'applying' } })

    try {
      const { acquire } = await import('@hypercomb/runtime/acquire')
      const sources = [...new Set([pkg.zone, ...this.zones()])]
      const outcome = await acquire(sig, sources)
      if (!outcome.ok) {
        this.intake.set({
          ...this.intake(),
          [sig]: { phase: 'failed', detail: outcome.error ?? 'package incomplete' },
        })
        return
      }

      this.intake.set({
        ...this.intake(),
        [sig]: {
          phase: 'applied',
          detail: `${outcome.fetched} fetched / ${outcome.present} already here`,
        },
      })
      // Remembered BEFORE the restart, and the window asked back only when
      // there is a way back to show in it.
      if (this.#remember(left, pkg)) {
        try { sessionStorage.setItem(REOPEN_KEY, '1') } catch { /* storage unavailable */ }
      }
      this.installed.set(sig)
      EffectBus.emit('activity:log', {
        message: `switched to ${pkg.label} build ${pkg.generation ?? sig.slice(0, 8)} from ${pkg.zone}; restarting`,
      })
      setTimeout(() => location.reload(), 650)
    } catch (error) {
      this.intake.set({
        ...this.intake(),
        [sig]: {
          phase: 'failed',
          detail: error instanceof Error ? error.message : 'package could not be applied',
        },
      })
    } finally {
      // Keep every other button locked while a successful acquisition is
      // waiting for its restart. A second package cannot safely replace the
      // install manifest in that small interval.
      if (this.intake()[sig]?.phase !== 'applied' && this.activeIntake() === sig) {
        this.activeIntake.set('')
      }
    }
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
