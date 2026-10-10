// hypercomb-shared/ui/mesh-modal/mesh-modal.component.ts
// Centered modal for editing the mesh location and secret in one place.
// Listens for 'mesh:open-modal' to open, broadcasts 'mesh:modal-open'
// while open so the controls-bar can highlight the trigger.
//
// THE TAB'S OWN PAIR. It pre-fills from this tab's zone (mesh-session.ts),
// else a FRESH read of the origin-wide pair — never a copy held in memory
// since boot, which a stale tab used to write back over another tab's
// meeting on START. An opener may hand it a pair (the old-package meeting
// link fallback) or a meeting point (`invite wss://…`); nothing is written
// until save / START / share, and cancel writes nothing at all.
//
// THE MEETING POINT. Where this tab meets when it is not the default relay,
// and that meeting point's access code — typed or pasted here once, by the
// facilitator, and kept only in this tab's session and in the meeting link
// (never on the command line, which remembers what it runs).

import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import { Component, signal, computed, type OnInit, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { fromRuntime } from '../../core/from-runtime'
import { TranslatePipe } from '../../core/i18n.pipe'
import { HcWidgetDirective } from '../widget-zoom/hc-widget.directive'
import type { RoomStore } from '../../core/room-store'
import type { SecretStore } from '../../core/secret-store'
import type { SecretStrengthProvider } from '../../core/secret-strength'
import type { SavedLocationsStore } from '../../core/saved-locations-store'
import { roomWords } from '../presence-banner/presence-status'
import { isAccessCode, meetingRelayOf, readMeshZone, tabCredential, writeMeshZone } from '../../core/mesh-session'

const SELF_DOMAIN_KEY = 'hc:nostrmesh:self-domain'
/** The /invite queen (essentials sharing/invite.queen.ts) — reached through
 *  IoC at runtime, never imported: shared is downstream of no module. */
const INVITE_QUEEN_KEY = '@diamondcoreprocessor.com/InviteQueenBee'
const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'

interface InviteQueenLike { invoke: (args: string) => Promise<void>; meetingLink?: () => Promise<void> }
interface SwarmLabelApi { myLabel?: () => string; setMyLabel?: (s: string) => void }
interface MeshRelayApi {
  configureRelays?: (urls: string[], persist?: boolean) => void
  getDebug?: () => { relays?: readonly string[] } | undefined
}
/** What an opener may hand the selector. */
interface OpenPayload {
  join?: boolean
  /** A pair to pre-fill instead of the tab's own (nothing is written). */
  room?: string
  secret?: string
  /** A meeting point to pre-fill (`invite wss://…`). */
  point?: string
  /** Which field takes the focus. */
  focus?: 'code'
}

/** A meeting point as a person reads it: no scheme. */
const pointLabel = (relay: string): string => relay.replace(/^wss?:\/\//, '')

/** Normalize a host string the same way the rest of the codebase does:
 *  strip protocol prefix, trailing slashes, lowercase. Keeps localStorage
 *  in the canonical bare-host form. */
function normalizeHost(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/^wss?:\/\//i, '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

@Component({
  selector: 'hc-mesh-modal',
  standalone: true,
  imports: [TranslatePipe, HcWidgetDirective],
  templateUrl: './mesh-modal.component.html',
  styleUrls: ['./mesh-modal.component.scss'],
})
export class MeshModalComponent implements OnInit, OnDestroy {

  #unsubOpen: (() => void) | null = null
  #unsubClose: (() => void) | null = null
  #unsubEscape: (() => void) | null = null
  #onWindowKeyDown: ((e: KeyboardEvent) => void) | null = null

  readonly open = signal(false)
  /** JOIN mode: opened from the solo→public flip. The primary button reads
   *  "start" and confirming also joins the swarm (emits 'mesh:join'). */
  readonly joinMode = signal(false)
  readonly roomDraft = signal('')
  readonly secretDraft = signal('')

  readonly #locale = signal('en')

  /** THE ROOM'S TWO WORDS — the same pair the breadcrumb and the presence
   *  line show, live from the drafts. They hash the room and the secret
   *  ONLY (`roomWords`: the swarm's lifecycle channel), never the page, so
   *  everyone in one room reads the same pair wherever they stand: the room
   *  can check out loud that it typed the same thing, and a capital the
   *  phone slipped in shows up as a different pair. */
  readonly zoneWords = computed(() => roomWords(this.roomDraft(), this.secretDraft(), this.#locale()))
  readonly labelDraft = signal('')
  readonly hostDraft = signal('')
  readonly secretVisible = signal(false)
  /** JOIN mode only: which credential blocked the start ('room' | 'secret'),
   *  so the field can say so instead of the dialog closing on a join that
   *  could never have worked. Cleared on every open and on a good start. */
  readonly missingField = signal<'room' | 'secret' | 'point' | 'code' | null>(null)
  /** The meeting point this tab dials, as typed ('' = the default relay). */
  readonly pointDraft = signal('')
  /** That meeting point's access code. Masked like the secret. */
  readonly codeDraft = signal('')
  /** JOIN mode only: persisted opt-out so a future join skips the pre-join
   *  privacy-review step (mesh-header reads `hc:skip-privacy-review`). */
  readonly skipReview = signal(false)

  readonly savedLocations = fromRuntime(
    get('@hypercomb.social/SavedLocationsStore') as EventTarget | undefined,
    () => this.#savedStore?.value ?? [],
  )

  readonly secretInputType = computed(() => this.secretVisible() ? 'text' : 'password')

  readonly shieldColor = computed(() => {
    const secret = this.secretDraft().trim()
    if (!secret) return 'rgba(245, 245, 245, 0.45)'
    const provider = get('@hypercomb.social/SecretStrengthProvider') as SecretStrengthProvider | undefined
    const score = provider?.evaluate(secret) ?? 0.5
    const hue = Math.round(score * 130)
    return `hsl(${hue}, 70%, 50%)`
  })

  get #roomStore(): RoomStore | undefined {
    return get('@hypercomb.social/RoomStore') as RoomStore | undefined
  }
  get #secretStore(): SecretStore | undefined {
    return get('@hypercomb.social/SecretStore') as SecretStore | undefined
  }
  get #savedStore(): SavedLocationsStore | undefined {
    return get('@hypercomb.social/SavedLocationsStore') as SavedLocationsStore | undefined
  }
  #readHost = (): string => {
    try { return normalizeHost(localStorage.getItem(SELF_DOMAIN_KEY) ?? '') }
    catch { return '' }
  }
  #writeHost = (v: string): void => {
    try {
      const clean = normalizeHost(v)
      if (clean) localStorage.setItem(SELF_DOMAIN_KEY, clean)
      else localStorage.removeItem(SELF_DOMAIN_KEY)
    } catch { /* ignore */ }
  }

  ngOnInit(): void {
    this.#unsubOpen = EffectBus.on<OpenPayload>('mesh:open-modal', (payload) => {
      this.joinMode.set(!!payload?.join)
      // The pair an opener handed over, else THIS tab's own, else a fresh
      // read of the origin-wide one — never the store's boot-time copy.
      const handed = typeof payload?.room === 'string' && typeof payload?.secret === 'string'
      const initialSecret = handed ? String(payload!.secret) : tabCredential('secret')
      this.roomDraft.set(handed ? String(payload!.room) : tabCredential('room'))
      this.secretDraft.set(initialSecret)
      const zone = readMeshZone()
      const point = typeof payload?.point === 'string' ? meetingRelayOf(payload.point) : ''
      this.pointDraft.set(point ? pointLabel(point) : zone?.relay ? pointLabel(zone.relay) : '')
      // A newly named meeting point starts with no code of the old one's.
      this.codeDraft.set(point && point !== zone?.relay ? '' : (zone?.code ?? ''))
      // The word pair's locale, read at open time — the window is modal.
      try {
        this.#locale.set((get('@hypercomb.social/I18n') as { locale?: string } | undefined)?.locale ?? 'en')
      } catch { /* English words */ }
      this.labelDraft.set(this.#readMyLabel())
      this.hostDraft.set(this.#readHost())
      this.secretVisible.set(false)
      this.missingField.set(null)
      try { this.skipReview.set(localStorage.getItem('hc:skip-privacy-review') === '1') }
      catch { this.skipReview.set(false) }
      this.open.set(true)
      EffectBus.emit('mesh:modal-open', { open: true })
      EffectBus.emit('mesh:secret-draft', { secret: initialSecret })
      const focus = payload?.focus === 'code' ? '.mesh-modal-code' : '.mesh-modal-room'
      queueMicrotask(() => {
        document.querySelector<HTMLInputElement>(focus)?.focus()
      })
    })

    // The share toggle wrapping HOST → PRIVATE closes the selector with it.
    this.#unsubClose = EffectBus.on('mesh:close-modal', () => {
      if (this.open()) this.#close()
    })

    this.#unsubEscape = EffectBus.on<{ cmd: string }>('keymap:invoke', (payload) => {
      if (payload?.cmd === 'global.escape' && this.open()) this.dismiss()
    })

    this.#onWindowKeyDown = (e: KeyboardEvent): void => {
      if (!this.open() || e.key !== 'Enter') return
      const active = document.activeElement as HTMLElement | null
      if (active?.tagName === 'BUTTON' && active.closest('.mesh-modal-panel')) return
      e.preventDefault()
      this.save()
    }
    window.addEventListener('keydown', this.#onWindowKeyDown)
  }

  ngOnDestroy(): void {
    this.#unsubOpen?.()
    this.#unsubClose?.()
    this.#unsubEscape?.()
    if (this.#onWindowKeyDown) window.removeEventListener('keydown', this.#onWindowKeyDown)
  }

  readonly onRoomInput = (event: Event): void => {
    this.roomDraft.set((event.target as HTMLInputElement).value)
  }

  readonly onSecretInput = (event: Event): void => {
    const value = (event.target as HTMLInputElement).value
    this.secretDraft.set(value)
    EffectBus.emit('mesh:secret-draft', { secret: value })
  }

  readonly onLabelInput = (event: Event): void => {
    this.labelDraft.set((event.target as HTMLInputElement).value)
  }

  readonly onHostInput = (event: Event): void => {
    this.hostDraft.set((event.target as HTMLInputElement).value)
  }

  readonly onPointInput = (event: Event): void => {
    this.pointDraft.set((event.target as HTMLInputElement).value)
  }

  readonly onCodeInput = (event: Event): void => {
    this.codeDraft.set((event.target as HTMLInputElement).value)
  }

  /** The meeting point and code as typed are something a dial can carry:
   *  an empty point is the default relay; a code needs the point it is for
   *  (it is never sent to the default relay). Flags the field otherwise. */
  #meetingPointValid = (): boolean => {
    const typed = this.pointDraft().trim()
    const code = this.codeDraft().trim()
    if (typed && !meetingRelayOf(typed)) { this.missingField.set('point'); return false }
    if (code && !isAccessCode(code)) { this.missingField.set('code'); return false }
    if (code && !typed) { this.missingField.set('point'); return false }
    return true
  }

  /** Commit the meeting point to THIS tab's zone. A new point leaves the old
   *  code and the old meeting host behind; the mesh is pointed at it now, and
   *  told (never the code) so it can dial again.
   *
   *  A point typed here names NO meeting host. The meeting host outranks the
   *  hosts pool and is never passed over (swarm-hosts.ts), so only a link
   *  that names one explicitly sets it; a point's own domain was a guess that
   *  stranded every tile as a name wherever that relay takes no uploads. The
   *  relay still keeps tiles when its card allows participants and nothing
   *  else does (the relay tier). */
  #commitMeetingPoint = (): void => {
    const relay = meetingRelayOf(this.pointDraft())
    const code = relay ? this.codeDraft().trim() : ''
    const zone = readMeshZone()
    const relayChanged = relay !== (zone?.relay ?? '')
    if (!relayChanged && code === (zone?.code ?? '')) return
    writeMeshZone(relayChanged ? { relay, code, host: '' } : { code })
    if (relay && relayChanged) {
      const mesh = get(MESH_KEY) as MeshRelayApi | undefined
      let current: readonly string[] | undefined
      try { current = mesh?.getDebug?.()?.relays } catch { current = undefined }
      if (!(Array.isArray(current) && current.length === 1 && current[0] === relay)) {
        try { mesh?.configureRelays?.([relay], false) } catch { /* the announcement still reaches the mesh */ }
      }
    }
    EffectBus.emit('mesh:zone', { relay })
  }

  /** SHARE THIS MEETING PLACE — as an invite a cold stranger can open.
   *
   *  This button used to mint an ADDRESS link (`https://host/location
   *  #alias=&secret=`, address-record.ts) and write it to the clipboard.
   *  Nothing decodes that shape on landing — the boot capture
   *  (invite-capture.ts) only stashes a lone `/<sig>` path, and parseAddress
   *  has no caller — so the recipient landed on a plain page with the secret
   *  sitting unread in the hash. The link that DOES land is the one the
   *  `invite` word hands out: with nothing selected, the MEETING LINK
   *  (`#meet=room/secret/page`, captured at boot by invite-capture.ts and
   *  joined through one confirm sheet by MeetingInviteWorker) — no host, no
   *  upload, ready at once. InviteQueenBee builds it from the room + secret
   *  in the credential stores and delivers it itself (share sheet →
   *  clipboard → fresh-tap toast, deliver-link.ts), so the drafts are
   *  committed first and the queen is invoked; its own toasts report the
   *  outcome.
   *
   *  The method keeps its name: the template binds `copyShareLink()`. */
  readonly copyShareLink = async (): Promise<void> => {
    const room = this.roomDraft().trim()
    const secret = this.secretDraft().trim()
    // An invite IS (room, secret) — without both there is nothing to share.
    // Same in-field callout the join path uses, instead of a silent no-op.
    if (!room || !secret) {
      this.missingField.set(!room ? 'room' : 'secret')
      return
    }
    this.missingField.set(null)
    if (!this.#meetingPointValid()) return
    if (this.#sharing) return
    const invite = get(INVITE_QUEEN_KEY) as InviteQueenLike | undefined
    if (typeof invite?.invoke !== 'function') {
      const i18n = get('@hypercomb.social/I18n') as { t: (k: string) => string } | undefined
      EffectBus.emit('toast:show', {
        type: 'error',
        title: i18n?.t('invite.title') ?? 'Invite',
        message: i18n?.t('mesh-modal.share-unavailable') ?? 'The invite behaviour is not loaded yet — try again in a moment.',
      })
      return
    }
    // The invite names the credentials in the STORES; make them the ones on
    // screen so the link never points at a stale pair.
    this.#commitDrafts()
    this.#sharing = true
    // The meeting link, whatever is selected (an older queen: invoke('')).
    try { await (invite.meetingLink ? invite.meetingLink() : invite.invoke('')) }
    catch (e) { console.warn('[mesh-modal] invite mint failed:', e) }
    finally { this.#sharing = false }
  }

  /** Re-entrancy latch for the share button — one mint at a time. */
  #sharing = false

  /** Template hook retained (`[class.copied]` / the "copied!" label). The
   *  address-link path that flashed it is gone; the invite queen reports its
   *  own delivery (shared / copied / offered) through a toast, so this never
   *  flips. Retire the binding with the template. */
  readonly copiedFlash = signal(false)

  /** Read the persisted swarm label, preferring the SwarmDrone's
   *  canonical accessor when present so any future-tightened
   *  sanitization (length cap, control-char filter) applies. Falls
   *  back to localStorage when the drone hasn't loaded yet — the
   *  modal can still surface and save without a hard swarm
   *  dependency. */
  #readMyLabel = (): string => {
    const swarm = get(SWARM_KEY) as SwarmLabelApi | undefined
    if (swarm?.myLabel) return swarm.myLabel()
    try { return String(localStorage.getItem('hc:user-label') ?? '').trim().slice(0, 64) }
    catch { return '' }
  }

  /** Persist the four drafts exactly as Save does — the credential stores,
   *  the `mesh:*` effects, the saved-locations chip, the swarm label —
   *  WITHOUT joining or closing. Save and Share both come through here so
   *  the two can never write the location differently. */
  #commitDrafts = (): void => {
    const room = this.roomDraft().trim()
    const secret = this.secretDraft().trim()
    const label = this.labelDraft().trim().slice(0, 64)
    const host = this.hostDraft().trim()
    this.#roomStore?.set(room)
    this.#secretStore?.set(secret)
    this.#commitMeetingPoint()
    // Host writes directly to localStorage — single canonical key, no
    // wrapper. Empty save doesn't unset it (the runtime bootstrap default
    // of window.location.origin stays), so we only write on non-empty.
    if (host) this.#writeHost(host)
    EffectBus.emit('mesh:room', { room })
    EffectBus.emit('mesh:secret', { secret })
    EffectBus.emit('mesh:host', { host: this.#readHost() })
    if (room) this.#savedStore?.add(room)

    // Label routes through swarm.setMyLabel when available — it
    // clears the publish memo + triggers re-sync so the new label
    // propagates immediately. localStorage fallback covers the case
    // where the swarm bee hasn't loaded yet.
    const swarm = get(SWARM_KEY) as SwarmLabelApi | undefined
    if (swarm?.setMyLabel) {
      swarm.setMyLabel(label)
    } else {
      try { localStorage.setItem('hc:user-label', label) } catch { /* ignore */ }
    }
  }

  readonly toggleSecretVisible = (): void => {
    this.secretVisible.set(!this.secretVisible())
  }

  readonly toggleSkipReview = (): void => {
    const next = !this.skipReview()
    this.skipReview.set(next)
    try { localStorage.setItem('hc:skip-privacy-review', next ? '1' : '0') }
    catch { /* ignore */ }
    // Unchecking it means "I DO want the review" — so step BACK to that stage
    // (the header returns to WORLD) and close. Checking it is a no-op for
    // navigation: you're already past the review, standing in the selector.
    if (!next) {
      EffectBus.emit('mesh:privacy-step-back', {})
      this.#close()
    }
  }

  /** The behavior axis of the pre-join review: open the Beehaviors ROSTER
   *  (global switches — off = dormant everywhere AND withheld from every
   *  swarm). ShowFeaturesDrone answers with the rows; the panel docks right,
   *  this modal stays where it is. */
  readonly openSharedBehaviors = (): void => {
    EffectBus.emit('features:roster-open', {})
  }

  readonly pickLocation = (name: string): void => {
    this.roomDraft.set(name)
  }

  readonly removeSaved = (event: Event, name: string): void => {
    event.stopPropagation()
    this.#savedStore?.remove(name)
  }

  readonly save = (): void => {
    const room = this.roomDraft().trim()
    const secret = this.secretDraft().trim()

    // START with a half-set zone used to join anyway, and the swarm then
    // refused to subscribe or publish (it composes its sig from BOTH
    // credentials) — a hive that looked joined and saw nobody, with nothing
    // said. Joining needs both; stay open and point at what is missing.
    // Non-join saves are unaffected: clearing the zone from the editor is a
    // legitimate way to go quiet.
    if (this.joinMode() && (!room || !secret)) {
      this.missingField.set(!room ? 'room' : 'secret')
      return
    }
    this.missingField.set(null)
    if (!this.#meetingPointValid()) return
    this.#commitDrafts()

    // JOIN mode: confirming the location IS the act of going public — the
    // controls-bar listens for 'mesh:join' and flips solo → swarm.
    if (this.joinMode()) EffectBus.emit('mesh:join', {})

    this.#close()
  }

  readonly dismiss = (): void => {
    this.#close(true)
  }

  #close = (cancelled = false): void => {
    this.open.set(false)
    EffectBus.emit('mesh:modal-open', { open: false, cancelled })
    EffectBus.emit('mesh:secret-draft', { secret: null })
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-mesh-modal',
  owner: '@hypercomb.shared/MeshModalComponent',
  component: MeshModalComponent,
  order: 260,
})
