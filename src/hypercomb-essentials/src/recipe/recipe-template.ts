// recipe/recipe-template.ts
//
// A RECIPE, THE LAYOUT IT IS WRITTEN INTO, AND THE ENTRY THAT OFFERS IT. Three
// artifacts, each one JSON document with one signature (I1), each complete
// alone (A1):
//
//   a TEMPLATE  { "recipe:template": 1, name, description?, sections: [...] }
//     the layout relation of N4: names arranged, a schema of holes. It says
//     which sections a recipe has, in what order, what each is called and what
//     it asks the cook for. It is the row a participant leaves in the
//     `recipe:template` pool (documentation/pools-as-relational-database.md).
//
//   a RECIPE    { "recipe": 1, template?, values: { <key>: <value> } }
//     the fill. Every value says its own kind, so a recipe reads without its
//     template, and the same recipe can be shown through another template:
//     sections are matched by key and kind, and whatever the new template has
//     no section for is kept and shown after it, never dropped.
//
//   an ENTRY    { "recipe:entry": 1, name, recipe, cover? }
//     the tile as a row: what it is called and the recipe it holds, by
//     signature. It is what a lit recipe tile leaves in the `recipe:entry`
//     pool, the same from a domain or from a classmate on one host: the reader
//     sees a node and its entries, never a kind of source (T9).
//
// ── STRICT, AND TEXT ONLY ───────────────────────────────────────────────────
//
// A template arrives from a stranger's host and a recipe may too, so both
// readers refuse what the format does not say, with a reason, and never strip
// (the rule of mail/template.ts). Nothing here is markup: every string reaches
// a page through textContent, a picture is a signature the reader resolves
// from its own heap, and a link is http or https with no credentials. Reading
// one can make this browser contact nobody (T7).
//
// A refusal is a CODE with what fills its holes (field names, keys and numbers,
// never words), the way recipe-setting.ts says its own: `reason` is the
// sentence in the participant's language when the shell's catalogue is up,
// English when it is not, and `refusal` lets any reader say it in its own.
//
// Pure: no DOM, no network, no storage. It exports and never registers; the one
// thing it asks of the hive is the catalogue's words for a refusal.

import { I18N_IOC_KEY, get, type I18nProvider } from '@hypercomb/core'

/** The self-declaring key of a template document; its value is the format version. */
export const RECIPE_TEMPLATE_KEY = 'recipe:template'
/** The self-declaring key of a recipe document. */
export const RECIPE_KEY = 'recipe'
/** The self-declaring key of an entry: a recipe tile as a row someone offers. */
export const RECIPE_ENTRY_KEY = 'recipe:entry'

export const RECIPE_LIMITS = Object.freeze({
  /** A template document, in bytes. */
  templateBytes: 64 * 1024,
  /** A recipe document, in bytes. */
  recipeBytes: 512 * 1024,
  /** An entry, in bytes: small enough to be one room member on a host. */
  entryBytes: 2 * 1024,
  sections: 24,
  name: 120,
  description: 500,
  label: 80,
  prompt: 300,
  /** The fact labels one facts section may suggest. */
  fields: 12,
  text: 20_000,
  ingredients: 200,
  amount: 60,
  item: 200,
  note: 300,
  steps: 100,
  step: 4_000,
  /** A step's minutes: up to a day. */
  minutes: 24 * 60,
  pictures: 48,
  links: 24,
  url: 2048,
  facts: 12,
  factLabel: 40,
  factValue: 120,
})

const L = RECIPE_LIMITS

// ── types ───────────────────────────────────────────────────────────────────

export type RecipeSectionKind = 'text' | 'ingredients' | 'steps' | 'pictures' | 'links' | 'facts'

export const RECIPE_SECTION_KINDS: readonly RecipeSectionKind[] = Object.freeze(['text', 'ingredients', 'steps', 'pictures', 'links', 'facts'])

export interface RecipeSection {
  /** The hole's name: lowercase letters, digits, - or _, starting with a letter. */
  readonly key: string
  readonly kind: RecipeSectionKind
  /** What the section is called, to the cook and to the reader. */
  readonly label: string
  /** What it asks the cook for, shown while the section is empty. */
  readonly prompt?: string
  /** A facts section's suggested labels ("Serves", "Time"). */
  readonly fields?: readonly string[]
}

/** The template as its author wrote it. `recipeTemplateBytes` writes it; `parseRecipeTemplate` reads it back. */
export interface RecipeTemplateDocument {
  readonly name: string
  readonly description?: string
  readonly sections: readonly RecipeSection[]
}

