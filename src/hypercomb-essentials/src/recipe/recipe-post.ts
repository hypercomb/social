// recipe/recipe-post.ts
//
// THE PAGE A PHONE POSTS FROM (documentation/open-entry-pools.md, "The page a
// phone sees"). Someone in the room scans the leader's code and lands on the
// leader's page with `#post=`; the post bee (recipe-post.drone.ts) reads the
// pool and hands this file what to draw. This file is the form and the list
// under it, and the plain rules that turn what was typed into an entry:
//
//   THE FORM   the name the person goes by, the entry's title, then one part
//              per section of the pool's template: text, ingredients, steps,
//              facts and links, each typed as plain lines. Pictures are left
//              out (a poster the host does not admit cannot upload one) and
//              the page says so.
//   THE ENTRY  what was typed, as a recipe document the reader accepts
//              (parseRecipe), naming the template and nothing else. A line
//              that is not what its section holds is refused in words, never
//              dropped quietly.
//   THE LIST   what has been posted, drawn with the catalogue's own cards
//              (recipe-catalogue.ts), and a row opened in the read-along
//              (recipe-page.ts, read-only). Both read on a visitor door.
//
// PURE DOM. No IoC, no network, no EffectBus, no registration, and nothing
// listens until a page is made: every listener belongs to the page it is
// bound in and goes with it. Everything the page does leaves through a
// callback, and everything it shows arrives through its handle.
//
// TEXT ONLY (T7). Words reach the page through textContent and field values,
// and a link is a plain anchor that is never fetched.

import { ENTRY_LIMITS, isEntryLine } from '../pools/open-entries.js'
import { recipeCatalogue, type RecipeCatalogueHandle, type RecipeCatalogueRow } from './recipe-catalogue.js'
import { recipePage, splitIngredientLine, splitStepLines, type RecipePageHandle } from './recipe-page.js'
import { ensureRecipePostStyles } from './recipe-post-style.js'
import { ensureRecipeStyles, recipeEl, recipeMark, recipeWords, type RecipeSay } from './recipe-style.js'
import {
  isEmptyRecipeValue,
  parseRecipe,
  recipeBytes,
  recipeLinkUrl,
  type RecipeDocument,
  type RecipeFact,
  type RecipeLink,
  type RecipeSection,
  type RecipeTemplateDocument,
  type RecipeValue,
} from './recipe-template.js'

/** Every post, change and take-back is one of these: a reader keeps the newest 8 of a key, and so does the host. */
export const RECIPE_POST_CHANGES = ENTRY_LIMITS.perKey

// ── the rules ───────────────────────────────────────────────────────────────

/** The sections a poster fills, and the picture sections the page leaves out and says so. */
export function recipePostSections(template: Pick<RecipeTemplateDocument, 'sections'>): {
  readonly asked: readonly RecipeSection[]
  readonly leftOut: readonly RecipeSection[]
} {
  const sections = Array.isArray(template?.sections) ? template.sections : []
  return { asked: sections.filter(section => section.kind !== 'pictures'), leftOut: sections.filter(section => section.kind === 'pictures') }
}

/** What the person typed: their name, the entry's title, and each section's words by its key. */
export interface RecipePostFields {
  readonly name: string
  readonly title: string
  readonly values: Readonly<Record<string, string>>
}

const linesOf = (text: string): string[] => String(text ?? '').split(/\r\n|\r|\n/).map(line => line.trim()).filter(Boolean)

