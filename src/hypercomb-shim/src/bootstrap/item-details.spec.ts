// hypercomb-shim/src/bootstrap/item-details.spec.ts — what is said about one item is a pool, read by key and checked.

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { ABOUT_PART, cleanParts, detailsBytes, detailsKey, itemSignature, parseDetails, readDetails } from './item-details'
import { showcase, type LedgerSite } from './showcase'
import type { OwnerBridge } from './owner-bridge'

vi.mock('./tile-picture', () => ({ tilePicture: async () => null, pictureOrigins: () => [] }))

const sha = (value: string | Uint8Array): Promise<string> =>
  SignatureService.sign((typeof value === 'string' ? new TextEncoder().encode(value) : value).slice().buffer as ArrayBuffer)

describe('an item\'s details record', () => {
  const item = { pubkey: 'a'.repeat(64), lineage: 'dylan' }

  it('is found under details:<sign(key + lineage)>', async () => {
    expect(await itemSignature(item)).toBe(await sha(`${item.pubkey}\ndylan`))
    expect(await detailsKey(item)).toBe(`details:${await sha(`${item.pubkey}\ndylan`)}`)
  })

  it('keeps named parts with words, each name once, as plain words', () => {
    expect(cleanParts([
      { name: ' About ', text: 'A  game‎\r\n\r\n\r\n\r\nfor two.' }, { name: 'about', text: 'again' }, { name: 'credits', text: '' },
      { name: 'How to play', text: 'Tap.' }, 'nonsense', null,
    ])).toEqual([{ name: 'about', text: 'A game\n\nfor two.' }, { name: 'how to play', text: 'Tap.' }])
  })

  it('is the same bytes for the same words, and is believed only about its own item', () => {
    const bytes = detailsBytes(item, [{ name: 'about', text: 'A game.' }])
    expect(new TextDecoder().decode(bytes)).toBe(`{"kind":"item:details","pubkey":"${item.pubkey}","lineage":"dylan","parts":[{"name":"about","text":"A game."}]}`)
    const raw = JSON.parse(new TextDecoder().decode(bytes))
    expect(parseDetails(raw, item)).toEqual([{ name: 'about', text: 'A game.' }])
    expect(parseDetails(raw, { ...item, lineage: 'susan' })).toBeNull()
    expect(parseDetails({ ...raw, kind: 'host:showcase' }, item)).toBeNull()
  })
})

describe('reading an item\'s details pool', () => {
  afterEach(() => vi.unstubAllGlobals())

  /** One host: signed indexes by key, atoms by signature, and the keys it lists per pool. */
  const host = async (speakers: { secret: Uint8Array; item: { pubkey: string; lineage: string }; text: string; listed: boolean; about?: { pubkey: string; lineage: string } }[]) => {
    const files = new Map<string, string>()
    const indexes = await sha('hive:indexes')
    for (const speaker of speakers) {
      const key = await detailsKey(speaker.item)
      const record = new TextDecoder().decode(detailsBytes(speaker.about ?? speaker.item, [{ name: ABOUT_PART, text: speaker.text }]))
      const sig = await sha(record)
      files.set(`/${sig}`, record)
      const pubkey = getPublicKey(speaker.secret)
      const event = finalizeEvent({ kind: 30564, created_at: 1, tags: [], content: JSON.stringify({ v: 1, roots: { [key]: sig } }) }, speaker.secret)
      files.set(`/${indexes}/${pubkey}`, JSON.stringify(event))
      if (speaker.listed) {
        const pool = `/${await sha(key)}/`
        files.set(pool, `${files.get(pool) ?? ''}${pubkey}\n`)
      }
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      const body = files.get(url.pathname)
      return body === undefined ? new Response('', { status: 404 })
        : new Response(body, { status: 200, headers: { 'content-type': url.pathname.endsWith('/') ? 'text/plain' : 'application/json' } })
    }))
  }

  it('asks the author by key with no listing at all, lists the rest, and puts the author first', async () => {
    const author = generateSecretKey(), friend = generateSecretKey(), stranger = generateSecretKey()
    const item = { pubkey: getPublicKey(author), lineage: 'dylan' }
    await host([
      { secret: friend, item, text: 'I play this daily.', listed: true },
      { secret: author, item, text: 'A game for two.', listed: false },
      { secret: stranger, item, text: 'Not listed, not asked.', listed: false },
    ])
    expect(await readDetails(['hypercomb.com'], item)).toEqual([
      { by: item.pubkey, parts: [{ name: 'about', text: 'A game for two.' }] },
      { by: getPublicKey(friend), parts: [{ name: 'about', text: 'I play this daily.' }] },
    ])
  })

  it('drops a word whose record is about another item', async () => {
    const author = generateSecretKey()
    const item = { pubkey: getPublicKey(author), lineage: 'dylan' }
    await host([{ secret: author, item, text: 'About something else.', listed: true, about: { ...item, lineage: 'susan' } }])
    expect(await readDetails(['hypercomb.com'], item)).toEqual([])
  })
})