export interface RecipeTemplate extends RecipeTemplateDocument {
  /** sha256 of the exact bytes it was read from. */
  readonly sig: string
}

export interface RecipeIngredient {
  readonly amount?: string
  readonly item: string
  readonly note?: string
}

export interface RecipeStep {
  readonly text: string
  /** A picture of this step, by signature. */
  readonly picture?: string
  readonly minutes?: number
}

export interface RecipeLink {
  readonly url: string
  readonly label?: string
}

export interface RecipeFact {
  readonly label: string
  readonly value: string
}

export type RecipeValue =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'ingredients'; readonly items: readonly RecipeIngredient[] }
  | { readonly kind: 'steps'; readonly steps: readonly RecipeStep[] }
  | { readonly kind: 'pictures'; readonly pictures: readonly string[] }
  | { readonly kind: 'links'; readonly links: readonly RecipeLink[] }
  | { readonly kind: 'facts'; readonly facts: readonly RecipeFact[] }

/** The recipe as its cook wrote it. `recipeBytes` writes it; `parseRecipe` reads it back. */
export interface RecipeDocument {
  /** The template it was written into, by signature. A recipe reads without it. */
  readonly template?: string
  readonly values: Readonly<Record<string, RecipeValue>>
}

export interface Recipe extends RecipeDocument {
  readonly sig: string
}

/** The entry as it is offered. `recipeEntryBytes` writes it; `parseRecipeEntry` reads it back. */
export interface RecipeEntryDocument {
  /** What the tile is called: the recipe's title. */
  readonly name: string
  /** The recipe document, by signature. */
  readonly recipe: string
  /** The picture a list shows beside the name, by signature. */
  readonly cover?: string
}

export interface RecipeEntry extends RecipeEntryDocument {
  readonly sig: string
}

/** Why a template, a recipe or an entry was refused, as a code a reader puts into its own language (`recipeTemplateRefusalWords`). */
export type RecipeTemplateRefusalCode = keyof typeof REFUSALS

export interface RecipeTemplateRefusal {
  readonly code: RecipeTemplateRefusalCode
  /** The i18n key of its sentence: `recipe.template.refusal.<code>`. */
  readonly key: string
  /** What fills the sentence's {holes}: field names, keys and numbers, never words. */
  readonly params: Readonly<Record<string, string | number>>
}

/** `reason` says the refusal in the participant's language (English without a catalogue); `refusal` says it in any. */
export type ParsedRecipeEntry =
  | { readonly ok: true; readonly entry: RecipeEntry; readonly sig: string }
  | { readonly ok: false; readonly reason: string; readonly refusal: RecipeTemplateRefusal }

export type ParsedRecipeTemplate =
  | { readonly ok: true; readonly template: RecipeTemplate; readonly sig: string }
  | { readonly ok: false; readonly reason: string; readonly refusal: RecipeTemplateRefusal }

export type ParsedRecipe =
  | { readonly ok: true; readonly recipe: Recipe; readonly sig: string }
  | { readonly ok: false; readonly reason: string; readonly refusal: RecipeTemplateRefusal }

// ── refusals ────────────────────────────────────────────────────────────────

/** Every refusal, in English, with {holes} for what it names. Each is the fallback of `recipe.template.refusal.<code>`. */
const REFUSALS = Object.freeze({
  notBytes: 'it is not bytes',
  tooLarge: 'it is larger than {kb} KB',
  notUtf8: 'it is not UTF-8',
  notJson: 'it is not JSON',
  forbiddenKey: 'the key "{key}" is not allowed anywhere in it',
  repeatedKey: 'it repeats the key "{key}", so two readers could see two documents',
  sigMismatch: 'its bytes do not match the signature they were held under',
  notObject: 'it is not a JSON object',
  version: 'it does not say "{key}": 1, the one version this reader knows',
  notText: '"{field}" must be text',
  empty: '"{field}" is empty',
  tooLong: '"{field}" is longer than {max} characters',
  notOneLine: '"{field}" has a line break, control characters or direction overrides in it',
  notProse: '"{field}" has control characters or direction overrides in it',
  notList: '"{field}" must be a list',
  tooMany: '"{field}" holds more than {max}',
  unknownField: 'it has an unknown field "{key}"',
  sectionUnknownField: 'section {n} has an unknown field "{key}"',
  valueUnknownField: 'the value {value} has an unknown field "{key}"',
  itemUnknownField: '{field} has an unknown field "{key}"',
  sectionNotObject: 'section {n} is not an object',
  sectionKey: "section {n}'s key must be lowercase letters, digits, - or _ (up to 40), starting with a letter",
  sharedKey: 'two sections share the key "{key}"',
  sectionKind: 'the section {key} has no kind this format knows ({kinds})',
  fieldsNotFacts: 'only a facts section suggests fields: {key}',
  noSections: 'it has no sections: a template arranges at least one',
  valueNotObject: 'the value {key} is not an object',
  valueKind: 'the value {key} has no kind this format knows ({kinds})',
  itemNotObject: '{field} is not an object',
  itemNotSignature: '{field} is not a signature (64 lowercase hex)',
  minutes: '{field} must be a number from 0 to {max}',
  itemEmpty: '{field} is empty',
  notLink: '{field} is not an http or https link',
  notSignature: '"{field}" must be a signature (64 lowercase hex)',
  valuesNotObject: '"values" must be an object (it may be empty)',
  tooManyValues: 'it holds more than {max} values',
  valueKey: "a value's key must be lowercase letters, digits, - or _ (up to 40), starting with a letter: {key}",
  unread: 'it could not be read',
})

