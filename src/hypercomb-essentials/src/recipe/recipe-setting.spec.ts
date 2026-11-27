// recipe/recipe-setting.spec.ts : the table-set format, its floors, and the
// set a render describes. The render is the real setting.json that
// tableware/setting.py wrote for the four-plate set (2026-11-25), copied here.

import { describe, expect, it } from 'vitest'
import {
  RECIPE_SETTING_KEY,
  RECIPE_SETTING_LIMITS,
  floorMatrix,
  parseRecipeSetting,
  recipeFloorArea,
  recipeFloorAt,
  recipeFloorBox,
  recipeFloorHolds,
  recipeFloorInset,
  recipeReadingFloor,
  recipeSettingAspectFits,
  recipeSettingBytes,
  recipeSettingRefusalWords,
  recipeSettingRender,
  recipeSettingSignatures,
  type RecipeSettingDocument,
  type RecipeSettingFloor,
  type RecipeSettingPoint,
} from './recipe-setting.js'

/** setting.json as tableware/setting.py wrote it for the set rendered on 2026-11-25. */
const RENDERED_SETTING = {
  size_px: [1800, 1200],
  camera: { location: [0.43, -0.67, 1.13], rotation_quaternion: [0.916038, 0.281257, 0.083931, 0.273359], lens_mm: 62.0, sensor_mm: 36.0 },
  floor_height_m: 0.0055,
  layers: { setting: 'setting.png', table: 'table.png', utensils: 'utensils.png' },
  plates: [
    { id: 'ash', glaze: 'ash', seed: 23, size_m: [0.28, 0.16], at_m: [-0.1, 0.13], turn_deg: -6,
      floor_corners_px: [[646.1, 206.4], [1007.1, 438.0], [1139.0, 306.0], [781.5, 87.6]], floor_centre_px: [889.7, 255.6], floor_size_m: [0.22, 0.1], layer: 'plate-ash.png' },
    { id: 'shino', glaze: 'shino', seed: 7, size_m: [0.27, 0.14], at_m: [0.205, 0.085], turn_deg: 13,
      floor_corners_px: [[1159.2, 616.7], [1632.5, 759.1], [1673.1, 612.0], [1212.9, 478.2]], floor_centre_px: [1416.3, 614.3], floor_size_m: [0.21, 0.08], layer: 'plate-shino.png' },
    { id: 'kuro', glaze: 'kuro', seed: 31, size_m: [0.27, 0.14], at_m: [-0.2, -0.1], turn_deg: -14,
      floor_corners_px: [[211.8, 402.0], [498.6, 685.8], [641.1, 581.7], [351.8, 310.1]], floor_centre_px: [422.1, 490.1], floor_size_m: [0.21, 0.08], layer: 'plate-kuro.png' },
    { id: 'tenmoku', glaze: 'tenmoku', seed: 11, size_m: [0.27, 0.15], at_m: [0.115, -0.14], turn_deg: -19,
      floor_corners_px: [[727.1, 778.6], [1042.2, 1143.0], [1215.8, 1016.0], [895.9, 668.8]], floor_centre_px: [965.5, 894.4], floor_size_m: [0.21, 0.09], layer: 'plate-tenmoku.png' },
  ],
  utensils_on: 'shino',
  note: 'Stack back to front: table, plates, dishes, utensils. A dish is placed in plate-floor metres, origin at the floor centre, x along the plate\'s length, and rendered from this camera.',
}

const enc = new TextEncoder()
const hex = (bytes: ArrayBuffer): string => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')
const sha = async (bytes: Uint8Array): Promise<string> => hex(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))
const sigOf = (ch: string): string => ch.repeat(64)

/** Each file the render names, under a signature of its own. */
const SIGS: Record<string, string> = {
  'table.png': sigOf('1'),
  'plate-ash.png': sigOf('2'),
  'plate-shino.png': sigOf('3'),
  'plate-kuro.png': sigOf('4'),
  'plate-tenmoku.png': sigOf('5'),
  'utensils.png': sigOf('6'),
}

