// calendar/rsvp.drone.spec.ts — the page's one write: a signed claim, written
// to the meeting's host as the member named by its own hash, answered on the
// document (documentation/calendar-events.md).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SignatureService } from '@hypercomb/core'

// Which hosts hold a profile for this hive's key, and which were asked.
let profiles: Record<string, string> = {}
const askedForProfile: string[] = []
vi.mock('../sharing/hive-pointer.js', () => ({
  fetchHiveIndex: async () => ({ ok: false, reason: 'http', status: 404 }),
  setHiveRoot: async () => ({ ok: true }),
  nip98Header: async () => null,
  ownHiveRoot: async (host: string, key: string) => { askedForProfile.push(host); return key === 'nostr:profile' ? profiles[host] ?? null : null },
}))

const registry = new Map<string, unknown>()
;(globalThis as unknown as { window: unknown }).window ??= globalThis
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry.set(key, value) },
  get: (key: string) => registry.get(key),
}

const { RSVP_ASK, RSVP_DONE, RSVP_ERROR } = await import('./rsvp.drone.js')
const { readRsvp, rsvpPoolAddress } = await import('./event.js')
// The bee registers itself at load and listens on the document from then on —
// one instance, as in the hive; a second would answer every ask twice.
const drone = registry.get('@diamondcoreprocessor.com/RsvpDrone') as InstanceType<typeof import('./rsvp.drone.js').RsvpDrone>

const EVENT = 'e'.repeat(64)
let puts: Array<{ url: string; body: Uint8Array }>
let answer: { status: number; reason?: string }

beforeEach(() => {
  profiles = {}
  askedForProfile.length = 0
  delete document.documentElement.dataset['hypercombMode']
  puts = []
  answer = { status: 201 }
  registry.set('@diamondcoreprocessor.com/NostrSigner', {
    signEvent: async (evt: Record<string, unknown>) => ({ ...evt, pubkey: '1'.repeat(64), id: 'i'.repeat(64), sig: 's'.repeat(128) }),
  })
  globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    puts.push({ url: String(url), body: new Uint8Array(init?.body as ArrayBuffer) })
    return new Response(answer.reason ?? '', { status: answer.status, headers: answer.reason ? { 'x-reason': answer.reason } : {} })
  }) as unknown as typeof fetch
})

describe('a hosted attendee, and a check-in', () => {
  it('names the profile this hive\'s key has on a host, so the door can show who they are', async () => {
    profiles['hypercomb.com'] = 'c'.repeat(64)
    const outcome = await drone.join({ event: EVENT, host: 'meetups.hypercomb.com', name: 'Ada', going: 'here' })
    expect(outcome).toMatchObject({ ok: true, going: 'here', profile: 'c'.repeat(64) })
    const pool = await rsvpPoolAddress(EVENT)
    const member = await SignatureService.sign(puts[0]!.body.slice().buffer as ArrayBuffer)
    expect(await readRsvp(pool, member, puts[0]!.body, () => true)).toMatchObject({ going: 'here', host: 'hypercomb.com', profile: 'c'.repeat(64) })
    expect(askedForProfile).toEqual(['meetups.hypercomb.com', 'hypercomb.com'])
  })

  it('joins by name alone on a visitor door — a key that lives for the page has no profile to name', async () => {
    document.documentElement.dataset['hypercombMode'] = 'visitor'
    profiles['hypercomb.com'] = 'c'.repeat(64)
    const outcome = await drone.join({ event: EVENT, host: 'meetups.hypercomb.com', name: 'Visitor' })
    expect(outcome).toMatchObject({ ok: true, going: 'yes' })
    expect(outcome.ok && outcome.profile).toBeFalsy()
    expect(askedForProfile).toEqual([])
  })
})

describe('joining from the page', () => {
  it('signs the claim, writes it to the meeting\'s host as the member named by its hash, and answers the page with the receipt', async () => {
    expect(drone).toBeTruthy()
    const heard: CustomEvent[] = []
    document.addEventListener(RSVP_DONE, e => heard.push(e as CustomEvent))
    document.dispatchEvent(new CustomEvent(RSVP_ASK, { detail: { event: EVENT, host: 'meetups.hypercomb.com', name: ' Jaime ' } }))
    await vi.waitFor(() => expect(heard).toHaveLength(1))

    const pool = await rsvpPoolAddress(EVENT)
    expect(puts).toHaveLength(1)
    const member = await SignatureService.sign(puts[0]!.body.slice().buffer as ArrayBuffer)
    expect(puts[0]!.url).toBe(`https://meetups.hypercomb.com/${pool}/${member}`)
    expect(heard[0]!.detail).toEqual({ ok: true, event: EVENT, pool, member, name: 'Jaime', going: 'yes', host: 'meetups.hypercomb.com' })
    // What went over the wire reads back as the claim — the host's own check.
    expect(await readRsvp(pool, member, puts[0]!.body, () => true)).toMatchObject({ event: EVENT, who: 'Jaime', going: 'yes', signer: '1'.repeat(64) })
  })

  it('says why when the host refuses, when there is no signer, and when the ask is not a meeting', async () => {
    answer = { status: 400, reason: 'an rsvp says going yes or no' }
    expect(await drone.join({ event: EVENT, name: 'Jaime' })).toEqual({ ok: false, event: EVENT, reason: 'an rsvp says going yes or no' })
    expect(await drone.join({ event: 'not-a-meeting', name: 'Jaime' })).toMatchObject({ ok: false, reason: 'name the meeting by its signature' })
    expect(await drone.join({ event: EVENT, name: '  ' })).toMatchObject({ ok: false, reason: 'say who is coming' })
    registry.delete('@diamondcoreprocessor.com/NostrSigner')
    expect(await drone.join({ event: EVENT, name: 'Jaime' })).toMatchObject({ ok: false, reason: 'no signer here' })
    const errors: CustomEvent[] = []
    document.addEventListener(RSVP_ERROR, e => errors.push(e as CustomEvent))
    document.dispatchEvent(new CustomEvent(RSVP_ASK, { detail: { event: EVENT, name: 'Jaime' } }))
    await vi.waitFor(() => expect(errors).toHaveLength(1))
  })
})
