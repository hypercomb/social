// recipe/recipe-picker.ts
//
// THE TEMPLATE PICKER: the panel over the recipe page that offers the layouts
// a recipe can be seen through. Its groups are the caller's: built in, the
// cook's own, then one per domain they follow, because whom a reader takes from
// is their own choice (T5) and the table is the union of what those hosts list
// (T9). An entry is an offer. Nothing is kept or switched until a press (T4).
//
// It says what a template is in the template's own words: its name, what it is
// for, and what its sections are called. Search narrows by those words, and it
// narrows here whatever the caller passes in, so a caller that hands over
// everything still gets a correct list. Filtering hides nothing for good: clear
// the field and every entry is back (H7).
//
// PURE DOM. No IoC, no store, no network, no EffectBus, no registration. Every
// string a template carries came from a stranger's host and reaches the page
// through textContent (T7: showing one can make this browser contact nobody).

import { recipeTemplateWords, type RecipeTemplateDocument } from './recipe-template.js'
import { ensureRecipeStyles, recipeEl, recipeMark, recipeWords, type RecipeSay } from './recipe-style.js'

export interface RecipePickerEntry {
  /** The template's signature: what a pick answers with. */
  sig: string
  template: RecipeTemplateDocument
  /** True for one the cook keeps on their own list. It can be taken off again. */
  kept?: boolean
}

/** A headed list: "Built in", "Yours", or a domain, whose label is the domain. */
export interface RecipePickerGroup {
  id: string
  label: string
  note?: string
  entries: readonly RecipePickerEntry[]
}

export interface RecipePickerOptions {
  say: RecipeSay
  /** The signature of the template in use: its entry is marked. */
  current?: string
  groups: readonly RecipePickerGroup[]
  query?: string
  /** True while the domains are still being asked. */
  loading?: boolean
  onPick(sig: string): void
  /** The search as typed. The picker has already narrowed what it shows. */
  onQuery(query: string): void
  /** "Take off my list", offered on entries marked kept. */
  onForget?(sig: string): void
  onClose(): void
}

/** What changed. `groups` replaces the lists; a field left out keeps the value it had. */
export interface RecipePickerUpdate {
  groups: readonly RecipePickerGroup[]
  current?: string
  query?: string
  loading?: boolean
}

export interface RecipePickerHandle {
  readonly element: HTMLElement
  update(next: RecipePickerUpdate): void
  /** Put the caret in the search field. */
  focus(): void
  dispose(): void
}

let pickersMade = 0