const built = (): RecipeSettingDocument => {
  const render = recipeSettingRender(RENDERED_SETTING)
  if (!render) throw new Error('the render does not read')
  const made = render.build(file => SIGS[file])
  if (!made.ok) throw new Error(made.reason)
  return made.doc
}

/** A document as raw JSON, to say things the writer would never write. */
const raw = (over: Record<string, unknown> = {}, plate: Record<string, unknown> = {}): Uint8Array => {
  const doc = JSON.parse(new TextDecoder().decode(recipeSettingBytes(built()))) as Record<string, unknown> & { plates: Record<string, unknown>[] }
  doc.plates[0] = { ...doc.plates[0], ...plate }
  return enc.encode(JSON.stringify({ ...doc, ...over }))
}

const reason = async (bytes: Uint8Array, expected?: string): Promise<string> => {
  const parsed = await parseRecipeSetting(bytes, expected)
  return parsed.ok ? 'it read' : parsed.reason
}

/** Where a matrix3d(...) string takes a point of its box. */
const apply = (matrix: string, x: number, y: number): RecipeSettingPoint => {
  const m = matrix.slice('matrix3d('.length, -1).split(',').map(Number)
  const w = m[3] * x + m[7] * y + m[15]
  return [(m[0] * x + m[4] * y + m[12]) / w, (m[1] * x + m[5] * y + m[13]) / w]
}

describe('the set a render describes', () => {
  it('names every picture it needs, the table first, and leaves the composite out', () => {
    expect(recipeSettingRender(RENDERED_SETTING)?.files).toEqual(['table.png', 'plate-ash.png', 'plate-shino.png', 'plate-kuro.png', 'plate-tenmoku.png', 'utensils.png'])
  })

  it('builds a set the strict reader accepts: size, table, utensils, and each plate with its floor and centre', async () => {
    const doc = built()
    expect(doc).toMatchObject({ name: 'ash · shino · kuro · tenmoku', size: [1800, 1200], table: SIGS['table.png'], utensils: SIGS['utensils.png'] })
    expect(doc.plates.map(plate => [plate.id, plate.glaze, plate.layer])).toEqual([
      ['ash', 'ash', SIGS['plate-ash.png']], ['shino', 'shino', SIGS['plate-shino.png']],
      ['kuro', 'kuro', SIGS['plate-kuro.png']], ['tenmoku', 'tenmoku', SIGS['plate-tenmoku.png']],
    ])
    expect(doc.plates[0].centre).toEqual([889.7, 255.6])
    const parsed = await parseRecipeSetting(recipeSettingBytes(doc))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.setting.plates).toEqual(doc.plates)
  })

  it('turns each floor into reading order: wound as a card is, starting on a long edge that runs left to right', () => {
    // The render goes round the other way, along the plate's length first.
    expect(built().plates[0].floor).toEqual([[781.5, 87.6], [1139, 306], [1007.1, 438], [646.1, 206.4]])
    for (const plate of built().plates) {
      const [a, b, c, d] = plate.floor
      expect(recipeFloorArea(plate.floor)).toBeGreaterThan(0)
      expect(b[0] - a[0]).toBeGreaterThan(0)
      expect(Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(d[0] - c[0], d[1] - c[1]))
        .toBeGreaterThan(Math.hypot(c[0] - b[0], c[1] - b[1]) + Math.hypot(a[0] - d[0], a[1] - d[1]))
      expect(recipeFloorHolds(plate.floor, plate.centre)).toBe(true)
    }
    // Already in reading order, it stays as it is.
    const reading = built().plates[1].floor
    expect(recipeReadingFloor(reading)).toEqual(reading)
  })

  it('takes a name when one is given, and says what is not held', () => {
    const render = recipeSettingRender(RENDERED_SETTING, 'Slate, four plates')
    const made = render?.build(file => SIGS[file])
    expect(made?.ok && made.doc.name).toBe('Slate, four plates')
    expect(render?.build(file => (file === 'plate-kuro.png' ? undefined : SIGS[file]))).toEqual({ ok: false, reason: 'plate-kuro.png is not held' })
  })

  it('is not a render without a size, a table, plates, or four corners and a centre on each plate', () => {
    const without = (key: string): Record<string, unknown> => { const copy: Record<string, unknown> = { ...RENDERED_SETTING }; delete copy[key]; return copy }
    expect(recipeSettingRender(null)).toBeNull()
    expect(recipeSettingRender([RENDERED_SETTING])).toBeNull()
    expect(recipeSettingRender(without('size_px'))).toBeNull()
    expect(recipeSettingRender(without('plates'))).toBeNull()
    expect(recipeSettingRender({ ...RENDERED_SETTING, layers: { utensils: 'utensils.png' } })).toBeNull()
    expect(recipeSettingRender({ ...RENDERED_SETTING, plates: [] })).toBeNull()
    expect(recipeSettingRender({ ...RENDERED_SETTING, plates: [{ ...RENDERED_SETTING.plates[0], floor_corners_px: [[1, 1], [2, 2], [3, 3]] }] })).toBeNull()
    expect(recipeSettingRender({ ...RENDERED_SETTING, plates: [{ ...RENDERED_SETTING.plates[0], floor_centre_px: undefined }] })).toBeNull()
    // A picture is named by its file name alone: never a path that reaches out of the folder.
    expect(recipeSettingRender({ ...RENDERED_SETTING, layers: { table: '../table.png' } })).toBeNull()
    // Without utensils it is still a set.
    expect(recipeSettingRender({ ...RENDERED_SETTING, layers: { table: 'table.png' } })?.files).not.toContain('utensils.png')
  })
})

