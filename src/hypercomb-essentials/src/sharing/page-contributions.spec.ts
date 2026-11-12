import { describe, expect, it, vi } from 'vitest'
import { SignatureService, registerPoolMeaning } from '@hypercomb/core'
import { contributionKey, dropContribution, pickKey, readContributions, readPick, signPick, type ContributionReadDeps, type PageContribution, type PickDeps } from './page-contributions.js'
import type { HostOfferDeps } from './host-offer.js'

// AN EDIT TO SOMEBODY ELSE'S PAGE IS OFFERED, NEVER APPLIED (documentation/
// page-contributions.md, step 2): the edited page goes to the publisher's host
// and the contributor's own index names it under `page:<base>`. Only words may
// travel; anything else is refused before a byte leaves.

const BASE_SIG = 'a'.repeat(64)
const NEW_SIG = 'b'.repeat(64)
const BASE = '<!doctype html><html><head><script>window.x = 1</script></head><body><h1>Hello</h1></body></html>'
const WORDS = BASE.replace('<h1>Hello</h1>', '<h1>Welcome</h1>')

const fakeDeps = (over: Partial<HostOfferDeps> = {}) => {
  const deps = {
    put: vi.fn(async () => NEW_SIG),
    publish: vi.fn(async () => ({ ok: true as const })),
    stamp: vi.fn(async () => ({ ok: true })),
    now: () => 1,
    ...over,
  }
  return deps
}

describe('dropContribution', () => {
  it('puts the page, ships it to the host, and names it as page:<base> in the contributor\'s index', async () => {
    const deps = fakeDeps()
    const done = await dropContribution('example.com', { base: BASE_SIG, baseHtml: BASE, html: WORDS }, deps)
    expect(done).toEqual({ ok: true, sig: NEW_SIG, key: `page:${BASE_SIG}` })
    expect(deps.put).toHaveBeenCalledWith(WORDS, 'text/html')
    expect(deps.publish).toHaveBeenCalledWith('example.com', [NEW_SIG])
    expect(deps.stamp).toHaveBeenCalledWith('example.com', contributionKey(BASE_SIG), NEW_SIG)
  })

  it('refuses anything but changed words, before a byte leaves', async () => {
    const deps = fakeDeps()
    const code = BASE.replace('window.x = 1', 'window.x = 2')
    expect(await dropContribution('example.com', { base: BASE_SIG, baseHtml: BASE, html: code }, deps))
      .toEqual({ ok: false, error: 'only changed words can be offered' })
    expect(await dropContribution('example.com', { base: BASE_SIG, baseHtml: BASE, html: BASE }, deps))
      .toEqual({ ok: false, error: 'nothing changed' })
    expect(deps.put).not.toHaveBeenCalled()
  })

  it('refuses with no host and with no base signature', async () => {
    const deps = fakeDeps()
    expect((await dropContribution('', { base: BASE_SIG, baseHtml: BASE, html: WORDS }, deps)).ok).toBe(false)
    expect((await dropContribution('example.com', { base: 'not-a-sig', baseHtml: BASE, html: WORDS }, deps)).ok).toBe(false)
    expect(deps.put).not.toHaveBeenCalled()
  })

  it('says why when the host refuses the bytes or the index', async () => {
    const shipped = fakeDeps({ publish: vi.fn(async () => ({ ok: false as const, error: 'host is full' })) })
    expect(await dropContribution('example.com', { base: BASE_SIG, baseHtml: BASE, html: WORDS }, shipped))
      .toEqual({ ok: false, error: 'host is full' })
    expect(shipped.stamp).not.toHaveBeenCalled()
    const stamped = fakeDeps({ stamp: vi.fn(async () => ({ ok: false, reason: 'index-unsafe: http' })) })
    expect(await dropContribution('example.com', { base: BASE_SIG, baseHtml: BASE, html: WORDS }, stamped))
      .toEqual({ ok: false, error: 'index-unsafe: http' })
  })
})