/** Build the picker. Its caller mounts it over the page and takes it down on a pick or a close. */
export function recipePicker(options: RecipePickerOptions): RecipePickerHandle {
  const doc = document
  ensureRecipeStyles(doc)
  const say = (key: string, fallback: string, params?: Record<string, string | number>): string => recipeWords(options.say, key, fallback, params)
  let groups = options.groups
  let current = options.current
  let query = options.query ?? ''
  let loading = options.loading === true
  let disposed = false

  const root = recipeEl('div', 'hc-recipe-picker')
  const panel = recipeEl('div', 'hc-recipe-picker-panel')
  const title = recipeEl('h2', 'hc-recipe-picker-title', say('recipe.picker.title', 'Choose a template'))
  title.id = `hc-recipe-picker-${++pickersMade}-title`
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.setAttribute('aria-labelledby', title.id)

  const closeWords = say('recipe.picker.close', 'Close')
  const close = recipeEl('button', 'hc-recipe-tool')
  close.type = 'button'
  close.title = closeWords
  close.setAttribute('aria-label', closeWords)
  close.append(recipeMark('close'))
  const head = recipeEl('div', 'hc-recipe-picker-head')
  head.append(title, close)

  const searchWords = say('recipe.picker.search', 'Search templates')
  const search = recipeEl('input', 'hc-recipe-field')
  search.type = 'search'
  search.value = query
  search.placeholder = searchWords
  search.autocomplete = 'off'
  search.setAttribute('aria-label', searchWords)
  const searching = recipeEl('div', 'hc-recipe-picker-search')
  searching.append(search)

  const asking = recipeEl('p', 'hc-recipe-picker-quiet', say('recipe.picker.loading', 'Asking the domains you follow'))
  asking.setAttribute('role', 'status')
  const nothing = recipeEl('p', 'hc-recipe-picker-quiet')
  nothing.dataset['none'] = ''
  const list = recipeEl('div', 'hc-recipe-picker-list')

  panel.append(head, searching, list)
  root.append(panel)

  const entryOf = (entry: RecipePickerEntry): HTMLElement => {
    const line = recipeEl('li')
    const inUse = entry.sig === current
    const button = recipeEl('button', 'hc-recipe-picker-entry')
    button.type = 'button'
    button.dataset['sig'] = entry.sig
    if (inUse) button.setAttribute('aria-current', 'true')
    const name = recipeEl('span', 'hc-recipe-picker-name')
    name.append(recipeEl('span', '', entry.template.name))
    if (inUse) name.append(recipeEl('span', 'hc-recipe-tag', say('recipe.picker.current', 'In use')))
    button.append(name)
    if (entry.template.description) button.append(recipeEl('span', 'hc-recipe-picker-about', entry.template.description))
    const chips = recipeEl('span', 'hc-recipe-chips')
    for (const section of entry.template.sections) chips.append(recipeEl('span', '', section.label))
    button.append(chips)
    button.addEventListener('click', () => options.onPick(entry.sig))
    line.append(button)
    if (entry.kept && options.onForget) {
      const forget = recipeEl('button', 'hc-recipe-btn is-quiet hc-recipe-picker-forget', say('recipe.picker.forget', 'Take off my list'))
      forget.type = 'button'
      forget.dataset['forget'] = entry.sig
      forget.setAttribute('aria-label', say('recipe.picker.forget-named', 'Take {name} off my list', { name: entry.template.name }))
      forget.addEventListener('click', () => options.onForget?.(entry.sig))
      line.append(forget)
    }
    return line
  }

  const paint = (): void => {
    const wanted = query.toLowerCase().split(/\s+/).filter(Boolean)
    const active = doc.activeElement instanceof HTMLElement && list.contains(doc.activeElement) ? doc.activeElement : null
    const nodes: HTMLElement[] = []
    let shown = 0
    for (const group of groups) {
      // Narrowed here as well as by the caller: an entry stays only if it says every word asked for.
      const entries = group.entries.filter(entry => {
        const words = recipeTemplateWords(entry.template)
        return wanted.every(word => words.includes(word))
      })
      if (!entries.length) continue
      shown += entries.length
      const section = recipeEl('section', 'hc-recipe-picker-group')
      section.dataset['group'] = group.id
      section.append(recipeEl('h3', '', group.label))
      if (group.note) section.append(recipeEl('p', 'hc-recipe-picker-quiet', group.note))
      const items = recipeEl('ul', 'hc-recipe-picker-entries')
      items.append(...entries.map(entryOf))
      section.append(items)
      nodes.push(section)
    }
    asking.hidden = !loading
    nothing.hidden = shown > 0
    nothing.textContent = wanted.length
      ? say('recipe.picker.none', 'No template matches "{query}".', { query: query.trim() })
      : say('recipe.picker.empty', 'There are no templates here yet.')
    list.replaceChildren(...nodes, nothing, asking)
    // The lists were rebuilt: focus goes back to the entry it was on, if that entry is still offered.
    if (!active) return
    const part = active.dataset['forget'] !== undefined ? 'forget' : 'sig'
    const again = Array.from(list.querySelectorAll<HTMLElement>('button')).find(button => button.dataset[part] !== undefined && button.dataset[part] === active.dataset[part])
    ;(again ?? search).focus()
  }

  const entries = (): HTMLButtonElement[] => Array.from(list.querySelectorAll<HTMLButtonElement>('.hc-recipe-picker-entry'))

  /** Arrows walk the entries, Enter in the search picks the first match, Escape closes, Tab stays in the panel. */
  const onKey = (event: KeyboardEvent): void => {
    if (disposed || event.defaultPrevented) return
    if (event.key === 'Escape') {
      // Stopped here: the page under the picker must not close with it.
      event.preventDefault()
      event.stopPropagation()
      options.onClose()
      return
    }
    const active = doc.activeElement instanceof HTMLElement ? doc.activeElement : null
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const all = entries()
      if (!all.length) return
      const line = active?.closest('li')
      const at = all.findIndex(button => button === active || line?.contains(button) === true)
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'ArrowDown') all[Math.min(at + 1, all.length - 1)].focus()
      else if (at <= 0) search.focus()
      else all[at - 1].focus()
      return
    }
    if (event.key === 'Enter' && active === search && !event.isComposing) {
      const first = entries()[0]
      if (!first || !query.trim()) return
      event.preventDefault()
      options.onPick(first.dataset['sig'] ?? '')
      return
    }
    if (event.key === 'Tab') {
      const stops = Array.from(panel.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')).filter(stop => !stop.disabled)
      const first = stops[0]
      const last = stops[stops.length - 1]
      if (!first || !last) return
      if (event.shiftKey ? active === first : active === last) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      }
    }
  }

  /** With nothing focused a key lands on the document: Escape must still close the panel on top. */
  const onDocumentKey = (event: KeyboardEvent): void => {
    if (root.isConnected && (event.target === doc.body || event.target === doc.documentElement || event.target === doc)) onKey(event)
  }

  root.addEventListener('keydown', onKey)
  doc.addEventListener('keydown', onDocumentKey, true)
  // A press on the dimmed page around the panel closes it.
  root.addEventListener('click', event => { if (event.target === root) options.onClose() })
  close.addEventListener('click', () => options.onClose())
  search.addEventListener('input', () => {
    query = search.value
    paint()
    options.onQuery(query)
  })

  paint()

  return {
    element: root,
    update(next) {
      groups = next.groups
      if (next.current !== undefined) current = next.current
      if (next.loading !== undefined) loading = next.loading
      if (next.query !== undefined && next.query !== query) {
        query = next.query
        if (search.value !== query) search.value = query
      }
      paint()
    },
    focus() { search.focus() },
    dispose() {
      disposed = true
      doc.removeEventListener('keydown', onDocumentKey, true)
      root.remove()
    },
  }
}