describe('reading a set: strict, with a reason', () => {
  it('reads its own canonical bytes back, under their signature, and the same set is the same bytes', async () => {
    const bytes = recipeSettingBytes(built())
    expect(recipeSettingBytes(built())).toEqual(bytes)
    const parsed = await parseRecipeSetting(bytes, await sha(bytes))
    expect(parsed.ok && parsed.sig).toBe(await sha(bytes))
    expect(new TextDecoder().decode(bytes).startsWith(`{"${RECIPE_SETTING_KEY}":1,"name":`)).toBe(true)
  })

  it('refuses bytes that are not the signature they were held under', async () => {
    expect(await reason(recipeSettingBytes(built()), sigOf('f'))).toBe('its bytes do not match the signature they were held under')
  })

  it('refuses what the format does not say, and never strips it', async () => {
    expect(await reason(raw({ dishes: [] }))).toBe('it has an unknown field "dishes"')
    expect(await reason(raw({}, { food: 'rice' }))).toBe('plate 1 has an unknown field "food"')
    expect(await reason(raw({ [RECIPE_SETTING_KEY]: 2 }))).toContain('the one version this reader knows')
    expect(await reason(enc.encode('{"__proto__":{}}'))).toBe('the key "__proto__" is not allowed anywhere in it')
    expect(await reason(enc.encode('{"recipe:setting":1,"recipe:setting":1}'))).toContain('repeats the key')
    expect(await reason(enc.encode('not json'))).toBe('it is not JSON')
    expect(await reason(new Uint8Array(RECIPE_SETTING_LIMITS.bytes + 1))).toBe('it is larger than 16 KB')
  })

  it('refuses a name that is not one line, and a picture that is not a signature', async () => {
    expect(await reason(raw({ name: 'two\nlines' }))).toContain('line break')
    expect(await reason(raw({ name: ' ' }))).toBe('"name" is empty')
    expect(await reason(raw({ name: 'x'.repeat(RECIPE_SETTING_LIMITS.name + 1) }))).toBe('"name" is longer than 80 characters')
    expect(await reason(raw({ table: 'table.png' }))).toBe('"table" must be a signature (64 lowercase hex)')
    expect(await reason(raw({ utensils: sigOf('A') }))).toBe('"utensils" must be a signature (64 lowercase hex)')
    expect(await reason(raw({}, { layer: '' }))).toBe('"ash.layer" must be a signature (64 lowercase hex)')
  })

  it('refuses a size that is not two whole numbers, and points that are not inside the picture', async () => {
    expect(await reason(raw({ size: [1800.5, 1200] }))).toContain('"size" must be')
    expect(await reason(raw({ size: [0, 1200] }))).toContain('"size" must be')
    expect(await reason(raw({ size: [RECIPE_SETTING_LIMITS.side + 1, 1200] }))).toContain('"size" must be')
    expect(await reason(raw({}, { centre: [889.7] }))).toBe('"ash.centre" must be a point: [x, y]')
    expect(await reason(raw({}, { centre: ['889.7', 255.6] }))).toBe('"ash.centre" must be two finite numbers')
    expect(await reason(raw({}, { centre: [1900, 255.6] }))).toBe('"ash.centre" lies outside the picture')
    expect(await reason(raw({}, { floor: [[781.5, 87.6], [1139, 306], [1007.1, 438], [646.1, -1]] }))).toBe('"ash.floor[3]" lies outside the picture')
  })

  it('refuses a floor wound the other way or folded, and a centre that is not on its floor', async () => {
    const [a, b, c, d] = built().plates[0].floor
    expect(await reason(raw({}, { floor: [a, d, c, b] }))).toContain('must go round top-left, top-right, bottom-right, bottom-left')
    expect(await reason(raw({}, { floor: [a, c, b, d] }))).toContain('without folding over itself')
    expect(await reason(raw({}, { floor: [a, b, c] }))).toBe('"ash.floor" must be four corners')
    expect(await reason(raw({}, { centre: [1600, 900] }))).toBe('"ash.centre" is not on its floor')
  })

  it('lays one to eight plates, each with an id of its own and one-word names', async () => {
    const doc = JSON.parse(new TextDecoder().decode(recipeSettingBytes(built()))) as { plates: Record<string, unknown>[] }
    expect(await reason(raw({ plates: [] }))).toBe('it has no plates: a table set lays at least one')
    expect(await reason(raw({ plates: Array.from({ length: 9 }, (_, i) => ({ ...doc.plates[0], id: `p${i}` })) }))).toBe('"plates" holds more than 8')
    expect(await reason(raw({ plates: [doc.plates[0], { ...doc.plates[1], id: 'ash' }] }))).toBe('two plates share the id "ash"')
    expect(await reason(raw({}, { id: 'Ash' }))).toContain('one short word')
    expect(await reason(raw({}, { glaze: 'ash glaze' }))).toContain('one short word')
    expect(await reason(raw({}, { id: 'constructor' }))).toContain('one short word')
  })
})

