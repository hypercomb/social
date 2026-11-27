// recipe/recipe-setting.ts
//
// A TABLE SET: the photographed table a recipe desk can sit on. One JSON
// document with one signature (I1), complete alone (A1):
//
//   { "recipe:setting": 1, name, size: [w, h], table, utensils?, plates: [
//       { id, glaze, layer, floor: [[x,y] x4], centre: [x,y] }, ... ] }
//
// Every picture is a signature the reader resolves from its own heap (I2):
// `table` is the bare table, the back layer; each plate's `layer` is that
// plate alone on transparency with its own contact shadow, drawn over the
// table; `utensils` lies over everything. Every layer is the full picture,
// `size` pixels, so stacking them is all a reader does. A plate's `floor` is
// where the flat floor of the plate lands in the picture, as four corners,
// and `centre` is the middle of that floor: what a place card is laid on and
// what a leader points to.
//
// THE FLOOR'S CORNERS ARE READ INTO READING ORDER. They must go round the way
// a box's corners go on a screen (top-left, top-right, bottom-right,
// bottom-left); the reader refuses a floor wound the other way or folded over
// itself. Which corner a maker wrote first does not matter: on reading, the
// order is turned (never reversed) so floor[0] to floor[1] is a long edge
// running left to right across the picture, the edge the words of a place
// card run along. A card laid on any floor that reads is upright from the
// camera, never upside down or sideways.
//
// THE PLATES ARE ONLY THE SURFACE. Food is a separate, interchangeable layer
// and is NOT a field here: a dish will be an artifact of its own, laid on a
// plate by that plate's `id` and floor and rendered from the same camera. So
// a set never changes when a dish changes, a dish never changes when better
// plates arrive, and better art is a new set in the pool, with no code change.
//
// ── STRICT, AND TEXT ONLY ───────────────────────────────────────────────────
//
// A set arrives from a stranger's host, so the reader refuses what the format
// does not say, with a reason, and never strips (the rule of
// recipe-template.ts, whose reading helpers this file repeats because a module
// of its own must stand alone). Every number is finite and inside the
// picture; every name is one short line.
//
// Pure: no DOM, no network, no storage. It exports and never registers.

/** The self-declaring key of a table set; its value is the format version. */
export const RECIPE_SETTING_KEY = 'recipe:setting'

export const RECIPE_SETTING_LIMITS = Object.freeze({
  /** A set document, in bytes. */
  bytes: 16 * 1024,
  name: 80,
  plates: 8,
  /** An id or a glaze: one short word. */
  word: 24,
  /** The picture's longest side, px. */
  side: 16_384,
  /** One layer picture, in bytes. */
  layerBytes: 3 * 1024 * 1024,
  /** The picture's width over its height: no wider than four times its height, no taller than four times its width, the shapes the desk fits whole. */
  aspect: Object.freeze({ least: 0.25, most: 4 }),
})

const L = RECIPE_SETTING_LIMITS

// ── types ───────────────────────────────────────────────────────────────────

export type RecipeSettingPoint = readonly [number, number]
/** Four corners in reading order: top-left, top-right, bottom-right, bottom-left, as a card laid on them reads. */
export type RecipeSettingFloor = readonly [RecipeSettingPoint, RecipeSettingPoint, RecipeSettingPoint, RecipeSettingPoint]

export interface RecipeSettingPlate {
  /** The plate's own name in the set: a dish is laid on it by this. */
  readonly id: string
  /** What the plate is glazed with, one word ("shino", "kuro"). */
  readonly glaze: string
  /** The plate alone on transparency, the full picture's size, by signature. */
  readonly layer: string
  readonly floor: RecipeSettingFloor
  readonly centre: RecipeSettingPoint
}

/** The set as its maker wrote it. `recipeSettingBytes` writes it; `parseRecipeSetting` reads it back. */
export interface RecipeSettingDocument {
  readonly name: string
  /** The picture's width and height, px: every layer is this size. */
  readonly size: readonly [number, number]
  /** The bare table, the back layer, by signature. */
  readonly table: string
  /** What lies over everything (chopsticks and their rest), by signature. */
  readonly utensils?: string
  /** Back to front is the order they are drawn in; the first is the first a recipe's sections sit on. */
  readonly plates: readonly RecipeSettingPlate[]
}