const fill = (text: string, params: Readonly<Record<string, string | number>>): string =>
  text.replace(/\{(\w+)\}/g, (hole, name: string) => (name in params ? String(params[name]) : hole))

const refusalOf = (code: RecipeTemplateRefusalCode, params: Readonly<Record<string, string | number>> = {}): RecipeTemplateRefusal =>
  Object.freeze({ code, key: `recipe.template.refusal.${code}`, params: Object.freeze({ ...params }) })

/** How a reader says a key in its own language: the fallback, its {holes} filled, when it knows no better. */
export type RecipeTemplateSay = (key: string, fallback: string, params?: Record<string, string | number>) => string

/** The shell's catalogue, when it is up. A key it does not know is echoed back, and then the English is used. */
const catalogue: RecipeTemplateSay = (key, fallback, params) => {
  let said: string | undefined
  try { said = get<I18nProvider>(I18N_IOC_KEY)?.t(key, params) } catch { said = undefined }
  return said && said !== key ? said : fallback
}

/** A refusal in the reader's language, through its own `say` (the shell's catalogue by default); the English sentence when neither knows it. */
export function recipeTemplateRefusalWords(refusal: RecipeTemplateRefusal, say: RecipeTemplateSay = catalogue): string {
  const english = fill(REFUSALS[refusal.code], refusal.params)
  let said = ''
  try { said = say(refusal.key, REFUSALS[refusal.code], { ...refusal.params }) } catch { said = '' }
  return said && said !== refusal.key ? fill(said, refusal.params) : english
}

// ── reading ─────────────────────────────────────────────────────────────────

const SIG = /^[a-f0-9]{64}$/
const KEY = /^[a-z][a-z0-9_-]{0,39}$/
// Every name an object already answers to, and `prototype`: refused as a key
// anywhere, so no lookup by name finds an inherited member where a section was meant.
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype'])
// Control characters, and the direction embeddings, overrides and isolates that
// make text read in one order and render in another.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const BIDI = /[‪-‮⁦-⁩]/
const KINDS: ReadonlySet<string> = new Set(RECIPE_SECTION_KINDS)
const TEMPLATE_KEYS: ReadonlySet<string> = new Set([RECIPE_TEMPLATE_KEY, 'name', 'description', 'sections'])
const SECTION_KEYS: ReadonlySet<string> = new Set(['key', 'kind', 'label', 'prompt', 'fields'])
const RECIPE_KEYS: ReadonlySet<string> = new Set([RECIPE_KEY, 'template', 'values'])
const ENTRY_KEYS: ReadonlySet<string> = new Set([RECIPE_ENTRY_KEY, 'name', 'recipe', 'cover'])

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
  readonly refusal: RecipeTemplateRefusal
  constructor(refusal: RecipeTemplateRefusal) {
    super(fill(REFUSALS[refusal.code], refusal.params))
    this.refusal = refusal
  }
}
// A declaration, not an arrow, so the compiler knows the code after a refusal is unreachable.
function refuse(code: RecipeTemplateRefusalCode, params: Readonly<Record<string, string | number>> = {}): never {
  throw new Refusal(refusalOf(code, params))
}

/** Bytes from any realm: a test runner's TextEncoder and its Uint8Array need not be the same class. */
const isBytes = (value: unknown): value is Uint8Array =>
  value instanceof Uint8Array || Object.prototype.toString.call(value) === '[object Uint8Array]'

/** JSON with every key checked as it is read: a forbidden key refuses the whole document. */
function parseJson(text: string): unknown {
  return JSON.parse(text, function reviver(key: string, value: unknown) {
    if (FORBIDDEN_KEYS.has(key)) refuse('forbiddenKey', { key })
    return value
  })
}