describe('a floor is read the right way up, whichever corner it was written from', () => {
  /** A wide floor, upright: its top edge from (100, 100) to (500, 100), 200 deep. */
  const UPRIGHT: RecipeSettingPoint[] = [[100, 100], [500, 100], [500, 300], [100, 300]]
  const read = async (floor: RecipeSettingPoint[], centre: RecipeSettingPoint = [300, 200]): Promise<RecipeSettingFloor> => {
    const parsed = await parseRecipeSetting(raw({}, { floor, centre }))
    if (!parsed.ok) throw new Error(parsed.reason)
    return parsed.setting.plates[0].floor
  }
  /** A card laid on the floor reads upright: its top runs left to right, and its words go down the picture from it. */
  const upright = (floor: RecipeSettingFloor): void => {
    const box = recipeFloorBox(floor)
    const matrix = floorMatrix(floor, box.width, box.height)
    const [topLeft, topRight, , bottomLeft] = [[0, 0], [box.width, 0], [box.width, box.height], [0, box.height]].map(([x, y]) => apply(matrix, x, y))
    expect(topRight[0]).toBeGreaterThan(topLeft[0])
    expect(bottomLeft[1]).toBeGreaterThan(topLeft[1])
    // Along the plate's length, not across it: the card is never sideways.
    expect(box.width).toBeGreaterThan(box.height)
  }

  it('turns a floor given from its far corner (upside down) so the card reads upright', async () => {
    const [tl, tr, br, bl] = UPRIGHT
    const floor = await read([br, bl, tl, tr])
    expect(floor).toEqual(UPRIGHT)
    upright(floor)
  })

  it('turns a floor that starts on a short edge (sideways) so the card runs along the plate', async () => {
    const [tl, tr, br, bl] = UPRIGHT
    expect(await read([tr, br, bl, tl])).toEqual(UPRIGHT)
    expect(await read([bl, tl, tr, br])).toEqual(UPRIGHT)
    upright(await read([tr, br, bl, tl]))
  })

  it("turns a tilted plate's floor the same way, and keeps its corners where they were", async () => {
    const reading = built().plates[0].floor
    const [a, b, c, d] = reading
    for (const given of [[c, d, a, b], [b, c, d, a], [d, a, b, c]]) {
      const floor = await read(given.map(([x, y]) => [x, y] as RecipeSettingPoint), [889.7, 255.6])
      expect(floor).toEqual(reading)
      upright(floor)
    }
  })

  it('still refuses a floor wound the other way: it is turned, never reversed', async () => {
    const [tl, tr, br, bl] = UPRIGHT
    expect(await reason(raw({}, { floor: [tl, bl, br, tr], centre: [300, 200] }))).toContain('must go round')
  })
})

