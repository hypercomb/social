// hypercomb-shim/src/bootstrap/managed-key.spec.ts — a managed page offers the key-list invite only while
// this browser's key is not on the publisher's list.

import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { firstKeyList, keyListTemplate, nextKeyList, verifyKeyListChain, type SignedKeyList } from '@hypercomb/core'
import { captureDeviceInvite, dropInvite, heldInvite } from './device-invite'
import { deviceSigner } from './device-key'
import { managedKeyCard, managedKeyState, showManagedKey } from './managed-key'
import type { ManageRecord } from './manage-record'

const WRITES = 'pluginthematrix.example'
const SITE = 'business-card.jwize.example'
const hex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
const sha = async (text: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))

const desktopSecret = generateSecretKey()
const anchor = getPublicKey(desktopSecret)
const record = (over: Partial<ManageRecord> = {}): ManageRecord =>
  ({ lineage: 'business-card', title: 'Business card', publisher: anchor, head: null, writes: WRITES, ...over })

/** The write host: the anchor's key list, nothing else. */
const listHost = () => {
  let chain: SignedKeyList[] | null = null
  const fetcher = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input)
    if (url.host !== WRITES || url.pathname !== `/${await sha('keys:lists')}/${anchor}`) return new Response('', { status: 404 })
    if ((init.method ?? 'GET') === 'GET') return chain ? new Response(JSON.stringify(chain)) : new Response('', { status: 404 })
    const offered = JSON.parse(String(init.body)) as SignedKeyList[]
    if (!verifyKeyListChain(anchor, offered, e => verifyEvent(structuredClone(e) as never)).ok) return new Response('', { status: 403 })
    chain = offered
    return new Response('', { status: 200 })
  })
  return {
    fetcher,
    invite: (until: number) => {
      const first = finalizeEvent(keyListTemplate(firstKeyList(anchor), until - 600) as never, desktopSecret) as unknown as SignedKeyList
      const secret = generateSecretKey()
      const next = nextKeyList(firstKeyList(anchor), first.id, { op: 'invite', pubkey: getPublicKey(secret), until }, until - 600)!
      chain = [first, finalizeEvent(keyListTemplate(next, until - 600) as never, desktopSecret) as unknown as SignedKeyList]
      return hex(secret)
    },
  }
}

