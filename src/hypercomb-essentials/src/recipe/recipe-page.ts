// recipe/recipe-page.ts
//
// THE RECIPE DESK: the DOM a cook writes a recipe on and reads along from. It
// is a drawing of ONE dish, in the tile editor's language
// (documentation/tile-editor.md): no stacked form, no scrolling page of fields.
//
//   WRITE    the plate, large, in the middle of a stage. Every section of the
//            template (N4: a layout and its fill) is a quiet TAB beside it: its
//            label, a few words of what it holds, and a thin leader to a dot on
//            the plate. An ingredients section is drawn as its INGREDIENTS, one
//            small label each, pointing into the dish. Pressing a tab opens
//            that one part as a CARD down the middle; the drawing behind keeps
//            up with what is typed. A value the template has no section for is
//            a tab too, after a divider: choosing another layout never drops
//            what a cook wrote (H2).
//   ARRANGE  the layout itself, in the same drawing: each tab is its name as a
//            field, with earlier, later and remove. It changes the template and
//            nothing else.
//   READ     the read-along: one page at a time, large type, a step a page.
//
// ON A TABLE SET (recipe-setting.ts) the plate is a photographed table: its
// bare table, each plate's layer over it, the utensils over those, one box at
// the set's own aspect where the plate was. The sections sit on its plates in
// order, each seated plate wearing a place card laid flat into the photograph
// (its section's label and what it holds), each tab's leader running to its
// plate's floor, and an ingredients section's labels to points across its
// plate. Pressing a plate opens its card, as its tab does. The plates are only
// the surface: no food is drawn on them. A set whose pictures do not arrive is
// the drawn plate again. The "Table" control beside the template button
// chooses the set, brings one in, or goes back to the drawn plate.
//
// PURE DOM. No IoC, no store, no network, no EffectBus, no registration.
// Everything it needs arrives in its options and everything it does leaves
// through a callback: the recipe drone mounts it, stores pictures and saves.
// What is where on the stage is arithmetic kept in recipe-desk.ts; this file
// measures the boxes and draws what that arithmetic answers (V1).
//
// THE DOCUMENT IS ALWAYS ONE THE READER ACCEPTS. A row a cook has not finished
// (an ingredient with no item, a step with no words, an address that is not a
// link) lives in the fields only. `recipe()` and `onChange` carry what
// `parseRecipe` reads back, and every edit is a new document (I1).
//
// TEXT ONLY, AND NOBODY IS CONTACTED (T7). Words reach the page through
// textContent and field values, a picture is a signature the caller resolves
// (I2), and a link is a plain anchor that is never embedded and never fetched.

import {
  RECIPE_LIMITS,
  RECIPE_SECTION_KINDS,
  isEmptyRecipeValue,
  projectRecipe,
  recipeLinkUrl,
  recipePages,
  recipeTemplateFrom,
  type RecipeDocument,
  type RecipePage,
  type RecipeProjectedSection,
  type RecipeSection,
  type RecipeSectionKind,
  type RecipeTemplateDocument,
  type RecipeValue,
} from './recipe-template.js'
import {
  ensureRecipeStyles,
  recipeBulb,
  recipeEl,
  recipeMark,
  recipePlate,
  recipePlateMark,
  recipeSvg,
  recipeWords,
  type RecipeMarkName,
  type RecipeSay,
} from './recipe-style.js'
import {
  recipeDeskCallouts,
  recipeDeskFit,
  recipeDeskFloorSpread,
  recipeDeskLeaders,
  recipeDeskPlatesOf,
  recipeDeskSeats,
  recipeDeskSetLeaders,
  recipeDeskSetSeats,
  RECIPE_DESK,
  recipeLinkIsVideo,
  recipeSectionSummary,
  type RecipeDeskFit,
  type RecipeDeskLeader,
  type RecipeDeskSetTab,
  type RecipeDeskTab,
} from './recipe-desk.js'
import { floorMatrix, recipeFloorBox, recipeFloorInset, type RecipeSettingDocument, type RecipeSettingPoint } from './recipe-setting.js'

/** Where this recipe is offered, said beside the light-bulb switch. */
export interface RecipeShared {
  readonly lit: boolean
  readonly words: string
  readonly tone?: 'plain' | 'good' | 'warn'
}

/** One row of the list on the left: a tile on the page this recipe's tile sits on. */
export interface RecipeTileRow {
  readonly label: string
  readonly hasRecipe: boolean
  readonly current: boolean
}

/** One extra action a read-only page offers, as its one filled button. */
export interface RecipePageAction {
  readonly label: string
  readonly onPress: () => void
}

/** One table set the Table control offers. */
export interface RecipeSettingChoice {
  readonly sig: string
  readonly name: string
  /** Kept on this hive, or offered by a followed host and kept only when it is chosen. */
  readonly from: 'kept' | 'community'
  /** The host that offers a community set. */
  readonly host?: string
}

/** What the Table control lists. */
export interface RecipeSettingMenu {
  readonly choices: readonly RecipeSettingChoice[]
  /** The set the desk sits on, by signature; '' for the drawn plate. */
  readonly current: string
  /** The followed hosts are still being asked what they offer. */
  readonly asking?: boolean
}

/** What the Table control asks of its caller. Without it there is no Table control. */
export interface RecipeTableActions {
  /** The control's list opened: the moment to ask the community. */
  open?(): void
  /** A set was chosen, or none (null): the drawn plate. */
  choose(choice: RecipeSettingChoice | null): void
  /** A kept set's remove press: take it off this hive's list. Without it the kept sets have no remove press. */
  remove?(choice: RecipeSettingChoice): void
  /** Files were chosen to bring a set in: a setting.json and the pictures it names. */
  add(files: readonly File[]): void
}

/** What a page that is written on tells its caller, and asks of it. A page that only reads never calls any of them. */
export interface RecipePageWriting {
  /** Every edit. The caller debounces the save. */
  onChange(recipe: RecipeDocument): void
  /** Arrange changed the layout or its name. */
  onLayout(template: RecipeTemplateDocument): void
  /** Store pictures and answer their signatures, in order. It may answer fewer. */
  takePictures(files: readonly Blob[]): Promise<readonly string[]>
}

/** What every page is given, written on or only read. */
export interface RecipePageShown {
  /** The tile's name: the recipe's title. */
  title: string
  recipe: RecipeDocument
  /** The layout being shown. */
  template: RecipeTemplateDocument
  /** Default 'write'. */
  mode?: 'write' | 'read'
  say: RecipeSay
  /** The src of a picture held by signature. */
  pictureUrl(sig: string): string
  /** Read pictures from the clipboard on a press. Without it there is no "Paste picture". */
  clipboardPictures?(): Promise<readonly Blob[]>
  /** The template button was pressed. Without it there is no template button: nothing can be picked. */
  onPickTemplate?(): void
  onKeepTemplate?(): void
  /** The name and the cover picture live on the tile. */
  onEditTile?(): void
  /** The cook changed the mode. */
  onMode?(mode: 'write' | 'read'): void
  onClose(): void
  /** The quiet route shown after the title, e.g. "/recipes/sunday-soup". */
  address?: string
  /** The list on the left: the tiles on the page this recipe's tile sits on. */
  tiles?: readonly RecipeTileRow[]
  /** A row of that list was chosen. */
  onPickTile?(label: string): void
  /** Where this recipe is offered, said in the header beside a light-bulb switch. */
  shared?: RecipeShared
  /** The bulb was pressed: light or unlight this tile. */
  onToggleShared?(): void
  /** "Browse": see what your nodes offer. */
  onBrowse?(): void
  /** One filled extra action in the header of a READ-ONLY page. */
  primaryAction?: RecipePageAction
  /** The table set the desk sits on; its pictures come through `pictureUrl`. Absent or null: the drawn plate. */
  setting?: RecipeSettingDocument | null
  /** What the Table control lists. */
  settings?: RecipeSettingMenu
  /** The Table control's actions. Without them there is no Table control. */
  table?: RecipeTableActions
}

/**
 * `readOnly` true is a visitor's page: no editing at all, read mode only. A
 * page that may be written on is given every callback of the writing; only a
 * page said to be read-only where it is made may leave them out.
 */
export type RecipePageOptions =
  | (RecipePageShown & RecipePageWriting & { readOnly?: boolean })
  | (RecipePageShown & Partial<RecipePageWriting> & { readOnly: true })

export interface RecipePageHandle {
  readonly element: HTMLElement
  /**
   * Replace what is shown. With the recipe alone it is the SAME recipe shown
   * again (an undo, a save echoed back): focus, scroll, the open card, the
   * read-along's page and the pictures still being stored are all kept.
   * `fresh` says ANOTHER recipe is on the desk now (the cook chose another
   * tile): it opens as its drawing or on its first page with nothing ticked,
   * and pictures still being stored for the recipe that left are not put in it.
   */
  setRecipe(recipe: RecipeDocument, how?: { readonly fresh?: boolean }): void
  /** The same recipe through another layout. */
  setTemplate(template: RecipeTemplateDocument): void
  setTitle(title: string): void
  setMode(mode: 'write' | 'read'): void
  mode(): 'write' | 'read'
  /** A quiet line in the header: "Saved", "Could not save: ...". */
  setStatus(words: string, tone?: 'plain' | 'good' | 'bad'): void
  /** The current values. */
  recipe(): RecipeDocument
  /** The rows of the list on the left. None: no list, and the stage takes the room. */
  setTiles(tiles: readonly RecipeTileRow[]): void
  /** Where the recipe is offered now. Undefined: no bulb. */
  setShared(shared: RecipeShared | undefined): void
  setAddress(address: string): void
  /** The table set the desk sits on now. Null: the drawn plate. */
  setSetting(setting: RecipeSettingDocument | null): void
  /** What the Table control lists now. */
  setSettings(menu: RecipeSettingMenu): void
  /** Resolves once no picture is still being stored: a caller waits on it before it saves and hands the desk on, so the pictures are in the recipe they were chosen for. */
  settled(): Promise<void>
  dispose(): void
}

const L = RECIPE_LIMITS
const SIG = /^[a-f0-9]{64}$/
/** What no field of the format may hold: control characters and the direction overrides. */
const UNSAFE = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f\\u202a-\\u202e\\u2066-\\u2069]', 'g')
/** The mark that opens a list line: a hyphen, a star, a bullet, a dash. */
const BULLET = '[-*\\u2022\\u00b7\\u2013\\u2014]'
/** Every name an object already answers to: never a section's key (the reader refuses them). */
const TAKEN_NAMES: ReadonlySet<string> = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype'])

// ── pure helpers ────────────────────────────────────────────────────────────

const FRACTION = '\\u00bc-\\u00be\\u2150-\\u215e'
const NUMBER = `(?:\\d+(?:[.,]\\d+)?(?:\\s+\\d+\\s*/\\s*\\d+|\\s*/\\s*\\d+|\\s*[${FRACTION}])?|[${FRACTION}])`
const UNITS = [
  'cups?', 'c', 'tablespoons?', 'tbsps?', 'tbs', 'teaspoons?', 'tsps?', 'kilograms?', 'kilos?', 'kg', 'grams?', 'g', 'mg',
  'millilitres?', 'milliliters?', 'ml', 'litres?', 'liters?', 'l', 'dl', 'cl', 'fl\\.?\\s*oz', 'ounces?', 'oz', 'pounds?', 'lbs?',
  'pinch(?:es)?', 'dash(?:es)?', 'drops?', 'cloves?', 'cans?', 'tins?', 'jars?', 'bottles?', 'bags?', 'packets?', 'packages?', 'pkgs?',
  'sticks?', 'slices?', 'pieces?', 'bunch(?:es)?', 'sprigs?', 'stalks?', 'heads?', 'handfuls?', 'knobs?', 'sheets?',
  'quarts?', 'qts?', 'pints?', 'pts?', 'gallons?', 'gal', 'cm', 'mm', 'inch(?:es)?',
]
const QUANTITY = new RegExp(
  `^(${NUMBER}(?:\\s*[-\\u2013\\u2014]\\s*${NUMBER}|\\s+to\\s+${NUMBER})?)(?:\\s*(${UNITS.join('|')})\\b\\.?|(?=\\s|$))\\s*(.*)$`,
  'i',
)

/**
 * One pasted line as an ingredient: a leading quantity ("2 cups", "1/2 tsp",
 * "200 g", "2-3") becomes the amount and the rest the item. A line with no
 * quantity is all item.
 */
export function splitIngredientLine(line: string): { amount?: string; item: string } {
  const text = String(line ?? '').replace(/\s+/g, ' ').trim().replace(new RegExp(`^${BULLET}\\s+`), '')
  const found = QUANTITY.exec(text)
  if (!found) return { item: text }
  const unit = found[2]
  const rest = found[3] ?? ''
  const item = (unit ? rest.replace(/^of\s+/i, '') : rest).trim()
  if (!item) return { item: text }
  const amount = text.slice(0, text.length - rest.length).trim().replace(/\.$/, '')
  return { amount, item }
}

/** Pasted text as steps: one a line, the numbering or bullet each line opened with taken off. */
export function splitStepLines(text: string): string[] {
  const opening = new RegExp(`^(?:\\(?(?:step\\s*)?\\d+\\s*[.):](?!\\d)\\s*|${BULLET}\\s+)`, 'i')
  return String(text ?? '').split(/\r\n|\r|\n/).map(line => line.trim().replace(opening, '').trim()).filter(Boolean)
}

/** A section key from its label: a slug the format accepts, unlike every key already taken. */
export function recipeSectionKey(label: string, taken: Iterable<string>): string {
  const held = new Set(taken)
  let base = String(label ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (!/^[a-z]/.test(base)) base = base ? `s-${base}` : 'section'
  base = base.slice(0, 40).replace(/-+$/, '')
  let key = base
  for (let n = 2; held.has(key) || TAKEN_NAMES.has(key); n++) {
    const tail = `-${n}`
    key = `${base.slice(0, 40 - tail.length).replace(/-+$/, '')}${tail}`
  }
  return key
}

const oneLine = (value: string, max: number): string =>
  value.replace(/[\r\n\t]+/g, ' ').replace(UNSAFE, '').trim().slice(0, max).trim()

const manyLines = (value: string, max: number): string =>
  value.replace(/\r\n?/g, '\n').replace(UNSAFE, '').slice(0, max)

/** What a cook typed as an address, as a link, or null. A bare "example.org/page" is taken as https. */
const linkOf = (typed: string): string | null => {
  const value = typed.trim()
  if (!value) return null
  if (/^[a-z][a-z0-9+.-]*:(?!\d+(?:\/|$))/i.test(value)) return recipeLinkUrl(value)
  return /^[^\s/]+\.[^\s/]+/.test(value) ? recipeLinkUrl(`https://${value}`) : null
}

const canon = (value: RecipeValue): string => {
  switch (value.kind) {
    case 'text': return value.text
    case 'ingredients': return JSON.stringify(value.items.map(i => [i.amount ?? '', i.item, i.note ?? '']))
    case 'steps': return JSON.stringify(value.steps.map(s => [s.text, s.picture ?? '', s.minutes ?? -1]))
    case 'pictures': return value.pictures.join(' ')
    case 'links': return JSON.stringify(value.links.map(l => [l.url, l.label ?? '']))
    case 'facts': return JSON.stringify(value.facts.map(f => [f.label, f.value]))
  }
}

/** Two values a reader could not tell apart. An empty one is the same as any other empty one of its kind. */
const sameValue = (a: RecipeValue, b: RecipeValue): boolean =>
  a.kind === b.kind && ((isEmptyRecipeValue(a) && isEmptyRecipeValue(b)) || canon(a) === canon(b))

const isPicture = (blob: Blob): boolean => typeof blob?.type === 'string' && blob.type.startsWith('image/')

/** The picture files a paste or a drop carries. */
const picturesIn = (data: DataTransfer | null | undefined): Blob[] => {
  if (!data) return []
  const files = Array.from(data.files ?? []).filter(isPicture)
  if (files.length) return files
  return Array.from(data.items ?? []).flatMap(item => {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) return []
    const file = item.getAsFile()
    return file ? [file] : []
  })
}

