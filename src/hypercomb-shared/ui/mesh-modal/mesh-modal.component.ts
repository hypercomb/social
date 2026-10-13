// hypercomb-shared/ui/mesh-modal/mesh-modal.component.ts
// Centered modal for editing the mesh location and secret in one place.
// Listens for 'mesh:open-modal' to open, broadcasts 'mesh:modal-open'
// while open so the controls-bar can highlight the trigger.
//
// THE TAB'S OWN PAIR. It pre-fills from this tab's zone (mesh-session.ts),
// else a FRESH read of the origin-wide pair — never a copy held in memory
// since boot, which a stale tab used to write back over another tab's
// meeting on START. An opener may point it at the meeting link stashed in
// this tab (the old-package fallback) or hand it a meeting point (`invite
// wss://…`); nothing is written until save / START / share, and cancel
// writes nothing at all.
//
// THE SECRET NEVER RIDES THE BUS. The bus replays its last value to every
// late subscriber (and the bridge's `effect-last` hands it off the page), so
// `mesh:secret` is a notice — listeners re-read the SecretStore — the draft
// goes out as its strength, and an opener names the stash, never the pair.
//
// THE HOST YOU MEET AT — and NO DEFAULT (jwize, 2026-10-11: "Let's just make
// sure that there isn't a default host" — "all the user should have to do is
// put the host name in when entering a swarm, end of story" — "hypercomb.com
// should be available but not filled by default for new installs"). The
// field is where this tab meets, and that meeting point's access code when
// it needs one — typed or pasted here once, kept only in this tab's session
// and in the meeting link (never on the command line, which remembers what
// it runs). It pre-fills only from what this participant chose: this tab's
// own point, else the point of the last meeting on this device (never its
// code — a missing code is then the point's visible 'access' refusal), else
// the relay their own list names (hc:nostrmesh:relays as chosen: /domain,
// an older `/use-live-relay <server>`). A new install's field is EMPTY;
// hypercomb.com is OFFERED beside it, one tap fills it. START needs a host:
// with none there is no room — no words, no address — so the field says so
// and takes the focus instead of joining.
//
// AN OLDER PACKAGE CANNOT MEET AT A POINT. A mesh from before meeting points
// (no ownRelays) forgets a point on its first refresh and cannot carry a
// code; the point and code fields are then disabled with the way to update,
// and the mesh is never pointed (VO-2).
//
// ONLY WHAT DEFINES THE MEETING (jwize, 2026-10-12: "the only place the host
// comes from is the field we attached to … hosts are added to our portal for
// replication"). A room is its host + room + secret (core roomPreimage), so
// the selector shows exactly those — and the access code when a coded point
// needs one (never for hypercomb.com, which is open). The words it previews
// carry their host beside them, and never the page's own domain.
// The old "host" field (your own host, `hc:nostrmesh:self-domain` — where a
// backup goes, never who meets) moved to the host directory; the alias field
// went with it (your name is renamed on the presence line).

import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import { Component, signal, computed, type OnInit, type OnDestroy } from '@angular/core'
import { EffectBus, SHIPPED_MEETING_POINT, canonicalZoneText } from '@hypercomb/core'
import { fromRuntime } from '../../core/from-runtime'
import { TranslatePipe } from '../../core/i18n.pipe'
import { HcWidgetDirective } from '../widget-zoom/hc-widget.directive'
import type { RoomStore } from '../../core/room-store'
import type { SecretStore } from '../../core/secret-store'
import type { SecretStrengthProvider } from '../../core/secret-strength'
import type { SavedLocationsStore } from '../../core/saved-locations-store'
import { meetingPointKey, wordsAtHost, wordsBeside } from '../presence-banner/presence-status'
import { isAccessCode, meetingRelayOf, readMeshZone, tabCredential, writeMeshZone } from '../../core/mesh-session'
import * as meshSession from '../../core/mesh-session'
import { pendingMeetCredentials } from '../../core/invite-capture'

