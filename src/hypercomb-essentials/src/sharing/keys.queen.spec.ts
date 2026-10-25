// sharing/keys.queen.spec.ts — the `keys` word: its forms, what a machine may
// say, the invite that lands but is never spent, and the three acts through the
// word itself (allow, accept, off) against a fake host that holds chains by
// core's rule. Real secp256k1 keys; no network.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const registry = vi.hoisted(() => {
  const held = new Map<string, unknown>()
  // A Store as the app has one — each place (each binding) gets its own, so a
  // binding written at one place is never read at another.
  const store = () => {
    const docs = new Map<string, ArrayBuffer>()
    const handle = (m: string) => ({ name: m } as unknown as FileSystemDirectoryHandle)
    return {
      initialize: async () => {},
      openPool: async (m: string) => [...docs.keys()].some(k => k.startsWith(`${m}|`)) ? handle(m) : null,
      getPool: async (m: string) => handle(m),
      getPoolDoc: async (pool: { name: string }, subKey?: string) => docs.get(`${pool.name}|${subKey ?? ''}`) ?? null,
      putPoolDoc: async (pool: { name: string }, bytes: ArrayBuffer, subKey?: string) => { docs.set(`${pool.name}|${subKey ?? ''}`, bytes); return 'f'.repeat(64) },
    }
  }
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: (key: string, value: unknown) => { held.set(key, value) },
    get: (key: string) => held.get(key),
    whenReady: (key: string, ready: (value: unknown) => void) => { if (key === '@hypercomb.social/Store') ready(store()) },
  }
  return held
})

import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import {
  EffectBus, KEY_LIST_MEANING, acceptKeyListChain, firstKeyList, isListedKey, keyListTemplate, nextKeyList,
  readKeyList, registerPoolMeaning, type SignedKeyList,
} from '@hypercomb/core'
import { forgetKeyReads, inviteLink, parseInvite, pendingInvite, clearPendingInvite } from './key-list.client.js'
import { KeysQueenBee, keysMachineRefusal, parseKeysWord } from './keys.queen.js'

const POOL = await registerPoolMeaning(KEY_LIST_MEANING)
const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
const BINDING_KEY = '@hypercomb.social/AnchorBinding'
const T0 = Math.floor(Date.now() / 1000)
const HOST = 'one.example'

const secretOf = (n: number): Uint8Array => new Uint8Array(32).fill(n)
const pk = (n: number): string => getPublicKey(secretOf(n))
const sign = (n: number, template: { kind: number; created_at: number; tags: string[][]; content: string }): SignedKeyList =>
  finalizeEvent(template, secretOf(n)) as unknown as SignedKeyList

const asPlace = (n: number): void => {
  registry.set(SIGNER_KEY, {
    signEvent: async (evt: never) => finalizeEvent(evt, secretOf(n)),
    getPublicKeyHex: async () => pk(n),
    knownPublicKeyHex: async () => pk(n),
  })
}

const chains = new Map<string, SignedKeyList[]>()
const verify = (e: SignedKeyList): boolean => { try { return verifyEvent(structuredClone(e) as never) } catch { return false } }
const fakeHost = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(input))
  const m = new RegExp(`^/${POOL}/([0-9a-f]{64})$`).exec(url.pathname)
  if (!m) return new Response('no route', { status: 404 })
  const id = `${url.host}|${m[1]}`
  if (!init?.method || init.method === 'GET') return chains.has(id) ? Response.json(chains.get(id)) : new Response('none', { status: 404 })
  const auth = JSON.parse(decodeURIComponent(escape(atob(new Headers(init.headers).get('authorization')!.replace(/^Nostr /, '')))))
  const offered = JSON.parse(String(init.body)) as SignedKeyList[]
  if (!offered.some(e => { const list = readKeyList(e); return !!list && isListedKey(list, auth.pubkey) })) return new Response('', { status: 403 })
  const verdict = acceptKeyListChain(m[1], chains.get(id) ?? [], offered, verify, Math.floor(Date.now() / 1000))
  if (!verdict.ok) return new Response('', { status: 400, headers: { 'X-Reason': verdict.reason } })
  chains.set(id, offered)
  return new Response('held', { status: 201 })
}) as typeof fetch

const toasts: { type: string; message: string }[] = []
EffectBus.on<{ type: string; message: string }>('toast:show', p => { toasts.push(p) })
const lastToast = (): string => toasts.at(-1)?.message ?? ''
const run = (queen: KeysQueenBee, args: string): Promise<void> => (queen as unknown as { execute(a: string): Promise<void> }).execute(args)
const realFetch = globalThis.fetch

