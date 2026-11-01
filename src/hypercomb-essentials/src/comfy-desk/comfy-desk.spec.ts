// comfy-desk/comfy-desk.spec.ts
//
// The contract of each part, asked of it alone. A filler at `partKey(word)` has
// to answer the same questions.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComfyRenderPayload } from '../comfy/comfy.drone.js'
import { listAssets, nameOfAsset, recordOf } from './assets/assets.js'
import { formPart } from './form/form.js'
import { frameBox, rowAt } from './frame/frame.js'
import { fillParts, PART_WORDS, partKey, type DeskParts, type FormHandle } from './parts.js'
import { recipeRows } from './recipe/recipe.js'

const SIG = (c: string): string => c.repeat(64)

const payload = (patch: Partial<ComfyRenderPayload>): ComfyRenderPayload => ({
  knobs: ['positive', 'negative', 'seed', 'width', 'height'],
  weights: [{ file: 'a.safetensors', kind: 'model', label: 'a', active: true }],
  seeds: { positive: 'a default', negative: 'blurry', width: 512, height: 768 },
  ...patch,
} as ComfyRenderPayload)

describe('the form', () => {
  let form: FormHandle
  let sent: { effect: string; payload: unknown }[]

  beforeEach(() => {
    vi.useFakeTimers()
    sent = []
    form = formPart.create((effect, body) => { sent.push({ effect, payload: body }) })
  })
  afterEach(() => {
    form.dispose()
    vi.useRealTimers()
  })

  it('takes the workflow seeds the first time a model is used', () => {
    form.read(payload({}))
    expect(form.values.positive).toBe('a default')
    expect(form.values.numbers['height']).toBe('768')
  })

  it('keeps the words when the same model comes through another render', () => {
    form.read(payload({}))
    form.set({ positive: 'my words' })
    form.read(payload({ seeds: { positive: 'another default' } }))
    expect(form.values.positive).toBe('my words')
  })

  it('moving to another model and back continues from the form left there', () => {
    form.read(payload({}))
    form.set({ positive: 'on a' })
    form.read(payload({ weights: [{ file: 'b.safetensors', kind: 'model', label: 'b', active: true }], seeds: { positive: 'b default' } }))
    expect(form.values.positive).toBe('b default')
    form.read(payload({}))
    expect(form.values.positive).toBe('on a')
  })

  it('a stored continuation fills an untouched form and never an edited one', () => {
    form.read(payload({}))
    form.read(payload({ draftReady: true, resume: { positive: 'stored' } as ComfyRenderPayload['resume'] }))
    expect(form.values.positive).toBe('stored')

    const edited = formPart.create(() => undefined)
    edited.read(payload({}))
    edited.set({ positive: 'typed first' })
    edited.read(payload({ draftReady: true, resume: { positive: 'stored' } as ComfyRenderPayload['resume'] }))
    expect(edited.values.positive).toBe('typed first')
    edited.dispose()
  })

  it('a save never carries an untouched recipe default', () => {
    form.read(payload({}))
    vi.advanceTimersByTime(1000)
    form.flush()
    expect(sent.filter(one => one.effect === 'comfy:remember')).toEqual([])
  })

  it('an edit is remembered once, after the typing stops', () => {
    form.read(payload({}))
    form.set({ positive: 'one' })
    form.set({ positive: 'one two' })
    vi.advanceTimersByTime(1000)
    const saves = sent.filter(one => one.effect === 'comfy:remember')
    expect(saves).toHaveLength(1)
    expect(saves[0]!.payload).toMatchObject({ draft: { positive: 'one two' } })
  })

  it('sends only what the workflow offers, and a blank seed stays blank', () => {
    form.read(payload({ knobs: ['positive', 'seed'] }))
    form.setNumber('width', '1024')
    const params = form.params()
    expect(params.positive).toBe('a default')
    expect(params).not.toHaveProperty('width')
    expect(params).not.toHaveProperty('seed')
    form.set({ seed: '42' })
    expect(form.params().seed).toBe(42)
  })

  it('a kept state replaces the continuation and turns the tile help on', () => {
    form.read(payload({}))
    form.read(payload({
      applyPrompt: { sig: SIG('a'), text: 'kept', width: 256, fromTile: true } as ComfyRenderPayload['applyPrompt'],
    }))
    expect(form.values.positive).toBe('kept')
    expect(form.values.numbers['width']).toBe('256')
    expect(sent.at(-1)).toMatchObject({ effect: 'comfy:set-help', payload: { fromTile: true } })
  })
})