/** The /invite queen (essentials sharing/invite.queen.ts) — reached through
 *  IoC at runtime, never imported: shared is downstream of no module. */
const INVITE_QUEEN_KEY = '@diamondcoreprocessor.com/InviteQueenBee'
const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'

interface InviteQueenLike { invoke: (args: string) => Promise<void>; meetingLink?: () => Promise<void> }
interface MeshRelayApi {
  configureRelays?: (urls: string[], persist?: boolean) => void
  getDebug?: () => { relays?: readonly string[] } | undefined
  /** The page's own relay list — present only on a mesh that follows this
   *  tab's meeting point (hc:mesh-zone) across a refresh. */
  ownRelays?: () => readonly string[]
  swarmHost?: () => string
}
/** What an opener may hand the selector. */
interface OpenPayload {
  join?: boolean
  /** Pre-fill from the meeting link stashed in this tab instead of the tab's
   *  own pair (nothing is written). The pair itself never rides the bus. */
  meet?: boolean
  /** A meeting point to pre-fill (`invite wss://…`). */
  point?: string
  /** Which field takes the focus — `point` is the host field (an entry with
   *  no host: a link that names none, a bare `use-live-relay`). */
  focus?: 'code' | 'point'
}

/** A meeting point as a person reads it: the default wss:// dropped, a
 *  computer's own ws:// KEPT — a bare host commits as wss://, so dropping it
 *  re-pointed an untouched ws:// meeting point on START (VO-6). */