/**
 * The first key an object repeats, or null. JSON.parse keeps the last of two,
 * and a reader of the bytes may see the first. Only called on text JSON.parse
 * accepted, so strings are well formed.
 */
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

/** One line of text: no line break, no control character, no direction override. */
const line = (value: unknown, field: string, max: number, required: boolean): string | undefined => {
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string') return refuse('notText', { field })
  if (required && !value.trim()) refuse('empty', { field })
  if (value.length > max) refuse('tooLong', { field, max })
  if (CONTROL.test(value) || /[\r\n]/.test(value) || BIDI.test(value)) refuse('notOneLine', { field })
  return value
}

/** Text that may run over lines: line feeds and tabs only. */
const prose = (value: unknown, field: string, max: number): string => {
  if (typeof value !== 'string') return refuse('notText', { field })
  if (value.length > max) refuse('tooLong', { field, max })
  if (CONTROL.test(value) || value.includes('\r') || BIDI.test(value)) refuse('notProse', { field })
  return value
}

/** Where an unknown field was found: the document, a section by number, a value by key, or an item by its path. */
type Where = { readonly section: number } | { readonly value: string } | { readonly item: string } | null

const onlyKeys = (value: Record<string, unknown>, allowed: ReadonlySet<string>, where: Where): void => {
  for (const name of Object.keys(value)) {
    if (allowed.has(name)) continue
    const key = clip(name)
    if (!where) refuse('unknownField', { key })
    if ('section' in where) refuse('sectionUnknownField', { n: where.section, key })
    if ('value' in where) refuse('valueUnknownField', { value: where.value, key })
    refuse('itemUnknownField', { field: where.item, key })
  }
}

const list = (value: unknown, field: string, max: number): unknown[] => {
  if (!Array.isArray(value)) return refuse('notList', { field })
  if (value.length > max) refuse('tooMany', { field, max })
  return value
}

/** The normalized address of a link, or null: http or https, parsed, with no `user:pass@` to dress one host up as another. */
export function recipeLinkUrl(candidate: string): string | null {
  const value = String(candidate ?? '').trim()
  if (!value || value.length > L.url || !/^https?:\/\//i.test(value) || /[\s<>"`]/.test(value) || CONTROL.test(value) || BIDI.test(value)) return null
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname || url.username || url.password) return null
  return url.href
}

function readSection(value: unknown, at: number, seen: Set<string>): RecipeSection {
  if (!isPlainObject(value)) return refuse('sectionNotObject', { n: at + 1 })
  onlyKeys(value, SECTION_KEYS, { section: at + 1 })
  const key = value['key']
  if (typeof key !== 'string' || !KEY.test(key) || FORBIDDEN_KEYS.has(key)) refuse('sectionKey', { n: at + 1 })
  if (seen.has(key as string)) refuse('sharedKey', { key: key as string })
  seen.add(key as string)
  const kind = value['kind']
  if (typeof kind !== 'string' || !KINDS.has(kind)) refuse('sectionKind', { key: key as string, kinds: RECIPE_SECTION_KINDS.join(', ') })
  const label = line(value['label'], `${key as string}.label`, L.label, true) as string
  const prompt = line(value['prompt'], `${key as string}.prompt`, L.prompt, false)
  let fields: string[] | undefined
  if (value['fields'] !== undefined) {
    if (kind !== 'facts') refuse('fieldsNotFacts', { key: key as string })
    fields = list(value['fields'], `${key as string}.fields`, L.fields).map((field, i) => line(field, `${key as string}.fields[${i}]`, L.factLabel, true) as string)
  }
  return Object.freeze({
    key: key as string,
    kind: kind as RecipeSectionKind,
    label,
    ...(prompt !== undefined ? { prompt } : {}),
    ...(fields !== undefined ? { fields: Object.freeze(fields) } : {}),
  })
}

function readTemplateDocument(doc: unknown, sig: string): RecipeTemplate {
  if (!isPlainObject(doc)) return refuse('notObject')
  onlyKeys(doc, TEMPLATE_KEYS, null)
  if (doc[RECIPE_TEMPLATE_KEY] !== 1) refuse('version', { key: RECIPE_TEMPLATE_KEY })
  const name = line(doc['name'], 'name', L.name, true) as string
  const description = line(doc['description'], 'description', L.description, false)
  const raw = list(doc['sections'], 'sections', L.sections)
  if (!raw.length) refuse('noSections')
  const seen = new Set<string>()
  const sections = raw.map((section, at) => readSection(section, at, seen))
  return Object.freeze({ sig, name, ...(description !== undefined ? { description } : {}), sections: Object.freeze(sections) })
}

