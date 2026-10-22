// sharing/meeting-invite.worker.ts
//
// Receive side of "share a meeting place by link" AND "join via a tile-borne
// invite junction". One Worker drives both:
//
//   • Meeting link — `#meet=room/secret/page`, the link a bare `invite`
//     copies. The shell capture stashes the fragment under MEET_KEY; this
//     worker joins straight from it. Nothing is fetched first: the link
//     carries the place itself, so joining by link waits on no host and no
//     bundle. The stash is KEPT until the sheet is answered — joined, not
//     now, already here, or a link that is no link — so a reload (or the
//     package floor's own reload) while the sheet is up asks again instead
//     of losing the invitation: the fragment left the address bar at boot,
//     and the stash is the only copy. A link that ARRIVES LATER — opened in
//     a tab already on the hive, where only the fragment changes and the
//     page never loads — is stashed by the shell, which says so with
//     `meet:pending`; the worker takes it then. A link it cannot read is
//     said so (a toast), never dropped in silence.
//
//   • Link path — the shell capture (hypercomb-shared/core/invite-capture.ts)
//     stashes a `/<sig>` boot URL under PENDING_INVITE_KEY; this worker drains
//     it once, resolves the bundle, and joins. The same capture stashes an
//     outside-in DOOR (a `?hive=` query pressed on somebody's published site)
//     under PENDING_DOOR_KEY, which carries coordinates rather than a
//     signature — a read-only visitor shell may not fetch across origins to
//     mint one — and lands as the same `hive:link`.
//
//   • Tile path — clicking a `swarm:invite` overlay icon emits
//     `tile:action { action:'invite', label }`. The handler resolves the
//     tile's invite bundle (a peer's `inviteSig` on the wire, or a local
//     `swarm:invite` decoration) and joins.
//
// Both funnel through joinMeetingPlace (meeting-invite.join.ts): confirm,
// then auth-switch — declining writes nothing. It is a Worker (acts once when the core
// services have registered) rather than a warmup() hook because the link sig
// may not be resolvable until Store + the credential stores exist.

