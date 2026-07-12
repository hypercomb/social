// diamondcoreprocessor.com/sharing/invite.queen.ts
//
// `/invite [label]` — create a meeting-place invite for the participant's
// CURRENT swarm and deliver it two ways:
//
//   • With tile(s) SELECTED → stamp each one as a `swarm:invite` junction
//     (the invite points at THAT tile's location). Peers who witness the
//     tile over the swarm get an invite icon; clicking it switches them in.
//
//   • Always → copy a `https://<host>/<sig>` link to the clipboard so the
//     same invite can be pasted anywhere.
//
// The invite encodes (segments, room, secret) so a recipient reproduces the
// exact swarm channel. SlashBehaviourDrone auto-wraps this registered object
// into a slash provider (command/aliases/description/invoke).
//
// Reachability: for a link OR a junction to resolve on another machine the
// bundle bytes must be fetchable by signature from a host. Store.putResource
// emits `content:wrote`, which HostSyncService PUTs to the operator's
// self-domain — but only when host sync is enabled. When it isn't, the invite
// still resolves in this browser; we say so rather than mint a dead link.

import { EffectBus, get } from '@hypercomb/core'
import {
  MEETING_INVITE_KIND,
  MEETING_INVITE_VERSION,
  SWARM_INVITE_KIND,
  encodeInviteBundle,
  type InviteDecorationPayload,
  type MeetingInviteBundle,
} from './meeting-invite.js'
import { writeDecoration } from '../commands/decoration-manifest.js'

const STORE_KEY = '@hypercomb.social/Store'
const ROOM_KEY = '@hypercomb.social/RoomStore'
const SECRET_KEY = '@hypercomb.social/SecretStore'
const NAV_KEY = '@hypercomb.social/Navigation'
const SELECTION_KEY = '@diamondcoreprocessor.com/SelectionService'
const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
const SELF_DOMAIN_KEY = 'hc:nostrmesh:self-domain'

interface StoreLike { putResource: (b: Blob) => Promise<string> }
interface CredStoreLike { value: string }
interface NavLike { segments: () => string[] }
interface SelectionLike { selected: ReadonlySet<string> }
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
  readonly aliases = ['meetlink', 'meeting-link', 'share-meeting'] as const
  readonly description =
    'Invite people to your current meeting place. With a tile selected, stamps it as a swarm junction; always copies a shareable link.'
  readonly descriptionKey = 'slash.invite'

  async invoke(args: string): Promise<void> {
    const store = get<StoreLike>(STORE_KEY)
    const room = get<CredStoreLike>(ROOM_KEY)
    const secret = get<CredStoreLike>(SECRET_KEY)
    const nav = get<NavLike>(NAV_KEY)
    if (!store?.putResource || !room || !secret || !nav?.segments) {
      this.#toast('error', 'Invite', 'Core services are not ready yet.')
      return
    }

    const roomVal = (room.value ?? '').trim()
    const secretVal = (secret.value ?? '').trim()
    if (!roomVal || !secretVal) {
      this.#toast('tip', 'Invite', 'Set a room and secret (go public) before sharing an invite.')
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
    const selection = get<SelectionLike>(SELECTION_KEY)
    const selected = selection?.selected ? [...selection.selected] : []

    const mkBundle = (segments: string[], lbl?: string): MeetingInviteBundle => ({
      kind: MEETING_INVITE_KIND,
      v: MEETING_INVITE_VERSION,
      segments,
      room: roomVal,
      secret: secretVal,
      ...((alias ?? lbl) ? { alias: alias ?? lbl } : {}),
      createdAt: Date.now(),
    })

    let linkSig: string | null = null
    let stamped = 0
    const mintedSigs: string[] = []

    if (selected.length > 0) {
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
    } else {
      // No selection — a link to the current location itself.
      try {
        linkSig = await store.putResource(encodeInviteBundle(mkBundle(baseSegments, undefined)))
        mintedSigs.push(linkSig)
      } catch (err) {
        console.warn('[invite] putResource failed', err)
        this.#toast('error', 'Invite', 'Could not create the invite resource.')
        return
      }
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
    const url = `${scheme}://${host}/${linkSig}`

    let copied = false
    try { await navigator.clipboard.writeText(url); copied = true }
    catch (err) { console.warn('[invite] clipboard write failed', err) }

    const stampNote = stamped > 0
      ? `Stamped ${stamped} tile${stamped === 1 ? '' : 's'} as a swarm junction. `
      : ''
    const linkNote = confirmed
      ? (copied ? 'Link copied — anyone who opens it joins this meeting place.' : url)
      : (copied
          ? 'Link copied — the invite is still uploading to your host; it goes live for others once the upload confirms (retries automatically).'
          : url)
    this.#toast(confirmed ? 'success' : 'info', 'Meeting place invite', stampNote + linkNote)
    console.log(`[invite] ${stamped > 0 ? `stamped ${stamped} tile(s); ` : ''}${confirmed ? '' : '(receipt pending) '}${url}`)
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
