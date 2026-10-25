// publish-turn-off.drone.spec.ts — the hive takes a front door's hand-off.
//
// It acts only with the key it already holds, asks with the exact result in
// hand, writes on a yes and nothing on a no, moves the branch's host marks
// with the doors, and takes the stash once.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const PUB = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const HEAD = 'c'.repeat(64)

const setHiveDoors = vi.fn(async (_zone: string, _key: string, _scope: string, options: { dryRun?: boolean }) =>
  ({ ok: true as const, host: 'hypercomb.com', doors: ['jwize.com'], head: HEAD, unchanged: false, written: !options.dryRun, was: ['hypercomb.com', 'jwize.com'] }))
const setBranchHosts = vi.fn(async () => [] as string[])

vi.mock('./publish-branch.js', () => ({ setHiveDoors: (...args: Parameters<typeof setHiveDoors>) => setHiveDoors(...args) }))
vi.mock('./publish-heads.js', () => ({
  latestByLineageKey: async () => new Map([['dylan', { sealed: HEAD, record: { segments: ['dylan'] } }]]),
}))
vi.mock('./community-hosts.js', () => ({ setBranchHosts: (...args: unknown[]) => setBranchHosts(...(args as [])) }))

let held: string | null = PUB
const registered = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registered.set(key, value) },
  get: (key: string): unknown => (key === '@diamondcoreprocessor.com/NostrSigner'
    ? { knownPublicKeyHex: async () => held } : undefined),
}

let answer = true
EffectBus.on<{ id: string }>('confirm:request', request => { EffectBus.emit('confirm:response', { id: request.id, confirmed: answer }) })
const toasts: { type: string; message: string }[] = []
EffectBus.on<{ type: string; message: string }>('toast:show', toast => { toasts.push(toast) })

globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ sites: [
  { host: 'hypercomb.com', publishers: [] }, { host: 'jwize.com', publishers: [] },
  { host: 'dylan.jwize.com', lineage: 'dylan', hosts: [{ host: 'dylan.hypercomb.com' }], publishers: [{ pubkey: PUB, head: HEAD }] },
] }), { headers: { 'content-type': 'application/json' } })) as typeof fetch

// The front door's own encoder, loaded at run time (outside this package's rootDir).
const SHIM_LINK = '../../../hypercomb-shim/src/bootstrap/turn-off-link'
const { turnOffHref } = await import(/* @vite-ignore */ SHIM_LINK) as {
  turnOffHref: (home: unknown, link: Record<string, string>) => string | null }
const { PENDING_TURN_OFF_KEY } = await import('./publish-turn-off.js')
await import('./publish-turn-off.drone.js')
const drone = registered.get('@diamondcoreprocessor.com/PublishTurnOffDrone') as { pulse: (g: string) => Promise<void> }
await drone.pulse('test')

const hand = (scope: 'here' | 'everywhere', relayed = true): void => {
  const href = turnOffHref('http://localhost:4250', { title: 'dylan', lineage: 'dylan', publisher: PUB,
    zone: 'hypercomb.com', scope, head: HEAD, back: 'https://hypercomb.com/' })!
  sessionStorage.setItem(PENDING_TURN_OFF_KEY, JSON.stringify({ hash: href.slice(href.indexOf('#')), relayed }))
  EffectBus.emit('publish:turn-off', { at: Date.now() })
}

beforeEach(() => {
  setHiveDoors.mockClear()
  setBranchHosts.mockClear()
  toasts.length = 0
  held = PUB
  answer = true
})

describe('the hive takes a turn-off handed from a front door', () => {
  it('asks, then writes, and says so', async () => {
    hand('here')
    await vi.waitFor(() => expect(toasts.at(-1)?.message).toBe('"dylan" is off on hypercomb.com.'))
    expect(setHiveDoors).toHaveBeenCalledTimes(2)
    expect(setHiveDoors.mock.calls[0]![3]).toMatchObject({ pubkey: PUB, expectHead: HEAD, dryRun: true })
    expect(setHiveDoors.mock.calls[1]![3]).not.toHaveProperty('dryRun')
    // Taken once: the stash is gone, so a replayed wake does nothing.
    expect(sessionStorage.getItem(PENDING_TURN_OFF_KEY)).toBeNull()
  })

  it('does nothing with a key it does not hold', async () => {
    held = OTHER
    hand('everywhere')
    await vi.waitFor(() => expect(toasts.at(-1)?.message).toContain('does not hold the key'))
    expect(setHiveDoors).not.toHaveBeenCalled()
  })

  it('writes nothing when the participant keeps it on', async () => {
    answer = false
    hand('everywhere')
    await vi.waitFor(() => expect(toasts.at(-1)?.message).toBe('Nothing was changed.'))
    expect(setHiveDoors).toHaveBeenCalledTimes(1)
    expect(setHiveDoors.mock.calls[0]![3]).toMatchObject({ dryRun: true })
  })

  it("names the index key when the link's title is something else", async () => {
    const href = turnOffHref('http://localhost:4250', { title: 'my cat', lineage: 'dylan', publisher: PUB,
      zone: 'hypercomb.com', scope: 'everywhere', head: HEAD, back: 'https://hypercomb.com/' })!
    let asked = ''
    const stop = EffectBus.on<{ title: string }>('confirm:request', request => { asked = request.title })
    sessionStorage.setItem(PENDING_TURN_OFF_KEY, JSON.stringify({ hash: href.slice(href.indexOf('#')), relayed: true }))
    EffectBus.emit('publish:turn-off', { at: Date.now() })
    await vi.waitFor(() => expect(asked).toBe('Turn off "my cat (dylan)"?'))
    stop()
  })

  it('says a link it cannot read is not one it acts on', async () => {
    sessionStorage.setItem(PENDING_TURN_OFF_KEY, JSON.stringify({ hash: '#turn-off=garbage', relayed: true }))
    EffectBus.emit('publish:turn-off', { at: Date.now() })
    await vi.waitFor(() => expect(toasts.at(-1)?.message).toContain('not one this hive can read'))
    expect(setHiveDoors).not.toHaveBeenCalled()
  })
})
