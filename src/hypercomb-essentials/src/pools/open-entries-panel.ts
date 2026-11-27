// pools/open-entries-panel.ts
//
// "OPEN FOR POSTS", IN THE POOLS BAR (documentation/open-entry-pools.md). One
// row of the bar: the pools the leader's index names, each with when it ends,
// how many entries it holds, its code again, Close and Recycle; a pool opened
// on another device with Close; and "Open for posts", which asks for the page
// (from the addresses the leader's index gives), the end (a day unless the
// leader picks another, 31 days at most), the title and what people fill in.
//
// A PAGE HAS ONE POOL. Opening where the page has one, and Recycle, ALWAYS ask
// first, and say how many of its entries were not brought home (offering to
// bring them), that all of them are home, or that they could not be counted
// (the host did not answer, its hidden list did not read, or this device does
// not hold its code): then only an explicit yes goes on. A pool opened on
// another device is placed on its page by its public record, and has Close and
// Recycle like any other.
//
// The row says "closed" the moment a pool's end passes, while the bar is up:
// it wakes itself at the next end it shows.
//
// EVERY ANSWER IS ONE SENTENCE: what happened, and when something failed,
// what to do, with whose it is to fix beside it (the design's "Who ships
// what"). Nothing here decides anything: `EntryPostsControl` runs the leader's
// side (open-entries-leader.ts) over injected dependencies and hands each new
// state to the row, which is built once and updated in place so a press is
// never lost under a finger. Every word a host or a person supplied reaches
// the page as text, never as markup. It registers nothing.

import { ENTRY_LIMITS } from './open-entries.js'
import type { EntryFixer } from './open-entries-flows.js'
import { entryForms, type EntryFormTemplate } from './open-entries-forms.js'
import {
  ENTRY_END_DAYS,
  bringPostsHome,
  closeForPosts,
  entryEndWords,
  entryWhoseWords,
  leaderPoolOfPage,
  openForPosts,
  readLeaderPosts,
  recycleForPosts,
  showPostsCode,
  type EntryLeaderDeps,
  type LeaderPool,
} from './open-entries-leader.js'

/** The words for a key, with the English beside it for a catalog that lacks it (pools-bar.ts poolsSay). */
export type EntryPostsSay = (key: string, fallback: string, params?: Record<string, string | number>) => string

/** One template a poster may fill, with the meaning of the entries it makes. */
export interface EntryPostsTemplate extends EntryFormTemplate {
  readonly meaning: string
}

/** What the row shows. */
export interface EntryPostsState {
  /** The leader's pools are being read. */
  readonly reading: boolean
  /** What is being done right now, '' for nothing. */
  readonly busy: string
  /** The last answer, in one sentence, and whose it is to fix when it failed. */
  readonly said: { readonly text: string; readonly ok: boolean; readonly whose?: EntryFixer } | null
  readonly host: string
  readonly pages: readonly string[]
  readonly pools: readonly LeaderPool[]
  readonly templates: readonly EntryPostsTemplate[]
  /** The open form is up. */
  readonly forming: boolean
  readonly choice: { readonly page: string; readonly days: number; readonly title: string; readonly template: string }
  /** A page's pool is about to be recycled: the leader is asked first, always. */
  readonly confirm: { readonly kind: 'open' | 'recycle'; readonly pool: LeaderPool } | null
}

export const EMPTY_POSTS_STATE: EntryPostsState = Object.freeze({
  reading: false, busy: '', said: null, host: '', pages: [], pools: [], templates: [], forming: false,
  choice: { page: '', days: ENTRY_END_DAYS[0] ?? 1, title: '', template: '' }, confirm: null,
})

export interface EntryPostsActions {
  onStart(): void
  onCancel(): void
  onChoose(field: 'page' | 'days' | 'title' | 'template', value: string): void
  onOpen(): void
  onCode(pool: LeaderPool): void
  onClose(pool: LeaderPool): void
  onRecycle(pool: LeaderPool): void
  /** The confirm's answer: bring the entries home first, or go on without them. */
  onConfirm(bring: boolean): void
}