const pastedLines = (event: ClipboardEvent): string[] => {
  const data = event.clipboardData
  const text = data && typeof data.getData === 'function' ? data.getData('text/plain') : ''
  return text.split(/\r\n|\r|\n/).map(line => line.trim()).filter(Boolean)
}

// ── small DOM makers ────────────────────────────────────────────────────────

type Words = (key: string, fallback: string, params?: Record<string, string | number>) => string

function pressable(words: string, mark?: RecipeMarkName, className = 'hc-recipe-btn'): HTMLButtonElement {
  const button = recipeEl('button', className)
  button.type = 'button'
  if (mark) button.append(recipeMark(mark))
  button.append(recipeEl('span', 'hc-recipe-btn-words', words))
  return button
}

/** A button that shows only a mark. Its label says what it does. */
function tool(mark: RecipeMarkName, label: string, at?: string): HTMLButtonElement {
  const button = recipeEl('button', 'hc-recipe-tool')
  button.type = 'button'
  button.title = label
  button.setAttribute('aria-label', label)
  if (at) button.dataset['at'] = at
  button.append(recipeMark(mark))
  return button
}

function lineField(at: string, label: string, max: number, value: string, placeholder = label): HTMLInputElement {
  const input = recipeEl('input', 'hc-recipe-field')
  input.type = 'text'
  input.maxLength = max
  input.value = value
  input.placeholder = placeholder
  input.autocomplete = 'off'
  input.dataset['at'] = at
  input.setAttribute('aria-label', label)
  return input
}

const caretToEnd = (field: HTMLElement): void => {
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return
  try { field.setSelectionRange(field.value.length, field.value.length) } catch { /* a field with no caret */ }
}

/** A textarea as tall as what it holds. */
const grow = (area: HTMLTextAreaElement): void => {
  area.style.height = 'auto'
  if (area.scrollHeight) area.style.height = `${area.scrollHeight + area.offsetHeight - area.clientHeight}px`
}

// ── the editors, one per kind ───────────────────────────────────────────────

interface StepDraft { text: string; minutes: string; picture?: string; storing?: boolean }

interface Tools {
  readonly words: Words
  pictureUrl(sig: string): string
  tell(words: string, tone?: 'plain' | 'good' | 'bad'): void
  /** Open the file chooser. What is chosen lands on this step, or with the pictures. */
  choose(step?: StepDraft): void
  /** Read the clipboard for pictures, when the caller can. */
  readonly paste?: () => void
}

interface Editor {
  readonly body: HTMLElement
  /** What the document holds of this section: finished rows only. */
  value(): RecipeValue
  /** Show another value in place of what the fields held. */
  show(value: RecipeValue): void
  /** Ingredients: the row the n-th finished ingredient is typed in. */
  rowOf?(at: number): number
  /** Steps: the step a node sits in. */
  stepAt?(node: Element): StepDraft | undefined
  /** Steps: true while this step is still one of its rows. */
  holds?(step: StepDraft): boolean
  /** Steps: a picture is being stored for this step, or has arrived (null: none did). */
  stepPicture?(step: StepDraft, sig: string | null, storing: boolean): void
  /** Pictures: append these, and answer how many the section had no room for. */
  addPictures?(sigs: readonly string[]): number
  /** Pictures: this many more, or fewer, are being stored. */
  storing?(by: number): void
}

const tellFull = (tools: Tools, max: number): void =>
  tools.tell(tools.words('recipe.full', 'This section is full: it holds at most {max}.', { max }), 'bad')

function pictureOf(tools: Tools, sig: string, alt: string): HTMLImageElement {
  const img = recipeEl('img')
  img.alt = alt
  img.draggable = false
  img.decoding = 'async'
  img.dataset['sig'] = sig
  const src = tools.pictureUrl(sig)
  if (src) img.src = src
  return img
}

function storingTile(tools: Tools, className = 'hc-recipe-thumb is-storing'): HTMLElement {
  return recipeEl('div', className, tools.words('recipe.picture.storing', 'Adding the picture'))
}

interface Rows<D> {
  readonly element: HTMLElement
  readonly add: HTMLButtonElement
  drafts: D[]
  paint(): void
  focus(row: number, name: string): void
  /** Put rows in at a place, as many as there is room for, and answer how many went in. */
  insert(at: number, more: readonly D[]): number
  remove(at: number): void
  /** Enter moves down or adds a row; Backspace in a row with nothing in it removes it. */
  keys(input: HTMLInputElement, at: number, name: string): void
}

/** A list of rows a cook adds to and removes from. The rows are drafts: the editor decides which are finished. */
function rowsOf<D>(spec: {
  max: number
  addWords: string
  first: string
  blank(): D
  bare(draft: D): boolean
  row(draft: D, at: number): HTMLElement
  changed(): void
}): Rows<D> {
  const element = recipeEl('div', 'hc-recipe-rows')
  element.setAttribute('role', 'list')
  const add = pressable(spec.addWords, 'add')
  const rows: Rows<D> = {
    element,
    add,
    drafts: [],
    paint() {
      if (!rows.drafts.length) rows.drafts.push(spec.blank())
      element.replaceChildren(...rows.drafts.map((draft, at) => {
        const line = spec.row(draft, at)
        line.setAttribute('role', 'listitem')
        return line
      }))
      add.disabled = rows.drafts.length >= spec.max
    },
    focus(row, name) {
      const field = element.querySelector<HTMLElement>(`[data-at="${row}:${name}"]`)
      if (!field) return
      field.focus()
      caretToEnd(field)
    },
    insert(at, more) {
      const fit = more.slice(0, Math.max(0, spec.max - rows.drafts.length))
      rows.drafts.splice(at, 0, ...fit)
      rows.paint()
      return fit.length
    },
    remove(at) {
      rows.drafts.splice(at, 1)
      rows.paint()
    },
    keys(input, at, name) {
      input.addEventListener('keydown', event => {
        if (event.isComposing) return
        if (event.key === 'Enter') {
          event.preventDefault()
          if (at < rows.drafts.length - 1) rows.focus(at + 1, name)
          else if (!spec.bare(rows.drafts[at]) && rows.insert(at + 1, [spec.blank()])) rows.focus(at + 1, spec.first)
        } else if (event.key === 'Backspace' && rows.drafts.length > 1 && spec.bare(rows.drafts[at])) {
          event.preventDefault()
          rows.remove(at)
          rows.focus(Math.max(0, at - 1), spec.first)
          spec.changed()
        }
      })
    },
  }
  add.addEventListener('click', () => {
    const at = rows.drafts.length
    if (rows.insert(at, [spec.blank()])) rows.focus(at, spec.first)
  })
  return rows
}

function editorBody(...nodes: HTMLElement[]): HTMLElement {
  const body = recipeEl('div', 'hc-recipe-editor')
  body.append(...nodes)
  return body
}

function textEditor(section: RecipeSection, labelledBy: string, changed: () => void): Editor {
  const area = recipeEl('textarea', 'hc-recipe-field')
  area.rows = 3
  area.maxLength = L.text
  area.placeholder = section.prompt ?? ''
  area.dataset['at'] = '0:text'
  area.setAttribute('aria-labelledby', labelledBy)
  area.addEventListener('input', () => { grow(area); changed() })
  return {
    body: editorBody(area),
    value: () => ({ kind: 'text', text: manyLines(area.value, L.text) }),
    show(value) {
      area.value = value.kind === 'text' ? value.text : ''
      grow(area)
    },
  }
}

interface IngredientDraft { amount: string; item: string; note: string }

function ingredientsEditor(tools: Tools, changed: () => void): Editor {
  const say = tools.words
  const fields = [
    { name: 'amount', max: L.amount, label: say('recipe.ingredient.amount', 'Amount') },
    { name: 'item', max: L.item, label: say('recipe.ingredient.item', 'Ingredient') },
    { name: 'note', max: L.note, label: say('recipe.ingredient.note', 'Note') },
  ] as const
  const bare = (draft: IngredientDraft): boolean => !draft.amount.trim() && !draft.item.trim() && !draft.note.trim()
  const rows: Rows<IngredientDraft> = rowsOf<IngredientDraft>({
    max: L.ingredients,
    addWords: say('recipe.ingredient.add', 'Add an ingredient'),
    first: 'amount',
    blank: () => ({ amount: '', item: '', note: '' }),
    bare,
    changed,
    row(draft, at) {
      const line = recipeEl('div', 'hc-recipe-row hc-recipe-ingredient')
      for (const { name, max, label } of fields) {
        const input = lineField(`${at}:${name}`, label, max, draft[name])
        input.addEventListener('input', () => { draft[name] = input.value; changed() })
        // Several pasted lines are several ingredients: one a line, the quantity split off.
        input.addEventListener('paste', event => {
          const lines = pastedLines(event)
          if (lines.length < 2) return
          event.preventDefault()
          const pasted = lines.map((text): IngredientDraft => {
            const split = splitIngredientLine(text)
            return { amount: (split.amount ?? '').slice(0, L.amount), item: split.item.slice(0, L.item), note: '' }
          })
          let last = at
          if (bare(draft)) Object.assign(draft, pasted.shift())
          const went = rows.insert(at + 1, pasted)
          last += went
          if (went < pasted.length) tellFull(tools, L.ingredients)
          rows.focus(last, 'item')
          changed()
        })
        rows.keys(input, at, name)
        line.append(input)
      }
      const remove = tool('close', say('recipe.ingredient.remove', 'Remove ingredient {n}', { n: at + 1 }), `${at}:remove`)
      remove.addEventListener('click', () => {
        rows.remove(at)
        rows.focus(Math.min(at, rows.drafts.length - 1), 'item')
        changed()
      })
      line.append(remove)
      return line
    },
  })
  return {
    body: editorBody(rows.element, rows.add),
    value: () => ({
      kind: 'ingredients',
      items: rows.drafts.flatMap(draft => {
        const item = oneLine(draft.item, L.item)
        if (!item) return []
        const amount = oneLine(draft.amount, L.amount)
        const note = oneLine(draft.note, L.note)
        return [{ ...(amount ? { amount } : {}), item, ...(note ? { note } : {}) }]
      }).slice(0, L.ingredients),
    }),
    show(value) {
      rows.drafts = value.kind === 'ingredients' ? value.items.map(i => ({ amount: i.amount ?? '', item: i.item, note: i.note ?? '' })) : []
      rows.paint()
    },
    rowOf(at) {
      let finished = -1
      for (let row = 0; row < rows.drafts.length; row++) {
        if (oneLine(rows.drafts[row].item, L.item) && ++finished === at) return row
      }
      return Math.max(0, rows.drafts.length - 1)
    },
  }
}

interface FactDraft { label: string; value: string }

function factsEditor(tools: Tools, section: RecipeSection, changed: () => void): Editor {
  const say = tools.words
  const fields = [
    { name: 'label', max: L.factLabel, label: say('recipe.fact.label', 'What') },
    { name: 'value', max: L.factValue, label: say('recipe.fact.value', 'How much, how long, from where') },
  ] as const
  const rows: Rows<FactDraft> = rowsOf<FactDraft>({
    max: L.facts,
    addWords: say('recipe.fact.add', 'Add a fact'),
    first: 'label',
    blank: () => ({ label: '', value: '' }),
    bare: draft => !draft.label.trim() && !draft.value.trim(),
    changed,
    row(draft, at) {
      const line = recipeEl('div', 'hc-recipe-row hc-recipe-fact')
      for (const { name, max, label } of fields) {
        const input = lineField(`${at}:${name}`, label, max, draft[name])
        input.addEventListener('input', () => { draft[name] = input.value; changed() })
        rows.keys(input, at, name)
        line.append(input)
      }
      const remove = tool('close', say('recipe.fact.remove', 'Remove fact {n}', { n: at + 1 }), `${at}:remove`)
      remove.addEventListener('click', () => {
        rows.remove(at)
        rows.focus(Math.min(at, rows.drafts.length - 1), 'value')
        changed()
      })
      line.append(remove)
      return line
    },
  })
  return {
    body: editorBody(rows.element, rows.add),
    value: () => ({
      kind: 'facts',
      facts: rows.drafts.flatMap(draft => {
        const label = oneLine(draft.label, L.factLabel)
        const value = oneLine(draft.value, L.factValue)
        return label && value ? [{ label, value }] : []
      }).slice(0, L.facts),
    }),
    // An unanswered facts section starts with what the template suggests: its labels, waiting for values.
    show(value) {
      const facts = value.kind === 'facts' ? value.facts : []
      rows.drafts = facts.length
        ? facts.map(fact => ({ label: fact.label, value: fact.value }))
        : (section.fields ?? []).slice(0, L.facts).map(label => ({ label, value: '' }))
      rows.paint()
    },
  }
}

interface LinkDraft { url: string; label: string }

function linksEditor(tools: Tools, changed: () => void): Editor {
  const say = tools.words
  const rows: Rows<LinkDraft> = rowsOf<LinkDraft>({
    max: L.links,
    addWords: say('recipe.link.add', 'Add a link'),
    first: 'url',
    blank: () => ({ url: '', label: '' }),
    bare: draft => !draft.url.trim() && !draft.label.trim(),
    changed,
    row(draft, at) {
      const line = recipeEl('div', 'hc-recipe-row hc-recipe-link')
      const address = lineField(`${at}:url`, say('recipe.link.address', 'Address'), L.url, draft.url, 'https://')
      address.inputMode = 'url'
      address.spellcheck = false
      address.setAttribute('autocapitalize', 'off')
      const label = lineField(`${at}:label`, say('recipe.link.label', 'What it is'), L.label, draft.label)
      const video = recipeEl('span', 'hc-recipe-tag', say('recipe.link.video', 'video'))
      const refused = recipeEl('p', 'hc-recipe-note', say('recipe.link.refused', 'Not a link: it is not kept. A link starts with https://'))
      const marks = recipeEl('div', 'hc-recipe-marks')
      marks.append(video, refused)
      const mark = (): void => {
        const href = linkOf(draft.url)
        video.hidden = !href || !recipeLinkIsVideo(href)
        refused.hidden = !draft.url.trim() || href !== null
        marks.hidden = video.hidden && refused.hidden
      }
      address.addEventListener('input', () => { draft.url = address.value; mark(); changed() })
      // Left alone, the field shows the address as it is kept.
      address.addEventListener('change', () => {
        const href = linkOf(draft.url)
        if (href && href !== address.value) { address.value = href; draft.url = href }
      })
      label.addEventListener('input', () => { draft.label = label.value; changed() })
      rows.keys(address, at, 'url')
      rows.keys(label, at, 'label')
      const remove = tool('close', say('recipe.link.remove', 'Remove link {n}', { n: at + 1 }), `${at}:remove`)
      remove.addEventListener('click', () => {
        rows.remove(at)
        rows.focus(Math.min(at, rows.drafts.length - 1), 'url')
        changed()
      })
      mark()
      line.append(address, label, remove, marks)
      return line
    },
  })
  return {
    body: editorBody(rows.element, rows.add),
    value: () => ({
      kind: 'links',
      links: rows.drafts.flatMap(draft => {
        const url = linkOf(draft.url)
        if (!url) return []
        const label = oneLine(draft.label, L.label)
        return [{ url, ...(label ? { label } : {}) }]
      }).slice(0, L.links),
    }),
    show(value) {
      rows.drafts = value.kind === 'links' ? value.links.map(link => ({ url: link.url, label: link.label ?? '' })) : []
      rows.paint()
    },
  }
}

