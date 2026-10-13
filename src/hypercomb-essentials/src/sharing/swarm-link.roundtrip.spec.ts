// sharing/swarm-link.roundtrip.spec.ts — a signed swarm link, made by the
// sharer and opened by a guest, is the same meeting a #meet= link is
// (2026-10-12: "we host the payload and give the link with a signature" …
// "then the swarm login is retrieved"). The worker turns an opened login into
// a #meet= fragment and joins it through the one sheet; this pins that turn.

import { describe, expect, it } from 'vitest'
import { openSwarmLink, parseSwarmLink, publishSwarmLink, swarmLinkText, swarmRelayUrl } from './swarm-link.js'
import { meetFragment, parseMeet } from './meeting-invite.js'

describe('a signed swarm link opens into the meeting it was made for', () => {
  it('host, location, secret, code and page survive the host, the link and the guest', async () => {
    const heap = new Map<string, Uint8Array>()
    const login = { host: 'hypercomb.com', location: 'Downtown', secret: 'rose', page: ['events', 'tonight'] }
    const made = await publishSwarmLink(login, async ({ sig, bytes }) => { heap.set(sig, bytes); return { ok: true } })
    expect(made.ok).toBe(true)
    if (!made.ok) return
    const link = swarmLinkText('https://hypercomb.io', made.parts)
    expect(link).toMatch(/^https:\/\/hypercomb\.io\/#swarm=[0-9a-f]{64}@hypercomb\.com~/)
    // The host holds ciphertext only — the secret is nowhere in it.
    for (const bytes of heap.values()) expect(new TextDecoder().decode(bytes)).not.toContain('rose')

    const parts = parseSwarmLink(link)!
    const opened = await openSwarmLink(parts, async ({ sig }) => {
      const bytes = heap.get(sig)
      return bytes ? { ok: true, bytes } : { ok: false, reason: 'missing' }
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const meet = parseMeet(meetFragment(opened.login.location, opened.login.secret, opened.login.page ?? [], { relay: swarmRelayUrl(opened.login.host) }))
    expect(meet).toMatchObject({ room: 'Downtown', secret: 'rose', segments: ['events', 'tonight'] })
    expect(meet!.relay).toBe('wss://hypercomb.com')
  })

  it('a link whose key is wrong opens nothing', async () => {
    const heap = new Map<string, Uint8Array>()
    const made = await publishSwarmLink({ host: 'hypercomb.com', location: 'a', secret: 'b' }, async ({ sig, bytes }) => { heap.set(sig, bytes); return { ok: true } })
    if (!made.ok) throw new Error('not made')
    const other = await publishSwarmLink({ host: 'hypercomb.com', location: 'a', secret: 'b' }, async () => ({ ok: true }))
    if (!other.ok) throw new Error('not made')
    const opened = await openSwarmLink({ ...made.parts, key: other.parts.key }, async ({ sig }) => {
      const bytes = heap.get(sig)
      return bytes ? { ok: true, bytes } : { ok: false, reason: 'missing' }
    })
    expect(opened).toMatchObject({ ok: false, reason: 'locked' })
  })
})