const STYLE = `
.hc-posts{display:grid;gap:0.35rem;padding:0.35rem 0 0 1.9rem;border-top:1px solid var(--hc-window-line,rgba(227,237,245,0.12));}
.hc-posts-line{display:flex;flex-wrap:wrap;align-items:baseline;gap:0.3rem 0.6rem;min-width:0;}
.hc-posts-title{flex:none;font-family:var(--hc-mono,ui-monospace,monospace);font-size:0.72em;letter-spacing:0.16em;text-transform:uppercase;color:var(--hc-window-ink-quiet,rgba(227,237,245,0.68));}
.hc-posts-say{flex:1 1 14rem;min-width:0;overflow-wrap:anywhere;}
.hc-posts-say[data-tone="refused"]{color:var(--hc-status-warn,var(--hc-window-ink-loud,#eef2f5));font-weight:600;}
.hc-posts-whose{flex:none;font-size:0.8em;padding:0 0.4rem;border:1px solid var(--hc-window-line,rgba(227,237,245,0.24));border-radius:var(--hc-radius-control,2px);}
.hc-posts-whose[hidden],.hc-posts [hidden]{display:none !important;}
.hc-posts-list{display:grid;gap:0.25rem;margin:0;padding:0;list-style:none;}
.hc-posts-pool{display:flex;flex-wrap:wrap;align-items:center;gap:0.3rem 0.5rem;min-width:0;}
.hc-posts-pool-words{flex:1 1 14rem;min-width:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums;}
.hc-posts-form{display:flex;flex-wrap:wrap;align-items:end;gap:0.4rem 0.6rem;}
.hc-posts-form label{display:grid;gap:0.15rem;font-size:0.84em;color:var(--hc-window-ink-quiet,rgba(227,237,245,0.68));min-width:0;}
.hc-posts-form select,.hc-posts-form input{font:inherit;font-size:1rem;min-height:2.1rem;max-width:100%;padding:0 0.45rem;box-sizing:border-box;
  border-radius:var(--hc-radius-control,2px);border:1px solid var(--hc-window-line,rgba(227,237,245,0.24));
  background:rgba(var(--hc-panel-pane,12,19,27),0.9);color:var(--hc-window-ink-loud,#eef2f5);}
.hc-posts-form input{width:min(16rem,100%);}
.hc-posts-confirm{display:flex;flex-wrap:wrap;align-items:center;gap:0.4rem 0.6rem;}
.hc-posts-confirm p{flex:1 1 100%;margin:0;overflow-wrap:anywhere;}
.hc-posts button:focus-visible{outline:2px solid var(--hc-focus,currentColor);outline-offset:2px;}
.hc-posts button.hc-posts-open{padding:0 0.8rem;border:1px solid var(--hc-window-line-firm,rgba(227,237,245,0.26));}
@media (max-width:560px){.hc-posts{padding-left:0;}.hc-posts-form label{flex:1 1 100%;}.hc-posts-form input,.hc-posts-form select{width:100%;}}
`

const piece = <K extends keyof HTMLElementTagNameMap>(tag: K, name: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  node.className = name
  if (text !== undefined) node.textContent = text
  return node
}

/** Has a pool stopped taking posts: closed in the index, or past the end it shows. */
const hasEnded = (pool: LeaderPool, nowSeconds: number): boolean => {
  const until = pool.known?.until ?? pool.until ?? 0
  return pool.state === 'closed' || (until > 0 && until <= nowSeconds)
}

/** One pool in words: its title, when it ends or that it is closed, how many entries, and "full" once its listing
 *  holds as many as a pool can list: a post past that is not read. */
export function entryPoolWords(say: EntryPostsSay, pool: LeaderPool, nowSeconds: number): string {
  const known = pool.known
  const ended = hasEnded(pool, nowSeconds)
  if (!known) {
    // Another device's pool, placed by its public record when it read: its title and its end.
    if (pool.title && pool.until) {
      const when = ended ? say('pools.posts.pool.closed', 'closed') : say('pools.posts.pool.ends', 'ends {end}', { end: entryEndWords(pool.until) })
      return [pool.title, when, say('pools.posts.pool.elsewhere', 'opened on another device')].join(' · ')
    }
    return pool.state === 'open'
      ? say('pools.posts.other.open', 'A pool opened on another device is open')
      : say('pools.posts.other.closed', 'A pool opened on another device is closed')
  }
  const when = ended
    ? say('pools.posts.pool.closed', 'closed')
    : say('pools.posts.pool.ends', 'ends {end}', { end: entryEndWords(known.until) })
  const count = pool.entries === null
    ? say('pools.posts.pool.unread', 'entries not read')
    : pool.entries === 1
      ? say('pools.posts.pool.count.one', '1 entry', { count: 1 })
      : say('pools.posts.pool.count.other', '{count} entries', { count: pool.entries })
  const full = pool.full === true || (pool.entries !== null && pool.entries >= ENTRY_LIMITS.listed) ? [say('pools.posts.pool.full', 'full')] : []
  return [known.title, when, count, ...full].join(' · ')
}