describe('the assets', () => {
  const member = (body: string): [string, { kind: string; getFile(): Promise<{ size: number; text(): Promise<string> }> }] =>
    [SIG(String(body.length % 10)), { kind: 'file', getFile: async () => ({ size: body.length, text: async () => body }) }]
  const generation = (at: number, positive: string): string =>
    JSON.stringify({ kind: 'comfy-generation@1', workflow: 'w', positive, at })
  const storeOf = (entries: ReturnType<typeof member>[]) => ({
    getPool: async () => ({
      async *entries() { yield* entries },
    }),
  })

  it('are the pool, newest first, and one bad member hides nothing else', async () => {
    const older = member(generation(1, 'older'))
    const newer: ReturnType<typeof member> = [SIG('b'), member(generation(2, 'newer'))[1]]
    const broken: ReturnType<typeof member> = [SIG('c'), member('not json')[1]]
    const assets = await listAssets(storeOf([older, broken, newer]) as never)
    expect(assets.map(asset => asset.record.positive)).toEqual(['newer', 'older'])
  })

  it('skip a marker: only a signature names a picture', async () => {
    const marker: ReturnType<typeof member> = ['00000001', member(generation(1, 'marker'))[1]]
    expect(await listAssets(storeOf([marker]) as never)).toEqual([])
  })

  it('read only a generation record', () => {
    expect(recordOf('{"kind":"comfy-workflow@1"}')).toBeNull()
    expect(recordOf(generation(1, 'x'))?.positive).toBe('x')
  })

  it('are called by the name given, then by their first words', () => {
    const record = { kind: 'comfy-generation@1', workflow: 'w', at: 1 } as const
    expect(nameOfAsset({ sig: SIG('a'), record: { ...record, name: 'lantern', positive: 'long' } })).toBe('lantern')
    expect(nameOfAsset({ sig: SIG('a'), record: { ...record, positive: 'a b c d e f g h i j' } })).toBe('a b c d e f g h')
    expect(nameOfAsset({ sig: SIG('a'), record })).toBe('aaaaaaaa')
  })
})

describe('the recipe', () => {
  const ids = (knobs: string[], asset = false): string[] =>
    recipeRows(knobs, asset ? { sig: SIG('a'), record: { kind: 'comfy-generation@1', workflow: 'w', at: 1 } } : null).map(row => row.id)

  it('draws no knob the workflow does not offer', () => {
    expect(ids(['positive'])).toEqual(['prompt', 'library', 'workflow', 'machine'])
    expect(ids(['positive', 'negative', 'width'])).toEqual(['prompt', 'negative', 'library', 'workflow', 'knobs', 'machine'])
  })

  it('offers a place only when a picture is on the stage', () => {
    expect(ids(['positive'], true)).toContain('place')
    expect(ids(['positive'], false)).not.toContain('place')
  })

  it('every row has a label key and one side', () => {
    for (const row of recipeRows(['positive', 'negative', 'seed'], null)) {
      expect(row.labelKey).toMatch(/^comfy\./)
      expect(['left', 'right']).toContain(row.side)
    }
  })
})

describe('the frame', () => {
  it('fits the long edge and centres the short one', () => {
    expect(frameBox(400, 1024, 512)).toEqual({ x: 0, y: 100, w: 400, h: 200 })
    expect(frameBox(400, 512, 1024)).toEqual({ x: 100, y: 0, w: 200, h: 400 })
    expect(frameBox(400, 0, 0)).toEqual({ x: 0, y: 0, w: 400, h: 400 })
  })

  it('answers the pointer from the rows, and lights nothing outside them', () => {
    const rows = recipeRows(['positive', 'negative'], null)
    expect(rowAt(rows, 0.5, 0.3)?.id).toBe('prompt')
    expect(rowAt(rows, 0.5, 0.8)?.id).toBe('negative')
    expect(rowAt(rows, 0.01, 0.01)).toBeNull()
  })
})

describe('a part is an extension point', () => {
  it('runs its own version until something stands at its key', () => {
    const own = Object.fromEntries(PART_WORDS.map(word => [word, { own: word }])) as unknown as DeskParts
    const filler = { own: 'filler' }
    const parts = fillParts(own, key => key === partKey('shelf') ? filler : undefined)
    expect(parts.shelf).toBe(filler)
    expect(parts.prompt).toBe(own.prompt)
  })
})