export interface RecipeSetting extends RecipeSettingDocument {
  /** sha256 of the exact bytes it was read from. */
  readonly sig: string
}

/** Why a set was refused, as a code a reader puts into its own language (`recipeSettingRefusalWords`). */
export type RecipeSettingRefusalCode = keyof typeof REFUSALS

export interface RecipeSettingRefusal {
  readonly code: RecipeSettingRefusalCode
  /** The i18n key of its sentence: `recipe.setting.refusal.<code>`. */
  readonly key: string
  /** What fills the sentence's {holes}: field names and numbers, never words. */
  readonly params: Readonly<Record<string, string | number>>
}

export type ParsedRecipeSetting =
  | { readonly ok: true; readonly setting: RecipeSetting; readonly sig: string }
  /** `reason` is the refusal in English; `refusal` says it in any language. */
  | { readonly ok: false; readonly reason: string; readonly refusal: RecipeSettingRefusal }

// ── refusals ────────────────────────────────────────────────────────────────

/** Every refusal, in English, with {holes} for what it names. Each is the fallback of `recipe.setting.refusal.<code>`. */
const REFUSALS = Object.freeze({
  notBytes: 'it is not bytes',
  tooLarge: 'it is larger than {kb} KB',
  notUtf8: 'it is not UTF-8',
  notJson: 'it is not JSON',
  forbiddenKey: 'the key "{key}" is not allowed anywhere in it',
  repeatedKey: 'it repeats the key "{key}", so two readers could see two documents',
  sigMismatch: 'its bytes do not match the signature they were held under',
  notObject: 'it is not a JSON object',
  unknownField: 'it has an unknown field "{key}"',
  plateUnknownField: 'plate {plate} has an unknown field "{key}"',
  version: 'it does not say "{key}": 1, the one version this reader knows',
  notText: '"{field}" must be text',
  empty: '"{field}" is empty',
  tooLong: '"{field}" is longer than {max} characters',
  notOneLine: '"{field}" has a line break, control characters or direction overrides in it',
  notWord: '"{field}" must be one short word: lowercase letters, digits, - or _ (up to {max}), starting with a letter',
  notSignature: '"{field}" must be a signature (64 lowercase hex)',
  notPoint: '"{field}" must be a point: [x, y]',
  notFinite: '"{field}" must be two finite numbers',
  outside: '"{field}" lies outside the picture',
  plateNotObject: 'plate {plate} is not an object',
  duplicateId: 'two plates share the id "{id}"',
  notCorners: '"{field}" must be four corners',
  floorWound: '"{field}" must go round top-left, top-right, bottom-right, bottom-left, without folding over itself',
  centreOff: '"{field}" is not on its floor',
  size: '"size" must be the picture\'s width and height: two whole numbers from 1 to {side}',
  aspect: '"size" is {width} by {height}: a table set may be at most {most} times as wide as it is tall, or as tall as it is wide',
  platesNotList: '"plates" must be a list',
  noPlates: 'it has no plates: a table set lays at least one',
  tooManyPlates: '"plates" holds more than {max}',
  unread: 'it could not be read',
})

const fill = (text: string, params: Readonly<Record<string, string | number>>): string =>
  text.replace(/\{(\w+)\}/g, (hole, name: string) => (name in params ? String(params[name]) : hole))

const refusalOf = (code: RecipeSettingRefusalCode, params: Readonly<Record<string, string | number>> = {}): RecipeSettingRefusal =>
  Object.freeze({ code, key: `recipe.setting.refusal.${code}`, params: Object.freeze({ ...params }) })

/** How a reader says a key in its own language: the fallback, its {holes} filled, when it knows no better. */
export type RecipeSettingSay = (key: string, fallback: string, params?: Record<string, string | number>) => string