function readValue(key: string, value: unknown): RecipeValue {
  if (!isPlainObject(value)) return refuse('valueNotObject', { key })
  const kind = value['kind']
  const where: Where = { value: key }
  switch (kind) {
    case 'text': {
      onlyKeys(value, new Set(['kind', 'text']), where)
      return Object.freeze({ kind, text: prose(value['text'], `${key}.text`, L.text) })
    }
    case 'ingredients': {
      onlyKeys(value, new Set(['kind', 'items']), where)
      const items = list(value['items'], `${key}.items`, L.ingredients).map((item, i): RecipeIngredient => {
        if (!isPlainObject(item)) return refuse('itemNotObject', { field: `${key}.items[${i}]` })
        onlyKeys(item, new Set(['amount', 'item', 'note']), { item: `${key}.items[${i}]` })
        const amount = line(item['amount'], `${key}.items[${i}].amount`, L.amount, false)
        const note = line(item['note'], `${key}.items[${i}].note`, L.note, false)
        return Object.freeze({
          ...(amount !== undefined ? { amount } : {}),
          item: line(item['item'], `${key}.items[${i}].item`, L.item, true) as string,
          ...(note !== undefined ? { note } : {}),
        })
      })
      return Object.freeze({ kind, items: Object.freeze(items) })
    }
    case 'steps': {
      onlyKeys(value, new Set(['kind', 'steps']), where)
      const steps = list(value['steps'], `${key}.steps`, L.steps).map((step, i): RecipeStep => {
        if (!isPlainObject(step)) return refuse('itemNotObject', { field: `${key}.steps[${i}]` })
        onlyKeys(step, new Set(['text', 'picture', 'minutes']), { item: `${key}.steps[${i}]` })
        const picture = step['picture']
        if (picture !== undefined && (typeof picture !== 'string' || !SIG.test(picture))) refuse('itemNotSignature', { field: `${key}.steps[${i}].picture` })
        const minutes = step['minutes']
        if (minutes !== undefined && (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0 || minutes > L.minutes)) refuse('minutes', { field: `${key}.steps[${i}].minutes`, max: L.minutes })
        const text = prose(step['text'], `${key}.steps[${i}].text`, L.step)
        if (!text.trim()) refuse('itemEmpty', { field: `${key}.steps[${i}].text` })
        return Object.freeze({
          text,
          ...(picture !== undefined ? { picture: picture as string } : {}),
          ...(minutes !== undefined ? { minutes: minutes as number } : {}),
        })
      })
      return Object.freeze({ kind, steps: Object.freeze(steps) })
    }
    case 'pictures': {
      onlyKeys(value, new Set(['kind', 'pictures']), where)
      const pictures = list(value['pictures'], `${key}.pictures`, L.pictures).map((picture, i) => {
        if (typeof picture !== 'string' || !SIG.test(picture)) return refuse('itemNotSignature', { field: `${key}.pictures[${i}]` })
        return picture
      })
      return Object.freeze({ kind, pictures: Object.freeze([...new Set(pictures)]) })
    }
    case 'links': {
      onlyKeys(value, new Set(['kind', 'links']), where)
      const links = list(value['links'], `${key}.links`, L.links).map((link, i): RecipeLink => {
        if (!isPlainObject(link)) return refuse('itemNotObject', { field: `${key}.links[${i}]` })
        onlyKeys(link, new Set(['url', 'label']), { item: `${key}.links[${i}]` })
        const url = typeof link['url'] === 'string' ? recipeLinkUrl(link['url']) : null
        if (!url) return refuse('notLink', { field: `${key}.links[${i}].url` })
        const label = line(link['label'], `${key}.links[${i}].label`, L.label, false)
        return Object.freeze({ url, ...(label !== undefined ? { label } : {}) })
      })
      return Object.freeze({ kind, links: Object.freeze(links) })
    }
    case 'facts': {
      onlyKeys(value, new Set(['kind', 'facts']), where)
      const facts = list(value['facts'], `${key}.facts`, L.facts).map((fact, i): RecipeFact => {
        if (!isPlainObject(fact)) return refuse('itemNotObject', { field: `${key}.facts[${i}]` })
        onlyKeys(fact, new Set(['label', 'value']), { item: `${key}.facts[${i}]` })
        return Object.freeze({
          label: line(fact['label'], `${key}.facts[${i}].label`, L.factLabel, true) as string,
          value: line(fact['value'], `${key}.facts[${i}].value`, L.factValue, true) as string,
        })
      })
      return Object.freeze({ kind, facts: Object.freeze(facts) })
    }
    default:
      return refuse('valueKind', { key, kinds: RECIPE_SECTION_KINDS.join(', ') })
  }
}