/** The sentence the confirm says before a pool is recycled: how many of its entries are not home, that all are, or
 *  that they could not be counted (then the leader's yes is the only thing that goes on). */
export const entryConfirmWords = (say: EntryPostsSay, kind: 'open' | 'recycle', pool: LeaderPool): string => {
  const title = pool.known?.title || pool.title || say('pools.posts.confirm.untitled', 'this pool')
  const count = pool.notHome
  if (count === null || count === undefined) {
    return kind === 'open'
      ? say('pools.posts.confirm.open-uncounted', 'This page already has "{title}". Opening a new pool recycles it, and how many of its entries are not in your hive could not be counted. Open only if you are sure.', { title })
      : say('pools.posts.confirm.recycle-uncounted', 'Recycling "{title}" lets its entries go, and how many of them are not in your hive could not be counted. Recycle only if you are sure.', { title })
  }
  if (count <= 0) {
    return kind === 'open'
      ? say('pools.posts.confirm.open-home', 'This page already has "{title}". Opening a new pool recycles it; every one of its entries is in your hive.', { title })
      : say('pools.posts.confirm.recycle-home', 'Recycling "{title}" lets its entries go; every one of them is in your hive.', { title })
  }
  return kind === 'open'
    ? say('pools.posts.confirm.open', 'This page already has "{title}". Opening a new pool recycles it, and {count} of its entries are not in your hive yet.', { title, count })
    : say('pools.posts.confirm.recycle', 'Recycling "{title}" lets its entries go, and {count} of them are not in your hive yet.', { title, count })
}

let panelsMade = 0