function stepsEditor(tools: Tools, changed: () => void): Editor {
  const say = tools.words
  let drafts: StepDraft[] = []
  /** Each row's own way to redraw its picture, so a picture arriving never rebuilds a step being typed in. */
  let redraw = new Map<StepDraft, () => void>()
  const list = recipeEl('div', 'hc-recipe-rows')
  list.setAttribute('role', 'list')
  const add = pressable(say('recipe.step.add', 'Add a step'), 'add')

  const focus = (row: number, name: string): void => {
    const field = list.querySelector<HTMLElement>(`[data-at="${row}:${name}"]`)
    if (!field) return
    field.focus()
    caretToEnd(field)
  }

  const row = (draft: StepDraft, at: number): HTMLElement => {
    const n = at + 1
    const line = recipeEl('div', 'hc-recipe-step')
    line.setAttribute('role', 'listitem')
    line.dataset['row'] = String(at)
    const number = recipeEl('span', 'hc-recipe-step-n', String(n))
    number.setAttribute('aria-hidden', 'true')

    const area = recipeEl('textarea', 'hc-recipe-field')
    area.rows = 2
    area.maxLength = L.step
    area.value = draft.text
    area.placeholder = say('recipe.step.placeholder', 'What happens in this step?')
    area.dataset['at'] = `${at}:text`
    area.setAttribute('aria-label', say('recipe.step.words', 'Step {n}', { n }))

    const minutes = lineField(`${at}:minutes`, say('recipe.step.minutes', 'Minutes for step {n}', { n }), 4, draft.minutes, '')
    minutes.inputMode = 'numeric'
    const timed = recipeEl('label', 'hc-recipe-minutes')
    timed.append(minutes, recipeEl('span', '', say('recipe.step.minutes-unit', 'min')))

    const picture = tool('picture', say('recipe.step.picture', 'Add a picture to step {n}', { n }), `${at}:picture`)
    const earlier = tool('up', say('recipe.step.earlier', 'Move step {n} earlier', { n }), `${at}:earlier`)
    const later = tool('down', say('recipe.step.later', 'Move step {n} later', { n }), `${at}:later`)
    const remove = tool('close', say('recipe.step.remove', 'Remove step {n}', { n }), `${at}:remove`)
    earlier.disabled = at === 0
    later.disabled = at === drafts.length - 1
    const bar = recipeEl('div', 'hc-recipe-step-tools')
    bar.append(timed, picture, earlier, later, remove)

    const held = recipeEl('div')
    const needs = recipeEl('p', 'hc-recipe-note', say('recipe.step.needs-words', 'Say what happens in this step and its picture is kept with it.'))
    const figure = (): void => {
      held.replaceChildren()
      if (draft.storing) held.append(storingTile(tools, 'hc-recipe-thumb hc-recipe-step-picture is-storing'))
      else if (draft.picture) {
        const frame = recipeEl('figure', 'hc-recipe-thumb hc-recipe-step-picture')
        const off = tool('close', say('recipe.step.picture-remove', 'Remove the picture of step {n}', { n }), `${at}:picture-remove`)
        off.addEventListener('click', () => { delete draft.picture; figure(); picture.focus(); changed() })
        const under = recipeEl('div', 'hc-recipe-thumb-tools')
        under.append(off)
        frame.append(pictureOf(tools, draft.picture, say('recipe.step.picture-alt', 'Picture of step {n}', { n })), under)
        held.append(frame)
      }
      held.hidden = !draft.storing && !draft.picture
      needs.hidden = !draft.picture || draft.text.trim() !== ''
    }
    redraw.set(draft, figure)
    figure()

    area.addEventListener('input', () => {
      draft.text = area.value
      grow(area)
      needs.hidden = !draft.picture || draft.text.trim() !== ''
      changed()
    })
    // Several lines pasted into an empty step are several steps. Into a step with words, they are its words.
    area.addEventListener('paste', event => {
      if (draft.text.trim()) return
      const data = event.clipboardData
      const lines = splitStepLines(data && typeof data.getData === 'function' ? data.getData('text/plain') : '')
      if (lines.length < 2) return
      event.preventDefault()
      const more = lines.slice(1, 1 + Math.max(0, L.steps - drafts.length)).map((text): StepDraft => ({ text: text.slice(0, L.step), minutes: '' }))
      draft.text = lines[0].slice(0, L.step)
      drafts.splice(at + 1, 0, ...more)
      if (more.length < lines.length - 1) tellFull(tools, L.steps)
      paint()
      focus(at + more.length, 'text')
      changed()
    })
    minutes.addEventListener('input', () => {
      const digits = minutes.value.replace(/\D/g, '')
      if (digits !== minutes.value) minutes.value = digits
      draft.minutes = digits
      changed()
    })
    picture.addEventListener('click', () => tools.choose(draft))
    const move = (by: -1 | 1): void => {
      drafts.splice(at + by, 0, ...drafts.splice(at, 1))
      paint()
      // The same button again, unless the step reached an end and that button is off.
      const to = at + by
      const edge = by < 0 ? to === 0 : to === drafts.length - 1
      focus(to, (by < 0) !== edge ? 'earlier' : 'later')
      changed()
    }
    earlier.addEventListener('click', () => move(-1))
    later.addEventListener('click', () => move(1))
    remove.addEventListener('click', () => {
      drafts.splice(at, 1)
      paint()
      focus(Math.min(at, drafts.length - 1), 'text')
      changed()
    })

    const main = recipeEl('div', 'hc-recipe-step-main')
    main.append(area, bar, held, needs)
    line.append(number, main)
    return line
  }

  function paint(): void {
    if (!drafts.length) drafts.push({ text: '', minutes: '' })
    redraw = new Map()
    list.replaceChildren(...drafts.map(row))
    add.disabled = drafts.length >= L.steps
    for (const area of list.querySelectorAll('textarea')) grow(area)
  }

  add.addEventListener('click', () => {
    if (drafts.length >= L.steps) return
    drafts.push({ text: '', minutes: '' })
    paint()
    focus(drafts.length - 1, 'text')
  })

  return {
    body: editorBody(list, add),
    value: () => ({
      kind: 'steps',
      steps: drafts.flatMap(draft => {
        const text = manyLines(draft.text, L.step)
        if (!text.trim()) return []
        const minutes = draft.minutes === '' ? NaN : Number(draft.minutes)
        return [{
          text,
          ...(draft.picture ? { picture: draft.picture } : {}),
          ...(Number.isFinite(minutes) && minutes >= 0 && minutes <= L.minutes ? { minutes } : {}),
        }]
      }).slice(0, L.steps),
    }),
    show(value) {
      drafts = value.kind === 'steps'
        ? value.steps.map(step => ({ text: step.text, minutes: step.minutes === undefined ? '' : String(step.minutes), ...(step.picture ? { picture: step.picture } : {}) }))
        : []
      paint()
    },
    stepAt(node) {
      const line = node.closest<HTMLElement>('.hc-recipe-step')
      return line && list.contains(line) ? drafts[Number(line.dataset['row'])] : undefined
    },
    holds: step => drafts.includes(step),
    stepPicture(step, sig, storing) {
      if (storing) step.storing = true
      else delete step.storing
      if (sig) step.picture = sig
      redraw.get(step)?.()
    },
  }
}

function picturesEditor(tools: Tools, section: RecipeSection, changed: () => void): Editor {
  const say = tools.words
  let sigs: string[] = []
  let waiting = 0
  const grid = recipeEl('div', 'hc-recipe-thumbs')
  const zone = recipeEl('div', 'hc-recipe-add')
  const paste = tools.paste ? pressable(say('recipe.picture.paste', 'Paste picture')) : null
  const choose = pressable(say('recipe.picture.choose', 'Choose files'), 'picture')
  paste?.addEventListener('click', () => tools.paste?.())
  choose.addEventListener('click', () => tools.choose())
  zone.append(...(paste ? [paste] : []), choose, recipeEl('span', 'hc-recipe-add-hint', say('recipe.picture.drop', 'or drop pictures anywhere on the page')))

  const focus = (at: number, name: string): void => {
    const next = grid.querySelector<HTMLElement>(`[data-at="${at}:${name}"]:not(:disabled)`) ?? grid.querySelector<HTMLElement>(`[data-at^="${at}:"]:not(:disabled)`) ?? choose
    next.focus()
  }

  const tile = (sig: string, at: number): HTMLElement => {
    const n = at + 1
    const frame = recipeEl('figure', 'hc-recipe-thumb')
    frame.append(pictureOf(tools, sig, say('recipe.picture.alt', '{label}: picture {n} of {total}', { label: section.label, n, total: sigs.length })))
    if (at === 0) frame.append(recipeEl('span', 'hc-recipe-tag', say('recipe.picture.cover', 'Cover')))
    const earlier = tool('left', say('recipe.picture.earlier', 'Move picture {n} earlier', { n }), `${at}:earlier`)
    const later = tool('right', say('recipe.picture.later', 'Move picture {n} later', { n }), `${at}:later`)
    const remove = tool('close', say('recipe.picture.remove', 'Remove picture {n}', { n }), `${at}:remove`)
    earlier.disabled = at === 0
    later.disabled = at === sigs.length - 1
    const move = (by: -1 | 1): void => {
      sigs.splice(at + by, 0, ...sigs.splice(at, 1))
      paint()
      focus(at + by, by < 0 ? 'earlier' : 'later')
      changed()
    }
    earlier.addEventListener('click', () => move(-1))
    later.addEventListener('click', () => move(1))
    remove.addEventListener('click', () => {
      sigs.splice(at, 1)
      paint()
      focus(Math.min(at, sigs.length - 1), 'remove')
      changed()
    })
    const under = recipeEl('div', 'hc-recipe-thumb-tools')
    under.append(earlier, later, remove)
    frame.append(under)
    return frame
  }

  function paint(): void {
    grid.replaceChildren(...sigs.map(tile), ...Array.from({ length: waiting }, () => storingTile(tools)))
    grid.hidden = sigs.length + waiting === 0
    const full = sigs.length + waiting >= L.pictures
    choose.disabled = full
    if (paste) paste.disabled = full
  }

  return {
    body: editorBody(grid, zone),
    value: () => ({ kind: 'pictures', pictures: sigs.slice(0, L.pictures) }),
    show(value) {
      sigs = value.kind === 'pictures' ? [...new Set(value.pictures)] : []
      paint()
    },
    addPictures(more) {
      let refused = 0
      for (const sig of more) {
        if (sigs.includes(sig)) continue
        if (sigs.length >= L.pictures) refused++
        else sigs.push(sig)
      }
      paint()
      return refused
    },
    storing(by) {
      waiting = Math.max(0, waiting + by)
      paint()
    },
  }
}

// ── the desk ────────────────────────────────────────────────────────────────

/** One part of the recipe: its tab beside the plate, its labels when it is an ingredients section, and its card. */
interface Part {
  /** Its own name on the drawing: unlike every other part's, even when two values share a key. */
  readonly id: string
  /** The key its value is written under. It changes only when a value of another kind had to move aside. */
  key: string
  readonly kind: RecipeSectionKind
  readonly kept: boolean
  /** Holds the tab, the labels and the card. It makes no box of its own on a wide desk. */
  readonly element: HTMLElement
  readonly tab: HTMLButtonElement
  readonly name: HTMLElement
  readonly said: HTMLElement
  /** An ingredients section's ingredients, each a small label pointing into the plate. */
  callouts: HTMLButtonElement[]
  readonly card: HTMLElement
  readonly heading: HTMLElement
  readonly editor: Editor
}

/** Something seated beside the plate: a part, or a row of the layout being arranged. */
interface Seated {
  readonly id: string
  readonly kept: boolean
  /** True for an ingredients section: its labels are stacked under its tab. */
  readonly group: boolean
  readonly holder: HTMLElement
  readonly tab: HTMLElement
  readonly callouts: readonly HTMLElement[]
}

let pagesMade = 0