/** A refusal in the reader's language, through its own `say`; the English sentence without one. */
export function recipeSettingRefusalWords(refusal: RecipeSettingRefusal, say?: RecipeSettingSay): string {
  const english = fill(REFUSALS[refusal.code], refusal.params)
  if (!say) return english
  const said = say(refusal.key, REFUSALS[refusal.code], { ...refusal.params })
  return said && said !== refusal.key ? fill(said, refusal.params) : english
}

// ── reading ─────────────────────────────────────────────────────────────────

const SIG = /^[a-f0-9]{64}$/
const WORD = /^[a-z][a-z0-9_-]*$/
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype'])
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const BIDI = /[‪-‮⁦-⁩]/
const SETTING_KEYS: ReadonlySet<string> = new Set([RECIPE_SETTING_KEY, 'name', 'size', 'table', 'utensils', 'plates'])
const PLATE_KEYS: ReadonlySet<string> = new Set(['id', 'glaze', 'layer', 'floor', 'centre'])

const utf8 = new TextEncoder()
const clip = (value: string, max = 40): string => (value.length > max ? `${value.slice(0, max)}…` : value)

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), b => b.toString(16).padStart(2, '0')).join('')

class Refusal extends Error {
  readonly refusal: RecipeSettingRefusal
  constructor(refusal: RecipeSettingRefusal) {
    super(fill(REFUSALS[refusal.code], refusal.params))
    this.refusal = refusal
  }
}
// A declaration, not an arrow, so the compiler knows the code after a refusal is unreachable.
function refuse(code: RecipeSettingRefusalCode, params: Readonly<Record<string, string | number>> = {}): never {
  throw new Refusal(refusalOf(code, params))
}

const isBytes = (value: unknown): value is Uint8Array =>
  value instanceof Uint8Array || Object.prototype.toString.call(value) === '[object Uint8Array]'

function parseJson(text: string): unknown {
  return JSON.parse(text, function reviver(key: string, value: unknown) {
    if (FORBIDDEN_KEYS.has(key)) refuse('forbiddenKey', { key })
    return value
  })
}

/** The first key an object repeats, or null: JSON.parse keeps the last of two, and a reader of the bytes may see the first. */
function repeatedKey(text: string): string | null {
  const open: (Set<string> | null)[] = []
  let expectKey = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      const top = open[open.length - 1]
      if (expectKey && top) {
        const key = JSON.parse(text.slice(i, j + 1)) as string
        if (top.has(key)) return key
        top.add(key)
        expectKey = false
      }
      i = j
    } else if (ch === '{') { open.push(new Set()); expectKey = true }
    else if (ch === '[') { open.push(null); expectKey = false }
    else if (ch === '}' || ch === ']') { open.pop(); expectKey = false }
    else if (ch === ',') expectKey = open[open.length - 1] instanceof Set
  }
  return null
}

/** `plate` is the plate's number from 1, or none for the set itself. */
const onlyKeys = (value: Record<string, unknown>, allowed: ReadonlySet<string>, plate?: number): void => {
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue
    if (plate === undefined) refuse('unknownField', { key: clip(key) })
    refuse('plateUnknownField', { plate, key: clip(key) })
  }
}

const line = (value: unknown, field: string, max: number): string => {
  if (typeof value !== 'string') return refuse('notText', { field })
  if (!value.trim()) refuse('empty', { field })
  if (value.length > max) refuse('tooLong', { field, max })
  if (CONTROL.test(value) || /[\r\n]/.test(value) || BIDI.test(value)) refuse('notOneLine', { field })
  return value
}

const word = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length > L.word || !WORD.test(value) || FORBIDDEN_KEYS.has(value)) {
    return refuse('notWord', { field, max: L.word })
  }
  return value
}

const signature = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !SIG.test(value)) return refuse('notSignature', { field })
  return value
}

const point = (value: unknown, field: string, width: number, height: number): RecipeSettingPoint => {
  if (!Array.isArray(value) || value.length !== 2) return refuse('notPoint', { field })
  const [x, y] = value as unknown[]
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) refuse('notFinite', { field })
  if ((x as number) < 0 || (y as number) < 0 || (x as number) > width || (y as number) > height) refuse('outside', { field })
  return Object.freeze([x as number, y as number]) as RecipeSettingPoint
}

