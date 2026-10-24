// sharing/side-words-name-their-host.spec.ts — NO SIDE WORD WRITES TO A HOST
// NOBODY NAMED (jwize 2026-10-11: "make sure that there isn't a default
// host"; hypercomb.com "is for testing purposes and may be retired").
//
// arrival, features publish, harness offer, language offer and missing,
// module's publishing words and the vocabulary claim each used to fall back
// to the compiled public content host when the participant named none, so a
// word typed with no host wrote somewhere nobody chose. Each now writes to the
// host its words name (else, where it has one, the public host the
// participant NAMED) and otherwise refuses — saying how to name one — before
// a byte leaves. Reads are untouched: a word that only reads still reads the
// public content host. The publish panel splits its read door from its write
// door the same way (checked against the drone's source below).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EffectBus, I18N_IOC_KEY, MODULE_DRAFTS_IOC_KEY } from '@hypercomb/core'

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: (key: string) => (window as unknown as { __reg?: Record<string, unknown> }).__reg?.[key],
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
})

const sent = vi.hoisted(() => ({
  arrival: vi.fn(async (..._args: unknown[]) => ({ ok: true, sig: 'a'.repeat(64) })),
  withdraw: vi.fn(async (..._args: unknown[]) => ({ ok: true, sig: '' })),
  features: vi.fn(async (..._args: unknown[]) => ({ ok: true, names: [] as string[] })),
  harness: vi.fn(async (..._args: unknown[]) => ({ ok: true, sig: 'b'.repeat(64) })),
}))
vi.mock('./arrival-plan-publish.js', () => ({ publishArrivalPlan: sent.arrival, withdrawArrivalPlan: sent.withdraw }))
vi.mock('./participant-features.js', () => ({
  addParticipantFeature: async () => true,
  removeParticipantFeature: async () => true,
  listParticipantFeatures: async () => [],
  publishParticipantFeatures: sent.features,
}))
vi.mock('../assistant/harness-network.js', () => ({
  publishHarness: sent.harness,
  syncHarnessesFrom: async () => ({ answered: false, imported: [], dropped: 0 }),
}))

const { ArrivalQueenBee } = await import('./arrival.queen.js')
const { FeaturesQueenBee } = await import('./features.queen.js')
const { PUBLIC_CONTENT_HOSTS } = await import('./hive-link.js')
const { harness } = await import('../assistant/harness.js')
const { HarnessQueenBee } = await import('../assistant/harness.queen.js')
const { LanguageQueenBee } = await import('../commands/language.queen.js')
const { ModuleQueenBee } = await import('../assistant/module.queen.js')
const { defaultVocabularyPublishDeps } = await import('../molecule/vocabulary-publish.deps.js')

const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
const STORE_KEY = '@hypercomb.social/Store'

type Toast = { type: string; message: string }
const toasts: Toast[] = []
EffectBus.on<Toast>('toast:show', toast => { toasts.push(toast) })

let fetched: { url: string; method: string }[] = []
const reg = (entries: Record<string, unknown>): void => {
  ;(window as unknown as { __reg: Record<string, unknown> }).__reg = entries
}