// A HOST'S LISTING IS MEMBERSHIP ONLY (step 3): every listed contributor's own
// index is read, the page it names must hash to that name, and words-only is
// decided against the base — never taken from the host.

const sigOf = async (text: string): Promise<string> =>
  SignatureService.sign(new TextEncoder().encode(text).slice().buffer as ArrayBuffer)

describe('readContributions', () => {
  const ALICE = 'c'.repeat(64)
  const BOB = 'd'.repeat(64)
  const CAROL = 'e'.repeat(64)
  const DAVE = 'f'.repeat(64)

  const world = async () => {
    const words = BASE.replace('<h1>Hello</h1>', '<h1>Welcome</h1>')
    const code = BASE.replace('window.x = 1', 'window.x = 2')
    const wordsSig = await sigOf(words)
    const codeSig = await sigOf(code)
    const forged = '9'.repeat(64)
    const pool = await registerPoolMeaning(contributionKey(BASE_SIG))
    const blobs = new Map<string, string>([[wordsSig, words], [codeSig, code], [forged, words]])
    const indexes = new Map<string, { roots: Record<string, string>; createdAt: number }>([
      [ALICE, { roots: { [contributionKey(BASE_SIG)]: wordsSig }, createdAt: 100 }],
      [BOB, { roots: { [contributionKey(BASE_SIG)]: codeSig }, createdAt: 200 }],
      // Carol's index names bytes that do not hash to their name: not believed.
      [CAROL, { roots: { [contributionKey(BASE_SIG)]: forged }, createdAt: 300 }],
      // Dave is listed but has since dropped the entry: not counted.
      [DAVE, { roots: { other: wordsSig }, createdAt: 400 }],
    ])
    const deps: ContributionReadDeps = {
      members: vi.fn(async (_host, poolSig) => (poolSig === pool ? [ALICE, BOB, CAROL, DAVE] : [])),
      index: vi.fn(async (_host, pubkey) => indexes.get(pubkey) ?? null),
      bytes: vi.fn(async (_host, sig) => (blobs.has(sig) ? new TextEncoder().encode(blobs.get(sig)!) : null)),
    }
    return { deps, wordsSig, codeSig }
  }

  it('lists each verified contribution, newest first, and says which change only words', async () => {
    const { deps, wordsSig, codeSig } = await world()
    const found = await readContributions('example.com', BASE_SIG, BASE, deps)
    expect(found.map(c => [c.pubkey, c.sig, c.textOnly])).toEqual([
      [BOB, codeSig, false],
      [ALICE, wordsSig, true],
    ])
    expect(found[1].html).toContain('<h1>Welcome</h1>')
    expect(found.every(c => c.host === 'example.com')).toBe(true)
  })

  it('asks the pool at sign(page:<base>) — a page nobody touched lists nothing', async () => {
    const { deps } = await world()
    expect(await readContributions('example.com', 'a'.repeat(63) + 'b', BASE, deps)).toEqual([])
    expect(await readContributions('example.com', 'not-a-sig', BASE, deps)).toEqual([])
    expect(await readContributions('', BASE_SIG, BASE, deps)).toEqual([])
  })
})

// WHAT EVERYONE SEES IS THE PUBLISHER'S PICK (step 5): `pick:<base>` in the
// publisher's own index, read from the newest copy any host holds — a cleared
// pick included — and believed only when its bytes hash to their name.