/** The cross product of a→b and a→c: positive when c turns the way a screen box's corners go. */
const turn = (a: RecipeSettingPoint, b: RecipeSettingPoint, c: RecipeSettingPoint): number =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

/** Twice the signed area, positive for corners wound top-left, top-right, bottom-right, bottom-left on a screen. */
export function recipeFloorArea(floor: readonly RecipeSettingPoint[]): number {
  let sum = 0
  for (let i = 0; i < floor.length; i++) {
    const a = floor[i]
    const b = floor[(i + 1) % floor.length]
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return sum
}

/** True for a picture of a shape the desk fits whole: its width over its height inside RECIPE_SETTING_LIMITS.aspect. */
export function recipeSettingAspectFits(width: number, height: number): boolean {
  const aspect = width / height
  return Number.isFinite(aspect) && aspect >= L.aspect.least && aspect <= L.aspect.most
}

/** True for a convex quad wound the way a card's corners go, with some area to it. */
const isReadingFloor = (floor: RecipeSettingFloor): boolean =>
  recipeFloorArea(floor) > 2 && floor.every((at, i) => turn(at, floor[(i + 1) % 4], floor[(i + 2) % 4]) > 0)

/**
 * The same corners, still wound the same way, turned so the first two are the
 * long edge that runs most nearly left to right across the picture: the top of
 * a place card laid on them, so its words read upright from the camera. The
 * longer pair of opposite edges is the plate's length; of its two edges, the
 * one that runs further to the right is the card's top. Nothing is moved or
 * rounded: only which corner comes first.
 */
function uprightFloor<T extends RecipeSettingPoint>(wound: readonly T[]): T[] {
  const edge = (i: number): number => Math.hypot(wound[(i + 1) % 4][0] - wound[i][0], wound[(i + 1) % 4][1] - wound[i][1])
  const along = edge(0) + edge(2) >= edge(1) + edge(3) ? [0, 2] : [1, 3]
  const run = (i: number): number => wound[(i + 1) % 4][0] - wound[i][0]
  const start = along.reduce((best, i) => (run(i) > run(best) ? i : best))
  return [0, 1, 2, 3].map(k => wound[(start + k) % 4])
}

/** True when a point is inside (or on the edge of) a floor that `isReadingFloor` accepts. */
export function recipeFloorHolds(floor: RecipeSettingFloor, at: RecipeSettingPoint): boolean {
  return floor.every((corner, i) => turn(corner, floor[(i + 1) % 4], at) >= 0)
}

function readPlate(value: unknown, at: number, seen: Set<string>, width: number, height: number): RecipeSettingPlate {
  if (!isPlainObject(value)) return refuse('plateNotObject', { plate: at + 1 })
  onlyKeys(value, PLATE_KEYS, at + 1)
  const id = word(value['id'], `plates[${at}].id`)
  if (seen.has(id)) refuse('duplicateId', { id })
  seen.add(id)
  const glaze = word(value['glaze'], `${id}.glaze`)
  const layer = signature(value['layer'], `${id}.layer`)
  const raw = value['floor']
  if (!Array.isArray(raw) || raw.length !== 4) return refuse('notCorners', { field: `${id}.floor` })
  const given = raw.map((corner, i) => point(corner, `${id}.floor[${i}]`, width, height)) as unknown as RecipeSettingFloor
  if (!isReadingFloor(given)) refuse('floorWound', { field: `${id}.floor` })
  // Whichever corner the maker wrote first, a card laid on it reads upright.
  const floor = Object.freeze(uprightFloor(given)) as unknown as RecipeSettingFloor
  const centre = point(value['centre'], `${id}.centre`, width, height)
  if (!recipeFloorHolds(floor, centre)) refuse('centreOff', { field: `${id}.centre` })
  return Object.freeze({ id, glaze, layer, floor, centre })
}

function readSettingDocument(doc: unknown, sig: string): RecipeSetting {
  if (!isPlainObject(doc)) return refuse('notObject')
  onlyKeys(doc, SETTING_KEYS)
  if (doc[RECIPE_SETTING_KEY] !== 1) refuse('version', { key: RECIPE_SETTING_KEY })
  const name = line(doc['name'], 'name', L.name)
  const size = doc['size']
  if (!Array.isArray(size) || size.length !== 2 || !size.every(side => Number.isInteger(side) && (side as number) >= 1 && (side as number) <= L.side)) {
    refuse('size', { side: L.side })
  }
  const [width, height] = size as [number, number]
  // A shape the desk cannot fit whole would be drawn cropped: refused, never cut.
  if (!recipeSettingAspectFits(width, height)) refuse('aspect', { width, height, most: L.aspect.most })
  const table = signature(doc['table'], 'table')
  const utensils = doc['utensils'] === undefined ? undefined : signature(doc['utensils'], 'utensils')
  const raw = doc['plates']
  if (!Array.isArray(raw)) return refuse('platesNotList')
  if (!raw.length) refuse('noPlates')
  if (raw.length > L.plates) refuse('tooManyPlates', { max: L.plates })
  const seen = new Set<string>()
  const plates = raw.map((plate, at) => readPlate(plate, at, seen, width, height))
  return Object.freeze({
    sig,
    name,
    size: Object.freeze([width, height]) as readonly [number, number],
    table,
    ...(utensils !== undefined ? { utensils } : {}),
    plates: Object.freeze(plates),
  })
}

/**
 * Read a table set from its bytes. Strict: anything this format does not say
 * is refused with a reason, never dropped. Pass the signature the bytes were
 * held under and a mismatch is refused too (S3). Never throws.
 */
export async function parseRecipeSetting(bytes: Uint8Array, expectedSig?: string): Promise<ParsedRecipeSetting> {
  try {
    if (!isBytes(bytes)) refuse('notBytes')
    if (bytes.length > L.bytes) refuse('tooLarge', { kb: L.bytes / 1024 })
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { return refuse('notUtf8') }
    let doc: unknown
    try { doc = parseJson(text) } catch (error) { if (error instanceof Refusal) throw error; return refuse('notJson') }
    const repeated = repeatedKey(text)
    if (repeated !== null) refuse('repeatedKey', { key: clip(repeated) })
    const sig = await sha256Hex(bytes)
    if (expectedSig !== undefined && sig !== expectedSig) refuse('sigMismatch')
    const setting = readSettingDocument(doc, sig)
    return { ok: true, setting, sig }
  } catch (error) {
    const refusal = error instanceof Refusal ? error.refusal : refusalOf('unread')
    return { ok: false, reason: recipeSettingRefusalWords(refusal), refusal }
  }
}

// ── writing ─────────────────────────────────────────────────────────────────

/**
 * The canonical bytes of a set: fields in one order, plates in the order the
 * maker gave them, no whitespace. One set is one signature (I1). It checks
 * nothing; `parseRecipeSetting` does.
 */
export function recipeSettingBytes(doc: RecipeSettingDocument): Uint8Array {
  const pair = (p: RecipeSettingPoint): [number, number] => [p[0], p[1]]
  return utf8.encode(JSON.stringify({
    [RECIPE_SETTING_KEY]: 1,
    name: doc.name,
    size: [doc.size[0], doc.size[1]],
    table: doc.table,
    ...(doc.utensils !== undefined ? { utensils: doc.utensils } : {}),
    plates: doc.plates.map(plate => ({
      id: plate.id,
      glaze: plate.glaze,
      layer: plate.layer,
      floor: plate.floor.map(pair),
      centre: pair(plate.centre),
    })),
  }))
}

/** Every signature a set names: its table, each plate's layer, its utensils. What a reader must hold to show it, and what travels with it. */
export function recipeSettingSignatures(doc: Pick<RecipeSettingDocument, 'table' | 'utensils' | 'plates'>): string[] {
  return [...new Set([doc.table, ...doc.plates.map(plate => plate.layer), ...(doc.utensils ? [doc.utensils] : [])])]
}

// ── the floor, as a place card lies on it ───────────────────────────────────

/**
 * The projective map of the unit square onto a floor: (u, v) in 0..1 lands at
 * ((a u + b v + c) / (g u + h v + 1), (d u + e v + f) / (g u + h v + 1)).
 * Corner (0,0) lands on floor[0], (1,0) on floor[1], (1,1) on floor[2] and
 * (0,1) on floor[3]. Null for a floor with no area.
 */
function unitToFloor(floor: readonly RecipeSettingPoint[]): readonly number[] | null {
  // A floor with no area has no square to map: every point would land on one line.
  if (floor.length !== 4 || !(Math.abs(recipeFloorArea(floor)) > 1e-9)) return null
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = floor
  const sx = x0 - x1 + x2 - x3
  const sy = y0 - y1 + y2 - y3
  let g = 0
  let h = 0
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    const dx1 = x1 - x2
    const dx2 = x3 - x2
    const dy1 = y1 - y2
    const dy2 = y3 - y2
    const den = dx1 * dy2 - dx2 * dy1
    if (Math.abs(den) < 1e-12) return null
    g = (sx * dy2 - dx2 * sy) / den
    h = (dx1 * sy - sx * dy1) / den
  }
  const out = [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h]
  return out.every(Number.isFinite) ? out : null
}