describe('a set of a shape the desk cannot fit whole is refused', () => {
  it('refuses a picture more than four times as wide as it is tall, or as tall as it is wide', async () => {
    expect(await reason(raw({ size: [16_000, 1200] }))).toBe('"size" is 16000 by 1200: a table set may be at most 4 times as wide as it is tall, or as tall as it is wide')
    expect(await reason(raw({ size: [1800, 7300] }))).toBe('"size" is 1800 by 7300: a table set may be at most 4 times as wide as it is tall, or as tall as it is wide')
  })

  it('takes the shapes the desk fits, up to four to one either way', async () => {
    expect(await reason(raw({ size: [4800, 1200] }))).toBe('it read')
    expect(await reason(raw({ size: [1800, 7200] }))).toBe('it read')
    expect(RECIPE_SETTING_LIMITS.aspect).toEqual({ least: 0.25, most: 4 })
    expect([recipeSettingAspectFits(4, 1), recipeSettingAspectFits(1, 4), recipeSettingAspectFits(4.01, 1), recipeSettingAspectFits(1, 4.01)]).toEqual([true, true, false, false])
  })
})

describe("a refusal is a code, said in the reader's own language", () => {
  it('names its code, its i18n key and what fills it, and says the English sentence without a reader', async () => {
    const parsed = await parseRecipeSetting(raw({}, { centre: [1900, 255.6] }))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.refusal).toEqual({ code: 'outside', key: 'recipe.setting.refusal.outside', params: { field: 'ash.centre' } })
    expect(parsed.reason).toBe('"ash.centre" lies outside the picture')
    expect(recipeSettingRefusalWords(parsed.refusal)).toBe(parsed.reason)
  })

  it("is said through the reader's own words where it has them, its holes filled, and in English where it has not", async () => {
    const parsed = await parseRecipeSetting(raw({ size: [16_000, 1200] }))
    if (parsed.ok) throw new Error('it read')
    const japanese = (key: string, fallback: string): string => (key === 'recipe.setting.refusal.aspect' ? '「size」が {width} × {height} です' : fallback)
    expect(recipeSettingRefusalWords(parsed.refusal, japanese)).toBe('「size」が 16000 × 1200 です')
    const echo = (key: string): string => key
    expect(recipeSettingRefusalWords(parsed.refusal, echo)).toBe(parsed.reason)
  })

  it('every refusal the reader gives has a code of its own', async () => {
    const cases = [
      raw({ dishes: [] }), raw({}, { food: 'rice' }), raw({ [RECIPE_SETTING_KEY]: 2 }), enc.encode('{"__proto__":{}}'),
      enc.encode('{"recipe:setting":1,"recipe:setting":1}'), enc.encode('not json'), new Uint8Array(RECIPE_SETTING_LIMITS.bytes + 1),
      raw({ name: 'two\nlines' }), raw({ name: ' ' }), raw({ table: 'table.png' }), raw({ size: [0, 1200] }), raw({ plates: [] }),
    ]
    const codes: string[] = []
    for (const bytes of cases) {
      const parsed = await parseRecipeSetting(bytes)
      codes.push(parsed.ok ? 'it read' : parsed.refusal.code)
    }
    expect(codes).toEqual(['unknownField', 'plateUnknownField', 'version', 'forbiddenKey', 'repeatedKey', 'notJson', 'tooLarge', 'notOneLine', 'empty', 'notSignature', 'size', 'noPlates'])
  })
})

