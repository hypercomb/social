// sharing/invite.queen.ts
//
// `/invite [label]` — invite people to the participant's CURRENT swarm:
//
//   • NOTHING selected → THE MEETING LINK, `https://<origin>/#meet=room/
//     secret/page` (meeting-invite.ts). It carries the place in the link
//     itself, so it is ready the instant it is asked for: no host, no upload,
//     no receipt wait. The page is the one the swarm actually hashes
//     (SwarmDrone.currentSegments — a pinned Home included), so everyone who
//     taps it lands in the same zone on the same page. Delivered through the
//     device's own ladder (share sheet → clipboard → fresh-tap toast).
//
//   • Tile(s) SELECTED → stamp each one as a `swarm:invite` junction (the
//     invite points at THAT tile's location). Peers who witness the tile over
//     the swarm get an invite icon; clicking it switches them in. A junction
//     rides the wire as a bundle SIGNATURE, so it also copies a
//     `https://<host>/<sig>` link — and that path keeps its availability
//     gate: the bundle must be host-served before anything is minted.
//
// Either way the invite encodes (segments, room, secret) so a recipient
// reproduces the exact swarm channel. SlashBehaviourDrone auto-wraps this
// registered object into a slash provider (command/description/invoke).
//
// THE MEETING POINT. A facilitator who meets somewhere other than the default
// relay — an always-on meeting point that asks for an access code — hands
// that out too: the meeting link carries this tab's meeting point, its
// meeting host and its access code (sessionStorage `hc:mesh-zone`,
// membership.ts). To set them:
//
//   invite wss://<meeting point>    opens the selector on that meeting point,
//   invite code                     …or on the code field, to paste the
//                                   access code (a recycled one replaces it);
//                                   the selector's share button copies the
//                                   link.
//
// The code is NEVER taken from the command line: the line is remembered
// (command history, on this device), and the code may live only in this tab's
// session and in the link. A code typed after `code` is refused, and named so.