beforeEach(() => {
  toasts.length = 0
  fetched = []
  for (const fn of Object.values(sent)) fn.mockClear()
  localStorage.clear()
  reg({})
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    fetched.push({ url: String(input), method: init?.method ?? 'GET' })
    return new Response(null, { status: 404 })
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('arrival takes its host from its words', () => {
  it('with no @<host> it sends nothing and says how to name one', async () => {
    await new ArrivalQueenBee().invoke('revolucion ViewBee SiteViewDrone')
    expect(sent.arrival).not.toHaveBeenCalled()
    expect(toasts.at(-1)).toMatchObject({ type: 'warning', message: expect.stringContaining('@example.com') })
  })

  it('with @<host> it signs the plan there — and the host is never taken for a bee', async () => {
    await new ArrivalQueenBee().invoke('revolucion ViewBee @friend.example SiteViewDrone')
    expect(sent.arrival).toHaveBeenCalledWith('friend.example', 'revolucion', ['ViewBee', 'SiteViewDrone'])
    await new ArrivalQueenBee().invoke('@friend.example revolucion none')
    expect(sent.withdraw).toHaveBeenCalledWith('friend.example', 'revolucion')
  })

  it('keeps its line verbatim, so a bee keeps the capitals of its class', async () => {
    // Read as plain language the line is lowered before any word sees it, and
    // the plans signed that way named `siteviewdrone` (meetups 8897c004).
    expect(new ArrivalQueenBee().rawArgs).toBe(true)
    await new ArrivalQueenBee().invoke('Meetups ViewBee WebsiteQueenBee SiteViewDrone RsvpDrone @hypercomb.com')
    expect(sent.arrival).toHaveBeenCalledWith('hypercomb.com', 'meetups', ['ViewBee', 'WebsiteQueenBee', 'SiteViewDrone', 'RsvpDrone'])
  })
})

describe('features publish takes its host from its words', () => {
  it('with no host it sends nothing and says how to name one', async () => {
    await new FeaturesQueenBee().invoke('publish')
    expect(sent.features).not.toHaveBeenCalled()
    expect(toasts.at(-1)).toMatchObject({ type: 'warning', message: expect.stringContaining('features publish <host>') })
  })

  it('with a host it sends the set there', async () => {
    await new FeaturesQueenBee().invoke('publish friend.example')
    expect(sent.features).toHaveBeenCalledWith('friend.example')
  })
})

describe('harness offer takes its host from its words', () => {
  it('with no @<host> nothing is offered, and the word says how', async () => {
    await harness.seed()
    await harness.import({ kind: 'harness@1', name: 'quiet-reader' })
    await (new HarnessQueenBee() as unknown as { execute(args: string): Promise<void> }).execute('offer quiet-reader')
    expect(sent.harness).not.toHaveBeenCalled()
    expect(fetched).toEqual([])
    expect(toasts.at(-1)).toEqual({ type: 'warning', message: 'quiet-reader was not offered: no host is named — say harness offer quiet-reader @<host>.' })
  })
})

describe('language offer and missing write only to a host the words name', () => {
  const putResource = vi.fn(async () => 'c'.repeat(64))
  const publishAtoms = vi.fn(async () => ({ ok: true as const, sent: 1, held: 0 }))
  beforeEach(() => {
    putResource.mockClear()
    publishAtoms.mockClear()
    reg({
      [I18N_IOC_KEY]: { locale: 'en', t: (key: string) => key, setLocale: () => {}, missingKeys: () => ['editor.save', 'editor.cancel'] },
      [STORE_KEY]: {
        overrides: {},
        getPoolDoc: async () => new TextEncoder().encode(JSON.stringify({ ja: { 'editor.save': '保存' } })).buffer,
        putResource,
      },
      [HOST_SYNC_KEY]: { publishAtoms },
    })
  })

  it('offer with no @<host>: nothing is put or sent, and the word says how', async () => {
    await new LanguageQueenBee().invoke('offer ja')
    expect(putResource).not.toHaveBeenCalled()
    expect(publishAtoms).not.toHaveBeenCalled()
    expect(fetched).toEqual([])
    // The provider answers keys with themselves, so the English is the fallback.
    expect(toasts.at(-1)).toEqual({ type: 'warning', message: 'Your ja translations were not published: no host is named — say language offer ja @<host>.' })
  })

  it('missing with no @<host> shows the list and tells no host', async () => {
    await new LanguageQueenBee().invoke('missing ja')
    expect(toasts.map(t => t.message).some(m => m.includes('not published'))).toBe(false)
    expect(putResource).not.toHaveBeenCalled()
    expect(publishAtoms).not.toHaveBeenCalled()
    expect(fetched).toEqual([])
  })
})

describe('module: a publishing word names its host; a reading word still reads', () => {
  beforeEach(() => {
    reg({ [MODULE_DRAFTS_IOC_KEY]: { list: async () => [], offPaths: () => [], bytesOf: async () => null } })
  })

  it('commit with no @<host> is refused before anything is asked', async () => {
    await new ModuleQueenBee().invoke('commit fresh-rooms')
    expect(fetched).toEqual([])
    expect(toasts.at(-1)).toEqual({ type: 'warning', message: 'No host is named to publish to — add @<host>, like module commit fresh-rooms @example.com.' })
  })

  it('trials with no @<host> still READS the public content host', async () => {
    await new ModuleQueenBee().invoke('trials')
    expect(fetched.length).toBeGreaterThan(0)
    expect(fetched.every(call => call.method === 'GET' && new URL(call.url).host === PUBLIC_CONTENT_HOSTS[0])).toBe(true)
  })
})

describe('the vocabulary claim advances only a door the participant named', () => {
  it('no public branch and no named public host → no door (the routine refuses no-host)', async () => {
    reg({ [HOST_SYNC_KEY]: { isPublicHostEnabled: () => true, publicHostDomain: () => '' } })
    expect(await defaultVocabularyPublishDeps().host()).toBe('')
    reg({ [HOST_SYNC_KEY]: { isPublicHostEnabled: () => false, publicHostDomain: () => 'friend.example' } })
    expect(await defaultVocabularyPublishDeps().host()).toBe('')
  })

  it('the public host the participant named and turned on is the door', async () => {
    reg({ [HOST_SYNC_KEY]: { isPublicHostEnabled: () => true, publicHostDomain: () => 'friend.example' } })
    expect(await defaultVocabularyPublishDeps().host()).toBe('friend.example')
  })
})

describe('the publish panel reads through one door and writes through another', () => {
  const DRONE = readFileSync(join(process.cwd(), 'hypercomb-essentials', 'src', 'sharing', 'publish-status.drone.ts'), 'utf8')
  /** A method's body, from its signature to its closing brace at two spaces. */
  const body = (signature: string): string => {
    const start = DRONE.indexOf(signature)
    expect(start, `${signature} not found`).toBeGreaterThan(-1)
    return DRONE.slice(start, DRONE.indexOf('\n  }\n', start))
  }

  it('the write host is the named public host, never the compiled one; the compiled one is only the read door', () => {
    expect(DRONE).toContain("const host = zoneDoor(hostSync?.publicHostDomain?.() || '')")
    expect(DRONE).toContain("const readDoor = host || zoneDoor(PUBLIC_CONTENT_HOSTS[0] ?? '')")
    expect(DRONE.match(/PUBLIC_CONTENT_HOSTS\[0\]/g)).toHaveLength(1)
    expect(body('#zonesFor(key: string)')).not.toContain('PUBLIC_CONTENT_HOSTS')
  })

  it('every write asks #writeDoorFor and refuses with no host named — never the read door', () => {
    for (const signature of ['async #setArrival(', 'async #entrance(']) {
      const said = body(signature)
      expect(said, signature).toMatch(/const door = this\.#writeDoorFor\((?:row\.)?key\)\s*\n\s*if \(!door\) \{ this\.#refuseNoHost\(\); return \}/)
      expect(said, signature).not.toContain('#hostByKey')
      expect(said, signature).not.toContain('this.#payload.host')
    }
    expect(body('#writeDoorFor(key: string)')).toContain("zoneDoor(this.#zonesFor(key)[0] ?? '')")
    expect(body('async #publishParticipant(')).toMatch(/if \(!this\.#payload\.host\) \{\s*\n\s*this\.#toast\('warning', 'publish\.optimize\.no-host'/)
  })
})

describe('every catalog says the new refusals, with the same tokens', () => {
  const DIR = join(process.cwd(), 'hypercomb-shared', 'i18n')
  const KEYS: Readonly<Record<string, readonly string[]>> = {
    'harness.nohost': ['{name}', '{name}'],
    'language.nohost': ['{locale}', '{locale}'],
    'module.nohost': [],
    'arrival.usage': [],
    'features.publish.nohost': [],
    'publish.write.no-host': [],
    'publish.optimize.no-host': [],
    'profile.reason.nohost': [],
    'host.confirm.message': ['{name}'],
    'host.uploading': [],
    'host.done-unconfirmed': ['{link}'],
    'publish.done': [],
    'publish.done-unconfirmed': [],
  }
  const en = JSON.parse(readFileSync(join(DIR, 'en.json'), 'utf8')) as Record<string, string>

  it('no string promises a standing public host any more', () => {
    for (const key of ['host.confirm.message', 'host.uploading', 'host.done-unconfirmed', 'publish.done', 'publish.done-unconfirmed']) {
      expect(en[key], key).not.toMatch(/public (?:host|content endpoint)/)
    }
  })

  for (const locale of ['ar', 'de', 'en', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt', 'ru', 'tr', 'zh']) {
    it(`${locale}.json`, () => {
      const json = JSON.parse(readFileSync(join(DIR, `${locale}.json`), 'utf8')) as Record<string, string>
      for (const [key, tokens] of Object.entries(KEYS)) {
        expect(json[key], `${locale} is missing ${key}`).toBeTypeOf('string')
        expect(json[key]!.trim(), `${locale} has an empty ${key}`).not.toBe('')
        expect((json[key]!.match(/\{\w+\}/g) ?? []).sort(), `${locale} ${key} tokens`).toEqual([...tokens].sort())
      }
    })
  }
})
