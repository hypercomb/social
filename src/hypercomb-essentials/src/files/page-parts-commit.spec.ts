// page-parts-commit.spec.ts — a block leaves a page for a tile of its own,
// the page does not change; the part changes, and the page follows it.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── an in-memory hive: resources by signature, records by tile ───────────
const resources = new Map<string, string>()
type Record_ = { sig: string; record: { kind: string; payload: Record<string, unknown> } }
const records = new Map<string, Record_[]>()
const pages = new Map<string, string>()
const children = new Map<string, string[]>([['', ['card']], ['card', []]])
let minted = 0
const key = (segments: readonly string[]): string => segments.join('/')
const sigOfText = (text: string): string => {
  for (const [sig, held] of resources) if (held === text) return sig
  const sig = (++minted).toString(16).padStart(64, '0')
  resources.set(sig, text)
  return sig
}

vi.mock('../commands/decoration-manifest.js', () => ({
  listDecorations: async ({ kind, segments }: { kind: string; segments: readonly string[] }) =>
    (records.get(key(segments)) ?? []).filter(entry => entry.record.kind === kind),
  writeDecoration: async ({ kind, segments, payload }: { kind: string; segments: readonly string[]; payload: Record<string, unknown> }) => {
    const sig = `record-${++minted}`
    records.set(key(segments), [...(records.get(key(segments)) ?? []), { sig, record: { kind, payload } }])
    return sig
  },
  removeDecorationAndWait: async ({ sig, segments }: { sig: string; segments: readonly string[] }) => {
    records.set(key(segments), (records.get(key(segments)) ?? []).filter(entry => entry.sig !== sig))
  },
  removeDecoration: () => {},
}))
vi.mock('./page-commit.js', () => ({
  commitPageSig: async (segments: readonly string[], htmlSig: string) => { pages.set(key(segments), htmlSig); return { ok: true } },
}))

// The test Blob has no text(): read it the way a browser of any age can.
const readBlob = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result ?? ''))
  reader.onerror = () => reject(reader.error)
  reader.readAsText(blob)
})

const services = new Map<string, unknown>([
  ['@hypercomb.social/Store', {
    putResource: async (blob: Blob) => sigOfText(await readBlob(blob)),
    getResource: async (sig: string) => (resources.has(sig) ? { text: async () => resources.get(sig)!, size: resources.get(sig)!.length } : null),
  }],
  ['@diamondcoreprocessor.com/SiteViewDrone', { resolvePageSig: async (segments: readonly string[]) => pages.get(key(segments)) ?? null }],
  ['@diamondcoreprocessor.com/HypercombHiveTreeReader', {
    readNode: async (segments: readonly string[]) => {
      const names = children.get(key(segments))
      return names ? { ok: true, children: names.map(name => ({ name })) } : { ok: false, code: 'not-found' }
    },
  }],
  ['@diamondcoreprocessor.com/LayerCommitter', {
    importTree: async (updates: { segments: readonly string[] }[]) => {
      for (const { segments } of updates) {
        const parent = key(segments.slice(0, -1))
        children.set(parent, [...(children.get(parent) ?? []), segments[segments.length - 1]])
        children.set(key(segments), [])
      }
    },
  }],
])
;(window as unknown as { ioc: unknown }).ioc = { get: (name: string) => services.get(name), register: () => {}, whenReady: () => {} }

const { breakBlockOut, partFilesOf, planPartRebuild, shellAt } = await import('./page-parts-commit.js')
const { PART_ATTR, SHELL_FILE } = await import('./page-parts.js')

const CSS = '.card{ color: gold }'
const ANIMATION = 'start({ colour: "red" })'
const PAGE = `<!doctype html><html><head><style>${CSS}</style></head><body><main></main><script>${ANIMATION}</script></body></html>`
const filesOn = (tile: string): Record<string, string> =>
  Object.fromEntries((records.get(tile) ?? []).filter(entry => entry.record.kind === 'files:attachment')
    .map(entry => [String(entry.record.payload['name']), String(entry.record.payload['sig'])]))
const pageText = (): string => resources.get(pages.get('card')!)!

beforeEach(() => {
  resources.clear(); records.clear(); pages.clear(); minted = 0
  children.clear(); children.set('', ['card']); children.set('card', [])
  pages.set('card', sigOfText(PAGE))
})