/** One section's words as the value the format holds, or the sentence that says which line is not right. */
function valueOf(section: RecipeSection, text: string, say: RecipeSay): RecipeValue | string {
  const words = (key: string, fallback: string, params?: Record<string, string | number>): string => recipeWords(say, key, fallback, params)
  switch (section.kind) {
    case 'text':
      return { kind: 'text', text: String(text ?? '').replace(/\r\n?/g, '\n').trim() }
    case 'ingredients':
      return {
        kind: 'ingredients',
        items: linesOf(text).map(line => {
          const split = splitIngredientLine(line)
          return split.amount ? { amount: split.amount, item: split.item } : { item: split.item }
        }),
      }
    case 'steps':
      return { kind: 'steps', steps: splitStepLines(text).map(step => ({ text: step })) }
    case 'links': {
      const links: RecipeLink[] = []
      for (const [at, line] of linesOf(text).entries()) {
        const parts = line.split(/\s+/)
        const index = parts.findIndex(part => recipeLinkUrl(part) !== null)
        if (index < 0) {
          return words('recipe.post.form.link', 'In {label}, line {n} is not a link. A link begins with https://.', { label: section.label, n: at + 1 })
        }
        const url = recipeLinkUrl(parts[index] as string) as string
        const label = [...parts.slice(0, index), ...parts.slice(index + 1)].join(' ').trim()
        links.push(label ? { url, label } : { url })
      }
      return { kind: 'links', links }
    }
    case 'facts': {
      const facts: RecipeFact[] = []
      for (const [at, line] of linesOf(text).entries()) {
        const colon = line.indexOf(':')
        if (colon <= 0) {
          return words('recipe.post.form.fact', 'In {label}, write line {n} as a name, a colon and its value, like "Serves: 4".', { label: section.label, n: at + 1 })
        }
        const value = line.slice(colon + 1).trim()
        // A suggested name with nothing after it was not answered.
        if (value) facts.push({ label: line.slice(0, colon).trim(), value })
      }
      return { kind: 'facts', facts }
    }
    case 'pictures':
      return { kind: 'pictures', pictures: [] }
  }
}

/**
 * What was typed as a recipe document, written into `template` (its
 * signature) and naming nothing else. `problem` is the first line that is not
 * what its section holds; the document then holds every other section, which
 * is what the room left is measured on while the person is still typing.
 */
export function recipePostDocument(
  template: { readonly sig: string; readonly sections: readonly RecipeSection[] },
  fields: RecipePostFields,
  say: RecipeSay,
): { readonly recipe: RecipeDocument; readonly problem?: string } {
  const values: Record<string, RecipeValue> = {}
  let problem: string | undefined
  for (const section of recipePostSections(template).asked) {
    const value = valueOf(section, fields.values?.[section.key] ?? '', say)
    if (typeof value === 'string') { problem ??= value; continue }
    if (!isEmptyRecipeValue(value)) values[section.key] = value
  }
  return { recipe: { template: template.sig, values }, ...(problem ? { problem } : {}) }
}

export type RecipePostBuilt =
  | { readonly ok: true; readonly name: string; readonly title: string; readonly recipe: RecipeDocument; readonly content: string }
  | { readonly ok: false; readonly reason: string }

/**
 * The entry a press posts: the name and title kept to the reader's one-line
 * rule, and the recipe as the canonical bytes the reader accepts, as text (the
 * member's `content`). Refused in words for a name or title out of its rule, a
 * line that is not what its section holds, nothing written, or a document the
 * reader would refuse. Never throws.
 */
export async function recipePostRecipe(
  template: { readonly sig: string; readonly sections: readonly RecipeSection[] },
  fields: RecipePostFields,
  say: RecipeSay,
): Promise<RecipePostBuilt> {
  const words = (key: string, fallback: string, params?: Record<string, string | number>): string => recipeWords(say, key, fallback, params)
  try {
    const name = String(fields?.name ?? '').trim()
    const title = String(fields?.title ?? '').trim()
    if (!isEntryLine(name, ENTRY_LIMITS.name)) {
      return { ok: false, reason: words('recipe.post.form.name', 'Write the name you go by: one line of 1 to {max} characters.', { max: ENTRY_LIMITS.name }) }
    }
    if (!isEntryLine(title, ENTRY_LIMITS.title)) {
      return { ok: false, reason: words('recipe.post.form.title', 'Give your entry a title: one line of 1 to {max} characters.', { max: ENTRY_LIMITS.title }) }
    }
    const made = recipePostDocument(template, fields, say)
    if (made.problem) return { ok: false, reason: made.problem }
    if (!Object.keys(made.recipe.values).length) {
      return { ok: false, reason: words('recipe.post.form.empty', 'Write something in your entry before you post it.') }
    }
    const bytes = recipeBytes(made.recipe)
    const read = await parseRecipe(bytes)
    if (!read.ok) return { ok: false, reason: words('recipe.post.form.unread', 'This entry cannot be posted: {reason}.', { reason: read.reason }) }
    return { ok: true, name, title, recipe: made.recipe, content: new TextDecoder().decode(bytes) }
  } catch {
    return { ok: false, reason: words('recipe.post.form.failed', 'This entry could not be made.') }
  }
}