describe('a held tile opens its details', () => {
  const a = 'a'.repeat(64), b = 'b'.repeat(64)
  const sites: LedgerSite[] = [
    { title: 'Hypercomb', lineage: 'hypercomb', hosts: ['hypercomb.com'], publishers: [], owners: [a] },
    { title: 'dylan', lineage: 'dylan', hosts: ['dylan.hypercomb.com'], publishers: [{ pubkey: a, label: 'Jaime', head: '1'.repeat(64) }], owners: [a] },
  ]
  const draw = (extra: Partial<Parameters<typeof showcase>[0]> = {}) => showcase({
    self: 'hypercomb.com', title: 'hypercomb', tagline: '', sources: [],
    ledger: Promise.resolve(sites), readShared: async () => ({ offers: [], creations: [] }), ...extra,
  })
  const hold = async (bands: HTMLElement): Promise<void> => {
    const dylan = await vi.waitFor(() => {
      const found = [...bands.querySelectorAll<HTMLAnchorElement>('.dex-row.own a.hex')].find(tile => tile.textContent?.includes('dylan'))
      expect(found).toBeDefined()
      return found!
    })
    dylan.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  }

  it('says what it is and whose, draws what its pool says with the author first, and offers a way to pass it on', async () => {
    const readDetails = vi.fn(async () => [
      { by: a, parts: [{ name: 'about', text: 'A game for two.' }, { name: 'how to play', text: 'Tap.' }] },
      { by: b, parts: [{ name: 'about', text: 'From a stranger.' }] },
    ])
    const { hero, bands } = draw({ readDetails })
    document.body.append(hero, bands)
    try {
      await hold(bands)
      const sheet = hero.querySelector('.versions') as HTMLElement
      expect(sheet.querySelector('.versions-title')?.textContent).toBe('dylan')
      expect(sheet.querySelector('.details-whose')?.textContent).toBe('Hive · Jaime')
      expect(sheet.querySelector('.version-share')).not.toBeNull()
      await vi.waitFor(() => expect(sheet.querySelector('.details-said')?.children.length).toBe(2))
      expect(readDetails).toHaveBeenCalledWith(['hypercomb.com', 'dylan.hypercomb.com'], { pubkey: a, lineage: 'dylan' }, [])
      const author = sheet.querySelector('.details-said > .details-word') as HTMLElement
      expect([...author.children].map(node => node.textContent)).toEqual(['A game for two.', 'how to play', 'Tap.'])
      // Somebody who is neither the author nor an owner here is one press away, never drawn outright.
      const more = sheet.querySelector('.details-more') as HTMLDetailsElement
      expect(more.open).toBe(false)
      expect(more.querySelector('summary')?.textContent).toBe('1 more note from other people')
      // A visitor is offered no box to write in.
      expect(sheet.querySelector('.details-field')).toBeNull()
    } finally { hero.remove(); bands.remove() }
  })

  it('lets the author say more under their own key, carrying the parts the sheet does not write', async () => {
    let said = [{ by: a, parts: [{ name: 'about', text: 'A game.' }, { name: 'credits', text: 'Me.' }] }]
    const details = vi.fn(async (request: { parts: readonly { name: string; text: string }[] }) => {
      said = [{ by: a, parts: [...request.parts] }]
      return { ok: true as const, changed: true }
    })
    const owner: OwnerBridge = { hello: async () => a, toggle: async () => ({ ok: true, changed: true }), details }
    const { hero, bands } = draw({ owner, readDetails: async () => said })
    document.body.append(hero, bands)
    try {
      await new Promise(resolve => setTimeout(resolve, 0))
      await hold(bands)
      const sheet = hero.querySelector('.versions') as HTMLElement
      const field = await vi.waitFor(() => {
        const found = sheet.querySelector<HTMLTextAreaElement>('.details-field')
        expect(found?.value).toBe('A game.')
        return found!
      })
      expect(sheet.querySelector('.details-label')?.firstChild?.textContent).toBe('Say more about it')
      field.value = 'A game for two.'
      field.dispatchEvent(new Event('input'))
      sheet.querySelector<HTMLButtonElement>('.version-save')!.click()
      await vi.waitFor(() => expect(sheet.querySelector('.details-told')?.textContent).toBe('Saved.'))
      expect(details).toHaveBeenCalledWith({ zone: 'hypercomb.com', pubkey: a, lineage: 'dylan',
        parts: [{ name: 'about', text: 'A game for two.' }, { name: 'credits', text: 'Me.' }] })
      await vi.waitFor(() => expect(sheet.querySelector('.details-text')?.textContent).toBe('A game for two.'))
    } finally { hero.remove(); bands.remove() }
  })
})