/** Where (u, v) of a floor's own square lands in the picture: (0,0) is its first corner, (1,1) its third. Null for a floor with no area. */
export function recipeFloorAt(floor: readonly RecipeSettingPoint[], u: number, v: number): RecipeSettingPoint | null {
  const m = unitToFloor(floor)
  if (!m) return null
  const [a, b, c, d, e, f, g, h] = m
  const w = g * u + h * v + 1
  if (Math.abs(w) < 1e-12) return null
  return [(a * u + b * v + c) / w, (d * u + e * v + f) / w]
}

const number = (value: number): string => {
  const rounded = Number(value.toPrecision(10))
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

/**
 * The CSS transform that lays a `width` x `height` box flat onto a floor: the
 * box's top-left corner on floor[0], top-right on floor[1], bottom-right on
 * floor[2] and bottom-left on floor[3], with everything between in
 * perspective. A homography written as `matrix3d(...)` for a box whose
 * transform-origin is its own top-left corner. 'none' for a floor with no
 * area or a box with no size.
 */
export function floorMatrix(floor: readonly RecipeSettingPoint[], width: number, height: number): string {
  const m = unitToFloor(floor)
  if (!m || !(width > 0) || !(height > 0)) return 'none'
  const [a, b, c, d, e, f, g, h] = m
  // The box's own px are taken to the unit square first: u = x / width, v = y / height.
  const column = [
    a / width, d / width, 0, g / width,
    b / height, e / height, 0, h / height,
    0, 0, 1, 0,
    c, f, 0, 1,
  ]
  return `matrix3d(${column.map(number).join(',')})`
}

/**
 * A smaller floor inside a floor: the part of it between `u0`..`u1` along and
 * `v0`..`v1` across, in the floor's own perspective. Where a place card lies
 * on a plate without covering all of it. Null for a floor with no area.
 */
export function recipeFloorInset(floor: readonly RecipeSettingPoint[], u0: number, v0: number, u1: number, v1: number): RecipeSettingFloor | null {
  const corners = [recipeFloorAt(floor, u0, v0), recipeFloorAt(floor, u1, v0), recipeFloorAt(floor, u1, v1), recipeFloorAt(floor, u0, v1)]
  return corners.every(Boolean) ? (corners as unknown as RecipeSettingFloor) : null
}

/** The size a place card is drawn at, in picture px: its floor's mean length along and across, so its words are not stretched. */
export function recipeFloorBox(floor: RecipeSettingFloor): { readonly width: number; readonly height: number } {
  const length = (p: RecipeSettingPoint, q: RecipeSettingPoint): number => Math.hypot(q[0] - p[0], q[1] - p[1])
  return {
    width: Math.max(1, Math.round((length(floor[0], floor[1]) + length(floor[3], floor[2])) / 2)),
    height: Math.max(1, Math.round((length(floor[1], floor[2]) + length(floor[0], floor[3])) / 2)),
  }
}

// ── from a render ───────────────────────────────────────────────────────────

const round1 = (value: number): number => Math.round(value * 10) / 10

/**
 * The four corners in reading order, whatever order a render gave them in:
 * wound the way a card's corners go, starting on a long edge that runs left
 * to right, so a place card lies along the plate the right way up.
 */
export function recipeReadingFloor(corners: readonly RecipeSettingPoint[]): RecipeSettingFloor {
  const wound = recipeFloorArea(corners) < 0 ? [corners[0], corners[3], corners[2], corners[1]] : [...corners]
  return uprightFloor(wound).map(([x, y]) => [round1(x), round1(y)] as RecipeSettingPoint) as unknown as RecipeSettingFloor
}

/** What a render's setting.json names, read loosely enough to say what is missing. */
export interface RecipeSettingRender {
  /** Every picture file it names, once each, the table first. */
  readonly files: readonly string[]
  /** Build the set once each named file is held under a signature. */
  build(sigOf: (file: string) => string | undefined): { readonly ok: true; readonly doc: RecipeSettingDocument } | { readonly ok: false; readonly reason: string }
}

const fileName = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() && value.length <= 200 && !/[\\/]/.test(value) && !CONTROL.test(value) ? value.trim() : null

const pairOf = (value: unknown): RecipeSettingPoint | null =>
  Array.isArray(value) && value.length === 2 && value.every(n => typeof n === 'number' && Number.isFinite(n))
    ? [value[0] as number, value[1] as number]
    : null

/**
 * The set a render describes, from the setting.json that tableware/setting.py
 * writes: its picture size, its table and utensils layers, and for each plate
 * its id, glaze, layer and where its floor lands. Null when the JSON is not
 * such a render. `name` is the set's name, else its plates' glazes.
 */
export function recipeSettingRender(json: unknown, name?: string): RecipeSettingRender | null {
  if (!isPlainObject(json)) return null
  const size = json['size_px']
  const layers = json['layers']
  const plates = json['plates']
  if (!Array.isArray(size) || size.length !== 2 || !size.every(side => Number.isInteger(side) && (side as number) > 0)) return null
  if (!isPlainObject(layers) || !Array.isArray(plates) || !plates.length) return null
  const table = fileName(layers['table'])
  if (!table) return null
  const utensils = layers['utensils'] === undefined || layers['utensils'] === null ? null : fileName(layers['utensils'])
  if (layers['utensils'] !== undefined && layers['utensils'] !== null && !utensils) return null
  const read: { id: string; glaze: string; layer: string; corners: RecipeSettingPoint[]; centre: RecipeSettingPoint }[] = []
  for (const plate of plates) {
    if (!isPlainObject(plate)) return null
    const layer = fileName(plate['layer'])
    const corners = Array.isArray(plate['floor_corners_px']) ? (plate['floor_corners_px'] as unknown[]).map(pairOf) : []
    const centre = pairOf(plate['floor_centre_px'])
    if (typeof plate['id'] !== 'string' || typeof plate['glaze'] !== 'string' || !layer || corners.length !== 4 || !centre || corners.some(c => !c)) return null
    read.push({ id: plate['id'], glaze: plate['glaze'], layer, corners: corners as RecipeSettingPoint[], centre })
  }
  const files = [...new Set([table, ...read.map(plate => plate.layer), ...(utensils ? [utensils] : [])])]
  const titled = typeof name === 'string' && name.trim() ? name.trim() : typeof json['name'] === 'string' && json['name'].trim() ? json['name'].trim() : read.map(plate => plate.glaze).join(' · ')
  return {
    files,
    build(sigOf) {
      const held = (file: string): string => sigOf(file) ?? ''
      const missing = files.find(file => !SIG.test(held(file)))
      if (missing) return { ok: false, reason: `${missing} is not held` }
      return {
        ok: true,
        doc: {
          name: titled.slice(0, L.name),
          size: [size[0] as number, size[1] as number],
          table: held(table),
          ...(utensils ? { utensils: held(utensils) } : {}),
          plates: read.map(plate => ({
            id: plate.id,
            glaze: plate.glaze,
            layer: held(plate.layer),
            floor: recipeReadingFloor(plate.corners),
            centre: [round1(plate.centre[0]), round1(plate.centre[1])] as RecipeSettingPoint,
          })),
        },
      }
    },
  }
}