/** Where the person stands with their own entry: nothing posted yet, posted, or taken back. */
export type RecipePostStanding = 'none' | 'posted' | 'gone'

/**
 * What the person may still do. Every post, change and take-back spends one
 * of 8, and the last is kept for a take-back: posting needs two left, taking
 * back one, and only a posted entry can be taken back.
 */
export function recipePostChanges(used: number, standing: RecipePostStanding): { readonly left: number; readonly post: boolean; readonly takeBack: boolean } {
  const spent = Number.isSafeInteger(used) && used > 0 ? used : 0
  return {
    left: Math.max(0, RECIPE_POST_CHANGES - spent),
    post: spent < RECIPE_POST_CHANGES - 1,
    takeBack: standing === 'posted' && spent < RECIPE_POST_CHANGES,
  }
}

/**
 * The host's refusal of an entry PUT, as a sentence in the page's language.
 * The Cloudflare host (hypercomb-relay/blossom-worker/worker.js, putEntryMember)
 * says why in English on X-Reason; each reason it sends is matched here, and
 * one it does not know is kept in the host's own words inside a sentence of ours.
 */
export function recipePostRefusal(said: string, say: RecipeSay): string {
  const words = String(said ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200)
  const reason = words.toLowerCase()
  if (!reason) return ''
  if (reason === 'this one is closed') return recipeWords(say, 'recipe.post.refused.closed', 'This one is closed, so your entry was not posted.')
  if (reason === 'this one has expired') return recipeWords(say, 'recipe.post.refused.expired', 'This one has expired, so your entry was not posted.')
  if (reason === 'this one is full') return recipeWords(say, 'recipe.post.refused.full', 'This one is full, so your entry was not posted.')
  if (/^this key has posted its \d+ here/.test(reason)) {
    return recipeWords(say, 'recipe.post.refused.changes', 'You have used all {max} changes here.', { max: ENTRY_LIMITS.perKey })
  }
  if (/^an entry is at most \d+ bytes/.test(reason)) return recipeWords(say, 'recipe.post.refused.size', 'Your entry is too long for this host.')
  if (reason.startsWith('entry stamp is more than')) {
    return recipeWords(say, 'recipe.post.refused.clock', 'This host\'s clock and this phone\'s are too far apart. Try again.')
  }
  if (/^an entry carries a (name|title)/.test(reason)) {
    return recipeWords(say, 'recipe.post.refused.lines', 'The host did not take your name or title as written. Keep each to one short line.')
  }
  if (['no pool is open at this address', 'this host holds no pools', 'this address belongs to another pool', 'this address is not an entry pool'].includes(reason)) {
    return recipeWords(say, 'recipe.post.refused.unknown', 'This host is not taking posts for this code.')
  }
  if (reason === 'this address holds too much' || reason === 'this host could not take the entry') {
    return recipeWords(say, 'recipe.post.refused.busy', 'This host could not take your entry just now. Try again in a moment.')
  }
  if (/^(member bytes do not hash|body is not a json|wrong event kind|an entry is the seven fields|an entry carries one pool|an entry is spelled|the id is not|entry is not tagged|an entry names its page|invalid entry signature)/.test(reason)) {
    return recipeWords(say, 'recipe.post.refused.unread', 'This host could not read the entry this page made, so it was not posted.')
  }
  return recipeWords(say, 'recipe.post.refused.other', 'The host did not take your entry. It said: {said}', { said: words })
}