describe('a block moved out of a page', () => {
  it('lands as a file on a child tile, the page keeps a shell, and the page itself is untouched', async () => {
    const before = pages.get('card')
    const out = await breakBlockOut(['card'], 'script-1', 'animation')
    expect(out).toMatchObject({ ok: true, tile: ['card', 'animation'], file: 'animation.js', characters: ANIMATION.length, restarted: false })
    expect(children.get('card')).toEqual(['animation'])
    expect(resources.get(filesOn('card/animation')['animation.js'])).toBe(ANIMATION)
    const shell = (await shellAt(['card']))!.text
    expect(shell).toContain(`<script ${PART_ATTR}="resource:${filesOn('card/animation')['animation.js']}/animation.js"></script>`)
    expect(shell).not.toContain(ANIMATION)
    expect(pages.get('card')).toBe(before)
  })

  it('the part is a trait of the page: the tile wears its name as one it fills itself, once', async () => {
    await breakBlockOut(['card'], 'script-1', 'animation')
    await breakBlockOut(['card'], 'style-1', 'style')
    const wants = (records.get('card') ?? []).filter(entry => entry.record.kind === 'trait:want').map(entry => entry.record.payload)
    expect(wants).toEqual([{ word: 'animation', own: true }, { word: 'style', own: true }])
    expect(await partFilesOf(['card'], pages.get('card')!)).toEqual([SHELL_FILE, 'style.css', 'animation.js'])
  })

  it('uses a child tile that is already there', async () => {
    children.set('card', ['animation']); children.set('card/animation', [])
    expect(await breakBlockOut(['card'], 'script-1', 'animation')).toMatchObject({ ok: true })
    expect(children.get('card')).toEqual(['animation'])
  })

  it('refuses a tile with no page, an unknown block and a bad name, and changes nothing', async () => {
    children.set('', ['card', 'empty']); children.set('empty', [])
    expect(await breakBlockOut(['empty'], 'script-1', 'animation')).toMatchObject({ ok: false, error: '/empty wears no page' })
    expect(await breakBlockOut(['card'], 'script-7', 'animation')).toMatchObject({ ok: false, error: expect.stringContaining('style-1, script-1') })
    expect(await breakBlockOut(['card'], 'script-1', 'My Animation')).toMatchObject({ ok: false, error: expect.stringContaining('not a tile name') })
    expect(await breakBlockOut(['card'], 'script-1', 'bees')).toMatchObject({ ok: false, error: expect.stringContaining('reserved') })
    expect(records.get('card') ?? []).toEqual([])
    expect(children.get('card')).toEqual([])
  })
})

describe('a part changed', () => {
  it('moves the shell to the new signature and rebuilds the page in that block alone', async () => {
    await breakBlockOut(['card'], 'script-1', 'animation')
    const prior = filesOn('card/animation')['animation.js']
    const next = sigOfText('start({ colour: "teal" })')
    const plan = await planPartRebuild(['card', 'animation'], 'animation.js', prior, next)
    expect(plan).toMatchObject({ ok: true, page: ['card'] })
    if (!plan?.ok) throw new Error('no plan')
    expect(pageText()).toBe(PAGE)
    expect(await plan.apply()).toEqual({ ok: true })
    expect(pageText()).toBe(PAGE.replace(ANIMATION, 'start({ colour: "teal" })'))
    expect((await shellAt(['card']))!.text).toContain(`resource:${next}/animation.js`)
  })

  it('refuses, before anything is filed, a text the page cannot be assembled from', async () => {
    await breakBlockOut(['card'], 'script-1', 'animation')
    const prior = filesOn('card/animation')['animation.js']
    const plan = await planPartRebuild(['card', 'animation'], 'animation.js', prior, sigOfText('document.write("</script>")'))
    expect(plan).toMatchObject({ ok: false, error: expect.stringContaining('</script') })
    expect(pageText()).toBe(PAGE)
  })

  it('a shell written by hand rebuilds the page from it', async () => {
    await breakBlockOut(['card'], 'script-1', 'animation')
    const shell = (await shellAt(['card']))!.text.replace('<main></main>', '<main><h1>Card</h1></main>')
    const plan = await planPartRebuild(['card'], SHELL_FILE, filesOn('card')[SHELL_FILE], sigOfText(shell))
    if (!plan?.ok) throw new Error('no plan')
    await plan.apply()
    expect(pageText()).toBe(PAGE.replace('<main></main>', '<main><h1>Card</h1></main>'))
  })

  it('a file no page stands on rebuilds nothing', async () => {
    expect(await planPartRebuild(['card'], 'notes.md', sigOfText('a'), sigOfText('b'))).toBeNull()
    expect(await planPartRebuild(['card'], 'new.css', undefined, sigOfText('c'))).toBeNull()
  })
})

describe('a page written whole after it was broken apart', () => {
  it('is the truth: its old shell no longer stands, and the next break starts from the page as it is', async () => {
    await breakBlockOut(['card'], 'script-1', 'animation')
    const rewritten = PAGE.replace(CSS, '.card{ color: teal }')
    pages.set('card', sigOfText(rewritten))
    expect(await partFilesOf(['card'], pages.get('card')!)).toBeNull()
    const out = await breakBlockOut(['card'], 'style-1', 'style')
    expect(out).toMatchObject({ ok: true, restarted: true })
    expect(resources.get(filesOn('card/style')['style.css'])).toBe('.card{ color: teal }')
    expect((await shellAt(['card']))!.text).toContain(ANIMATION)
    expect(pageText()).toBe(rewritten)
  })
})