describe('readPick', () => {
  const OWNER = '7'.repeat(64)

  const setup = async (indexes: Record<string, { roots: Record<string, string>; createdAt: number } | null>) => {
    const words = BASE.replace('<h1>Hello</h1>', '<h1>Welcome</h1>')
    const wordsSig = await sigOf(words)
    const deps: ContributionReadDeps = {
      members: vi.fn(async () => []),
      index: vi.fn(async (host, pubkey) => (pubkey === OWNER ? indexes[host] ?? null : null)),
      bytes: vi.fn(async (_host, sig) => (sig === wordsSig ? new TextEncoder().encode(words) : null)),
    }
    return { deps, wordsSig }
  }

  it('reads the pick from the publisher\'s newest index', async () => {
    const words = BASE.replace('<h1>Hello</h1>', '<h1>Welcome</h1>')
    const wordsSig = await sigOf(words)
    const { deps } = await setup({
      'old.example': { roots: {}, createdAt: 100 },
      'new.example': { roots: { [pickKey(BASE_SIG)]: wordsSig }, createdAt: 200 },
    })
    const pick = await readPick(['old.example', 'new.example'], OWNER, BASE_SIG, BASE, deps)
    expect(pick).toMatchObject({ pubkey: OWNER, sig: wordsSig, textOnly: true, host: 'new.example', at: 200 })
    expect(pick?.html).toContain('<h1>Welcome</h1>')
  })

  it('a newer index without the pick means it was taken away', async () => {
    const words = BASE.replace('<h1>Hello</h1>', '<h1>Welcome</h1>')
    const wordsSig = await sigOf(words)
    const { deps } = await setup({
      'old.example': { roots: { [pickKey(BASE_SIG)]: wordsSig }, createdAt: 100 },
      'new.example': { roots: {}, createdAt: 200 },
    })
    expect(await readPick(['old.example', 'new.example'], OWNER, BASE_SIG, BASE, deps)).toBeNull()
  })

  it('believes no pick whose bytes do not hash to its name, and none without an owner', async () => {
    const { deps } = await setup({ 'h.example': { roots: { [pickKey(BASE_SIG)]: '9'.repeat(64) }, createdAt: 1 } })
    expect(await readPick(['h.example'], OWNER, BASE_SIG, BASE, deps)).toBeNull()
    expect(await readPick(['h.example'], 'nobody', BASE_SIG, BASE, deps)).toBeNull()
  })
})

describe('signPick', () => {
  const PICK: PageContribution = { pubkey: 'c'.repeat(64), sig: NEW_SIG, html: WORDS, at: 1, textOnly: true, host: 'a.example' }
  const fake = (over: Partial<PickDeps> = {}): PickDeps & { [k: string]: ReturnType<typeof vi.fn> } => ({
    publish: vi.fn(async () => ({ ok: true as const })),
    stamp: vi.fn(async () => ({ ok: true })),
    clear: vi.fn(async () => ({ ok: true })),
    ...over,
  }) as never

  it('ships the chosen page and names it as pick:<base> on every host the page is published to', async () => {
    const deps = fake()
    expect(await signPick(['a.example', 'b.example'], BASE_SIG, PICK, deps)).toEqual({ ok: true, hosts: ['a.example', 'b.example'] })
    expect(deps.publish).toHaveBeenCalledWith('a.example', [NEW_SIG])
    expect(deps.stamp).toHaveBeenCalledWith('b.example', pickKey(BASE_SIG), NEW_SIG)
    expect(deps.clear).not.toHaveBeenCalled()
  })

  it('with no pick, takes it away so the published page shows again', async () => {
    const deps = fake()
    expect(await signPick(['a.example'], BASE_SIG, null, deps)).toEqual({ ok: true, hosts: ['a.example'] })
    expect(deps.clear).toHaveBeenCalledWith('a.example', pickKey(BASE_SIG))
    expect(deps.stamp).not.toHaveBeenCalled()
  })

  it('is done where any host took it, and refused only when none did', async () => {
    const partly = fake({ stamp: vi.fn(async (host: string) => ({ ok: host === 'b.example', reason: 'refused' })) })
    expect(await signPick(['a.example', 'b.example'], BASE_SIG, PICK, partly)).toEqual({ ok: true, hosts: ['b.example'] })
    const none = fake({ publish: vi.fn(async () => ({ ok: false as const, error: 'down' })) })
    expect(await signPick(['a.example'], BASE_SIG, PICK, none)).toEqual({ ok: false, error: 'a.example: down' })
    expect(await signPick([], BASE_SIG, PICK, fake())).toEqual({ ok: false, error: 'this page is not published anywhere yet' })
  })
})
