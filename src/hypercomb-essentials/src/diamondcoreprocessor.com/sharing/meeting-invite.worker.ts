// diamondcoreprocessor.com/sharing/meeting-invite.worker.ts
//
// Receive side of "share a meeting place by link" AND "join via a tile-borne
// invite junction". One Worker drives both:
//
//   • Link path — the shell capture (hypercomb-shared/core/invite-capture.ts)
//     stashes a `/<sig>` boot URL under PENDING_INVITE_KEY; this worker drains
//     it once, resolves the bundle, and joins.
//
//   • Tile path — clicking a `swarm:invite` overlay icon emits
//     `tile:action { action:'invite', label }`. The handler resolves the
//     tile's invite bundle (a peer's `inviteSig` on the wire, or a local
//     `swarm:invite` decoration) and joins.
//
// Both funnel through joinMeetingPlace (meeting-invite.join.ts): confirm,
// auth-switch, rollback-on-cancel. It is a Worker (acts once when the core
// services have registered) rather than a warmup() hook because the link sig
// may not be resolvable until Store + the credential stores exist.

import { Worker, get } from '@hypercomb/core'
import {
  PENDING_INVITE_KEY,
  SWARM_INVITE_KIND,
  type InviteDecorationPayload,
} from './meeting-invite.js'
import { loadInviteBundle, joinMeetingPlace } from './meeting-invite.join.js'
import { listDecorations } from '../commands/decoration-manifest.js'

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
    'Joins a meeting place from a /<sig> invite link (on boot) or from a swarm:invite tile junction (on click): resolves the bundle by signature, confirms, and auth-switches the participant in — restoring prior credentials on cancel.'
  public override effects = ['network'] as const
  protected override listens = ['tile:action']
  protected override emits = ['mesh:join', 'mesh:room', 'mesh:secret', 'toast:show']

  // Synchronous one-shot latch — Worker.pulse sets its own #acted only after
  // act() resolves, so guard re-entrancy ourselves (act awaits nothing before
  // wiring the listener, but the link branch is one-shot).
  #handled = false

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

    // One-shot: a /<sig> invite link captured at boot. sessionStorage
    // survives a reload within the tab, so clear it regardless of outcome.
    const sig = this.#pendingLink()
    if (sig) {
      this.#clearPending()
      void this.#joinFromLink(sig)
    }
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

  #joinFromLink = async (sig: string): Promise<void> => {
    const bundle = await loadInviteBundle(sig)
    if (!bundle) {
      this.emitEffect('toast:show', { type: 'error', title: 'Invite link', message: 'This invite link is invalid or could not be reached.' })
      return
    }
    await joinMeetingPlace(bundle)
  }

  #joinFromTile = async (label: string): Promise<void> => {
    const bundleSig = this.#peerInviteSig(label) ?? await this.#localInviteSig(label)
    if (!bundleSig) {
      this.emitEffect('toast:show', { type: 'tip', title: 'Invite', message: 'This tile has no swarm invite.' })
      return
    }
    const bundle = await loadInviteBundle(bundleSig)
    if (!bundle) {
      this.emitEffect('toast:show', { type: 'error', title: 'Invite', message: 'The invite could not be loaded.' })
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