beforeEach(() => {
  chains.clear()
  toasts.length = 0
  registry.clear()
  forgetKeyReads()
  clearPendingInvite()
  localStorage.clear()
  globalThis.fetch = vi.fn(fakeHost) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  window.location.hash = ''
})

describe('the forms', () => {
  it('reads keys, allow, accept and off', () => {
    expect(parseKeysWord('')).toEqual({ form: 'list' })
    expect(parseKeysWord('  nonsense words')).toEqual({ form: 'list' })
    expect(parseKeysWord('allow')).toEqual({ form: 'allow', where: '' })
    expect(parseKeysWord('ALLOW https://Jwize.com/some/path')).toEqual({ form: 'allow', where: 'jwize.com' })
    expect(parseKeysWord('accept')).toEqual({ form: 'accept', link: '', label: '' })
    expect(parseKeysWord('accept https://x.example/#invite=a/b/c')).toEqual({ form: 'accept', link: 'https://x.example/#invite=a/b/c', label: '' })
    expect(parseKeysWord('accept invite=a/b/c as desktop at home')).toEqual({ form: 'accept', link: 'invite=a/b/c', label: 'desktop at home' })
    expect(parseKeysWord('off desktop')).toEqual({ form: 'off', place: 'desktop' })
    expect(parseKeysWord('off')).toEqual({ form: 'off', place: '' })
  })

  it('completes the words, and nothing once one is chosen', () => {
    const keys = new KeysQueenBee()
    expect(keys.slashComplete('')).toEqual(['allow', 'accept ', 'off '])
    expect(keys.slashComplete('a')).toEqual(['allow', 'accept '])
    expect(keys.slashComplete('of')).toEqual(['off '])
    expect(keys.slashComplete('off ')).toEqual([])
    expect(keys.slashComplete('allow')).toEqual([])
  })

  it('a machine may read who publishes, and say nothing that changes it', () => {
    expect(keysMachineRefusal('')).toBeUndefined()
    expect(keysMachineRefusal('anything else')).toBeUndefined()
    for (const line of ['allow', 'allow jwize.com', 'accept link', 'accept', 'off desktop']) {
      expect(keysMachineRefusal(line), line).toContain("only the participant says it")
    }
    const keys = new KeysQueenBee()
    expect(keys.machine).toMatchObject({ reach: 'additive', scope: 'local' })
    expect(keys.machine?.refuse?.('allow')).toContain('participant')
  })
})

describe('an invite that lands', () => {
  const parts = { host: HOST, anchor: pk(1), secret: 'c'.repeat(64) }

  it('is held and taken out of the address; the participant is told what to type, and nothing is spent', () => {
    window.history.replaceState(null, '', '/room?a=1')
    window.location.hash = `#invite=${HOST}/${parts.anchor}/${parts.secret}`
    new KeysQueenBee()
    expect(pendingInvite()).toEqual(parts)
    expect(window.location.hash).toBe('')
    expect(window.location.pathname + window.location.search).toBe('/room?a=1')
    expect(lastToast()).toContain('keys accept')
    expect(lastToast()).toContain(parts.anchor.slice(0, 8))
    expect(lastToast()).not.toContain(parts.secret)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(registry.has(BINDING_KEY)).toBe(true)
  })

  it('a page with no invite changes nothing', () => {
    window.history.replaceState(null, '', '/room#other')
    new KeysQueenBee()
    expect(pendingInvite()).toBeNull()
    expect(window.location.hash).toBe('#other')
    expect(toasts).toEqual([])
  })
})