import { EffectBus, get, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { deliverLink } from './deliver-link.js'
import {
  MEETING_INVITE_KIND,
  MEETING_INVITE_VERSION,
  INVITE_SECRET_PREFIX,
  SWARM_INVITE_KIND,
  encodeInviteBundle,
  inviteSecretCheck,
  meetFragment,
  meetingRelayOf,
  type InviteDecorationPayload,
  type MeetingInviteBundle,
} from './meeting-invite.js'
import { isJoinedHere, readTabZone } from './membership.js'
import { writeDecoration } from '../commands/decoration-manifest.js'

const STORE_KEY = '@hypercomb.social/Store'
const ROOM_KEY = '@hypercomb.social/RoomStore'
const SECRET_KEY = '@hypercomb.social/SecretStore'
const NAV_KEY = '@hypercomb.social/Navigation'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const SELECTION_KEY = '@diamondcoreprocessor.com/SelectionService'
const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
const SELF_DOMAIN_KEY = 'hc:nostrmesh:self-domain'

interface StoreLike { putResource: (b: Blob) => Promise<string> }
interface CredStoreLike { value: string }
interface NavLike { segments: () => string[] }
interface SelectionLike { selected: ReadonlySet<string> }
interface SwarmLike { currentSegments?: () => readonly string[] }
interface LineageLike { explorerSegments?: () => readonly string[] }
interface HostSyncLike {
  isEnabled?: () => boolean
  ensureReceipt?: (sig: string, timeoutMs?: number) => Promise<boolean>
}

function normalizeHost(raw: string): string {
  return String(raw ?? '').trim()
    .replace(/^wss?:\/\//i, '').replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '').toLowerCase()
}

const LOOPBACK_RE = /^(localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i

export class InviteQueenBee {
  readonly command = 'invite'
  readonly description =
    'Invite people to your current meeting place. Copies a meeting link to this room and page; with a tile selected, stamps it as a swarm junction instead.'
  readonly descriptionKey = 'slash.invite'

  /** THE MEETING LINK, whatever is selected — the entry point for the
   *  status line's Invite and the mesh modal's share button. Those are about
   *  the room, never about a tile the facilitator happens to have selected;
   *  through invoke('') a selection turned them into the junction-bundle path
   *  (which needs host sync, or refuses). */
  async meetingLink(): Promise<void> {
    const room = (get<CredStoreLike>(ROOM_KEY)?.value ?? '').trim()
    const secret = (get<CredStoreLike>(SECRET_KEY)?.value ?? '').trim()
    const nav = get<NavLike>(NAV_KEY)
    if (!nav?.segments) {
      this.#toast('error', 'Invite', 'Core services are not ready yet.')
      return
    }
    if (!room || !secret) {
      this.#toast('tip', 'Invite', 'Set a room and secret (go public) before sharing an invite.')
      return
    }
    await this.#deliverMeetingLink(room, secret, nav)
  }

  async invoke(args: string): Promise<void> {
    const store = get<StoreLike>(STORE_KEY)
    const room = get<CredStoreLike>(ROOM_KEY)
    const secret = get<CredStoreLike>(SECRET_KEY)
    const nav = get<NavLike>(NAV_KEY)
    if (!room || !secret || !nav?.segments) {
      this.#toast('error', 'Invite', 'Core services are not ready yet.')
      return
    }

    // `invite wss://…` / `invite code`: the facilitator's meeting point, set
    // in the selector — never a code on this line.
    const tokens = (args ?? '').trim().split(/\s+/).filter(Boolean)
    const pointToken = tokens.find(t => /^wss?:\/\//i.test(t))
    const codeAt = tokens.findIndex(t => t.toLowerCase() === 'code')
    if (pointToken !== undefined || codeAt >= 0) {
      this.#openMeetingPoint(pointToken, codeAt >= 0 && codeAt < tokens.length - 1)
      return
    }

    const roomVal = (room.value ?? '').trim()
    const secretVal = (secret.value ?? '').trim()
    if (!roomVal || !secretVal) {
      this.#toast('tip', 'Invite', 'Set a room and secret (go public) before sharing an invite.')
      return
    }

    const selection = get<SelectionLike>(SELECTION_KEY)
    const selected = selection?.selected ? [...selection.selected] : []

    // NOTHING SELECTED → the meeting link. Ready at once, no host involved.
    if (selected.length === 0) {
      await this.#deliverMeetingLink(roomVal, secretVal, nav)
      return
    }

    if (!store?.putResource) {
      this.#toast('error', 'Invite', 'Core services are not ready yet.')
      return
    }

    // AVAILABILITY GATE — an invite is a DURABLE-HOST contract: the link
    // (and any stamped junction's bundleSig on the wire) is fetched by
    // machines that have never met this browser, so the bundle MUST be
    // host-served before anything is minted. Without hosting we refuse
    // outright rather than mint a link that 404s for everyone but us —
    // the share doctrine: to share it, it already has to be available.
    const hostSync = get<HostSyncLike>(HOST_SYNC_KEY)
    if (!hostSync?.isEnabled?.()) {
      this.#toast('error', 'Invite',
        'Sharing requires hosting — turn on host sync (with a self-domain) so invitees can fetch the invite, then run /invite again.')
      return
    }

    const alias = args.trim().slice(0, 120) || undefined
    const baseSegments = nav.segments()

    // THE BUNDLE HOLDS NO SECRET (jwize, 2026-10-07: "the key can never be
    // stored in a pool or public place"). It goes to the host and its sig
    // rides the swarm, so it carries only the secret's check; a swarm peer
    // already holds the secret, and the link carries it in its fragment.
    const secretCheck = await inviteSecretCheck(roomVal, secretVal)
    const mkBundle = (segments: string[], lbl?: string): MeetingInviteBundle => ({
      kind: MEETING_INVITE_KIND,
      v: MEETING_INVITE_VERSION,
      segments,
      room: roomVal,
      secretCheck,
      ...((alias ?? lbl) ? { alias: alias ?? lbl } : {}),
      createdAt: Date.now(),
    })

    let linkSig: string | null = null
    let stamped = 0
    const mintedSigs: string[] = []

    // Each selected tile becomes a junction pointing at its OWN location.
    for (const label of selected) {
      const segments = [...baseSegments, label]
      let bundleSig: string
      try {
        bundleSig = await store.putResource(encodeInviteBundle(mkBundle(segments, label)))
      } catch (err) {
        console.warn('[invite] putResource failed for', label, err)
        continue
      }
      try {
        await writeDecoration<InviteDecorationPayload>({
          kind: SWARM_INVITE_KIND,
          appliesTo: segments,
          payload: { bundleSig },
          segments,
        })
        stamped++
        linkSig ??= bundleSig
        mintedSigs.push(bundleSig)
      } catch (err) {
        console.warn('[invite] stamp failed for', label, err)
      }
    }
    if (stamped === 0) {
      this.#toast('error', 'Invite', 'Could not stamp the selected tile(s).')
      return
    }

    if (!linkSig) { this.#toast('error', 'Invite', 'Could not create the invite.'); return }

    // AVAILABILITY GATE, second half: putResource emitted `content:wrote`,
    // so every bundle is already in the host-sync queue — now WAIT for the
    // confirmed read-back receipt before declaring the link live. Bundles
    // are single tiny PUTs (normally sub-second); a shared deadline covers
    // multi-tile stamps. On timeout the queue keeps retrying detached, so
    // we hand the link over with an honest "still uploading" instead of a
    // false success — never a silent dead link.
    const deadline = Date.now() + 12_000
    let confirmed = true
    for (const sig of mintedSigs) {
      const ok = await hostSync.ensureReceipt?.(sig, Math.max(0, deadline - Date.now()))
      if (!ok) { confirmed = false; break }
    }

    const host = this.#linkHost()
    const scheme = LOOPBACK_RE.test(host) ? 'http' : 'https'
    // The secret rides in the fragment, which no server is sent.
    const url = `${scheme}://${host}/${linkSig}${INVITE_SECRET_PREFIX}${encodeURIComponent(secretVal)}`

    // Sheet → clipboard → fresh-tap offer: the receipt wait above can leave
    // the tap's activation stale, and on phones the invite is the link most
    // likely to be TEXTED onward — the share sheet is its natural exit.
    const delivery = await deliverLink(url, 'Hypercomb invite')
    const handed = delivery === 'shared' ? 'Link shared' : delivery === 'copied' ? 'Link copied' : ''

    const stampNote = stamped > 0
      ? `Stamped ${stamped} tile${stamped === 1 ? '' : 's'} as a swarm junction. `
      : ''
    const linkNote = confirmed
      ? (handed ? `${handed} — anyone who opens it joins this meeting place.` : url)
      : (handed
          ? `${handed} — the invite is still uploading to your host; it goes live for others once the upload confirms (retries automatically).`
          : url)
    this.#toast(confirmed ? 'success' : 'info', 'Meeting place invite', stampNote + linkNote)
    console.log(`[invite] ${stamped > 0 ? `stamped ${stamped} tile(s); ` : ''}${confirmed ? '' : '(receipt pending) '}${url}`)
  }

  /** The meeting link for this room, secret and page, handed over on the
   *  device's own terms. The page is what the swarm hashes: its own record of
   *  the last sync while joined, else the explorer's segments — never the
   *  URL's lower-cased form, which differs for a raw-named tile. It carries
   *  this tab's meeting point (relay, host, code) when it has one, so the
   *  room meets where the facilitator meets. The toasts and the log name the
   *  meeting point, never the code. */
  #deliverMeetingLink = async (room: string, secret: string, nav: NavLike): Promise<void> => {
    let segs: readonly string[] | undefined
    if (isJoinedHere()) {
      try { segs = get<SwarmLike>(SWARM_KEY)?.currentSegments?.() } catch { segs = undefined }
    }
    if (!Array.isArray(segs)) segs = get<LineageLike>(LINEAGE_KEY)?.explorerSegments?.() ?? nav.segments()
    const segments = segs.map(s => String(s ?? '').trim()).filter(s => s.length > 0)
    const zone = readTabZone()
    const relay = meetingRelayOf(zone?.relay)
    const url = `${window.location.origin}/${meetFragment(room, secret, segments, { relay, host: zone?.host, code: zone?.code })}`
    const point = relay.replace(/^wss?:\/\//, '')

    const delivery = await deliverLink(url, 'Hypercomb meeting')
    // 'offered' already put the URL on screen behind a fresh-tap button.
    if (delivery !== 'offered') {
      const shared = delivery === 'shared'
      this.#toast('success', this.#tr('invite.meet.title', 'Meeting link'), point
        ? shared
          ? this.#tr('invite.meet.shared-at', `Meeting link shared — anyone who opens it joins ${room} at ${point}, on this page.`, { room, point })
          : this.#tr('invite.meet.copied-at', `Meeting link copied — anyone who opens it joins ${room} at ${point}, on this page.`, { room, point })
        : shared
          ? this.#tr('invite.meet.shared', `Meeting link shared — anyone who opens it joins ${room} on this page.`, { room })
          : this.#tr('invite.meet.copied', `Meeting link copied — anyone who opens it joins ${room} on this page.`, { room }))
    }
    console.log(`[invite] meeting link ${url.slice(0, url.indexOf('#'))}#meet=…${point ? ` at ${point}` : ''}`)
  }

  /** THE FACILITATOR'S MEETING POINT — set in the selector, which pre-fills
   *  the named point and puts the cursor on the access code. Nothing is
   *  written here; the selector writes on share or save. */
  #openMeetingPoint = (pointToken: string | undefined, codeTyped: boolean): void => {
    const title = this.#tr('invite.point.title', 'Meeting point')
    const point = pointToken === undefined ? '' : meetingRelayOf(pointToken)
    if (pointToken !== undefined && !point) {
      this.#toast('error', title, this.#tr('invite.point.invalid', 'That is not a meeting point — give it as wss://name.tld (a path may follow).'))
      return
    }
    if (codeTyped) {
      this.#toast('warning', title, this.#tr('invite.point.code-not-here',
        'The access code is never taken from the command line — it remembers what it runs. Paste it in the selector instead.'))
    }
    EffectBus.emit('mesh:open-modal', { ...(point ? { point } : {}), focus: 'code' })
  }

  #tr = (key: string, fallback: string, params?: Record<string, string | number>): string => {
    const s = get<I18nProvider>(I18N_IOC_KEY)?.t(key, params)
    return s && s !== key ? s : fallback
  }

  #linkHost = (): string => {
    try {
      const self = normalizeHost(localStorage.getItem(SELF_DOMAIN_KEY) ?? '')
      if (self) return self
    } catch { /* ignore */ }
    return normalizeHost(window.location.host) || window.location.host
  }

  #toast = (type: string, title: string, message: string): void => {
    EffectBus.emit('toast:show', { type, title, message })
  }
}

const _invite = new InviteQueenBee()
window.ioc.register('@diamondcoreprocessor.com/InviteQueenBee', _invite)