function readRecipeDocument(doc: unknown, sig: string): Recipe {
  if (!isPlainObject(doc)) return refuse('notObject')
  onlyKeys(doc, RECIPE_KEYS, null)
  if (doc[RECIPE_KEY] !== 1) refuse('version', { key: RECIPE_KEY })
  const template = doc['template']
  if (template !== undefined && (typeof template !== 'string' || !SIG.test(template))) refuse('notSignature', { field: 'template' })
  const raw = doc['values']
  if (!isPlainObject(raw)) return refuse('valuesNotObject')
  const keys = Object.keys(raw)
  if (keys.length > L.sections * 2) refuse('tooManyValues', { max: L.sections * 2 })
  const values: Record<string, RecipeValue> = {}
  for (const key of keys) {
    if (!KEY.test(key) || FORBIDDEN_KEYS.has(key)) refuse('valueKey', { key: clip(key) })
    values[key] = readValue(key, raw[key])
  }
  return Object.freeze({ sig, ...(template !== undefined ? { template: template as string } : {}), values: Object.freeze(values) })
}

function readEntryDocument(doc: unknown, sig: string): RecipeEntry {
  if (!isPlainObject(doc)) return refuse('notObject')
  onlyKeys(doc, ENTRY_KEYS, null)
  if (doc[RECIPE_ENTRY_KEY] !== 1) refuse('version', { key: RECIPE_ENTRY_KEY })
  const name = line(doc['name'], 'name', L.name, true) as string
  const recipe = doc['recipe']
  if (typeof recipe !== 'string' || !SIG.test(recipe)) refuse('notSignature', { field: 'recipe' })
  const cover = doc['cover']
  if (cover !== undefined && (typeof cover !== 'string' || !SIG.test(cover))) refuse('notSignature', { field: 'cover' })
  return Object.freeze({ sig, name, recipe: recipe as string, ...(cover !== undefined ? { cover: cover as string } : {}) })
}

async function read<T>(bytes: Uint8Array, expectedSig: string | undefined, limit: number, shape: (doc: unknown, sig: string) => T): Promise<{ ok: true; value: T; sig: string } | { ok: false; reason: string; refusal: RecipeTemplateRefusal }> {
  try {
    if (!isBytes(bytes)) refuse('notBytes')
    if (bytes.length > limit) refuse('tooLarge', { kb: limit / 1024 })
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { return refuse('notUtf8') }
    let doc: unknown
    try { doc = parseJson(text) } catch (error) { if (error instanceof Refusal) throw error; return refuse('notJson') }
    const repeated = repeatedKey(text)
    if (repeated !== null) refuse('repeatedKey', { key: clip(repeated) })
    const sig = await sha256Hex(bytes)
    if (expectedSig !== undefined && sig !== expectedSig) refuse('sigMismatch')
    return { ok: true, value: shape(doc, sig), sig }
  } catch (error) {
    const refusal = error instanceof Refusal ? error.refusal : refusalOf('unread')
    return { ok: false, reason: recipeTemplateRefusalWords(refusal), refusal }
  }
}

/**
 * Read a template from its bytes. Strict: anything this format does not say is
 * refused with a reason, never dropped. Pass the signature the bytes were held
 * under and a mismatch is refused too (S3). Never throws.
 */
export async function parseRecipeTemplate(bytes: Uint8Array, expectedSig?: string): Promise<ParsedRecipeTemplate> {
  const out = await read(bytes, expectedSig, L.templateBytes, readTemplateDocument)
  return out.ok ? { ok: true, template: out.value, sig: out.sig } : out
}

/** Read a recipe from its bytes, as strictly. Never throws. */
export async function parseRecipe(bytes: Uint8Array, expectedSig?: string): Promise<ParsedRecipe> {
  const out = await read(bytes, expectedSig, L.recipeBytes, readRecipeDocument)
  return out.ok ? { ok: true, recipe: out.value, sig: out.sig } : out
}

/** Read an entry from its bytes, as strictly. Never throws. */
export async function parseRecipeEntry(bytes: Uint8Array, expectedSig?: string): Promise<ParsedRecipeEntry> {
  const out = await read(bytes, expectedSig, L.entryBytes, readEntryDocument)
  return out.ok ? { ok: true, entry: out.value, sig: out.sig } : out
}

// ── writing ─────────────────────────────────────────────────────────────────

/**
 * The canonical bytes of a template: fields in one order, sections in the order
 * the author gave them, no whitespace. One template is one signature (I1). It
 * checks nothing; `parseRecipeTemplate` does.
 */