import { Worker, get, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import {
  MEET_KEY,
  PENDING_INVITE_KEY,
  PENDING_INVITE_SECRET_KEY,
  SWARM_INVITE_KIND,
  meetFragment,
  parseMeet,
  validateInviteBundle,
  type InviteDecorationPayload,
} from './meeting-invite.js'
import { loadBundleJson, loadInviteBundle, joinMeetingPlace } from './meeting-invite.join.js'
import { PENDING_DOOR_KEY, hiveDoorOf, validateHiveLinkBundle } from './hive-link.js'
import { listDecorations } from '../commands/decoration-manifest.js'
import { openSwarmLink, parseSwarmLink, swarmRelayUrl } from './swarm-link.js'
import { fetchTakeBundle, parseTake } from './take-home.js'

/** The shell's stash of a #swarm= link — MIRRORED: hypercomb-shared/core/
 *  invite-capture.ts PENDING_SWARM_KEY. */
const SWARM_LINK_KEY = 'hc:pending-swarm'
/** The shell's stash of a #take= link — MIRRORED: hypercomb-shared/core/
 *  invite-capture.ts PENDING_TAKE_KEY. */
const TAKE_LINK_KEY = 'hc:pending-take'

const STORE_KEY = '@hypercomb.social/Store'
const ROOM_KEY = '@hypercomb.social/RoomStore'
const SECRET_KEY = '@hypercomb.social/SecretStore'
const NAV_KEY = '@hypercomb.social/Navigation'
const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'

const SIG_RE = /^[a-f0-9]{64}$/

interface NavLike { segments: () => string[] }
interface SwarmLike {
  peerTilesAtCurrentSig?: () => readonly ({ name: string } & Record<string, unknown>)[]
}
interface TileActionPayload { action?: string; label?: string }

export class MeetingInviteWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'meeting-invite'

  public override description =
    'Joins a meeting place from a #meet= meeting link or a /<sig> invite link (on boot), or from a swarm:invite tile junction (on click): confirms, and auth-switches the participant in — nothing is written unless they join.'
  public override effects = ['network'] as const
  protected override listens = ['tile:action', 'meet:pending']
  protected override emits = ['keymap:invoke', 'command-line:stance', 'mesh:room', 'mesh:secret', 'toast:show', 'hive:link']

  // Synchronous one-shot latch — Worker.pulse sets its own #acted only after
  // act() resolves, so guard re-entrancy ourselves (act awaits nothing before
  // wiring the listener, but the link branch is one-shot).
  #handled = false

  /** The stashed link whose sheet is up — one at a time. */
  #meetTaken = ''

  /** THE SHELL ASKS THIS. A package that keeps the meeting link until it is
   *  answered says so here; the shell's fallback (invite-capture.ts) then
   *  leaves the stash to it. A package without it either drained the stash
   *  at once or never read it — and the shell opens the selector itself. */
  readonly meetLinks = 2

  protected override ready = (): boolean => {
    if (this.#handled) return false
    return !!get(STORE_KEY) && !!get(ROOM_KEY) && !!get(SECRET_KEY) && !!get(NAV_KEY)
  }

  protected override act = async (): Promise<void> => {
    this.#handled = true

    // Always-on: clicking a swarm:invite junction icon.
    this.onEffect<TileActionPayload>('tile:action', (p) => {
      if (p?.action === 'invite' && typeof p.label === 'string' && p.label) {
        void this.#joinFromTile(p.label)
      }
    })

    // A `#meet=` meeting link captured at boot — and any the shell stashes
    // later, from a link opened in this tab while it is on the hive.
    this.onEffect('meet:pending', () => { void this.#takeSwarm(); this.#takeMeet(); void this.#takeHome() })
    void this.#takeSwarm()
    void this.#takeHome()
    this.#takeMeet()

    // One-shot: a /<sig> invite link captured at boot. sessionStorage
    // survives a reload within the tab, so clear it regardless of outcome.
    const sig = this.#pendingLink()
    if (sig) {
      this.#clearPending()
      void this.#joinFromLink(sig)
    }

    // One-shot: an outside-in DOOR captured at boot — a link pressed on
    // somebody's published site, carrying coordinates rather than a
    // signature. It reaches the same place a `/<sig>` hive-link does, and
    // the head is read from the publisher's signed index there.
    this.#drainDoor()
  }

  #drainDoor = (): void => {
    let held = ''
    try { held = sessionStorage.getItem(PENDING_DOOR_KEY) ?? '' } catch { held = '' }
    if (!held) return
    try { sessionStorage.removeItem(PENDING_DOOR_KEY) } catch { /* ignore */ }
    const door = hiveDoorOf(held)
    if (!door) return
    // The route rides BESIDE the bundle, never inside it: a bundle is one
    // creation's coordinates and reads the same for everyone handed it, while
    // where the reader was standing is theirs alone.
    this.emitEffect('hive:link', door.at.length ? { ...door.bundle, at: [...door.at] } : door.bundle)
  }

  /** A SIGNED SWARM LINK stashed by the shell (#swarm=, swarm-link.ts):
   *  fetch the locked login from its host by signature, check it, open it
   *  with the key the link carried — then it is a #meet= link like any other
   *  (room, secret, page, the host as its meeting point, the code), stashed
   *  and joined through the one sheet. A link that cannot be opened is said
   *  so, by reason; nothing is joined. */
  #takeSwarm = async (): Promise<void> => {
    if (this.#swarmTaking) return
    let held = ''
    try { held = sessionStorage.getItem(SWARM_LINK_KEY) ?? '' } catch { held = '' }
    if (!held) return
    this.#swarmTaking = true
    try {
      try { sessionStorage.removeItem(SWARM_LINK_KEY) } catch { /* ignore */ }
      const parts = parseSwarmLink(held)
      const opened = parts ? await openSwarmLink(parts) : { ok: false as const, reason: 'malformed' as const }
      if (!opened.ok) {
        this.emitEffect('toast:show', {
          type: 'warning',
          title: this.#tr('invite.meet.title', 'Meeting link'),
          message: `${this.#tr('meet.swarm-link-unopened', 'This swarm link could not be opened — ask whoever shared it for a fresh one.')} (${opened.reason})`,
        })
        return
      }
      const login = opened.login
      const fragment = meetFragment(login.location, login.secret, login.page ?? [], {
        relay: swarmRelayUrl(login.host),
        ...(login.code ? { code: login.code } : {}),
      })
      try { sessionStorage.setItem(MEET_KEY, fragment) } catch { return }
      this.#takeMeet()
    } finally { this.#swarmTaking = false }
  }
  #swarmTaking = false

  /** TAKE HOME (take-home.ts): what this participant collected in a room,
   *  sent here from the room's door. The bundle is read from the room's host
   *  by its signature and checked against it, then taken as any hive link is
   *  — offered at the top level, adopted as it is entered. A link that cannot
   *  be read is said so; nothing is taken. */
  #takeHome = async (): Promise<void> => {
    let held = ''
    try { held = sessionStorage.getItem(TAKE_LINK_KEY) ?? '' } catch { held = '' }
    if (!held) return
    try { sessionStorage.removeItem(TAKE_LINK_KEY) } catch { /* ignore */ }
    const link = parseTake(held)
    const bundle = link ? await fetchTakeBundle(link.sig, link.host) : null
    if (!bundle) {
      this.emitEffect('toast:show', {
        type: 'warning',
        title: this.#tr('take.title', 'Take home'),
        message: this.#tr('take.unreadable', 'What you took home could not be read from the room\'s host — try "room home" again from the room.'),
      })
      return
    }
    this.emitEffect('hive:link', bundle)
  }

  #heldMeet = (): string => {
    try { return sessionStorage.getItem(MEET_KEY) ?? '' } catch { return '' }
  }

  /** Answer the stashed meeting link. Cleared only once the join has
   *  settled, on every exit. A newer link stashed while the sheet was up is
   *  kept, and asked about next. A link that is no link is dropped at once —
   *  and said so: the guest tapped something, and nothing at all is the one
   *  answer they must never get. */
  #takeMeet = (): void => {
    if (this.#meetTaken) return
    const held = this.#heldMeet()
    if (!held) return
    const meet = parseMeet(held)
    if (!meet) {
      this.#clearMeet()
      this.emitEffect('toast:show', {
        type: 'warning',
        title: this.#tr('invite.meet.title', 'Meeting link'),
        message: this.#tr('meet.link-unreadable', 'This meeting link could not be read — ask whoever shared it for a fresh one.'),
      })
      return
    }
    this.#meetTaken = held
    void joinMeetingPlace(meet).catch(() => false).finally(() => {
      this.#meetTaken = ''
      if (this.#heldMeet() === held) this.#clearMeet()
      else this.#takeMeet()
    })
  }

  #clearMeet = (): void => {
    try { sessionStorage.removeItem(MEET_KEY) } catch { /* ignore */ }
  }

  /** The catalog's words, else English — `t()` answers a missing key with
   *  the key itself. */
  #tr = (key: string, fallback: string): string => {
    const s = (get(I18N_IOC_KEY) as I18nProvider | undefined)?.t(key)
    return s && s !== key ? s : fallback
  }

  #pendingLink = (): string => {
    try {
      const v = (sessionStorage.getItem(PENDING_INVITE_KEY) ?? '').trim().toLowerCase()
      return SIG_RE.test(v) ? v : ''
    } catch { return '' }
  }

  #clearPending = (): void => {
    try { sessionStorage.removeItem(PENDING_INVITE_KEY) } catch { /* ignore */ }
  }

  /** A /<sig> boot link resolves to ONE bundle, dispatched by kind: a
   *  meeting-invite joins (auth-switch), a hive-link hands off to the
   *  static-hive preview flow (hive-visit.drone). Unknown/unreachable
   *  stays the honest invalid-link toast. */
  #joinFromLink = async (sig: string): Promise<void> => {
    const raw = await loadBundleJson(sig)
    const invite = validateInviteBundle(raw)
    // The secret rode in the link's fragment (`#invite-secret=`), never in
    // the bundle the host serves. Drained once, like the link itself.
    let linkSecret = ''
    try {
      linkSecret = sessionStorage.getItem(PENDING_INVITE_SECRET_KEY) ?? ''
      sessionStorage.removeItem(PENDING_INVITE_SECRET_KEY)
    } catch { linkSecret = '' }
    if (invite) {
      await joinMeetingPlace(invite, linkSecret || undefined)
      return
    }
    const hiveLink = validateHiveLinkBundle(raw)
    if (hiveLink) {
      this.emitEffect('hive:link', hiveLink)
      return
    }
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    this.emitEffect('toast:show', { type: 'error', title: i18n?.t('invite.link.title') ?? 'Invite link', message: i18n?.t('invite.error.invalid') ?? 'This invite link is invalid or could not be reached.' })
  }

  #joinFromTile = async (label: string): Promise<void> => {
    const bundleSig = this.#peerInviteSig(label) ?? await this.#localInviteSig(label)
    if (!bundleSig) {
      const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
      this.emitEffect('toast:show', { type: 'tip', title: i18n?.t('invite.title') ?? 'Invite', message: i18n?.t('invite.error.no-tile') ?? 'This tile has no swarm invite.' })
      return
    }
    const bundle = await loadInviteBundle(bundleSig)
    if (!bundle) {
      const i18nLoad = get(I18N_IOC_KEY) as I18nProvider | undefined
      this.emitEffect('toast:show', { type: 'error', title: i18nLoad?.t('invite.title') ?? 'Invite', message: i18nLoad?.t('invite.error.load') ?? 'The invite could not be loaded.' })
      return
    }
    await joinMeetingPlace(bundle)
  }

  /** Observer path: the publisher surfaced the junction tile's bundle sig as
   *  `inviteSig` on the wire (see swarm.drone publish + visual-sanitizer). */
  #peerInviteSig = (label: string): string | null => {
    const swarm = get<SwarmLike>(SWARM_KEY)
    for (const t of swarm?.peerTilesAtCurrentSig?.() ?? []) {
      if (t.name !== label) continue
      const s = String(t['inviteSig'] ?? '').toLowerCase()
      if (SIG_RE.test(s)) return s
    }
    return null
  }

  /** Owner path: the junction tile carries a local `swarm:invite` decoration. */
  #localInviteSig = async (label: string): Promise<string | null> => {
    const nav = get<NavLike>(NAV_KEY)
    if (!nav) return null
    try {
      const decos = await listDecorations<InviteDecorationPayload>({
        kind: SWARM_INVITE_KIND,
        segments: [...nav.segments(), label],
      })
      const s = String(decos[0]?.record?.payload?.bundleSig ?? '').toLowerCase()
      return SIG_RE.test(s) ? s : null
    } catch { return null }
  }
}

const _meetingInvite = new MeetingInviteWorker()
window.ioc.register('@diamondcoreprocessor.com/MeetingInviteWorker', _meetingInvite)