/** Build the desk. It is mounted by its caller, fills the box it is put in, and asks for everything through its options. */
export function recipePage(options: RecipePageOptions): RecipePageHandle {
  const doc = document
  ensureRecipeStyles(doc)
  const say: Words = (key, fallback, params) => recipeWords(options.say, key, fallback, params)
  const readOnly = options.readOnly === true
  const serial = ++pagesMade

  let recipe: RecipeDocument = { ...(options.recipe.template !== undefined ? { template: options.recipe.template } : {}), values: { ...options.recipe.values } }
  let template = options.template
  let title = options.title
  let mode: 'write' | 'read' = readOnly ? 'read' : options.mode ?? 'write'
  let arranging = false
  /** The read-along's page. Kept through a visit to write mode and back. */
  let readAt = 0
  let parts: Part[] = []
  /** The rows of the layout while it is arranged. */
  let arrangeRows: Seated[] = []
  /** The divider before the values the template has no section for. */
  let also: HTMLElement | null = null
  /** The one part whose card is open. */
  let open: Part | null = null
  /** What the pointer is over and what holds focus, by drawing id: they light together with their leaders. */
  let hot = ''
  let focused = ''
  let chooseFor: { step?: StepDraft; front: boolean } = { front: false }
  let tiles: readonly RecipeTileRow[] = readOnly ? [] : options.tiles ?? []
  let shared = options.shared
  let drawer = false
  let fit: RecipeDeskFit | null = null
  let disposed = false
  /** Which recipe is on the desk, counted: another one taking the desk moves it on. Pictures are put in the recipe they were chosen for, or in none. */
  let sitting = 0
  /** The pictures still being stored, one promise an intake. */
  const intakes = new Set<Promise<void>>()
  /** Ingredients ticked off while cooking. This sitting only: never saved. */
  const ticked = new Set<string>()
  /** The table set the desk sits on, and whether one of its pictures failed to arrive (then the drawn plate stands in). */
  let setting: RecipeSettingDocument | null = options.setting ?? null
  let setBroken = false
  /** How many times the set's layers were laid: an answer from an earlier laying is not this one's. */
  let setBuilds = 0
  let settingsMenu: RecipeSettingMenu = options.settings ?? { choices: [], current: '' }

  // ── the frame ───────────────────────────────────────────────────────────

  const root = recipeEl('section', 'hc-recipe')
  root.setAttribute('aria-label', say('recipe.page', 'Recipe'))
  root.dataset['layout'] = 'wide'
  root.dataset['list'] = 'full'

  const list = recipeEl('nav', 'hc-recipe-list')
  list.id = `hc-recipe-${serial}-list`
  list.setAttribute('aria-label', say('recipe.list.label', 'Tiles on this page'))
  const listRows = recipeEl('div', 'hc-recipe-list-rows')
  list.append(recipeEl('div', 'hc-recipe-list-head', say('recipe.list.legend', 'Hive')), listRows)
  const scrim = recipeEl('div', 'hc-recipe-scrim')

  const drawerToggle = tool('list', say('recipe.list.show', 'Tiles on this page'))
  drawerToggle.classList.add('hc-recipe-drawer-toggle')
  drawerToggle.setAttribute('aria-expanded', 'false')
  drawerToggle.setAttribute('aria-controls', list.id)

  const heading = recipeEl('h1', 'hc-recipe-title', title)
  const addressWords = recipeEl('span', 'hc-recipe-address')

  const naming = lineField('name', say('recipe.arrange.name', 'Template name'), L.name, template.name)
  naming.hidden = true

  const templateWords = recipeEl('span', 'hc-recipe-btn-words')
  const templateButton = recipeEl('button', 'hc-recipe-btn hc-recipe-template')
  templateButton.type = 'button'
  templateButton.append(templateWords, recipeMark('down'))

  // The Table control: which photographed table the desk sits on, if any.
  const tableButton = recipeEl('button', 'hc-recipe-btn hc-recipe-table')
  tableButton.type = 'button'
  tableButton.append(recipeEl('span', 'hc-recipe-btn-words', say('recipe.setting.button', 'Table')), recipeMark('down'))
  const tableMenu = recipeEl('div', 'hc-recipe-table-menu')
  tableMenu.id = `hc-recipe-${serial}-table`
  tableMenu.hidden = true
  tableButton.setAttribute('aria-expanded', 'false')
  tableButton.setAttribute('aria-controls', tableMenu.id)
  const tableWrap = recipeEl('div', 'hc-recipe-table-wrap')
  tableWrap.append(tableButton, tableMenu)
  const settingChooser = recipeEl('input')
  settingChooser.type = 'file'
  settingChooser.accept = '.json,application/json,.png,image/png,.webp,image/webp'
  settingChooser.multiple = true
  settingChooser.hidden = true
  settingChooser.tabIndex = -1
  settingChooser.setAttribute('aria-hidden', 'true')

  const writeButton = recipeEl('button', '', say('recipe.write', 'Write'))
  const readButton = recipeEl('button', '', say('recipe.read', 'Read along'))
  writeButton.type = readButton.type = 'button'
  const modes = recipeEl('div', 'hc-recipe-switch')
  modes.setAttribute('role', 'group')
  modes.setAttribute('aria-label', say('recipe.mode', 'Write or read along'))
  modes.append(writeButton, readButton)
  modes.hidden = readOnly

  const status = recipeEl('p', 'hc-recipe-status')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')

  const bulb = recipeEl('button', 'hc-recipe-tool hc-recipe-bulb')
  bulb.type = 'button'
  bulb.setAttribute('aria-label', say('recipe.shared.switch', 'Offer this recipe'))
  bulb.title = say('recipe.shared.switch', 'Offer this recipe')
  bulb.append(recipeBulb())
  const sharedWords = recipeEl('span', 'hc-recipe-shared-words')
  sharedWords.id = `hc-recipe-${serial}-shared`
  bulb.setAttribute('aria-describedby', sharedWords.id)
  const sharedWrap = recipeEl('div', 'hc-recipe-shared')
  sharedWrap.append(bulb, sharedWords)

  const browse = pressable(say('recipe.browse', 'Browse'), undefined, 'hc-recipe-btn hc-recipe-browse')
  browse.title = say('recipe.browse.hint', 'See what your nodes offer')
  browse.hidden = !options.onBrowse

  const more = tool('more', say('recipe.more', 'More'))
  const menu = recipeEl('div', 'hc-recipe-menu')
  menu.id = `hc-recipe-${serial}-menu`
  menu.hidden = true
  more.setAttribute('aria-expanded', 'false')
  more.setAttribute('aria-controls', menu.id)
  const arrangeButton = pressable(say('recipe.arrange', 'Arrange'))
  arrangeButton.setAttribute('aria-pressed', 'false')
  const keepButton = pressable(say('recipe.keep-template', 'Keep as a template'))
  const tileButton = pressable(say('recipe.edit-tile', 'Edit tile'))
  // On a narrow desk Browse is offered here, where there is room for its word.
  const browseItem = pressable(say('recipe.browse', 'Browse'), undefined, 'hc-recipe-btn is-narrow-only')
  if (!readOnly) menu.append(arrangeButton)
  if (options.onKeepTemplate) menu.append(keepButton)
  if (!readOnly && options.onEditTile) menu.append(tileButton)
  const ownItems = menu.childElementCount
  if (options.onBrowse) menu.append(browseItem)
  const moreWrap = recipeEl('div', 'hc-recipe-more')
  moreWrap.append(more, menu)
  moreWrap.hidden = menu.childElementCount === 0
  // With nothing of its own in the menu, the button is there only for the narrow desk's Browse.
  if (!ownItems) moreWrap.classList.add('is-narrow-only')

  const rule = recipeEl('span', 'hc-recipe-sep')
  rule.setAttribute('role', 'separator')
  rule.setAttribute('aria-orientation', 'vertical')

  // The one filled button. A cook's closes the desk (or ends arranging); a visitor's is the caller's action.
  const primaryWords = recipeEl('span', 'hc-recipe-btn-words')
  const primary = recipeEl('button', 'hc-recipe-btn is-solid hc-recipe-done')
  primary.type = 'button'
  primary.append(primaryWords)
  primary.hidden = readOnly
  const action = readOnly && options.primaryAction ? pressable(options.primaryAction.label, undefined, 'hc-recipe-btn is-solid hc-recipe-action') : null
  const close = tool('close', say('recipe.close', 'Close the recipe'))
  close.classList.add('hc-recipe-close')
  close.hidden = !readOnly
  rule.hidden = primary.hidden && !action

  // What the recipe is, then what is said about it, then what is done with it: the last keep to the right, together.
  const headEnd = recipeEl('div', 'hc-recipe-head-end')
  headEnd.append(status, sharedWrap, browse, moreWrap, rule, primary, ...(action ? [action] : []), close)
  const head = recipeEl('header', 'hc-recipe-head')
  // The template button asks the caller for another template: with nobody to ask, it is not drawn.
  // The Table control sits beside it, and only where the caller can choose a set.
  head.append(drawerToggle, heading, addressWords, naming, ...(options.onPickTemplate ? [templateButton] : []), ...(options.table && !readOnly ? [tableWrap] : []), modes, headEnd)

  const fill = recipeEl('div', 'hc-recipe-progress-fill')
  const progress = recipeEl('div', 'hc-recipe-progress')
  progress.setAttribute('role', 'progressbar')
  progress.setAttribute('aria-label', say('recipe.read.progress', 'How far through the recipe'))
  progress.setAttribute('aria-valuemin', '1')
  progress.append(fill)

  // The stage: the plate in the middle, its tools under it, the tabs either side, one overlay of leaders.
  const stage = recipeEl('div', 'hc-recipe-stage')
  const leaders = recipeSvg('svg', { class: 'hc-recipe-leaders', 'aria-hidden': 'true', focusable: 'false' })
  const veil = recipeEl('div', 'hc-recipe-veil')
  veil.hidden = true
  const figure = recipeEl('div', 'hc-recipe-figure')
  const plateArt = recipePlate(`hc-recipe-${serial}`)
  const dishPicture = recipeEl('img')
  dishPicture.draggable = false
  dishPicture.decoding = 'async'
  const dish = recipeEl('div', 'hc-recipe-dish')
  dish.append(dishPicture)
  const upload = recipeEl('button', 'hc-recipe-invite-btn')
  upload.type = 'button'
  upload.append(recipeMark('upload'), recipeEl('span', '', say('recipe.invite.upload', 'upload')))
  const invite = recipeEl('div', 'hc-recipe-invite')
  invite.append(recipeMark('picture'), recipeEl('p', '', say('recipe.invite', 'drop a picture of the dish, or choose one')), upload)
  const storingNote = recipeEl('p', 'hc-recipe-figure-note', say('recipe.picture.storing', 'Adding the picture'))
  storingNote.hidden = true
  // The set: one canvas in the picture's own px, scaled to the figure, so every floor and centre is used as the set says it.
  const setArt = recipeEl('div', 'hc-recipe-set')
  setArt.hidden = true
  const setCanvas = recipeEl('div', 'hc-recipe-set-canvas')
  const setCards = recipeEl('div', 'hc-recipe-set-cards')
  const setHits = recipeSvg('svg', { class: 'hc-recipe-set-hits', focusable: 'false' })
  setArt.append(setCanvas)
  figure.append(plateArt, dish, setArt, invite, storingNote)

  const pasteButton = options.clipboardPictures ? pressable(say('recipe.picture.paste', 'Paste picture'), 'paste') : null
  const chooseButton = pressable(say('recipe.picture.choose', 'Choose files'), 'picture')
  const strip = recipeEl('div', 'hc-recipe-strip')
  strip.setAttribute('role', 'list')
  strip.setAttribute('aria-label', say('recipe.strip', 'Pictures: choose the cover'))
  const arrangeNote = recipeEl('p', 'hc-recipe-tools-note')
  arrangeNote.hidden = true
  const toolsRow = recipeEl('div', 'hc-recipe-tools')
  toolsRow.append(...(pasteButton ? [pasteButton] : []), chooseButton, strip, arrangeNote)

  const partsHost = recipeEl('div', 'hc-recipe-parts')
  stage.append(figure, toolsRow, veil, leaders, partsHost)

  const column = recipeEl('main', 'hc-recipe-column')
  const scroll = recipeEl('div', 'hc-recipe-scroll')
  scroll.append(column)


  const previous = pressable(say('recipe.read.previous', 'Previous'), 'left', 'hc-recipe-btn is-line')
  const next = pressable(say('recipe.read.next', 'Next'), undefined, 'hc-recipe-btn is-solid')
  next.append(recipeMark('right'))
  const position = recipeEl('span', 'hc-recipe-position')
  const nav = recipeEl('nav', 'hc-recipe-nav')
  nav.setAttribute('aria-label', say('recipe.read.pages', 'Pages'))
  nav.append(previous, position, next)
  // The read-along: its page and its turning, beside the list like the stage is.
  const reader = recipeEl('div', 'hc-recipe-reader')
  reader.append(scroll, nav)

  const body = recipeEl('div', 'hc-recipe-body')
  body.append(list, scrim, stage, reader)

  const chooser = recipeEl('input')
  chooser.type = 'file'
  chooser.accept = 'image/*'
  chooser.multiple = true
  chooser.hidden = true
  chooser.tabIndex = -1
  chooser.setAttribute('aria-hidden', 'true')

  root.append(head, progress, body, chooser, ...(options.table && !readOnly ? [settingChooser] : []))

  // ── saying things ───────────────────────────────────────────────────────

  const setStatus = (words: string, tone: 'plain' | 'good' | 'bad' = 'plain'): void => {
    status.textContent = words
    status.classList.toggle('is-good', tone === 'good')
    status.classList.toggle('is-bad', tone === 'bad')
  }
  /** Said while pictures are being stored, and taken back only while it is still what is said. */
  const adding = say('recipe.picture.adding', 'Adding pictures')

  const showTemplate = (): void => {
    templateWords.textContent = template.name
    templateButton.setAttribute('aria-label', say('recipe.template.choose', 'Template: {name}. Choose another', { name: template.name }))
    if (doc.activeElement !== naming) naming.value = template.name
  }

  const showAddress = (address: string): void => {
    addressWords.textContent = address
    addressWords.hidden = !address
  }

  const showShared = (): void => {
    sharedWrap.hidden = readOnly || !shared
    if (!shared) return
    bulb.setAttribute('aria-pressed', String(shared.lit))
    bulb.disabled = !options.onToggleShared
    sharedWords.textContent = shared.words
    sharedWords.dataset['tone'] = shared.tone ?? 'plain'
  }

  /** The Table control names the set the desk sits on, so a reader hears what pressing it changes. */
  const showTable = (): void => {
    tableButton.toggleAttribute('data-broken', !!setting && setBroken)
    if (setting && setBroken) {
      // The set is chosen but the drawn plate stands in: the control says so, never only the set's name.
      const words = say('recipe.setting.choose-broken', 'Table set: {name}, its pictures did not arrive, so the drawn plate stands in. Choose it again to try again', { name: setting.name })
      tableButton.setAttribute('aria-label', words)
      tableButton.title = words
      return
    }
    tableButton.setAttribute('aria-label', setting
      ? say('recipe.setting.choose', 'Table set: {name}. Choose another', { name: setting.name })
      : say('recipe.setting.choose-none', 'Table set: none, the drawn plate. Choose one'))
    tableButton.title = setting ? setting.name : say('recipe.setting.none', 'The drawn plate')
  }

  /** The Table control's list: the kept sets, what the followed hosts offer, bringing one in, and the drawn plate. */
  const drawTableMenu = (): void => {
    const current = settingsMenu.current
    const row = (words: string, checked: boolean, act: () => void, aside?: string): HTMLButtonElement => {
      const item = pressable(words, undefined, 'hc-recipe-btn hc-recipe-table-item')
      item.setAttribute('role', 'menuitemradio')
      item.setAttribute('aria-checked', String(checked))
      if (aside) item.append(recipeEl('span', 'hc-recipe-table-aside', aside))
      item.addEventListener('click', () => { openTableMenu(false, true); act() })
      return item
    }
    const kept = settingsMenu.choices.filter(choice => choice.from === 'kept')
    const offered = settingsMenu.choices.filter(choice => choice.from === 'community' && !kept.some(each => each.sig === choice.sig))
    const nodes: HTMLElement[] = []
    if (kept.length) {
      nodes.push(recipeEl('p', 'hc-recipe-table-head', say('recipe.setting.kept', 'Your table sets')))
      for (const choice of kept) {
        // The set the desk sits on whose pictures did not arrive: choosing it again tries them again.
        const item = row(choice.name, choice.sig === current, () => {
          if (choice.sig === current && setting && setBroken) retrySet()
          else options.table?.choose(choice)
        })
        const remove = options.table?.remove
        if (!remove) { nodes.push(item); continue }
        // Each kept set wears its own remove press, so a full list can always be made room in.
        const forget = tool('close', say('recipe.setting.remove', 'Take {name} off your table sets', { name: choice.name }))
        forget.classList.add('hc-recipe-table-forget')
        forget.setAttribute('role', 'menuitem')
        forget.addEventListener('click', () => { openTableMenu(false, true); remove(choice) })
        const pair = recipeEl('div', 'hc-recipe-table-kept')
        pair.append(item, forget)
        nodes.push(pair)
      }
    }
    if (offered.length || settingsMenu.asking) {
      nodes.push(recipeEl('p', 'hc-recipe-table-head', say('recipe.setting.community', 'From your domains')))
      for (const choice of offered) nodes.push(row(choice.name, false, () => options.table?.choose(choice), choice.host))
      if (settingsMenu.asking) nodes.push(recipeEl('p', 'hc-recipe-table-note', say('recipe.setting.asking', 'Asking your domains')))
    }
    nodes.push(recipeEl('span', 'hc-recipe-table-rule'))
    const add = pressable(say('recipe.setting.add', 'Add a table set'), 'upload', 'hc-recipe-btn hc-recipe-table-item')
    add.addEventListener('click', () => {
      openTableMenu(false)
      settingChooser.value = ''
      settingChooser.click()
    })
    nodes.push(add, row(say('recipe.setting.none', 'The drawn plate'), current === '', () => options.table?.choose(null)))
    tableMenu.replaceChildren(...nodes)
  }

  function openTableMenu(show: boolean, refocus = false): void {
    if (show === !tableMenu.hidden) { if (!show && refocus) tableButton.focus(); return }
    tableMenu.hidden = !show
    tableButton.setAttribute('aria-expanded', String(show))
    if (show) {
      drawTableMenu()
      options.table?.open?.()
      ;(tableMenu.querySelector<HTMLElement>('[aria-checked="true"]') ?? tableMenu.querySelector<HTMLElement>('button'))?.focus()
    } else if (refocus) tableButton.focus()
  }

  const kindWords = (kind: RecipeSectionKind): string => {
    switch (kind) {
      case 'text': return say('recipe.kind.text', 'Text')
      case 'ingredients': return say('recipe.kind.ingredients', 'Ingredients')
      case 'steps': return say('recipe.kind.steps', 'Steps')
      case 'pictures': return say('recipe.kind.pictures', 'Pictures')
      case 'links': return say('recipe.kind.links', 'Links')
      case 'facts': return say('recipe.kind.facts', 'Facts')
    }
  }

  /** Open the file chooser. What is chosen lands on a step, at the front as the cover, or with the pictures. */
  const pick = (step: StepDraft | undefined, front: boolean): void => {
    chooseFor = { ...(step ? { step } : {}), front }
    chooser.value = ''
    chooser.click()
  }

  const tools: Tools = {
    words: say,
    pictureUrl(sig) {
      try { return options.pictureUrl(sig) || '' } catch { return '' }
    },
    tell: setStatus,
    choose: step => pick(step, false),
    ...(options.clipboardPictures ? { paste: () => { void fromClipboard(false) } } : {}),
  }

  // ── the drawing: what is lit, where things sit, the leaders ─────────────

  const seatedNow = (): Seated[] => (arranging
    ? arrangeRows
    : parts.map(part => ({ id: part.id, kept: part.kept, group: part.kind === 'ingredients', holder: part.element, tab: part.tab, callouts: part.callouts })))

  /** A tab, its labels and their leaders light together: softly under the pointer or focus, strongly while its card is open. */
  const litOf = (id: string): string => {
    const owner = id.split('#')[0]
    const own = id === owner
    if (open && open.id === owner && own) return 'strong'
    for (const each of [hot, focused]) {
      if (!each) continue
      if (each === id) return 'soft'
      if (each.split('#')[0] === owner && (own || each === owner)) return 'soft'
    }
    return ''
  }

  const light = (): void => {
    for (const node of stage.querySelectorAll('[data-id]')) {
      const id = node.getAttribute('data-id') ?? ''
      const lit = litOf(id)
      if (lit) node.setAttribute('data-lit', lit)
      else node.removeAttribute('data-lit')
      // What belongs to the open part is never dimmed with the rest of the drawing.
      node.toggleAttribute('data-own', open !== null && id.split('#')[0] === open.id)
    }
  }

  /** Give every tab and label its side of the plate and its row. Answers the tallest side, in rows. */
  const seat = (): number => {
    const seated = seatedNow()
    const asked = seated.map(each => ({ key: each.id, ...(each.group ? { callouts: each.callouts.length } : {}), ...(each.kept ? { kept: true } : {}) }))
    // On a set each tab sits on its plate's side, top to bottom as the plates are.
    const plates = platesNow()
    const seating = setting && showingSet()
      ? recipeDeskSetSeats(asked.map(part => {
        const plate = plates.get(part.key)
        return plate ? { ...part, plate: { x: plate.centre[0] / (setting as RecipeSettingDocument).size[0], y: plate.centre[1] / (setting as RecipeSettingDocument).size[1] } } : part
      }), fit?.capacity)
      : recipeDeskSeats(asked, fit?.capacity)
    const most = Math.max(seating.rows.left, seating.rows.right, 1)
    // Rows are halves of a tab's pitch, so a shorter side sits exactly in the middle of a taller one.
    root.style.setProperty('--hc-recipe-rows', String(most * 2))
    const place = (node: HTMLElement, side: 'left' | 'right', row: number): void => {
      node.style.gridRow = `${most - seating.rows[side] + row * 2 + 1} / span 2`
    }
    seating.seats.forEach((each, at) => {
      const it = seated[at]
      it.holder.dataset['side'] = each.side
      place(it.tab, each.side, each.row)
      it.callouts.forEach((label, n) => place(label, each.side, each.row + 1 + n))
      if (each.divider !== undefined && also) {
        also.dataset['side'] = each.side
        place(also, each.side, each.divider)
      }
    })
    return most
  }

  // ── the table set ───────────────────────────────────────────────────────

  /** The set is drawn while one is chosen and every picture of it has arrived. */
  function showingSet(): boolean {
    return setting !== null && !setBroken
  }

  /**
   * Which plate each seated thing sits on, by drawing id: the template's
   * sections in order, the first on the first plate. While the layout is
   * arranged its rows sit there the same way, so a cook sees where a section
   * will sit before leaving Arrange.
   */
  function platesNow(): Map<string, RecipeSettingDocument['plates'][number]> {
    const out = new Map<string, RecipeSettingDocument['plates'][number]>()
    if (!setting || !showingSet()) return out
    const seated = arranging ? arrangeRows.filter(row => /^a\d+$/.test(row.id)) : seatedNow()
    const plates = setting.plates
    recipeDeskPlatesOf(seated, plates.length).forEach((plate, at) => {
      if (plate !== undefined) out.set(seated[at].id, plates[plate])
    })
    return out
  }

  /** What the desk says while a set's pictures have not arrived, so it is taken back only while it is still what is said. */
  let brokenWords = ''

  /** A picture of the set has not arrived: the drawn plate stands in, the desk is laid out again around it, and the cook is told. */
  const setFailed = (): void => {
    if (setBroken || !setting || disposed) return
    setBroken = true
    brokenWords = say('recipe.setting.unarrived', 'The pictures of the table set {name} did not arrive, so the drawn plate is shown.', { name: setting.name })
    setStatus(brokenWords, 'bad')
    showTable()
    drawFigure()
    layOut()
  }

  /** Try the chosen set's pictures once more: it is drawn again, or the drawn plate stays and the desk says so again. */
  const retrySet = (): void => {
    buildSet()
    showTable()
    if (mode === 'read') return
    drawFigure()
    layOut()
  }

  /** The layers of the set, back to front: the table, each plate, the place cards, the utensils, and the plates' press targets over all. */
  const buildSet = (): void => {
    setBroken = false
    // A fresh try: what was said about the last one is taken back, if nothing else has been said since.
    if (brokenWords && status.textContent === brokenWords) setStatus('')
    brokenWords = ''
    // Only this try's pictures speak: one of a set laid before that fails late changes nothing.
    const build = ++setBuilds
    const failed = (): void => { if (build === setBuilds) setFailed() }
    setCanvas.replaceChildren()
    root.toggleAttribute('data-set', setting !== null)
    if (!setting) return
    const [width, height] = setting.size
    setCanvas.style.width = `${width}px`
    setCanvas.style.height = `${height}px`
    const layer = (sig: string, className: string, alt = ''): HTMLImageElement => {
      const img = recipeEl('img', `hc-recipe-set-layer ${className}`)
      img.alt = alt
      img.draggable = false
      img.decoding = 'async'
      img.dataset['sig'] = sig
      img.width = width
      img.height = height
      img.addEventListener('error', failed)
      const src = tools.pictureUrl(sig)
      if (src) img.src = src
      else queueMicrotask(failed)
      return img
    }
    setHits.setAttribute('viewBox', `0 0 ${width} ${height}`)
    setHits.setAttribute('width', String(width))
    setHits.setAttribute('height', String(height))
    setCanvas.append(
      layer(setting.table, 'is-table', say('recipe.setting.alt', 'Table set: {name}', { name: setting.name })),
      ...setting.plates.map(plate => layer(plate.layer, 'is-plate')),
      setCards,
      ...(setting.utensils ? [layer(setting.utensils, 'is-utensils')] : []),
      setHits,
    )
  }

  /** Press a plate: its part's card opens down the middle, as pressing its tab does, and closes again the same way. */
  const pressPlate = (id: string): void => {
    const part = parts.find(each => each.id === id)
    if (!part) return
    if (open === part) closeCard()
    else openPart(part)
  }

  /** The place cards and press targets of the seated plates, drawn again from what each part says now. */
  const drawSet = (): void => {
    setCards.replaceChildren()
    setHits.replaceChildren()
    const plates = platesNow()
    if (!plates.size) return
    const point = (p: RecipeSettingPoint): string => `${p[0]},${p[1]}`
    for (const [id, plate] of plates) {
      const part = parts.find(each => each.id === id)
      const row = part ? undefined : arrangeRows.find(each => each.id === id)
      const label = part?.name.textContent ?? (row ? (row.tab.querySelector('input')?.value ?? '') : '')
      const said = part?.said.textContent ?? ''
      // The card lies on the near half of the floor, drawn its own size in the picture's px, then laid flat onto it.
      const { u, v } = RECIPE_DESK.placeCard
      const lies = recipeFloorInset(plate.floor, u[0], v[0], u[1], v[1])
      if (lies) {
        const box = recipeFloorBox(lies)
        const card = recipeEl('div', 'hc-recipe-placecard')
        card.dataset['id'] = id
        card.dataset['plate'] = plate.id
        card.setAttribute('aria-hidden', 'true')
        card.style.width = `${box.width}px`
        card.style.height = `${box.height}px`
        card.style.fontSize = `${Math.max(6, Math.round(box.height * 0.34))}px`
        card.style.transform = floorMatrix(lies, box.width, box.height)
        card.append(recipeEl('span', 'hc-recipe-placecard-label', label))
        if (said) card.append(recipeEl('span', 'hc-recipe-placecard-said', said))
        setCards.append(card)
      }
      const hit = recipeSvg('polygon', { class: 'hc-recipe-set-plate', points: plate.floor.map(point).join(' '), 'data-id': id, 'data-plate': plate.id })
      if (part) hit.addEventListener('click', () => pressPlate(id))
      setHits.append(hit)
    }
    light()
  }

  /** The picture the recipe is known by: the first of its first pictures. */
  const coverOf = (): string | undefined => {
    for (const { value } of projectRecipe(template, recipe)) if (value.kind === 'pictures' && value.pictures[0]) return value.pictures[0]
    return undefined
  }

  /** One SVG of leaders, laid from where the tabs and the plate really are. */
  const drawLeaders = (): void => {
    leaders.replaceChildren()
    if (mode !== 'write' || root.dataset['layout'] === 'narrow') return
    // Laid-out boxes, measured from the stage: the same numbers whatever is done to the desk from outside.
    const box = { left: figure.offsetLeft, top: figure.offsetTop, width: figure.offsetWidth, height: figure.offsetHeight }
    if (setting && showingSet()) { drawSetLeaders(box, setting); return }
    const tabs: RecipeDeskTab[] = []
    const add = (node: HTMLElement, id: string, side: 'left' | 'right', into: 'rim' | 'face'): void => {
      tabs.push({ id, side, into, edge: node.offsetLeft + (side === 'left' ? node.offsetWidth : 0), y: node.offsetTop + node.offsetHeight / 2 })
    }
    for (const each of seatedNow()) {
      const side = each.holder.dataset['side'] === 'right' ? 'right' : 'left'
      // An ingredients section with ingredients is drawn as them: its heading has no leader of its own.
      if (!each.callouts.length) add(each.tab, each.id, side, 'rim')
      // The label that counts the rest points at nothing: it is not an ingredient.
      for (const label of each.callouts) if (!label.classList.contains('is-more')) add(label, label.dataset['id'] ?? '', side, 'face')
    }
    const cover = coverOf()
    const plate = {
      cx: box.left + box.width / 2,
      cy: box.top + box.height / 2,
      size: box.width,
      shape: cover ? 'card' as const : 'plate' as const,
      clear: !cover && !arranging,
    }
    const em = Number.parseFloat(getComputedStyle(root).fontSize) || 16
    const fixed = (value: number): string => (Math.round(value * 10) / 10).toString()
    // The plate is white on any ground: the stretch of a leader that lies on it is drawn again in the plate's own ink.
    const onPlate = recipeSvg('clipPath', { id: `hc-recipe-${serial}-on-plate` })
    onPlate.append(cover
      ? recipeSvg('rect', { x: fixed(box.left), y: fixed(box.top), width: fixed(box.width), height: fixed(box.height), rx: 4 })
      : recipeSvg('rect', {
        x: fixed(plate.cx - plate.size * RECIPE_DESK.rim), y: fixed(plate.cy - plate.size * RECIPE_DESK.rim),
        width: fixed(plate.size * RECIPE_DESK.rim * 2), height: fixed(plate.size * RECIPE_DESK.rim * 2), rx: fixed(plate.size * 0.035),
      }))
    leaders.append(onPlate)
    const faces = new Set(tabs.filter(tab => tab.into === 'face').map(tab => tab.id))
    for (const leader of recipeDeskLeaders(tabs, plate, em / 16)) {
      const d = leader.points.map((point, at) => `${at ? 'L' : 'M'}${fixed(point.x)} ${fixed(point.y)}`).join(' ')
      const group = recipeSvg('g', { class: 'hc-recipe-lead', 'data-id': leader.id })
      group.append(recipeSvg('path', { class: 'is-halo', d }), recipeSvg('path', { class: 'is-line', d }))
      if (faces.has(leader.id)) {
        const clipped = { d, 'clip-path': `url(#${onPlate.id})` }
        group.classList.add('is-face')
        group.append(recipeSvg('path', { class: 'is-halo is-inside', ...clipped }), recipeSvg('path', { class: 'is-line is-inside', ...clipped }))
      }
      group.append(recipeSvg('circle', { cx: fixed(leader.dot.x), cy: fixed(leader.dot.y), r: 2.75 }))
      leaders.append(group)
    }
    light()
  }

  /** One leader drawn: its halo, its line and its dot. */
  const leaderOf = (leader: RecipeDeskLeader, face: boolean): SVGGElement => {
    const fixed = (value: number): string => (Math.round(value * 10) / 10).toString()
    const d = leader.points.map((point, at) => `${at ? 'L' : 'M'}${fixed(point.x)} ${fixed(point.y)}`).join(' ')
    const group = recipeSvg('g', { class: `hc-recipe-lead${face ? ' is-face is-set' : ' is-set'}`, 'data-id': leader.id })
    group.append(recipeSvg('path', { class: 'is-halo', d }), recipeSvg('path', { class: 'is-line', d }))
    group.append(recipeSvg('circle', { cx: fixed(leader.dot.x), cy: fixed(leader.dot.y), r: 2.75 }))
    return group
  }

  /**
   * The leaders on a set: a section's tab to its plate's floor centre, an
   * ingredients section's labels to points spread over its plate's floor. A
   * tab whose section sits on no plate has no leader: there is nothing in the
   * photograph it is about.
   */
  function drawSetLeaders(box: { left: number; top: number; width: number; height: number }, on: RecipeSettingDocument): void {
    const scale = box.width / on.size[0]
    const at = (x: number, y: number): { x: number; y: number } => ({ x: box.left + x * scale, y: box.top + y * scale })
    const plates = platesNow()
    const tabs: RecipeDeskSetTab[] = []
    const add = (node: HTMLElement, id: string, side: 'left' | 'right', into: 'rim' | 'face', to: { x: number; y: number }): void => {
      tabs.push({ id, side, into, to, edge: node.offsetLeft + (side === 'left' ? node.offsetWidth : 0), y: node.offsetTop + node.offsetHeight / 2 })
    }
    for (const each of seatedNow()) {
      const plate = plates.get(each.id)
      if (!plate) continue
      const side = each.holder.dataset['side'] === 'right' ? 'right' : 'left'
      const labels = each.callouts.filter(label => !label.classList.contains('is-more'))
      if (!labels.length) { add(each.tab, each.id, side, 'rim', at(plate.centre[0], plate.centre[1])); continue }
      const spread = recipeDeskFloorSpread(plate.floor, labels.length)
      labels.forEach((label, n) => {
        const point = spread[n] ?? { x: plate.centre[0], y: plate.centre[1] }
        add(label, label.dataset['id'] ?? '', side, 'face', at(point.x, point.y))
      })
    }
    const em = Number.parseFloat(getComputedStyle(root).fontSize) || 16
    const faces = new Set(tabs.filter(tab => tab.into === 'face').map(tab => tab.id))
    for (const leader of recipeDeskSetLeaders(tabs, em / 16)) leaders.append(leaderOf(leader, faces.has(leader.id)))
    light()
  }

  /**
   * Size the desk from the room it has, seat everything, then draw the leaders
   * from the measured boxes. The room is reckoned from the desk's OWN box, its
   * width and its height less one line of header: sizes no layout changes. The
   * box under the header is never measured for it, because the header is taller
   * in one layout than in the other, and a desk resting on a threshold would
   * turn wide and narrow at every frame.
   */
  const layOut = (): void => {
    const width = root.clientWidth
    const tall = root.clientHeight
    if (width > 0 && tall > 0) {
      const em = Number.parseFloat(getComputedStyle(root).fontSize) || 16
      // A set is fitted where the plate was, at its own aspect.
      const aspect = setting && showingSet() ? setting.size[0] / setting.size[1] : undefined
      const room = { width, height: tall - RECIPE_DESK.headEm * em, em, list: tiles.length > 0, ...(fit ? { was: fit.layout } : {}), ...(aspect ? { aspect } : {}) }
      fit = recipeDeskFit(room)
      fit = recipeDeskFit({ ...room, rows: seat() })
      root.dataset['layout'] = fit.layout
      root.dataset['list'] = fit.list
      root.toggleAttribute('data-compact', fit.compact)
      root.style.setProperty('--hc-recipe-plate', `${fit.plate}px`)
      root.style.setProperty('--hc-recipe-figure-w', `${fit.figure.width}px`)
      root.style.setProperty('--hc-recipe-figure-h', `${fit.figure.height}px`)
      if (setting) setCanvas.style.transform = `scale(${fit.figure.width / setting.size[0]})`
      if (fit.layout === 'wide' && drawer) setDrawer(false)
    }
    seat()
    drawLeaders()
  }

  // ── the plate and its tools ─────────────────────────────────────────────

  /** The part whose pictures the strip under the plate arranges: the one holding the cover, else the first of its kind. */
  const shelfOf = (): Part | undefined => {
    const holding = parts.find(part => { const value = part.editor.value(); return value.kind === 'pictures' && value.pictures.length > 0 })
    return holding ?? parts.find(part => part.kind === 'pictures')
  }

  const focusStrip = (at: string): void => {
    const again = strip.querySelector<HTMLElement>(`[data-at="${at}"]`) ?? strip.querySelector<HTMLElement>('button') ?? chooseButton
    again.focus()
  }

  const drawFigure = (): void => {
    const cover = coverOf()
    // A chosen set is the surface: it stands where the plate and the dish picture would, and the pictures stay in their strip.
    const onSet = showingSet()
    root.toggleAttribute('data-set', onSet)
    setArt.hidden = !onSet
    plateArt.toggleAttribute('hidden', cover !== undefined || onSet)
    dish.hidden = cover === undefined || onSet
    invite.hidden = cover !== undefined || arranging || onSet
    figure.dataset['state'] = onSet ? 'set' : cover ? 'picture' : 'empty'
    drawSet()
    dishPicture.alt = say('recipe.cover.alt', 'Cover picture of {title}', { title })
    if (cover) {
      const src = tools.pictureUrl(cover)
      if (dishPicture.dataset['sig'] !== cover || (src && dishPicture.getAttribute('src') !== src)) {
        dishPicture.dataset['sig'] = cover
        if (src) dishPicture.src = src
      }
    }
    const shelf = arranging ? undefined : shelfOf()
    const held = shelf?.editor.value()
    const sigs = held?.kind === 'pictures' ? [...held.pictures] : []
    const put = (pictures: string[]): void => {
      if (!shelf) return
      shelf.editor.show({ kind: 'pictures', pictures })
      commit(shelf)
    }
    strip.replaceChildren(...sigs.map((sig, at) => {
      const n = at + 1
      const item = recipeEl('div', 'hc-recipe-strip-item')
      item.setAttribute('role', 'listitem')
      const thumb = recipeEl('button', 'hc-recipe-strip-thumb')
      thumb.type = 'button'
      thumb.dataset['at'] = `strip:${at}`
      thumb.setAttribute('aria-pressed', String(at === 0))
      thumb.setAttribute('aria-label', at === 0
        ? say('recipe.strip.cover', 'Picture {n}: the cover', { n })
        : say('recipe.strip.make-cover', 'Make picture {n} the cover', { n }))
      thumb.append(pictureOf(tools, sig, say('recipe.strip.alt', 'Picture {n}', { n })))
      thumb.addEventListener('click', () => {
        if (at === 0) return
        put([sig, ...sigs.filter(each => each !== sig)])
        focusStrip('strip:0')
      })
      const remove = tool('close', say('recipe.picture.remove', 'Remove picture {n}', { n }), `strip:${at}:remove`)
      remove.classList.add('hc-recipe-strip-remove')
      remove.addEventListener('click', () => {
        put(sigs.filter(each => each !== sig))
        focusStrip(`strip:${Math.min(at, sigs.length - 2)}:remove`)
      })
      item.append(thumb, remove)
      return item
    }))
    strip.hidden = sigs.length === 0
  }

  // ── the document ────────────────────────────────────────────────────────

  /** A part's own name changed with its key: its tab, its card and its labels follow. */
  const rename = (part: Part, key: string): void => {
    part.key = key
    part.element.dataset['key'] = key
    part.card.dataset['key'] = key
    const words = key.replace(/[-_]+/g, ' ')
    part.heading.textContent = words
    part.name.textContent = words
  }

  /**
   * Put a value under a key: a new document, announced. A value of another kind
   * already held under that key is moved aside first, never written over.
   */
  const write = (key: string, kind: RecipeSectionKind, value: RecipeValue): void => {
    const values: Record<string, RecipeValue> = { ...recipe.values }
    const there = values[key]
    const held = there && !isEmptyRecipeValue(there) ? there : undefined
    if (held && held.kind !== kind) {
      if (isEmptyRecipeValue(value)) return
      const aside = recipeSectionKey(`${key}-${held.kind}`, [...Object.keys(values), ...template.sections.map(section => section.key)])
      values[aside] = held
      const shown = parts.find(part => part.kept && part.key === key)
      if (shown) rename(shown, aside)
    } else if (held ? sameValue(held, value) : isEmptyRecipeValue(value)) return
    if (isEmptyRecipeValue(value)) delete values[key]
    else values[key] = value
    recipe = { ...(recipe.template !== undefined ? { template: recipe.template } : {}), values }
    options.onChange?.(recipe)
  }

  /** An ingredients section is drawn as its ingredients: one label each, and the rest counted. */
  const paintCallouts = (part: Part, value: RecipeValue): void => {
    for (const old of part.callouts) old.remove()
    const { shown, more } = recipeDeskCallouts(value.kind === 'ingredients' ? value.items : [])
    const label = (id: string, row: number): HTMLButtonElement => {
      const node = recipeEl('button', 'hc-recipe-callout')
      node.type = 'button'
      // The heading is the keyboard's way in; a label is the pointer's shortcut to one row.
      node.tabIndex = -1
      node.dataset['id'] = `${part.id}#${id}`
      node.dataset['row'] = String(row)
      node.addEventListener('click', () => openPart(part, row))
      return node
    }
    part.callouts = shown.map(each => {
      const node = label(String(each.at), each.at)
      if (each.amount) node.append(recipeEl('span', 'hc-recipe-callout-amount', each.amount))
      node.append(recipeEl('span', 'hc-recipe-callout-item', each.item))
      return node
    })
    if (more > 0) {
      const rest = label('more', shown.length)
      rest.classList.add('is-more')
      rest.append(recipeEl('span', 'hc-recipe-callout-item', say('recipe.callout.more', '+ {n} more', { n: more })))
      part.callouts.push(rest)
    }
    part.card.before(...part.callouts)
  }

  /** Say on the tab what the part holds now. */
  const describe = (part: Part, value: RecipeValue): void => {
    const summary = part.kind === 'ingredients' && isEmptyRecipeValue(value)
      ? say('recipe.summary.add-ingredients', 'add ingredients')
      : recipeSectionSummary(value, options.say)
    part.said.textContent = summary
    part.tab.title = `${part.name.textContent ?? ''}: ${summary}`
    if (part.kind === 'ingredients') paintCallouts(part, value)
  }

  /** An edit: the document takes it, and the drawing behind the card keeps up. */
  const commit = (part: Part): void => {
    const value = part.editor.value()
    write(part.key, part.kind, value)
    describe(part, value)
    if (part.kind === 'pictures') drawFigure()
    // The place card on its plate says what the part holds now.
    else if (showingSet()) drawSet()
    // New labels need their rows; anything else only moves the leaders' lit state.
    if (part.kind === 'ingredients') layOut()
    else drawLeaders()
  }

  // ── keeping the cook's place ────────────────────────────────────────────

  const growAll = (): void => { for (const area of stage.querySelectorAll('textarea')) grow(area) }

  const focusAt = (at: string): void => {
    const field = stage.querySelector<HTMLElement>(`[data-at="${at}"]:not(:disabled)`)
    field?.focus()
  }

  /** Redraw, and put focus, caret and scroll back where they were. */
  const keepingPlace = (work: () => void): void => {
    const active = doc.activeElement
    const held = active instanceof HTMLElement && stage.contains(active) ? active : null
    const at = held?.dataset['at']
    const inPart = held ? parts.findIndex(part => part.element.contains(held)) : -1
    const caret = held instanceof HTMLInputElement || held instanceof HTMLTextAreaElement ? [held.selectionStart, held.selectionEnd] as const : null
    const top = stage.scrollTop
    work()
    stage.scrollTop = top
    if (!held || held.isConnected || at === undefined) return
    const again = (inPart >= 0 ? parts[inPart]?.element : stage)?.querySelector<HTMLElement>(`[data-at="${at}"]`)
    if (!again) return
    again.focus()
    if (caret && (again instanceof HTMLInputElement || again instanceof HTMLTextAreaElement)) {
      try { again.setSelectionRange(caret[0], caret[1]) } catch { /* a field with no caret */ }
    }
  }

  // ── the card ────────────────────────────────────────────────────────────

  const shut = (part: Part): void => {
    part.card.hidden = true
    delete part.element.dataset['open']
    part.tab.setAttribute('aria-expanded', 'false')
  }

  /** Close the open card back to the drawing. Answers whether one was open. */
  const closeCard = (refocus = true): boolean => {
    const was = open
    if (!was) return false
    shut(was)
    open = null
    delete root.dataset['open']
    veil.hidden = true
    drawLeaders()
    if (refocus) was.tab.focus()
    return true
  }

  /** Open one part as the card down the middle. `row`: the ingredient whose label was pressed. */
  function openPart(part: Part, row?: number, focus = true): void {
    if (open && open !== part) shut(open)
    open = part
    part.card.hidden = false
    part.element.dataset['open'] = ''
    part.tab.setAttribute('aria-expanded', 'true')
    root.dataset['open'] = part.key
    veil.hidden = false
    for (const area of part.card.querySelectorAll('textarea')) grow(area)
    drawLeaders()
    if (!focus) return
    const fields = Array.from(part.card.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[data-at], textarea[data-at]')).filter(field => !field.disabled)
    const asked = row !== undefined && part.editor.rowOf ? part.card.querySelector<HTMLInputElement>(`[data-at="${part.editor.rowOf(row)}:item"]`) : null
    // A facts section opens on the first label still waiting for its value.
    const waiting = part.kind === 'facts' ? fields.find(field => field.dataset['at']?.endsWith(':value') && !field.value.trim()) : undefined
    const field = asked ?? waiting ?? fields[0] ?? part.card.querySelector<HTMLElement>('.hc-recipe-editor button:not(:disabled)') ?? part.card.querySelector<HTMLElement>('button')
    if (!field) return
    field.focus()
    caretToEnd(field)
  }

  // ── write ───────────────────────────────────────────────────────────────

  const makePart = ({ section, value, kept }: RecipeProjectedSection, index: number): Part => {
    const element = recipeEl('div', 'hc-recipe-part')
    element.dataset['key'] = section.key
    element.dataset['kind'] = section.kind
    const id = `p${index}`

    const name = recipeEl('span', 'hc-recipe-tab-label', section.label)
    const said = recipeEl('span', 'hc-recipe-tab-value')
    const tab = recipeEl('button', 'hc-recipe-tab')
    tab.type = 'button'
    tab.dataset['at'] = 'tab'
    tab.dataset['id'] = id
    tab.append(name, said)

    const card = recipeEl('section', 'hc-recipe-card')
    card.id = `hc-recipe-${serial}-card-${index}`
    card.dataset['key'] = section.key
    card.dataset['kind'] = section.kind
    card.hidden = true
    const label = recipeEl('h2', 'hc-recipe-label', section.label)
    label.id = `hc-recipe-${serial}-label-${index}`
    card.setAttribute('aria-labelledby', label.id)
    tab.setAttribute('aria-expanded', 'false')
    tab.setAttribute('aria-controls', card.id)

    const changed = (): void => commit(part)
    const editor = ((): Editor => {
      switch (section.kind) {
        case 'text': return textEditor(section, label.id, changed)
        case 'ingredients': return ingredientsEditor(tools, changed)
        case 'steps': return stepsEditor(tools, changed)
        case 'pictures': return picturesEditor(tools, section, changed)
        case 'links': return linksEditor(tools, changed)
        case 'facts': return factsEditor(tools, section, changed)
      }
    })()
    editor.show(value)

    // A text section asks through its placeholder. The others ask in a quiet line under the heading.
    const top = recipeEl('div', 'hc-recipe-card-head')
    top.append(label)
    if (section.prompt && section.kind !== 'text') top.append(recipeEl('p', 'hc-recipe-hint', section.prompt))
    const done = pressable(say('recipe.card.done', 'Done'), undefined, 'hc-recipe-btn is-line')
    done.dataset['at'] = 'done'
    done.addEventListener('click', () => closeCard())
    const foot = recipeEl('div', 'hc-recipe-card-foot')
    foot.append(done)
    card.append(top, editor.body, foot)
    element.append(tab, card)

    const part: Part = { id, key: section.key, kind: section.kind, kept: kept === true, element, tab, name, said, callouts: [], card, heading: label, editor }
    tab.addEventListener('click', () => { if (open === part) closeCard(); else openPart(part) })
    describe(part, value)
    return part
  }

  const alsoHeading = (): HTMLElement => recipeEl('p', 'hc-recipe-also', say('recipe.also', 'Also in this recipe'))

  const renderWrite = (): void => {
    const wasOpen = open?.key
    open = null
    delete root.dataset['open']
    veil.hidden = true
    arrangeRows = []
    parts = projectRecipe(template, recipe).map(makePart)
    const kept = parts.filter(part => part.kept)
    also = kept.length ? alsoHeading() : null
    partsHost.replaceChildren(...parts.filter(part => !part.kept).map(part => part.element), ...(also ? [also] : []), ...kept.map(part => part.element))
    // The same part stays open across a redraw; the cook's focus is put back by whoever asked for it.
    const again = wasOpen === undefined ? undefined : parts.find(part => part.key === wasOpen)
    if (again) openPart(again, undefined, false)
    drawFigure()
    layOut()
  }

  // ── arrange ─────────────────────────────────────────────────────────────

  /** A new layout: a new template document, announced. The recipe is not touched. */
  const relayout = (sections: readonly RecipeSection[], name = template.name): void => {
    template = recipeTemplateFrom(name, sections, template.description)
    showTemplate()
    options.onLayout?.(template)
  }

  const renderArrange = (): void => {
    parts = []
    open = null
    delete root.dataset['open']
    veil.hidden = true
    const sections = template.sections
    const keys = new Set(sections.map(section => section.key))
    const full = sections.length >= L.sections
    const rows: Seated[] = []
    const nodes: HTMLElement[] = []
    const row = (id: string, kept: boolean, extra = ''): HTMLElement => {
      const holder = recipeEl('div', 'hc-recipe-part')
      const line = recipeEl('div', `hc-recipe-tab hc-recipe-arrange-row${extra}`)
      line.dataset['id'] = id
      holder.append(line)
      rows.push({ id, kept, group: false, holder, tab: line, callouts: [] })
      nodes.push(holder)
      return line
    }

    const move = (at: number, by: -1 | 1): void => {
      const moved = [...template.sections]
      moved.splice(at + by, 0, ...moved.splice(at, 1))
      relayout(moved)
      renderArrange()
      const to = at + by
      const edge = by < 0 ? to === 0 : to === moved.length - 1
      focusAt(`${to}:${(by < 0) !== edge ? 'earlier' : 'later'}`)
    }
    sections.forEach((section, at) => {
      const n = at + 1
      const line = row(`a${at}`, false)
      line.dataset['key'] = section.key
      const label = lineField(`${at}:label`, say('recipe.arrange.label', 'Name of section {n}', { n }), L.label, section.label)
      label.addEventListener('input', () => {
        const words = oneLine(label.value, L.label)
        if (words) relayout(template.sections.map((each, i) => (i === at ? { ...each, label: words } : each)))
      })
      label.addEventListener('blur', () => { if (!oneLine(label.value, L.label)) label.value = template.sections[at]?.label ?? '' })
      const earlier = tool('up', say('recipe.arrange.earlier', 'Move section {n} earlier', { n }), `${at}:earlier`)
      const later = tool('down', say('recipe.arrange.later', 'Move section {n} later', { n }), `${at}:later`)
      const remove = tool('close', say('recipe.arrange.remove', 'Remove section {n} from the layout', { n }), `${at}:remove`)
      earlier.disabled = at === 0
      later.disabled = at === sections.length - 1
      // A template arranges at least one section.
      remove.disabled = sections.length === 1
      earlier.addEventListener('click', () => move(at, -1))
      later.addEventListener('click', () => move(at, 1))
      remove.addEventListener('click', () => {
        relayout(template.sections.filter((_, i) => i !== at))
        renderArrange()
        focusAt(`${Math.min(at, template.sections.length - 1)}:label`)
      })
      line.append(label, recipeEl('span', 'hc-recipe-tag', kindWords(section.kind)), earlier, later, remove)
    })

    const adding = row('add', false, ' hc-recipe-arrange-add')
    const kind = recipeEl('select', 'hc-recipe-field')
    kind.dataset['at'] = 'add:kind'
    kind.setAttribute('aria-label', say('recipe.arrange.kind', 'Kind of section'))
    for (const each of RECIPE_SECTION_KINDS) {
      const option = recipeEl('option', '', kindWords(each))
      option.value = each
      kind.append(option)
    }
    const fresh = lineField('add:label', say('recipe.arrange.new', 'Name of the new section'), L.label, '', say('recipe.arrange.new-short', 'add a part'))
    const go = tool('add', say('recipe.arrange.add', 'Add a section'), 'add:go')
    kind.disabled = fresh.disabled = go.disabled = full
    const addSection = (): void => {
      if (template.sections.length >= L.sections) return
      const chosen = kind.value as RecipeSectionKind
      const label = oneLine(fresh.value, L.label) || kindWords(chosen)
      relayout([...template.sections, { key: recipeSectionKey(label, template.sections.map(section => section.key)), kind: chosen, label }])
      renderArrange()
      focusAt(`${template.sections.length - 1}:label`)
    }
    go.addEventListener('click', addSection)
    fresh.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing) return
      event.preventDefault()
      addSection()
    })
    adding.append(kind, fresh, go)

    const kept = projectRecipe(template, recipe).filter(projected => projected.kept)
    also = kept.length ? alsoHeading() : null
    if (also) nodes.push(also)
    kept.forEach(({ section }, at) => {
      const line = row(`k${at}`, true, ' hc-recipe-kept-row')
      line.dataset['key'] = section.key
      line.append(recipeEl('span', 'hc-recipe-kept-name', section.label), recipeEl('span', 'hc-recipe-tag', kindWords(section.kind)))
      if (full || keys.has(section.key)) return
      const give = pressable(say('recipe.arrange.give', 'Make it a section'), undefined, 'hc-recipe-btn is-line')
      give.addEventListener('click', () => {
        const label = section.label.charAt(0).toUpperCase() + section.label.slice(1)
        relayout([...template.sections, { key: section.key, kind: section.kind, label: oneLine(label, L.label) || section.key }])
        renderArrange()
        focusAt(`${template.sections.length - 1}:label`)
      })
      line.append(give)
    })

    arrangeRows = rows
    partsHost.replaceChildren(...nodes)
    arrangeNote.textContent = full
      ? say('recipe.arrange.full', 'A layout holds at most {max} sections.', { max: L.sections })
      : say('recipe.arrange.hint', 'Rename, reorder, add or remove sections. Nothing you wrote is deleted: what a removed section held stays under "Also in this recipe".')
    drawFigure()
    layOut()
  }

  // ── read ────────────────────────────────────────────────────────────────

  const pageLabel = (words: string): HTMLElement => recipeEl('h2', 'hc-recipe-page-label', words)

  const framed = (sig: string, alt: string): HTMLElement => {
    const frame = recipeEl('figure', 'hc-recipe-picture')
    frame.append(pictureOf(tools, sig, alt))
    return frame
  }

  const pageOf = (page: RecipePage): HTMLElement => {
    const node = recipeEl('article', 'hc-recipe-page')
    node.dataset['page'] = page.kind
    switch (page.kind) {
      case 'cover': {
        node.append(recipeEl('h2', 'hc-recipe-cover-title', title))
        // The facts sit over the picture, so they are read at once on a short screen.
        if (page.facts.length) {
          const facts = recipeEl('dl', 'hc-recipe-facts')
          for (const fact of page.facts) {
            const pair = recipeEl('div')
            pair.append(recipeEl('dt', '', fact.label), recipeEl('dd', '', fact.value))
            facts.append(pair)
          }
          node.append(facts)
        }
        if (page.picture) node.append(framed(page.picture, say('recipe.cover.alt', 'Cover picture of {title}', { title })))
        break
      }
      case 'text':
        node.append(pageLabel(page.label), recipeEl('p', 'hc-recipe-prose', page.text))
        break
      case 'ingredients': {
        const items = recipeEl('ul', 'hc-recipe-check')
        page.items.forEach((item, at) => {
          const name = JSON.stringify([page.label, at, item.item])
          const box = recipeEl('input')
          box.type = 'checkbox'
          box.checked = ticked.has(name)
          box.addEventListener('change', () => { if (box.checked) ticked.add(name); else ticked.delete(name) })
          const words = recipeEl('span')
          if (item.amount) words.append(recipeEl('span', 'hc-recipe-amount', item.amount))
          words.append(recipeEl('span', '', item.item))
          if (item.note) words.append(recipeEl('span', 'hc-recipe-item-note', item.note))
          const line = recipeEl('label')
          line.append(box, words)
          const entry = recipeEl('li')
          entry.append(line)
          items.append(entry)
        })
        node.append(pageLabel(page.label), items)
        break
      }
      case 'step': {
        const n = page.at + 1
        node.append(
          pageLabel(page.label),
          recipeEl('p', 'hc-recipe-aside', say('recipe.read.step', 'Step {n} of {total}', { n, total: page.of })),
          recipeEl('p', 'hc-recipe-prose hc-recipe-step-words', page.step.text),
        )
        if (page.step.minutes !== undefined) node.append(recipeEl('p', 'hc-recipe-aside', say('recipe.read.minutes', '{n} min', { n: page.step.minutes })))
        if (page.step.picture) node.append(framed(page.step.picture, say('recipe.step.picture-alt', 'Picture of step {n}', { n })))
        break
      }
      case 'pictures': {
        const gallery = recipeEl('div', 'hc-recipe-gallery')
        page.pictures.forEach((sig, at) => gallery.append(pictureOf(tools, sig, say('recipe.picture.alt', '{label}: picture {n} of {total}', { label: page.label, n: at + 1, total: page.pictures.length }))))
        node.append(pageLabel(page.label), gallery)
        break
      }
      case 'links': {
        const links = recipeEl('ul', 'hc-recipe-links')
        for (const link of page.links) {
          const line = recipeEl('li')
          // Checked again here: a document handed in from anywhere still makes only http and https anchors.
          const href = recipeLinkUrl(link.url)
          if (href) {
            const anchor = recipeEl('a', '', link.label || href)
            anchor.href = href
            anchor.target = '_blank'
            anchor.rel = 'noopener noreferrer'
            line.append(anchor)
            if (recipeLinkIsVideo(href)) line.append(recipeEl('span', 'hc-recipe-tag', say('recipe.link.video', 'video')))
          } else line.append(recipeEl('span', '', link.label || link.url))
          links.append(line)
        }
        node.append(pageLabel(page.label), links)
        break
      }
    }
    return node
  }

  const renderRead = (): void => {
    parts = []
    arrangeRows = []
    open = null
    also = null
    delete root.dataset['open']
    veil.hidden = true
    partsHost.replaceChildren()
    leaders.replaceChildren()
    const projected = projectRecipe(template, recipe)
    const pages = recipePages(projected)
    const total = pages.length
    readAt = Math.min(Math.max(readAt, 0), total - 1)
    const blank = projected.every(({ value }) => isEmptyRecipeValue(value))
    nav.hidden = progress.hidden = blank
    if (blank) {
      const node = recipeEl('article', 'hc-recipe-page')
      node.dataset['page'] = 'empty'
      node.append(recipeEl('h2', 'hc-recipe-cover-title', title), recipeEl('p', 'hc-recipe-prose', say('recipe.read.empty', 'Nothing is written here yet.')))
      if (!readOnly) {
        const start = pressable(say('recipe.read.start', 'Start writing'), undefined, 'hc-recipe-btn is-solid')
        start.addEventListener('click', () => chooseMode('write'))
        node.append(start)
      }
      column.replaceChildren(node)
      return
    }
    column.replaceChildren(pageOf(pages[readAt]))
    previous.disabled = readAt === 0
    next.disabled = readAt === total - 1
    position.textContent = say('recipe.read.position', '{n} of {total}', { n: readAt + 1, total })
    fill.style.width = `${((readAt + 1) / total) * 100}%`
    progress.setAttribute('aria-valuemax', String(total))
    progress.setAttribute('aria-valuenow', String(readAt + 1))
  }

  const turn = (by: -1 | 1): void => {
    const from = readAt
    readAt += by
    renderRead()
    if (readAt !== from) scroll.scrollTop = 0
  }

  // ── the three faces ─────────────────────────────────────────────────────

  const render = (): void => {
    const reading = mode === 'read'
    root.dataset['mode'] = mode
    root.classList.toggle('is-arranging', arranging)
    writeButton.setAttribute('aria-pressed', String(mode === 'write'))
    readButton.setAttribute('aria-pressed', String(reading))
    arrangeButton.setAttribute('aria-pressed', String(arranging))
    stage.hidden = reading
    reader.hidden = !reading
    nav.hidden = progress.hidden = !reading
    naming.hidden = !arranging
    templateButton.hidden = arranging
    tableWrap.hidden = arranging
    if (arranging) openTableMenu(false)
    primaryWords.textContent = arranging ? say('recipe.arrange.done', 'Done arranging') : say('recipe.done', 'Done')
    if (pasteButton) pasteButton.hidden = arranging
    chooseButton.hidden = arranging
    arrangeNote.hidden = !arranging
    if (reading) {
      column.setAttribute('aria-live', 'polite')
      renderRead()
      return
    }
    column.removeAttribute('aria-live')
    column.replaceChildren()
    if (arranging) renderArrange()
    else renderWrite()
  }

  const applyMode = (to: 'write' | 'read'): void => {
    mode = readOnly ? 'read' : to
    arranging = false
    render()
    scroll.scrollTop = 0
  }

  /** The cook's own press: the mode changes and the caller hears of it. */
  const chooseMode = (to: 'write' | 'read'): void => {
    const from = mode
    applyMode(to)
    if (mode !== from) options.onMode?.(mode)
  }

  const setArranging = (on: boolean): void => {
    if (readOnly) return
    const from = mode
    mode = 'write'
    arranging = on
    render()
    if (from !== mode) options.onMode?.(mode)
    if (on) { naming.value = template.name; naming.focus(); caretToEnd(naming) }
    else {
      // The name field left with the arrangement: focus goes back to the button that opened it.
      const active = doc.activeElement
      if (!active || active === doc.body || active === naming) more.focus()
    }
  }

  const openMenu = (show: boolean, refocus = false): void => {
    menu.hidden = !show
    more.setAttribute('aria-expanded', String(show))
    if (show) Array.from(menu.querySelectorAll('button')).find(button => button.offsetParent !== null || !button.classList.contains('is-narrow-only'))?.focus()
    else if (refocus) more.focus()
  }

  // ── the list on the left ────────────────────────────────────────────────

  function setDrawer(on: boolean): void {
    drawer = on && tiles.length > 0
    root.toggleAttribute('data-drawer', drawer)
    drawerToggle.setAttribute('aria-expanded', String(drawer))
    if (drawer) (listRows.querySelector<HTMLElement>('[aria-current="true"]') ?? listRows.querySelector<HTMLElement>('button'))?.focus()
  }

  const drawList = (): void => {
    const shown = tiles.length > 0
    list.hidden = !shown
    drawerToggle.hidden = !shown
    const active = doc.activeElement instanceof HTMLElement && listRows.contains(doc.activeElement) ? doc.activeElement.dataset['label'] : undefined
    listRows.replaceChildren(...tiles.map(row => {
      const line = recipeEl('button', 'hc-recipe-list-row')
      line.type = 'button'
      line.dataset['label'] = row.label
      line.title = row.label
      if (row.current) line.setAttribute('aria-current', 'true')
      if (row.hasRecipe) line.setAttribute('aria-label', say('recipe.list.with-recipe', '{name}: holds a recipe', { name: row.label }))
      // The letter plate stands where a picture would: the name beside it is what a reader hears.
      const plate = recipeEl('span', 'hc-recipe-list-plate', Array.from(row.label.trim())[0] ?? '')
      plate.setAttribute('aria-hidden', 'true')
      line.append(plate, recipeEl('span', 'hc-recipe-list-name', row.label))
      if (row.hasRecipe) line.append(recipePlateMark())
      line.addEventListener('click', () => {
        setDrawer(false)
        if (!row.current) options.onPickTile?.(row.label)
      })
      return line
    }))
    if (active !== undefined) Array.from(listRows.querySelectorAll<HTMLElement>('button')).find(line => line.dataset['label'] === active)?.focus()
    if (!shown && drawer) setDrawer(false)
  }

  // ── pictures arriving ───────────────────────────────────────────────────

  const stepOf = (node: Element | null): StepDraft | undefined => {
    if (!node) return undefined
    for (const part of parts) {
      const step = part.editor.stepAt?.(node)
      if (step) return step
    }
    return undefined
  }

  /** True where a picture that arrives is the dish itself: on the stage, outside every card. */
  const onStage = (node: Element | null): boolean =>
    mode === 'write' && !arranging && !(node && node.closest('.hc-recipe-card'))

  /** A part made while writing joins the drawing. Nothing the cook is typing in is rebuilt. */
  const appendPart = (projected: RecipeProjectedSection): void => {
    const part = makePart(projected, parts.length)
    if (projected.kept && !also) {
      also = alsoHeading()
      partsHost.append(also)
    }
    partsHost.append(part.element)
    parts.push(part)
  }

  /**
   * Stored pictures join the first pictures section. With none on the desk they
   * are kept under `pictures`. `front`: they were put on the plate, so they lead
   * and the first of them is the cover.
   */
  const addPictures = (sigs: readonly string[], front: boolean): void => {
    const shelf = parts.find(part => part.kind === 'pictures')
    if (shelf?.editor.addPictures) {
      if (shelf.editor.addPictures(sigs)) tellFull(tools, L.pictures)
      const held = shelf.editor.value()
      if (front && held.kind === 'pictures') {
        const lead = sigs.filter(sig => held.pictures.includes(sig))
        shelf.editor.show({ kind: 'pictures', pictures: [...new Set([...lead, ...held.pictures])] })
      }
      commit(shelf)
      return
    }
    const projected = projectRecipe(template, recipe)
    const there = projected.find(({ section }) => section.kind === 'pictures')
    const key = there?.section.key
      ?? recipeSectionKey('pictures', Object.keys(recipe.values).filter(each => !isEmptyRecipeValue(recipe.values[each])))
    const before = there?.value.kind === 'pictures' ? there.value.pictures : []
    const pictures = [...new Set(front ? [...sigs, ...before] : [...before, ...sigs])]
    if (pictures.length > L.pictures) tellFull(tools, L.pictures)
    write(key, 'pictures', { kind: 'pictures', pictures: pictures.slice(0, L.pictures) })
    if (mode !== 'write' || arranging) { render(); return }
    const now = projectRecipe(template, recipe).find(({ section, kept }) => kept && section.key === key)
    if (now) appendPart(now)
    drawFigure()
    layOut()
  }

  /** Store what was pasted, dropped or chosen, and put it where the cook is: on that step, on the plate, or with the pictures. */
  const takeInNow = async (blobs: readonly Blob[], where: { step?: StepDraft; front?: boolean }): Promise<void> => {
    const images = blobs.filter(isPicture)
    const keep = options.takePictures
    if (readOnly || disposed || !images.length || !keep) return
    const chosenFor = sitting
    const step = where.step
    const front = where.front === true && !step
    const onStep = step ? parts.find(part => part.editor.holds?.(step)) : undefined
    const shelf = parts.find(part => part.kind === 'pictures')
    const waiting = images.length - (onStep ? 1 : 0)
    if (onStep && step) onStep.editor.stepPicture?.(step, null, true)
    if (waiting > 0) shelf?.editor.storing?.(waiting)
    if (front) storingNote.hidden = false
    setStatus(adding)
    let sigs: string[] = []
    try {
      sigs = [...await keep(images)].filter(sig => typeof sig === 'string' && SIG.test(sig))
    } catch { sigs = [] }
    if (disposed) return
    if (chosenFor !== sitting) {
      // Another recipe took the desk while these were stored. They were chosen for the one that left: put in this one, they would be saved into another tile.
      setStatus(images.length === 1
        ? say('recipe.picture.left.one', 'The picture you were adding to the recipe you left was not added to it. Add it again there.')
        : say('recipe.picture.left.other', 'The pictures you were adding to the recipe you left were not added to it. Add them again there.'), 'bad')
      return
    }
    if (waiting > 0) shelf?.editor.storing?.(-waiting)
    storingNote.hidden = true
    if (status.textContent === adding) setStatus('')
    if (sigs.length < images.length) setStatus(say('recipe.picture.failed', 'A picture could not be stored.'), 'bad')
    if (onStep && step) {
      const still = parts.includes(onStep) && onStep.editor.holds?.(step) === true
      onStep.editor.stepPicture?.(step, still ? sigs.shift() ?? null : null, false)
      if (still) commit(onStep)
    }
    if (sigs.length) addPictures(sigs, front)
  }

  /** One intake, held until it has landed or been dropped: `settled` waits on every one of them. */
  const takeIn = (blobs: readonly Blob[], where: { step?: StepDraft; front?: boolean } = {}): Promise<void> => {
    const work = takeInNow(blobs, where)
    const over = (): void => { intakes.delete(work) }
    intakes.add(work)
    work.then(over, over)
    return work
  }

  async function fromClipboard(front: boolean): Promise<void> {
    let blobs: readonly Blob[] = []
    try { blobs = await options.clipboardPictures?.() ?? [] } catch {
      setStatus(say('recipe.picture.clipboard-refused', 'The clipboard could not be read.'), 'bad')
      return
    }
    if (!blobs.some(isPicture)) {
      setStatus(say('recipe.picture.none', 'There is no picture on the clipboard.'))
      return
    }
    await takeIn(blobs, { front })
  }

  // ── what the desk listens for ───────────────────────────────────────────

  /** The picker is the drone's panel over the desk. While it is up, keys and pastes are its own. */
  const pickerOpen = (): boolean => doc.querySelector('.hc-recipe-picker') !== null

  /**
   * A paste that carries picture files is the desk's: stored, placed where the
   * cook is, and stopped here so the hive's own paste never also makes a tile
   * of it. Words pasted into a field stay words, even when a picture rides along.
   */
  const onPaste = (event: ClipboardEvent): void => {
    if (disposed || pickerOpen()) return
    const data = event.clipboardData
    const images = picturesIn(data)
    if (!images.length) return
    const active = doc.activeElement instanceof HTMLElement && root.contains(doc.activeElement) ? doc.activeElement : null
    const typing = active?.matches('input:not([type="checkbox"]):not([type="file"]), textarea') === true
    if (typing && data && typeof data.getData === 'function' && data.getData('text/plain').trim()) return
    event.preventDefault()
    event.stopPropagation()
    const step = stepOf(active)
    void takeIn(images, { ...(step ? { step } : {}), front: onStage(active) })
  }

  const onKey = (event: KeyboardEvent): void => {
    if (disposed || event.defaultPrevented || pickerOpen()) return
    if (event.key === 'Escape') {
      // Stopped here: nothing behind the desk also takes it. One rung a press.
      event.preventDefault()
      event.stopPropagation()
      if (!menu.hidden) openMenu(false, true)
      else if (!tableMenu.hidden) openTableMenu(false, true)
      else if (drawer) { setDrawer(false); drawerToggle.focus() }
      else if (closeCard()) return
      else if (arranging) setArranging(false)
      else options.onClose()
      return
    }
    if (mode !== 'read' || event.altKey || event.ctrlKey || event.metaKey) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('input:not([type="checkbox"]), textarea, select, [contenteditable]')) return
    let by: -1 | 1 | 0 = 0
    if (event.key === 'ArrowRight' || event.key === 'PageDown') by = 1
    else if (event.key === 'ArrowLeft' || event.key === 'PageUp') by = -1
    else if (event.key === ' ' && !target?.closest('button, a, input, summary')) by = event.shiftKey ? -1 : 1
    if (!by) return
    event.preventDefault()
    event.stopPropagation()
    turn(by)
  }

  /** With nothing focused, a key or a paste lands on the document: the desk takes those too while it is up. */
  const fromNowhere = (event: Event): boolean =>
    root.isConnected && (event.target === doc.body || event.target === doc.documentElement || event.target === doc)
  const onDocumentPaste = (event: ClipboardEvent): void => { if (fromNowhere(event)) onPaste(event) }
  const onDocumentKey = (event: KeyboardEvent): void => { if (fromNowhere(event)) onKey(event) }

  const carriesFiles = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes('Files')
  const drawingId = (target: EventTarget | null): string =>
    (target instanceof Element ? target.closest('[data-id]')?.getAttribute('data-id') : null) ?? ''

  root.addEventListener('paste', onPaste)
  root.addEventListener('keydown', onKey)
  doc.addEventListener('paste', onDocumentPaste, true)
  doc.addEventListener('keydown', onDocumentKey, true)
  root.addEventListener('dragover', event => {
    if (!carriesFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    if (!readOnly) root.classList.add('is-dropping')
  })
  root.addEventListener('dragleave', event => {
    if (!(event.relatedTarget instanceof Node) || !root.contains(event.relatedTarget)) root.classList.remove('is-dropping')
  })
  root.addEventListener('drop', event => {
    if (!carriesFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    root.classList.remove('is-dropping')
    const target = event.target instanceof Element ? event.target : null
    const step = stepOf(target)
    void takeIn(picturesIn(event.dataTransfer), { ...(step ? { step } : {}), front: onStage(target) })
  })
  root.addEventListener('pointerdown', event => {
    if (!menu.hidden && !(event.target instanceof Node && moreWrap.contains(event.target))) openMenu(false)
    if (!tableMenu.hidden && !(event.target instanceof Node && tableWrap.contains(event.target))) openTableMenu(false)
  })
  stage.addEventListener('pointerover', event => { const id = drawingId(event.target); if (id !== hot) { hot = id; light() } })
  stage.addEventListener('pointerleave', () => { if (hot) { hot = ''; light() } })
  stage.addEventListener('focusin', event => { const id = drawingId(event.target); if (id !== focused) { focused = id; light() } })
  stage.addEventListener('focusout', () => { if (focused) { focused = ''; light() } })
  // A press on the dimmed stage closes the card back to the drawing.
  veil.addEventListener('click', () => { closeCard() })
  scrim.addEventListener('click', () => setDrawer(false))
  chooser.addEventListener('change', () => {
    const { step, front } = chooseFor
    chooseFor = { front: false }
    void takeIn(Array.from(chooser.files ?? []), { ...(step ? { step } : {}), front })
  })

  drawerToggle.addEventListener('click', () => setDrawer(!drawer))
  templateButton.addEventListener('click', () => options.onPickTemplate?.())
  tableButton.addEventListener('click', () => openTableMenu(tableMenu.hidden))
  settingChooser.addEventListener('change', () => {
    const files = Array.from(settingChooser.files ?? [])
    settingChooser.value = ''
    if (files.length) options.table?.add(files)
  })
  writeButton.addEventListener('click', () => chooseMode('write'))
  readButton.addEventListener('click', () => chooseMode('read'))
  bulb.addEventListener('click', () => options.onToggleShared?.())
  browse.addEventListener('click', () => options.onBrowse?.())
  browseItem.addEventListener('click', () => { openMenu(false, true); options.onBrowse?.() })
  more.addEventListener('click', () => openMenu(menu.hidden))
  arrangeButton.addEventListener('click', () => {
    openMenu(false)
    setArranging(!arranging)
  })
  keepButton.addEventListener('click', () => { openMenu(false, true); options.onKeepTemplate?.() })
  tileButton.addEventListener('click', () => { openMenu(false, true); options.onEditTile?.() })
  primary.addEventListener('click', () => { if (arranging) setArranging(false); else options.onClose() })
  action?.addEventListener('click', () => options.primaryAction?.onPress())
  close.addEventListener('click', () => options.onClose())
  upload.addEventListener('click', () => pick(undefined, true))
  // The dish is the pictures' part drawn large: a press on it opens that card. Its tab is the keyboard's way in.
  dish.addEventListener('click', () => {
    const shelf = shelfOf()
    if (shelf) openPart(shelf)
  })
  chooseButton.addEventListener('click', () => pick(undefined, true))
  pasteButton?.addEventListener('click', () => { void fromClipboard(true) })
  previous.addEventListener('click', () => turn(-1))
  next.addEventListener('click', () => turn(1))
  naming.addEventListener('input', () => {
    const name = oneLine(naming.value, L.name)
    if (name) relayout(template.sections, name)
  })
  naming.addEventListener('blur', () => { if (!oneLine(naming.value, L.name)) naming.value = template.name })

  // The desk is measured once it has a size, and again whenever that changes: the plate, the seats and the leaders follow.
  // The box under the header is watched for the leaders alone (it moves what they join): it decides nothing, so a callback it causes changes no size.
  const watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (!disposed) { layOut(); growAll() } }) : null
  watcher?.observe(root)
  watcher?.observe(body)

  showTemplate()
  showTable()
  buildSet()
  showAddress(options.address ?? '')
  showShared()
  drawList()
  render()

  return {
    element: root,
    setRecipe(to, how) {
      recipe = { ...(to.template !== undefined ? { template: to.template } : {}), values: { ...to.values } }
      if (how?.fresh) {
        // Another recipe: nothing of the one that left is carried into it. Not its pictures still being stored,
        // not the read-along's page or its ticks, not the open card, not the scroll.
        sitting++
        readAt = 0
        ticked.clear()
        open = null
        storingNote.hidden = true
        if (status.textContent === adding) setStatus('')
        // The desk opens again: a set whose pictures did not arrive is tried once more.
        if (setting && setBroken) { buildSet(); showTable() }
        render()
        scroll.scrollTop = stage.scrollTop = 0
        return
      }
      if (mode === 'read' || arranging) { keepingPlace(render); return }
      const projected = projectRecipe(template, recipe)
      const sameParts = projected.length === parts.length
        && projected.every(({ section, kept }, at) => parts[at].key === section.key && parts[at].kind === section.kind && parts[at].kept === (kept === true))
      if (!sameParts) { keepingPlace(renderWrite); return }
      // The same parts: only a value that reads differently is shown again, so a save echoed back touches nothing.
      projected.forEach(({ value }, at) => {
        const part = parts[at]
        if (sameValue(part.editor.value(), value)) return
        keepingPlace(() => part.editor.show(value))
        describe(part, value)
      })
      for (const img of root.querySelectorAll<HTMLImageElement>('img[data-sig]')) {
        const src = tools.pictureUrl(img.dataset['sig'] ?? '')
        if (src && img.getAttribute('src') !== src) img.src = src
      }
      drawFigure()
      layOut()
    },
    setTemplate(to) {
      template = to
      showTemplate()
      keepingPlace(render)
    },
    setTitle(to) {
      title = to
      heading.textContent = to
      if (mode === 'read') renderRead()
      else drawFigure()
    },
    setMode: applyMode,
    mode: () => mode,
    setStatus,
    recipe: () => recipe,
    setTiles(to) {
      tiles = readOnly ? [] : to
      drawList()
      layOut()
    },
    setShared(to) {
      shared = to
      showShared()
    },
    setAddress: showAddress,
    setSetting(to) {
      if (to === setting && !setBroken) return
      setting = to
      buildSet()
      showTable()
      if (mode === 'read') return
      // Another surface: the seats, the leaders and the place cards are laid again; what the cook is typing is not rebuilt.
      drawFigure()
      layOut()
    },
    setSettings(to) {
      settingsMenu = to
      if (tableMenu.hidden) return
      // The list grows while it is open (the domains answer one by one): the item in focus keeps it.
      // A remove press shows no words: it is known by its label.
      const wordsOf = (item: Element): string => item.getAttribute('aria-label') ?? item.textContent ?? ''
      const focusedWords = doc.activeElement instanceof HTMLElement && tableMenu.contains(doc.activeElement) ? wordsOf(doc.activeElement) : null
      drawTableMenu()
      if (focusedWords !== null) Array.from(tableMenu.querySelectorAll<HTMLElement>('button')).find(item => wordsOf(item) === focusedWords)?.focus()
    },
    async settled() {
      // An intake may start while the last is awaited: asked again until none is left.
      while (intakes.size) await Promise.allSettled([...intakes])
    },
    dispose() {
      disposed = true
      watcher?.disconnect()
      doc.removeEventListener('paste', onDocumentPaste, true)
      doc.removeEventListener('keydown', onDocumentKey, true)
      root.remove()
    },
  }
}