export function recipeTemplateBytes(doc: RecipeTemplateDocument): Uint8Array {
  return utf8.encode(JSON.stringify({
    [RECIPE_TEMPLATE_KEY]: 1,
    name: doc.name,
    ...(doc.description !== undefined ? { description: doc.description } : {}),
    sections: doc.sections.map(section => ({
      key: section.key,
      kind: section.kind,
      label: section.label,
      ...(section.prompt !== undefined ? { prompt: section.prompt } : {}),
      ...(section.fields !== undefined ? { fields: [...section.fields] } : {}),
    })),
  }))
}

const valueOut = (value: RecipeValue): unknown => {
  switch (value.kind) {
    case 'text': return { kind: value.kind, text: value.text }
    case 'ingredients': return { kind: value.kind, items: value.items.map(i => ({
      ...(i.amount !== undefined ? { amount: i.amount } : {}), item: i.item, ...(i.note !== undefined ? { note: i.note } : {}) })) }
    case 'steps': return { kind: value.kind, steps: value.steps.map(s => ({
      text: s.text, ...(s.picture !== undefined ? { picture: s.picture } : {}), ...(s.minutes !== undefined ? { minutes: s.minutes } : {}) })) }
    case 'pictures': return { kind: value.kind, pictures: [...value.pictures] }
    case 'links': return { kind: value.kind, links: value.links.map(l => ({ url: l.url, ...(l.label !== undefined ? { label: l.label } : {}) })) }
    case 'facts': return { kind: value.kind, facts: value.facts.map(f => ({ label: f.label, value: f.value })) }
  }
}

/**
 * The canonical bytes of a recipe: values in key order, so the same recipe is
 * the same signature however it was typed in. Empty values are left out: an
 * unanswered section is not content.
 */
export function recipeBytes(doc: RecipeDocument): Uint8Array {
  const values: Record<string, unknown> = {}
  for (const key of Object.keys(doc.values).sort()) {
    const value = doc.values[key]
    if (value && !isEmptyRecipeValue(value)) values[key] = valueOut(value)
  }
  return utf8.encode(JSON.stringify({
    [RECIPE_KEY]: 1,
    ...(doc.template !== undefined ? { template: doc.template } : {}),
    values,
  }))
}

/** The canonical bytes of an entry: fields in one order, so the same tile offering the same recipe is one row. */
export function recipeEntryBytes(doc: RecipeEntryDocument): Uint8Array {
  return utf8.encode(JSON.stringify({
    [RECIPE_ENTRY_KEY]: 1,
    name: doc.name,
    recipe: doc.recipe,
    ...(doc.cover !== undefined ? { cover: doc.cover } : {}),
  }))
}

/** The picture a recipe is known by: its first picture, else its first step's. */
export function recipeCover(recipe: Pick<RecipeDocument, 'values'>): string | undefined {
  for (const key of Object.keys(recipe.values).sort()) {
    const value = recipe.values[key]
    if (value?.kind === 'pictures' && value.pictures[0]) return value.pictures[0]
  }
  for (const key of Object.keys(recipe.values).sort()) {
    const value = recipe.values[key]
    if (value?.kind === 'steps') for (const step of value.steps) if (step.picture) return step.picture
  }
  return undefined
}

// ── using one through another ───────────────────────────────────────────────

/** A value with nothing in it yet, of a section's kind. */
export function emptyRecipeValue(kind: RecipeSectionKind): RecipeValue {
  switch (kind) {
    case 'text': return { kind, text: '' }
    case 'ingredients': return { kind, items: [] }
    case 'steps': return { kind, steps: [] }
    case 'pictures': return { kind, pictures: [] }
    case 'links': return { kind, links: [] }
    case 'facts': return { kind, facts: [] }
  }
}

export function isEmptyRecipeValue(value: RecipeValue): boolean {
  switch (value.kind) {
    case 'text': return !value.text.trim()
    case 'ingredients': return value.items.length === 0
    case 'steps': return value.steps.length === 0
    case 'pictures': return value.pictures.length === 0
    case 'links': return value.links.length === 0
    case 'facts': return value.facts.length === 0
  }
}

export interface RecipeProjectedSection {
  readonly section: RecipeSection
  readonly value: RecipeValue
  /** True for a value the template has no section for: kept, and shown after the template's own. */
  readonly kept?: true
}

/**
 * A key said as words, for a value no section names: `swaps` is "Swaps", and
 * `make-ahead`, `make_ahead` and `makeAhead` are all "Make ahead".
 */
export function recipeKeyWords(key: string): string {
  const raw = String(key ?? '')
  const words = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_\s]+/g, ' ').trim().toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : raw
}