describe('the acts, through the word', () => {
  const standing = (): void => {
    // A host the participant publishes to: their own domain, switched on.
    localStorage.setItem('hc:nostrmesh:self-domain', HOST)
    registry.set(SYNC_KEY, { isEnabled: () => true })
  }
  const bindingOf = (): { anchor(): string | null } => registry.get(BINDING_KEY) as { anchor(): string | null }

  it('says there is nowhere to keep a list when no host is named', async () => {
    asPlace(1)
    const keys = new KeysQueenBee()
    await run(keys, 'allow')
    expect(lastToast()).toContain('Name a host first')
    await run(keys, 'off desktop')
    expect(lastToast()).toContain('Name a host first')
    await run(keys, '')
    expect(lastToast()).toContain('Only this place publishes for you')
  })

  it('allow begins the list and gives a link (the clipboard is not here, so it is shown); accept at the other place spends it', async () => {
    standing()
    asPlace(1)
    const a = new KeysQueenBee()
    await run(a, 'allow jwize.com')
    const link = /https:\/\/jwize\.com\/#invite=\S+/.exec(lastToast())?.[0]
    expect(link).toBeDefined()
    expect(parseInvite(link!)?.anchor).toBe(pk(1))
    expect(chains.get(`${HOST}|${pk(1)}`)).toHaveLength(2)

    // The other place: its own key, nothing carried but the link.
    registry.clear()
    asPlace(2)
    const b = new KeysQueenBee()
    await run(b, `accept ${link} as desktop`)
    expect(lastToast()).toContain('now publishes for')
    expect(bindingOf().anchor()).toBe(pk(1))
    const head = readKeyList(chains.get(`${HOST}|${pk(1)}`)!.at(-1)!)!
    expect(head.keys).toEqual([{ pubkey: pk(1) }, { pubkey: pk(2), label: 'desktop' }])
  })

  it('accept takes the invite that landed when no link is typed', async () => {
    standing()
    asPlace(1)
    await run(new KeysQueenBee(), 'allow')
    const link = /https:\/\/\S+#invite=\S+/.exec(lastToast())![0]
    const parts = parseInvite(link)!

    registry.clear()
    asPlace(2)
    window.location.hash = new URL(inviteLink(HOST, parts)).hash
    const b = new KeysQueenBee()
    expect(pendingInvite()).toEqual(parts)
    await run(b, 'accept')
    expect(lastToast()).toContain('now publishes for')
    expect(pendingInvite()).toBeNull()
    expect(readKeyList(chains.get(`${HOST}|${pk(1)}`)!.at(-1)!)!.keys.map(k => k.pubkey)).toEqual([pk(1), pk(2)])
  })

  it('accept with nothing to accept, or a link that is not one, says what to do', async () => {
    asPlace(2)
    const b = new KeysQueenBee()
    await run(b, 'accept')
    expect(lastToast()).toContain('keys accept <link>')
    await run(b, 'accept https://x.example/')
    expect(lastToast()).toContain('keys accept <link>')
    expect(bindingOf().anchor()).toBeNull()
  })

  it('lists who publishes, marks this place, and off takes another off', async () => {
    standing()
    asPlace(1)
    await run(new KeysQueenBee(), 'allow')
    const link = /https:\/\/\S+#invite=\S+/.exec(lastToast())![0]
    registry.clear()
    asPlace(2)
    await run(new KeysQueenBee(), `accept ${link} as desktop`)

    // Back at the anchor: the list names both, and one is this place.
    registry.clear()
    standing()
    asPlace(1)
    const a = new KeysQueenBee()
    await run(a, '')
    expect(lastToast()).toContain('Publishing for')
    expect(lastToast()).toContain('(this place)')
    expect(lastToast()).toContain('desktop')

    await run(a, 'off')
    expect(lastToast()).toContain('Which place?')
    await run(a, 'off nobody')
    expect(lastToast()).toContain('No place on your list is called nobody')
    await run(a, 'off desktop')
    expect(lastToast()).toContain('desktop no longer publishes for you')
    expect(readKeyList(chains.get(`${HOST}|${pk(1)}`)!.at(-1)!)!.keys.map(k => k.pubkey)).toEqual([pk(1)])
  })

  it('a place that is not on the list cannot let another in, and says so', async () => {
    standing()
    asPlace(1)
    await run(new KeysQueenBee(), 'allow')
    registry.clear()
    standing()
    asPlace(2)
    const b = new KeysQueenBee()
    ;(registry.get(BINDING_KEY) as { bind(a: string, s: string[]): void }).bind(pk(1), [HOST])
    await run(b, 'allow')
    expect(lastToast()).toContain('not on your list')
  })
})

describe('the list as the participant first sees it', () => {
  it('names the anchor when a place is bound to one that no host holds', async () => {
    asPlace(2)
    localStorage.setItem('hc:nostrmesh:self-domain', HOST)
    registry.set(SYNC_KEY, { isEnabled: () => true })
    const b = new KeysQueenBee()
    ;(registry.get(BINDING_KEY) as { bind(a: string, s: string[]): void }).bind(pk(1), [HOST])
    await run(b, '')
    expect(lastToast()).toContain('no host you publish to holds its list')
  })
})