const memoryStore = () => {
  const docs = new Map<FileSystemDirectoryHandle, ArrayBuffer>()
  const pools = new Map<string, FileSystemDirectoryHandle>()
  return {
    getPool: async (meaning: string) => pools.get(meaning) ?? (pools.set(meaning, { name: meaning } as FileSystemDirectoryHandle), pools.get(meaning)!),
    getPoolDoc: async (pool?: FileSystemDirectoryHandle) => (pool ? docs.get(pool) ?? null : null),
    putPoolDoc: async (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer) => { docs.set(pool, bytes); return 'ok' },
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('the managed page\'s own key', () => {
  let host: ReturnType<typeof listHost>
  beforeEach(() => {
    localStorage.clear()
    dropInvite()
    host = listHost()
    vi.stubGlobal('fetch', host.fetcher)
    const store = memoryStore()
    ;(window as unknown as { ioc: unknown }).ioc = { get: (key: string) => (key === '@hypercomb.social/Store' ? store : undefined) }
    document.querySelectorAll('hc-managed-key').forEach(element => element.remove())
  })
  afterEach(() => { vi.unstubAllGlobals() })

  const opened = (until: number) => {
    const secret = host.invite(until)
    captureDeviceInvite({ hash: `#invite=${WRITES}/${anchor}/${secret}`, pathname: '/@hypercomb', search: '' }, { replaceState: () => {} })
  }

  it('says how to get a key while this browser has none on the list: the one line, run on the hive', async () => {
    host.invite(Math.floor(Date.now() / 1000) + 600)
    const state = await managedKeyState(record(), { siteDoor: () => SITE })
    expect(state).toEqual({ state: 'unlisted' })
    const card = managedKeyCard(state, SITE, () => {})!
    expect(card.querySelector('code')?.textContent).toBe(`keys allow ${SITE}`)
    expect(card.textContent).toContain('open the link it gives you here')
  })

  it('one press copies that line for the hive, and says what to do with it', async () => {
    const copy = vi.fn(async () => true)
    const card = managedKeyCard({ state: 'unlisted' }, SITE, () => {}, copy)!
    const button = card.querySelector<HTMLButtonElement>('button.primary')!
    expect(button.textContent).toBe('Copy the line')
    button.click()
    await vi.waitFor(() => expect(button.textContent).toBe('Copied'))
    expect(copy).toHaveBeenCalledWith(`keys allow ${SITE}`)
    expect(card.querySelector('.note')?.textContent).toContain('Paste it on your hive')
  })

  it('says so when the browser will not copy, and the line is still there to select', async () => {
    const card = managedKeyCard({ state: 'unlisted' }, SITE, () => {}, async () => false)!
    const button = card.querySelector<HTMLButtonElement>('button.primary')!
    button.click()
    await vi.waitFor(() => expect(card.querySelector('.note')?.textContent).toContain('would not copy'))
    expect(button.textContent).toBe('Copy the line')
    expect(card.querySelector('code')?.textContent).toBe(`keys allow ${SITE}`)
  })

  it('never offers an invite to another publisher’s list', async () => {
    const stranger = 'c'.repeat(64)
    const state = await managedKeyState(record(), { siteDoor: () => SITE, invite: () => ({ host: WRITES, anchor: stranger, secret: 'f'.repeat(64) }) as never })
    expect(state.state).not.toBe('invited')
  })

  it('offers the invite the page was opened with, and Allow puts this browser\'s key on the list', async () => {
    opened(Math.floor(Date.now() / 1000) + 600)
    const state = await managedKeyState(record(), { siteDoor: () => SITE })
    expect(state).toMatchObject({ state: 'invited', invite: { host: WRITES, anchor } })
    const done = vi.fn()
    const heard = vi.fn()
    window.addEventListener('hypercomb:managed-key', heard)
    const card = managedKeyCard(state, SITE, done)!
    expect(card.textContent).toContain(`publish for ${anchor.slice(0, 8)}`)
    ;[...card.querySelectorAll('button')].find(button => button.textContent === 'Allow')!.click()
    await vi.waitFor(() => expect(card.querySelector('.note')?.textContent).toBe('This browser publishes for you now.'))
    window.removeEventListener('hypercomb:managed-key', heard)
    expect(heard).toHaveBeenCalled()
    expect(heldInvite()).toBeNull()
    // On the list now: nothing more is drawn.
    expect(await managedKeyState(record(), { siteDoor: () => SITE })).toEqual({ state: 'listed' })
    expect(managedKeyCard({ state: 'listed' }, SITE, done)).toBeNull()
  })

  it('draws nothing once the key is listed, even with an invite in the address', async () => {
    opened(Math.floor(Date.now() / 1000) + 600)
    const card = managedKeyCard(await managedKeyState(record(), { siteDoor: () => SITE }), SITE, () => {})!
    ;[...card.querySelectorAll('button')].find(button => button.textContent === 'Allow')!.click()
    await vi.waitFor(() => expect(deviceSigner(false)).not.toBeNull())
    await vi.waitFor(async () => expect(await managedKeyState(record(), { siteDoor: () => SITE })).toEqual({ state: 'listed' }))
    // Another invite link opened later is not offered: this browser is on the list.
    await showManagedKey(record(), { siteDoor: () => SITE, invite: () => ({ host: WRITES, anchor, secret: 'f'.repeat(64) }) })
    await settle()
    expect(document.querySelector('hc-managed-key')).toBeNull()
  })

  it('is quiet with no publisher, or when no host could be asked', async () => {
    expect(await managedKeyState(record({ publisher: null }))).toEqual({ state: 'quiet' })
    localStorage.setItem('hc:nostr:secret-key', hex(generateSecretKey()))
    const binding = async () => ({ anchor, sources: [] })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    expect(await managedKeyState(record(), { siteDoor: () => SITE, binding })).toEqual({ state: 'quiet' })
  })

  it('puts the corner card on the page in an element of its own', async () => {
    await showManagedKey(record(), { siteDoor: () => SITE })
    const element = document.querySelector('hc-managed-key')
    expect(element).not.toBeNull()
    expect(element!.shadowRoot!.querySelector('code')?.textContent).toBe(`keys allow ${SITE}`)
    // Asked again (the host card redraws), it is still one card.
    await showManagedKey(record(), { siteDoor: () => SITE })
    expect(document.querySelectorAll('hc-managed-key').length).toBe(1)
    // Closed is closed for this page.
    ;(element!.shadowRoot!.querySelector('.close') as HTMLButtonElement).click()
    expect(document.querySelector('hc-managed-key')).toBeNull()
    await showManagedKey(record(), { siteDoor: () => SITE })
    expect(document.querySelector('hc-managed-key')).toBeNull()
  })
})