/** Build the row. `update` puts a state on the same nodes; `dispose` takes the element away. */
export function entryPostsPanel(say: EntryPostsSay, actions: EntryPostsActions, now: () => number = Date.now): {
  element: HTMLElement
  update(state: EntryPostsState): void
  dispose(): void
} {
  const element = piece('div', 'hc-posts')
  element.id = 'hc-posts'
  const style = document.createElement('style')
  style.textContent = STYLE

  const button = (name: string, onPress: () => void): HTMLButtonElement => {
    const node = piece('button', name)
    node.type = 'button'
    node.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (!node.disabled) onPress() })
    return node
  }

  const title = piece('span', 'hc-posts-title')
  const lead = piece('span', 'hc-posts-say')
  lead.setAttribute('role', 'status')
  const whose = piece('span', 'hc-posts-whose')
  whose.hidden = true
  const start = button('hc-posts-start', actions.onStart)
  const line = piece('div', 'hc-posts-line')
  line.append(title, lead, whose, start)

  const list = piece('ul', 'hc-posts-list')

  const field = <T extends HTMLElement>(label: HTMLLabelElement, words: HTMLSpanElement, control: T): T => {
    label.append(words, control)
    return control
  }
  const pageWords = piece('span', 'hc-posts-label')
  const pageLabel = piece('label', 'hc-posts-field')
  const page = field(pageLabel, pageWords, piece('select', 'hc-posts-page'))
  page.addEventListener('change', () => actions.onChoose('page', page.value))
  const daysWords = piece('span', 'hc-posts-label')
  const daysLabel = piece('label', 'hc-posts-field')
  const days = field(daysLabel, daysWords, piece('select', 'hc-posts-days'))
  days.addEventListener('change', () => actions.onChoose('days', days.value))
  const nameWords = piece('span', 'hc-posts-label')
  const nameLabel = piece('label', 'hc-posts-field')
  const name = field(nameLabel, nameWords, piece('input', 'hc-posts-name'))
  name.type = 'text'
  name.maxLength = ENTRY_LIMITS.title
  name.autocomplete = 'off'
  name.addEventListener('input', () => actions.onChoose('title', name.value))
  const formWords = piece('span', 'hc-posts-label')
  const formLabel = piece('label', 'hc-posts-field')
  const template = field(formLabel, formWords, piece('select', 'hc-posts-template'))
  template.addEventListener('change', () => actions.onChoose('template', template.value))
  const open = button('hc-posts-open', actions.onOpen)
  const cancel = button('hc-posts-cancel', actions.onCancel)
  const form = piece('div', 'hc-posts-form')
  form.append(pageLabel, daysLabel, nameLabel, formLabel, open, cancel)

  const confirmWords = piece('p', 'hc-posts-confirm-words')
  confirmWords.id = `hc-posts-confirm-words-${++panelsMade}`
  const bring = button('hc-posts-bring', () => actions.onConfirm(true))
  const without = button('hc-posts-without', () => actions.onConfirm(false))
  const keep = button('hc-posts-keep', actions.onCancel)
  const confirm = piece('div', 'hc-posts-confirm')
  confirm.setAttribute('role', 'alertdialog')
  confirm.setAttribute('aria-describedby', confirmWords.id)
  // The confirm answers Escape itself: it cancels, and the hive's Escape does not also close the bar
  // (keyboard/escape-cascade.ts).
  confirm.setAttribute('data-escape-local', '')
  confirm.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (!keep.disabled) actions.onCancel()
  })
  confirm.append(confirmWords, bring, without, keep)

  element.append(style, line, list, form, confirm)

  /** A select's options, made again only when what it offers changed. */
  const offer = (select: HTMLSelectElement, options: readonly { value: string; words: string }[], chosen: string): void => {
    const stamp = JSON.stringify(options)
    if (select.dataset['stamp'] !== stamp) {
      select.replaceChildren(...options.map(one => {
        const option = document.createElement('option')
        option.value = one.value
        option.textContent = one.words
        return option
      }))
      select.dataset['stamp'] = stamp
    }
    if (select.value !== chosen) select.value = chosen
  }

  let listStamp = ''
  let last: EntryPostsState | null = null
  /** The confirm last shown, so the focus moves into it once as it comes up. */
  let asked: EntryPostsState['confirm'] = null
  /** Where the focus goes back to once the confirm is gone and nothing is running: the press that asked. */
  let returnTo: { readonly kind: 'open' | 'recycle'; readonly pool: string } | null = null
  /** Whether the focus was let go: on nothing, or on a press the confirm took off the page. */
  const focusLost = (): boolean => {
    const held = document.activeElement
    return !held || held === document.body || confirm.contains(held) || !(held as HTMLElement).isConnected
  }
  /** The wake at the next end the row shows, so "ends ..." turns to "closed" without anyone pressing anything. */
  let wake: ReturnType<typeof setTimeout> | null = null
  const rewake = (state: EntryPostsState, nowSeconds: number): void => {
    if (wake) { clearTimeout(wake); wake = null }
    const next = Math.min(...state.pools.filter(one => !hasEnded(one, nowSeconds)).map(one => one.known?.until ?? one.until ?? 0).filter(until => until > 0))
    if (!Number.isFinite(next)) return
    // A second past the end; never longer than a timer holds.
    const ms = Math.min(Math.max(0, next * 1000 - now()) + 1_000, 2_147_000_000)
    wake = setTimeout(() => { wake = null; if (last && element.isConnected) update(last) }, ms)
  }
  const update = (state: EntryPostsState): void => {
    last = state
    const busy = !!state.busy || state.reading
    title.textContent = say('pools.posts.title', 'Posts')
    lead.textContent = state.busy
      || state.said?.text
      || (state.reading ? say('pools.posts.reading', 'Reading your pools...') : '')
      || (state.pools.length
        ? say('pools.posts.lead.some', 'Phones with a code post to your page. A page has one pool.')
        : say('pools.posts.lead.none', 'Open a page for posts: anyone you show the code to can post an entry from a phone.'))
    const refusal = !state.busy && !!state.said && !state.said.ok
    if (refusal) lead.dataset['tone'] = 'refused'
    else delete lead.dataset['tone']
    const fixer = refusal ? entryWhoseWords(state.said?.whose) : ''
    whose.textContent = fixer
    whose.hidden = !fixer
    start.textContent = say('pools.posts.start', 'Open for posts')
    start.hidden = state.forming || !!state.confirm
    start.disabled = busy

    const nowSeconds = Math.floor(now() / 1000)
    // Whether each pool has ended is part of what the row shows, so it is part of the stamp.
    const stamp = JSON.stringify([state.pools.map(one => [one.pool, one.state, one.code !== '', one.entries, one.known?.until ?? one.until, one.known?.title ?? one.title, hasEnded(one, nowSeconds)]), busy])
    if (stamp !== listStamp) {
      listStamp = stamp
      // A press the focus was on is made again: the focus goes to the one made in its place.
      const holding = document.activeElement instanceof HTMLButtonElement && list.contains(document.activeElement) ? document.activeElement : null
      const heldAt = holding ? { pool: holding.closest<HTMLElement>('li')?.dataset['pool'] ?? '', name: holding.className } : null
      list.replaceChildren(...state.pools.map(pool => {
        const item = piece('li', 'hc-posts-pool')
        item.dataset['pool'] = pool.pool
        item.append(piece('span', 'hc-posts-pool-words', entryPoolWords(say, pool, nowSeconds)))
        if (pool.code) {
          const code = button('hc-posts-code', () => actions.onCode(pool))
          code.textContent = say('pools.posts.code', 'Code')
          code.disabled = busy
          item.append(code)
        }
        if (pool.state === 'open') {
          const close = button('hc-posts-close', () => actions.onClose(pool))
          close.textContent = say('pools.posts.close', 'Close')
          close.disabled = busy
          item.append(close)
        }
        // Every pool can be recycled, one opened on another device too: its keys are the leader's own.
        const recycle = button('hc-posts-recycle', () => actions.onRecycle(pool))
        recycle.textContent = say('pools.posts.recycle', 'Recycle')
        recycle.disabled = busy
        item.append(recycle)
        return item
      }))
      if (heldAt) {
        const row = [...list.children].find(item => (item as HTMLElement).dataset['pool'] === heldAt.pool)
        const again = [...(row?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(press => press.className === heldAt.name)
        again?.focus()
      }
    }
    list.hidden = !state.pools.length
    rewake(state, nowSeconds)

    form.hidden = !state.forming || !!state.confirm
    pageWords.textContent = say('pools.posts.form.page', 'Page')
    offer(page, state.pages.map(one => ({ value: one, words: one })), state.choice.page)
    daysWords.textContent = say('pools.posts.form.ends', 'Ends in')
    offer(days, ENTRY_END_DAYS.map(count => ({
      value: String(count),
      words: count === 1 ? say('pools.posts.form.days.one', '1 day', { count }) : say('pools.posts.form.days.other', '{count} days', { count }),
    })), String(state.choice.days))
    nameWords.textContent = say('pools.posts.form.title', 'Title')
    name.placeholder = say('pools.posts.form.title-hint', 'Tuesday class')
    if (name.value !== state.choice.title && document.activeElement !== name) name.value = state.choice.title
    formWords.textContent = say('pools.posts.form.template', 'What people fill in')
    offer(template, state.templates.map(one => ({ value: one.sig, words: one.name })), state.choice.template)
    open.textContent = say('pools.posts.form.open', 'Open')
    open.disabled = busy || !state.pages.length || !state.templates.length || !state.choice.title.trim()
    cancel.textContent = say('pools.posts.form.cancel', 'Cancel')
    cancel.disabled = !!state.busy

    confirm.hidden = !state.confirm
    if (state.confirm) confirmWords.textContent = entryConfirmWords(say, state.confirm.kind, state.confirm.pool)
    // Bringing is offered only when there are entries to bring; otherwise the yes is the one press that goes on.
    const missing = (state.confirm?.pool.notHome ?? 0) > 0
    bring.textContent = say('pools.posts.confirm.bring', 'Bring them home first')
    bring.hidden = !missing
    without.textContent = state.confirm?.kind === 'open'
      ? missing ? say('pools.posts.confirm.open-anyway', 'Open without them') : say('pools.posts.confirm.open-go', 'Open the new pool')
      : missing ? say('pools.posts.confirm.recycle-anyway', 'Recycle without them') : say('pools.posts.confirm.recycle-go', 'Recycle it')
    keep.textContent = say('pools.posts.form.cancel', 'Cancel')
    for (const node of [bring, without, keep]) node.disabled = !!state.busy
    confirm.setAttribute('aria-label', state.confirm?.kind === 'open'
      ? say('pools.posts.confirm.ask-open', 'Open a new pool on this page?')
      : say('pools.posts.confirm.ask-recycle', 'Recycle this pool?'))

    // The confirm takes the focus as it comes up, on the press that changes nothing, and gives it back to the
    // press that asked once it is gone.
    if (state.confirm && !asked) {
      returnTo = { kind: state.confirm.kind, pool: state.confirm.pool.pool }
      if (element.isConnected) keep.focus()
    }
    asked = state.confirm
    if (!state.confirm && returnTo && !state.busy && !state.reading) {
      const back = returnTo
      returnTo = null
      const row = [...list.children].find(item => (item as HTMLElement).dataset['pool'] === back.pool)
      const target = [
        back.kind === 'recycle' ? row?.querySelector<HTMLButtonElement>('.hc-posts-recycle') : open,
        start,
      ].find(press => !!press && !press.disabled && !press.hidden && !press.closest('[hidden]'))
      if (target && focusLost()) target.focus()
    }
  }

  return { element, update, dispose: () => { if (wake) clearTimeout(wake); wake = null; last = null; element.remove() } }
}

// ── the control ─────────────────────────────────────────────────────────────

/**
 * The leader's posts, as a small state machine over the leader's side: read
 * the pools, open the form, open (with the confirm when the page's pool holds
 * entries not brought home), close, recycle, show the code. Every answer is
 * one sentence. `onChange` hears each new state.
 */
export class EntryPostsControl {
  #state: EntryPostsState = EMPTY_POSTS_STATE
  readonly #say: EntryPostsSay
  readonly #deps: EntryLeaderDeps
  readonly #onChange: (state: EntryPostsState) => void
  /** Each read's turn, so a slow read never overwrites a newer one. */
  #turn = 0

  constructor(options: { say: EntryPostsSay; onChange(state: EntryPostsState): void; deps?: EntryLeaderDeps }) {
    this.#say = options.say
    this.#deps = options.deps ?? {}
    this.#onChange = options.onChange
  }

  get state(): EntryPostsState { return this.#state }

  /** What the row's presses call. */
  get actions(): EntryPostsActions {
    return {
      onStart: () => { void this.start() },
      onCancel: () => this.cancel(),
      onChoose: (field, value) => this.choose(field, value),
      onOpen: () => { void this.open() },
      onCode: pool => this.code(pool),
      onClose: pool => { void this.close(pool) },
      onRecycle: pool => { void this.recycle(pool) },
      onConfirm: bring => { void this.confirm(bring) },
    }
  }

  #set(next: Partial<EntryPostsState>): void {
    this.#state = { ...this.#state, ...next }
    this.#onChange(this.#state)
  }

  #tell(said: EntryPostsState['said'], extra: Partial<EntryPostsState> = {}): void {
    this.#set({ busy: '', said, ...extra })
  }

  /** Read the leader's pools again, and the templates once. What the hive did on its own is said. */
  async refresh(keepSaid = false): Promise<void> {
    const turn = ++this.#turn
    this.#set({ reading: true })
    const read = await readLeaderPosts(this.#deps)
    const templates = this.#state.templates.length ? this.#state.templates : await this.#templates()
    if (turn !== this.#turn) return
    if (!read.ok) {
      this.#set({ reading: false, templates, said: keepSaid && this.#state.said ? this.#state.said : { text: read.reason, ok: false, ...(read.whose ? { whose: read.whose } : {}) } })
      return
    }
    const choice = this.#state.choice
    this.#set({
      reading: false, host: read.host, pages: read.pages, pools: read.pools, templates,
      choice: {
        ...choice,
        page: read.pages.includes(choice.page) ? choice.page : read.pages[0] ?? '',
        template: templates.some(one => one.sig === choice.template) ? choice.template : templates[0]?.sig ?? '',
      },
      ...(read.told.length ? { said: { text: read.told.join(' '), ok: true } } : keepSaid ? {} : { said: null }),
    })
  }

  async #templates(): Promise<EntryPostsTemplate[]> {
    const out: EntryPostsTemplate[] = []
    for (const form of (this.#deps.forms ?? entryForms)()) {
      for (const one of await form.templates().catch(() => [])) out.push({ ...one, meaning: form.meaning })
    }
    return out
  }

  /** "Open for posts": the form, with the pools read fresh. With no page to offer it says so and stops. */
  async start(): Promise<void> {
    this.#set({ forming: true, confirm: null, said: null })
    await this.refresh()
    if (!this.#state.forming) return
    if (this.#state.host && !this.#state.pages.length) {
      this.#tell({ text: this.#say('pools.posts.refuse.no-page', 'You have no published page to show a code for. Publish a site first.'), ok: false, whose: 'leader' }, { forming: false })
    } else if (this.#state.host && !this.#state.templates.length) {
      this.#tell({ text: this.#say('pools.posts.refuse.no-template', 'Nothing in this hive says what people would fill in.'), ok: false, whose: 'operator' }, { forming: false })
    }
  }

  cancel(): void {
    if (this.#state.busy) return
    this.#set({ forming: false, confirm: null })
  }

  choose(field: 'page' | 'days' | 'title' | 'template', value: string): void {
    const choice = { ...this.#state.choice }
    if (field === 'days') {
      const days = Number(value)
      choice.days = ENTRY_END_DAYS.includes(days) ? days : ENTRY_END_DAYS[0] ?? 1
    } else {
      choice[field] = String(value ?? '')
    }
    this.#set({ choice })
  }

  /** Open: when the page already has a pool (from any device), the confirm asks first, always, and says the count. */
  async open(): Promise<void> {
    const state = this.#state
    if (state.busy || !state.forming) return
    const existing = leaderPoolOfPage(state.pools, state.choice.page)
    if (existing) { this.#set({ confirm: { kind: 'open', pool: existing } }); return }
    await this.#open(null)
  }

  async #open(replaces: LeaderPool | null): Promise<void> {
    const { choice, host } = this.#state
    const template = this.#state.templates.find(one => one.sig === choice.template)
    if (!template) {
      this.#tell({ text: this.#say('pools.posts.refuse.template', 'Pick what people will fill in first.'), ok: false, whose: 'leader' })
      return
    }
    this.#set({ busy: this.#say('pools.posts.opening', 'Opening the pool and asking the host to say it is open...'), confirm: null })
    const opened = await openForPosts({ host, page: choice.page, title: choice.title, days: choice.days, meaning: template.meaning, template, replaces }, this.#deps)
    if (!opened.ok) {
      this.#tell({ text: opened.reason, ok: false, ...(opened.whose ? { whose: opened.whose } : {}) })
      await this.refresh(true)
      return
    }
    const said = opened.shown ? opened.said : `${opened.said} ${this.#say('pools.posts.code.unshown', 'The code could not be drawn here: copy the link from this pool\'s Code.')}`
    this.#tell({ text: said, ok: true }, { forming: false, choice: { ...choice, title: '' } })
    await this.refresh(true)
  }

  code(pool: LeaderPool): void {
    if (!showPostsCode(pool, this.#deps)) {
      this.#tell({ text: this.#say('pools.posts.code.none', 'This device does not hold this pool\'s code.'), ok: false })
    }
  }

  async close(pool: LeaderPool): Promise<void> {
    if (this.#state.busy) return
    this.#set({ busy: this.#say('pools.posts.closing', 'Closing the pool...') })
    const done = await closeForPosts(this.#state.host, pool, this.#deps)
    this.#tell({ text: done.said, ok: done.ok, ...(done.whose ? { whose: done.whose } : {}) })
    await this.refresh(true)
  }

  /** Recycle: the confirm asks first, always, and says how many of its entries are not home, or that they could not be counted. */
  async recycle(pool: LeaderPool): Promise<void> {
    if (this.#state.busy) return
    this.#set({ confirm: { kind: 'recycle', pool } })
  }

  async #recycle(pool: LeaderPool): Promise<void> {
    this.#set({ busy: this.#say('pools.posts.recycling', 'Recycling the pool...'), confirm: null })
    const done = await recycleForPosts(this.#state.host, pool, this.#deps)
    this.#tell({ text: done.said, ok: done.ok, ...(done.whose ? { whose: done.whose } : {}) })
    await this.refresh(true)
  }

  /** The confirm's answer. Bringing that fails stops there and says why: nothing is recycled under it. */
  async confirm(bring: boolean): Promise<void> {
    const asked = this.#state.confirm
    if (!asked || this.#state.busy) return
    if (bring && (asked.pool.notHome ?? 0) > 0) {
      this.#set({ busy: this.#say('pools.posts.bringing', 'Bringing the entries home...') })
      const brought = await bringPostsHome(asked.pool, this.#deps)
      if (!brought.ok) { this.#tell({ text: brought.said, ok: false }, { confirm: null }); return }
    }
    if (asked.kind === 'open') await this.#open(asked.pool)
    else await this.#recycle(asked.pool)
  }
}