/**
 * A recipe seen through a template: the template's sections in its order, each
 * with the recipe's value of the same key and kind (or an empty one), then every
 * value the template did not ask for, in key order, under its own key. Nothing
 * a cook wrote is ever left out by choosing another template.
 */
export function projectRecipe(template: Pick<RecipeTemplateDocument, 'sections'>, recipe: Pick<RecipeDocument, 'values'>): RecipeProjectedSection[] {
  const used = new Set<string>()
  const out: RecipeProjectedSection[] = template.sections.map(section => {
    const held = recipe.values[section.key]
    if (held && held.kind === section.kind) { used.add(section.key); return { section, value: held } }
    return { section, value: emptyRecipeValue(section.kind) }
  })
  for (const key of Object.keys(recipe.values).sort()) {
    const value = recipe.values[key]
    if (!value || used.has(key) || isEmptyRecipeValue(value)) continue
    out.push({ section: { key, kind: value.kind, label: recipeKeyWords(key) }, value, kept: true })
  }
  return out
}

/**
 * The layout a recipe is showing, as a template of its own: "save as template".
 * The sections and what they ask, never the cook's words (A1: the template is
 * one artifact that stands alone).
 */
export function recipeTemplateFrom(name: string, sections: readonly RecipeSection[], description?: string): RecipeTemplateDocument {
  return {
    name,
    ...(description ? { description } : {}),
    sections: sections.map(section => ({
      key: section.key,
      kind: section.kind,
      label: section.label,
      ...(section.prompt !== undefined ? { prompt: section.prompt } : {}),
      ...(section.fields !== undefined ? { fields: [...section.fields] } : {}),
    })),
  }
}

/** Every signature a recipe names: its template and its pictures. What a reader must hold to show all of it. */
export function recipeSignatures(recipe: RecipeDocument): string[] {
  const out = new Set<string>()
  if (recipe.template) out.add(recipe.template)
  for (const value of Object.values(recipe.values)) {
    if (value.kind === 'pictures') for (const picture of value.pictures) out.add(picture)
    if (value.kind === 'steps') for (const step of value.steps) if (step.picture) out.add(step.picture)
  }
  return [...out]
}

/** What a search reads of a template: its name, what it is for, and what its sections are called. */
export function recipeTemplateWords(template: RecipeTemplateDocument): string {
  return [template.name, template.description ?? '', ...template.sections.flatMap(s => [s.label, s.prompt ?? ''])].join(' ').toLowerCase()
}

// ── reading along ───────────────────────────────────────────────────────────

export type RecipePage =
  | { readonly kind: 'cover'; readonly picture?: string; readonly facts: readonly RecipeFact[] }
  | { readonly kind: 'text'; readonly label: string; readonly text: string }
  | { readonly kind: 'ingredients'; readonly label: string; readonly items: readonly RecipeIngredient[] }
  | { readonly kind: 'step'; readonly label: string; readonly at: number; readonly of: number; readonly step: RecipeStep }
  | { readonly kind: 'pictures'; readonly label: string; readonly pictures: readonly string[] }
  | { readonly kind: 'links'; readonly label: string; readonly links: readonly RecipeLink[] }

/**
 * The read-along: one page at a time, in the template's order. A cover (the
 * first picture and the facts), then each section that holds something, with
 * every step a page of its own so a cook reads one thing and does it. Empty
 * sections make no page.
 */
export function recipePages(projected: readonly RecipeProjectedSection[]): RecipePage[] {
  const facts: RecipeFact[] = []
  let picture: string | undefined
  for (const { value } of projected) {
    if (value.kind === 'facts') facts.push(...value.facts)
    if (!picture && value.kind === 'pictures') picture = value.pictures[0]
  }
  const pages: RecipePage[] = [{ kind: 'cover', ...(picture ? { picture } : {}), facts }]
  for (const { section, value } of projected) {
    if (isEmptyRecipeValue(value)) continue
    switch (value.kind) {
      case 'text': pages.push({ kind: 'text', label: section.label, text: value.text }); break
      case 'ingredients': pages.push({ kind: 'ingredients', label: section.label, items: value.items }); break
      case 'steps': value.steps.forEach((step, at) => pages.push({ kind: 'step', label: section.label, at, of: value.steps.length, step })); break
      case 'pictures': if (value.pictures.length > 1 || value.pictures[0] !== picture) pages.push({ kind: 'pictures', label: section.label, pictures: value.pictures }); break
      case 'links': pages.push({ kind: 'links', label: section.label, links: value.links }); break
      case 'facts': break
    }
  }
  return pages
}