/** When a pool ends, as this reader's clock and language say it. */
export function recipePostEnds(until: number, locale?: string): string {
  const when = new Date(Math.floor(Number(until)) * 1000)
  try { return new Intl.DateTimeFormat(locale || undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(when) } catch { return when.toISOString() }
}

// ── the page ────────────────────────────────────────────────────────────────

export interface RecipePostPageOptions {
  say: RecipeSay
  /** The pool's title. */
  title: string
  /** The page's own Close. */
  onClose(): void
  /** A field changed: the caller measures again. */
  onInput(): void
  onPost(): void
  onTakeBack(): void
  /** A posted row was chosen. */
  onOpen(sig: string): void
  /** Try again: ask the host once more for the same code. */
  onRetry?(): void
}

/** What a recipe opened from the list is shown with. */
export interface RecipePostReading {
  readonly title: string
  readonly recipe: RecipeDocument
  readonly template: RecipeTemplateDocument
}

export interface RecipePostPageHandle {
  readonly element: HTMLElement
  setTitle(title: string): void
  /** The pool's state as one sentence, and when it ends ('' for no end line). */
  setState(words: string, ends?: string): void
  /** Offer Try again under the state (after the host did not answer), or take it away. */
  setRetry(on: boolean): void
  /** Put focus on the page's heading: where a reader starts. */
  focus(): void
  /** Draw the form for this template, or take it away (null). The same template again keeps what was typed. */
  setForm(template: RecipeTemplateDocument | null): void
  /** What is typed now. */
  fields(): RecipePostFields
  /** The plain measure: room left and changes left. `over` when the entry does not fit. */
  setMeasure(words: string, over?: boolean): void
  /** Which presses are open now. `posted` names the press for a change; `sending` names the press under way. */
  setActions(actions: { readonly post: boolean; readonly takeBack: boolean; readonly posted: boolean; readonly sending?: 'post' | 'back' | null }): void
  /** Where the entry went, or the host's own words. */
  setSaid(words: string, tone?: 'plain' | 'good' | 'bad'): void
  /** What has been posted, with one quiet line about it; null takes the list away. */
  setPosted(rows: readonly RecipeCatalogueRow[] | null, note?: string): void
  /** A posted recipe in the read-along, over the page, until it is closed. Focus moves into it. */
  showRecipe(reading: RecipePostReading): void
  /** Close the read-along: focus goes back to the row it was opened from. */
  closeRecipe(): void
  dispose(): void
}

let pagesMade = 0

/** A hint for a section: what its template asks, then how its words are typed here. */
const hintOf = (section: RecipeSection, say: RecipeSay): string => {
  const words = (key: string, fallback: string): string => recipeWords(say, key, fallback)
  const how = section.kind === 'ingredients' ? words('recipe.post.hint.ingredients', 'One a line, the amount first: 2 cups flour.')
    : section.kind === 'steps' ? words('recipe.post.hint.steps', 'One step a line.')
      : section.kind === 'links' ? words('recipe.post.hint.links', 'One link a line, with any words about it after it.')
        : section.kind === 'facts' ? words('recipe.post.hint.facts', 'One a line, a name and its value: Serves: 4.')
          : ''
  return [section.prompt ?? '', how].filter(Boolean).join(' ')
}

/** Build the page. Its caller reads the pool, mounts it, and acts on what a press asks. */
export function recipePostPage(options: RecipePostPageOptions): RecipePostPageHandle {
  const doc = document
  ensureRecipeStyles(doc)
  ensureRecipePostStyles(doc)
  const say = (key: string, fallback: string, params?: Record<string, string | number>): string => recipeWords(options.say, key, fallback, params)
  const serial = `hc-recipe-post-${++pagesMade}`
  let disposed = false
  let template: RecipeTemplateDocument | null = null
  let fieldsByKey = new Map<string, HTMLTextAreaElement>()
  let catalogue: RecipeCatalogueHandle | null = null
  let reading: RecipePageHandle | null = null
  const offs: (() => void)[] = []
  const on = (target: EventTarget, type: string, handler: (event: Event) => void): void => {
    target.addEventListener(type, handler)
    offs.push(() => target.removeEventListener(type, handler))
  }

  // ── the frame ───────────────────────────────────────────────────────────

  const root = recipeEl('section', 'hc-recipe hc-recipe-post')
  root.setAttribute('aria-labelledby', `${serial}-title`)
  // The page owns its surface: without this the hive's wheel handler takes the wheel and nothing scrolls.
  root.setAttribute('data-consumes-wheel', '')
  const heading = recipeEl('h1', 'hc-recipe-title', options.title)
  heading.id = `${serial}-title`
  // Focus lands here when the page opens, so a reader starts at the pool's name.
  heading.tabIndex = -1
  const closeWords = say('recipe.post.close', 'Close')
  const close = recipeEl('button', 'hc-recipe-tool')
  close.type = 'button'
  close.title = closeWords
  close.setAttribute('aria-label', closeWords)
  close.append(recipeMark('close'))
  on(close, 'click', () => options.onClose())
  const head = recipeEl('header', 'hc-recipe-head')
  head.append(heading, close)

  const state = recipeEl('p', 'hc-recipe-post-state')
  state.setAttribute('role', 'status')
  const ends = recipeEl('p', 'hc-recipe-post-quiet')
  ends.hidden = true
  const retry = recipeEl('button', 'hc-recipe-btn hc-recipe-post-retry', say('recipe.post.retry', 'Try again'))
  retry.type = 'button'
  retry.hidden = true
  on(retry, 'click', () => {
    if (retry.hidden) return
    retry.hidden = true
    // The press goes away under the finger: focus waits on the heading, not on nothing.
    heading.focus()
    options.onRetry?.()
  })

  // ── the form ────────────────────────────────────────────────────────────

  const nameField = recipeEl('input', 'hc-recipe-field')
  nameField.type = 'text'
  nameField.maxLength = ENTRY_LIMITS.name
  nameField.setAttribute('autocomplete', 'nickname')
  const titleField = recipeEl('input', 'hc-recipe-field')
  titleField.type = 'text'
  titleField.maxLength = ENTRY_LIMITS.title
  titleField.autocomplete = 'off'
  on(nameField, 'input', () => options.onInput())
  on(titleField, 'input', () => options.onInput())

  const part = (id: string, label: string, control: HTMLElement, hint?: string): HTMLElement => {
    const box = recipeEl('div', 'hc-recipe-post-part')
    const caption = recipeEl('label', 'hc-recipe-label', label)
    caption.htmlFor = id
    control.id = id
    box.append(caption)
    if (hint) {
      const said = recipeEl('p', 'hc-recipe-hint', hint)
      said.id = `${id}-hint`
      control.setAttribute('aria-describedby', said.id)
      box.append(said)
    }
    box.append(control)
    return box
  }

  const sections = recipeEl('div', 'hc-recipe-post-form')
  const leftOut = recipeEl('p', 'hc-recipe-post-quiet')
  leftOut.hidden = true
  const notice = recipeEl('p', 'hc-recipe-post-notice', say('recipe.post.notice',
    'What you post is kept by this host and can be read by anyone with this code. You can change it or take it back until this tab closes or reloads, or the leader closes this, or it fills up. After that only the leader can hide it.'))
  const measure = recipeEl('p', 'hc-recipe-post-measure')
  measure.setAttribute('aria-live', 'polite')
  const post = recipeEl('button', 'hc-recipe-btn is-solid', say('recipe.post.post', 'Post'))
  post.type = 'button'
  const takeBack = recipeEl('button', 'hc-recipe-btn', say('recipe.post.take-back', 'Take it back'))
  takeBack.type = 'button'
  takeBack.hidden = true
  on(post, 'click', () => { if (!post.disabled) options.onPost() })
  on(takeBack, 'click', () => { if (!takeBack.disabled) options.onTakeBack() })
  const actions = recipeEl('div', 'hc-recipe-post-actions')
  actions.append(post, takeBack)
  const said = recipeEl('p', 'hc-recipe-post-said')
  said.setAttribute('role', 'status')

  const form = recipeEl('div', 'hc-recipe-post-form')
  form.setAttribute('role', 'form')
  form.setAttribute('aria-label', say('recipe.post.form', 'Your entry'))
  form.append(
    part(`${serial}-name`, say('recipe.post.name', 'The name you go by'), nameField),
    part(`${serial}-title-field`, say('recipe.post.entry-title', 'The title of your entry'), titleField),
    sections, leftOut, notice, measure, actions,
  )
  form.hidden = true

  const posted = recipeEl('div', 'hc-recipe-post-posted')
  posted.hidden = true

  const column = recipeEl('main', 'hc-recipe-post-column')
  column.append(state, ends, retry, form, said, posted)
  const scroll = recipeEl('div', 'hc-recipe-post-scroll')
  scroll.append(column)
  root.append(head, scroll)

  /** One part for each section the poster fills, drawn once per template. */
  const drawSections = (next: RecipeTemplateDocument): void => {
    const { asked, leftOut: pictures } = recipePostSections(next)
    const kept = fieldsByKey
    fieldsByKey = new Map()
    sections.replaceChildren()
    for (const section of asked) {
      const field = recipeEl('textarea', 'hc-recipe-field')
      field.dataset['kind'] = section.kind
      field.rows = section.kind === 'text' ? 5 : 4
      if (section.kind === 'facts' && section.fields?.length) field.placeholder = section.fields.map(name => `${name}: `).join('\n')
      // A field of the same key and kind keeps what was typed in it.
      const before = kept.get(section.key)
      if (before && before.dataset['kind'] === section.kind) field.value = before.value
      on(field, 'input', () => options.onInput())
      fieldsByKey.set(section.key, field)
      sections.append(part(`${serial}-s-${section.key}`, section.label, field, hintOf(section, options.say)))
    }
    leftOut.hidden = !pictures.length
    leftOut.textContent = pictures.length
      ? say('recipe.post.pictures', 'Pictures cannot be posted from this page, so {sections} is left out.', { sections: pictures.map(section => section.label).join(', ') })
      : ''
  }

  // ── the list and the read-along ─────────────────────────────────────────

  /** Take the read-along away. `back`: the person closed it, so focus returns to the row it was opened from. */
  const closeRecipe = (back = false): void => {
    if (!reading) return
    const leaving = reading
    reading = null
    leaving.dispose()
    leaving.element.remove()
    scroll.inert = false
    head.inert = false
    if (back && !disposed) {
      if (catalogue) catalogue.focus()
      else heading.focus()
    }
  }

  // Escape closes an open read-along and nothing more: the page itself stays until its Close.
  on(root, 'keydown', event => {
    if (!reading || !(event instanceof KeyboardEvent) || event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    closeRecipe(true)
  })

  return {
    element: root,
    setTitle: title => { heading.textContent = title },
    setState: (words, end = '') => {
      state.textContent = words
      ends.textContent = end
      ends.hidden = !end
    },
    setRetry: on => { retry.hidden = !on || !options.onRetry },
    focus: () => { if (!disposed) heading.focus({ preventScroll: true }) },
    setForm: next => {
      if (disposed) return
      if (!next) { form.hidden = true; return }
      if (next !== template) { template = next; drawSections(next) }
      form.hidden = false
    },
    fields: () => ({
      name: nameField.value,
      title: titleField.value,
      values: Object.fromEntries([...fieldsByKey].map(([key, field]) => [key, field.value])),
    }),
    setMeasure: (words, over = false) => {
      measure.textContent = words
      measure.classList.toggle('is-over', over)
    },
    setActions: next => {
      const sending = next.sending ?? null
      post.disabled = !next.post || sending !== null
      post.textContent = sending === 'post' ? say('recipe.post.posting-press', 'Posting…')
        : next.posted ? say('recipe.post.change', 'Post the change') : say('recipe.post.post', 'Post')
      takeBack.hidden = !next.posted
      takeBack.disabled = !next.takeBack || sending !== null
      takeBack.textContent = sending === 'back' ? say('recipe.post.taking-back-press', 'Taking it back…') : say('recipe.post.take-back', 'Take it back')
      actions.setAttribute('aria-busy', String(sending !== null))
    },
    setSaid: (words, tone = 'plain') => {
      said.textContent = words
      said.classList.toggle('is-good', tone === 'good')
      said.classList.toggle('is-bad', tone === 'bad')
    },
    setPosted: (rows, note) => {
      if (disposed) return
      if (!rows) { posted.hidden = true; return }
      const shown = { rows, note: note ?? '' }
      if (catalogue) catalogue.update(shown)
      else {
        catalogue = recipeCatalogue({
          say: options.say,
          title: say('recipe.post.posted.title', 'Posted so far'),
          ...shown,
          // A posted recipe names no picture: every card draws its plate.
          pictureUrl: () => '',
          onOpen: sig => options.onOpen(sig),
        })
        posted.append(catalogue.element)
      }
      posted.hidden = false
    },
    showRecipe: shown => {
      if (disposed) return
      closeRecipe()
      reading = recipePage({
        title: shown.title,
        recipe: shown.recipe,
        template: shown.template,
        mode: 'read',
        readOnly: true,
        say: options.say,
        pictureUrl: () => '',
        onClose: () => closeRecipe(true),
      })
      // The page under the recipe stands aside, so its keys and fields are not reached through it.
      scroll.inert = true
      head.inert = true
      root.append(reading.element)
      // Focus goes in with it, so a reader is where the recipe is and Escape reaches it.
      const into = reading.element
      if (!into.hasAttribute('tabindex')) into.tabIndex = -1
      into.focus({ preventScroll: true })
    },
    closeRecipe: () => closeRecipe(true),
    dispose: () => {
      if (disposed) return
      disposed = true
      closeRecipe()
      catalogue?.dispose()
      catalogue = null
      for (const off of offs.splice(0)) off()
      root.remove()
    },
  }
}