const pointLabel = (relay: string): string => relay.replace(/^wss:\/\//i, '')

/** hypercomb.com as the room's identity names it — the open point that
 *  never takes an access code (D8), and the one host the field OFFERS. */
const OPEN_POINT = meetingPointKey(SHIPPED_MEETING_POINT)
/** The offered host as the field shows it: 'hypercomb.com'. */
const OFFERED_POINT_LABEL = pointLabel(SHIPPED_MEETING_POINT)

/** Where this page's OWN relay list would meet: its first relay as the
 *  participant chose it (nostr-mesh ownRelays — a default a package stored
 *  beside it is not a choice; the page's own domain never picks it,
 *  2026-10-11); '' for none. Never a hidden point: it is shown in the field
 *  (pre-filled) when nothing nearer names one. Read, never written; nothing
 *  is asked. */
const ownMeetingPoint = (mesh: MeshRelayApi | undefined): string => {
  try {
    // An older mesh (no ownRelays) meets where it always did: its swarmHost.
    if (typeof mesh?.ownRelays !== 'function') return String(mesh?.swarmHost?.() ?? '')
    for (const relay of mesh.ownRelays()) {
      try { if (new URL(String(relay)).host) return String(relay) } catch { /* not a URL — the next */ }
    }
    return ''
  } catch { return '' }
}

/** The origin's last meeting point (mesh-session's origin-wide pre-fill),
 *  when this shell has it — '' otherwise. Read, never written, here. */
const meetPointPrefill = (): string => {
  try {
    const read = (meshSession as unknown as { readMeetPointPrefill?: () => unknown }).readMeetPointPrefill
    return typeof read === 'function' ? meetingRelayOf(read()) : ''
  } catch { return '' }
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

  /** Whether the loaded mesh can meet at a point (see the header). True
   *  while no mesh is loaded yet: the zone is then read when it starts. */
  readonly pointSupported = signal(true)
  /** Where this page's own relay list would meet (ownMeetingPoint). */
  readonly #ownPoint = signal('')

  /** THE ROOM'S TWO WORDS — the same pair the breadcrumb and the presence
   *  line show, live from the drafts: the room's address read aloud, with
   *  the host it is drawn at beside it ('marble cove · hypercomb.com'). They
   *  hash the host, the room and the secret (`roomWords`: the swarm's
   *  lifecycle channel) — never the page, so everyone in one room reads the
   *  same pair wherever they stand: the room can check out loud that it
   *  typed the same thing, and a capital the phone slipped in — or a half of
   *  the room at another host — shows up as a different pair. No host, no
   *  words. The pair is from the English list in every language, the
   *  reader's own beside it. They hash what START will STORE: a draft that
   *  is the store's own value as held, anything else folded as entered text
   *  (D6) — so a smart quote or a full-width IME previews the pair the
   *  banner shows after START, the one a friend typing plain text reads. */
  readonly zoneWords = computed(() => {
    const point = this.#wordsPoint()
    return wordsAtHost(wordsBeside(
      this.#asStored(this.roomDraft(), this.#roomStore?.value),
      this.#asStored(this.secretDraft(), this.#secretStore?.value),
      point, this.#locale()), point)
  })

  #asStored = (draft: string, held: string | undefined): string => {
    const text = draft.trim()
    return held !== undefined && text === held ? held : canonicalZoneText(text)
  }

  /** The host START will meet at: the one in the field, and nothing else —
   *  '' when it is empty (no host, no room: there is no default). A mesh
   *  that cannot meet at a point meets on its own list. */
  readonly #startPoint = computed(() => {
    if (!this.pointSupported()) return this.#ownPoint()
    return this.pointDraft().trim()
  })

  /** The host the words are drawn at — the one START will meet at. */
  readonly #wordsPoint = computed(() => this.#startPoint())
  readonly secretVisible = signal(false)
  /** Your name in the swarm (the swarm's own label — never part of the room). */
  readonly labelDraft = signal('')
  /** JOIN mode only: which credential blocked the start ('room' | 'secret'),
   *  so the field can say so instead of the dialog closing on a join that
   *  could never have worked. Cleared on every open and on a good start. */
  readonly missingField = signal<'room' | 'secret' | 'point' | 'host' | 'code' | null>(null)
  /** The host this tab meets at, as typed ('' = none named yet). */
  readonly pointDraft = signal('')
  /** That meeting point's access code. Masked like the secret. */
  readonly codeDraft = signal('')
  /** The opener asked for the code (`invite wss://…`, an 'access' refusal). */
  readonly #codeAsked = signal(false)
  /** THE CODE ONLY WHEN A CODED POINT NEEDS ONE. The shipped default is open
   *  and never takes one (D8); a point of an operator's own may — so the
   *  field shows for a point other than the default, for a code already
   *  held, and when the opener asked for it. */
  readonly codeShown = computed(() => {
    const typed = meetingPointKey(this.pointDraft())
    return !!this.codeDraft().trim() || this.#codeAsked() || (!!typed && typed !== OPEN_POINT)
  })
  /** HYPERCOMB.COM, OFFERED — never filled (2026-10-11): one tap puts it in
   *  the field. Shown while the field names another host, or none. */
  readonly offerShown = computed(() =>
    this.pointSupported() && meetingPointKey(this.pointDraft()) !== OPEN_POINT)
  readonly offeredPoint = OFFERED_POINT_LABEL
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

  ngOnInit(): void {
    this.#unsubOpen = EffectBus.on<OpenPayload>('mesh:open-modal', (payload) => {
      this.joinMode.set(!!payload?.join)
      // The pair in the stashed meeting link the opener named, else THIS
      // tab's own, else a fresh read of the origin-wide one — never the
      // store's boot-time copy.
      const handed = payload?.meet === true ? pendingMeetCredentials() : null
      const initialSecret = handed ? handed.secret : tabCredential('secret')
      this.roomDraft.set(handed ? handed.room : tabCredential('room'))
      this.secretDraft.set(initialSecret)
      const zone = readMeshZone()
      const point = typeof payload?.point === 'string' ? meetingRelayOf(payload.point) : ''
      // An older package cannot meet at a point (VO-2); feature-detected on
      // the loaded mesh, synchronously — nothing is asked of anyone.
      const mesh = get(MESH_KEY) as MeshRelayApi | undefined
      this.pointSupported.set(!mesh || typeof mesh.ownRelays === 'function')
      const listPoint = ownMeetingPoint(mesh)
      this.#ownPoint.set(listPoint)
      // THIS tab's point — else the point this device last met at (never its
      // code), else the relay the page's own list names (as chosen): the
      // field is the only place the host comes from, so it is never hidden
      // in a list. Nothing else — a new install's field is EMPTY, and
      // hypercomb.com is only offered. A zone that names no point names no
      // host (there is no default), so the remembered one is offered even to
      // a tab with a room of its own — the doors that open this field for a
      // missing host (a bare `use-live-relay <room> <secret>`, a link with no
      // host, `join`) all write the room first. Nothing moves until START.
      const tabPoint = String(zone?.relay ?? '')
      const resumed = tabPoint || meetPointPrefill() || listPoint
      this.pointDraft.set(point ? pointLabel(point) : resumed ? pointLabel(resumed) : '')
      // A newly named meeting point starts with no code of the old one's,
      // and a remembered one with none at all.
      this.codeDraft.set(point && point !== tabPoint ? '' : tabPoint ? (zone?.code ?? '') : '')
      this.#codeAsked.set(payload?.focus === 'code')
      // The word pair's locale, read at open time — the window is modal.
      try {
        this.#locale.set((get('@hypercomb.social/I18n') as { locale?: string } | undefined)?.locale ?? 'en')
      } catch { /* English words */ }
      this.secretVisible.set(false)
      this.labelDraft.set(this.#swarmLabel()?.myLabel?.() ?? '')
      this.missingField.set(null)
      try { this.skipReview.set(localStorage.getItem('hc:skip-privacy-review') === '1') }
      catch { this.skipReview.set(false) }
      this.open.set(true)
      EffectBus.emit('mesh:modal-open', { open: true })
      this.#announceDraft(initialSecret)
      // An entry with no host opens on the host field: it is the one thing
      // missing, and the only thing START cannot do without.
      const focus = payload?.focus === 'code' ? '.mesh-modal-code'
        : payload?.focus === 'point' || (this.pointSupported() && !this.pointDraft().trim()) ? '.mesh-modal-point'
        : '.mesh-modal-room'
      // After the render that draws the fields: a microtask ran before
      // `@if (open())` had drawn them, and the caret stayed in the command
      // line, so typing straight after the shortcut went there (2026-10-12).
      this.#focusSoon(focus)
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
    this.#announceDraft(value)
  }

  readonly onPointInput = (event: Event): void => {
    this.pointDraft.set((event.target as HTMLInputElement).value)
  }

  readonly onCodeInput = (event: Event): void => {
    this.codeDraft.set((event.target as HTMLInputElement).value)
  }

  /** Focus a field as soon as it is drawn — a few frames at most. */
  #focusSoon = (selector: string, tries = 10): void => {
    const field = document.querySelector<HTMLInputElement>(selector)
    if (field) { field.focus(); return }
    if (tries > 0) setTimeout(() => this.#focusSoon(selector, tries - 1), 16)
  }

  /** The offered host, in one tap: hypercomb.com fills the field (its code,
   *  never needed — it is open — goes with the old host). */
  readonly offerPoint = (): void => {
    this.pointDraft.set(OFFERED_POINT_LABEL)
    this.codeDraft.set('')
    if (this.missingField() === 'host' || this.missingField() === 'point') this.missingField.set(null)
    queueMicrotask(() => {
      document.querySelector<HTMLInputElement>('.mesh-modal-room')?.focus()
    })
  }

  /** The meeting point and code as typed are something a dial can carry:
   *  an empty point names no host (a join refuses it — #hostNamed); a code
   *  needs the point it is for. Flags the field otherwise. */
  #meetingPointValid = (): boolean => {
    if (!this.pointSupported()) return true
    const typed = this.pointDraft().trim()
    const code = this.codeDraft().trim()
    if (typed && !meetingRelayOf(typed)) { this.missingField.set('point'); return false }
    if (code && !isAccessCode(code)) { this.missingField.set('code'); return false }
    if (code && !typed) { this.missingField.set('point'); return false }
    return true
  }

  /** NO HOST, NO ROOM: joining or sharing needs the host field filled (a
   *  mesh that cannot meet at a point meets on its own list, unasked). Flags
   *  the field — and focuses it — otherwise. */
  #hostNamed = (): boolean => {
    if (!this.pointSupported() || this.pointDraft().trim()) return true
    this.missingField.set('host')
    queueMicrotask(() => { document.querySelector<HTMLInputElement>('.mesh-modal-point')?.focus() })
    return false
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
    // An older package forgets a point on refresh and cannot carry a code:
    // never point it (the fields are disabled, with the way to update).
    if (!this.pointSupported()) return
    // The field and nothing else (2026-10-11: no default host). An empty one
    // names no point: a non-join save may clear it — going quiet is allowed
    // — and the tab then meets at the relay its own list names, or nowhere.
    // Never the page's own domain.
    const relay = meetingRelayOf(this.pointDraft())
    // hypercomb.com is open and never takes a code (D8).
    const code = relay && meetingPointKey(relay) !== OPEN_POINT ? this.codeDraft().trim() : ''
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
    // A link with no host lands nobody anywhere (there is no default).
    if (!this.#hostNamed()) return
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

  /** Persist the drafts exactly as Save does — the meeting point, the
   *  credential stores, the `mesh:*` effects, the saved-locations chip —
   *  WITHOUT joining or closing. Save and Share both come through here so
   *  the two can never write the meeting differently. Only what defines the
   *  meeting is here: your own host lives in the host directory, your name
   *  on the presence line. */
  /** The swarm's label accessors — the one place a name is kept. */
  #swarmLabel = (): { myLabel?: () => string; setMyLabel?: (label: string) => void } | undefined =>
    get('@diamondcoreprocessor.com/SwarmDrone') as { myLabel?: () => string; setMyLabel?: (label: string) => void } | undefined

  readonly onLabelInput = (event: Event): void => {
    this.labelDraft.set((event.target as HTMLInputElement).value)
  }

  #commitDrafts = (): void => {
    const room = this.roomDraft().trim()
    const secret = this.secretDraft().trim()
    // Your name, when it changed — through the swarm, which re-announces it.
    const label = this.labelDraft().trim().slice(0, 64)
    const swarm = this.#swarmLabel()
    if (swarm?.setMyLabel && label !== (swarm.myLabel?.() ?? '')) swarm.setMyLabel(label)
    // THE POINT FIRST: the stores' change events resync the swarm at once,
    // and its first page address is derived in that same turn from the
    // point the tab meets at — written after, the page went out at the OLD
    // point's address until the next resync (meeting-invite.join does the
    // same).
    this.#commitMeetingPoint()
    this.#roomStore?.set(room)
    this.#secretStore?.set(secret)
    // What the store holds now (entered text folds), never the raw draft.
    EffectBus.emit('mesh:room', { room: this.#roomStore?.value ?? room })
    // A notice, never the secret: the store above already holds it (folded),
    // and listeners re-read it there.
    EffectBus.emit('mesh:secret', {})
    if (room) this.#savedStore?.add(room)
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
    // legitimate way to go quiet. The HOST first — the first field, and with
    // none there is no room to join (2026-10-11: no default host).
    if (this.joinMode() && !this.#hostNamed()) return
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

  /** The older-package line's button: open Packages to update. */
  readonly openPackages = (): void => {
    this.#close(true)
    EffectBus.emit('packages:open', {})
  }

  #close = (cancelled = false): void => {
    this.open.set(false)
    EffectBus.emit('mesh:modal-open', { open: false, cancelled })
    this.#announceDraft(null)
  }

  /** The header previews the draft's STRENGTH while the selector is open —
   *  the score, never the draft (null = closed). */
  #announceDraft = (draft: string | null): void => {
    const clean = draft?.trim() ?? ''
    const provider = get('@hypercomb.social/SecretStrengthProvider') as SecretStrengthProvider | undefined
    EffectBus.emit('mesh:secret-draft', { open: draft !== null, score: clean ? (provider?.evaluate(clean) ?? 0.5) : null })
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