describe('what a set names', () => {
  it('names its table, each plate\'s layer and its utensils, once each', () => {
    expect(recipeSettingSignatures(built())).toEqual(['table.png', 'plate-ash.png', 'plate-shino.png', 'plate-kuro.png', 'plate-tenmoku.png', 'utensils.png'].map(file => SIGS[file]))
    const doc = built()
    const shared = { ...doc, utensils: undefined, plates: doc.plates.map(plate => ({ ...plate, layer: doc.table })) }
    expect(recipeSettingSignatures(shared)).toEqual([doc.table])
  })
})

describe('the floor, as a place card lies on it', () => {
  const floors = (): RecipeSettingFloor[] => built().plates.map(plate => plate.floor)

  it('floorMatrix lays a box\'s four corners on the floor\'s four corners', () => {
    for (const floor of floors()) {
      const box = recipeFloorBox(floor)
      const matrix = floorMatrix(floor, box.width, box.height)
      expect(matrix).toMatch(/^matrix3d\((-?[\d.e-]+,){15}-?[\d.e-]+\)$/)
      const corners: [number, number][] = [[0, 0], [box.width, 0], [box.width, box.height], [0, box.height]]
      corners.forEach(([x, y], at) => {
        const [px, py] = apply(matrix, x, y)
        expect(px).toBeCloseTo(floor[at][0], 3)
        expect(py).toBeCloseTo(floor[at][1], 3)
      })
      // The middle of the box lands on the floor, where the floor's own perspective puts it.
      const middle = apply(matrix, box.width / 2, box.height / 2)
      const expected = recipeFloorAt(floor, 0.5, 0.5) as RecipeSettingPoint
      expect(middle[0]).toBeCloseTo(expected[0], 3)
      expect(middle[1]).toBeCloseTo(expected[1], 3)
      expect(recipeFloorHolds(floor, middle)).toBe(true)
    }
  })

  it('is the plain affine map on a parallelogram, and nothing for a floor or a box with no size', () => {
    const square: RecipeSettingFloor = [[10, 20], [110, 20], [110, 70], [10, 70]]
    expect(floorMatrix(square, 100, 50)).toBe('matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,10,20,0,1)')
    expect(floorMatrix([[0, 0], [0, 0], [0, 0], [0, 0]], 100, 50)).toBe('none')
    expect(floorMatrix(square, 0, 50)).toBe('none')
    expect(floorMatrix(square.slice(0, 3), 100, 50)).toBe('none')
  })

  it('a card inset on the floor lies inside it, and its box is the floor\'s own size', () => {
    for (const floor of floors()) {
      const inset = recipeFloorInset(floor, 0.06, 0.52, 0.94, 0.94) as RecipeSettingFloor
      for (const corner of inset) expect(recipeFloorHolds(floor, corner)).toBe(true)
      expect(recipeFloorArea(inset)).toBeGreaterThan(0)
    }
    expect(recipeFloorBox([[0, 0], [300, 0], [300, 100], [0, 100]])).toEqual({ width: 300, height: 100 })
  })
})
