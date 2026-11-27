// pools/open-entries-panel.ts
//
// "COLLECT FROM PHONES", AS ONE CARD (documentation/open-entry-pools.md; jwize
// 2026-11-27: "totally confused with this ... very complex ... simplify the
// card first ... You can use full screen"). It used to be a row of the pools
// bar, under the lights, with four fields in a line and an Open that stayed
// grey without saying why. Now it is one full-screen dialog that asks one
// thing: what is it for. The page is said (and asked only when there are
// several), the end and the form stay at a day and the first template until
// the leader asks to change them, the name is filled in already, and Start
// says what it still needs when it cannot be pressed.
//
// What takes posts NOW stands first, each with its code, "Stop taking posts"
// and Recycle. Pools that ended, were closed, or were opened on another device
// fold under "Earlier". The bar keeps one line (`entryPostsLine`): how many
// pages take posts, and the press that opens this card.
//
// A PAGE HAS ONE POOL. Starting where the page has one, and Recycle, ALWAYS ask
// first, and say how many of its entries were not brought home (offering to
// bring them), that all of them are home, or that they could not be counted
// (the host did not answer, its hidden list did not read, or this device does
// not hold its code): then only an explicit yes goes on.
//
// The card says "closed" the moment a pool's end passes, while it is up: it
// wakes itself at the next end it shows.
//
// IT IS A MODAL DIALOG. Escape cancels a confirm, then closes the card; Tab
// goes round it; a press on the dark around it closes it. Whoever mounts it
// holds the hive's keymap while it is up (pools-mode.drone.ts).
//
// EVERY ANSWER IS ONE SENTENCE: what happened, and when something failed,
// what to do, with whose it is to fix beside it (the design's "Who ships
// what"). Nothing here decides anything: `EntryPostsControl` runs the leader's
// side (open-entries-leader.ts) over injected dependencies and hands each new
// state to the card, which is built once and updated in place so a press is
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

/** Above the pools bar and the recipe desk, under the code it shows (sharing/room-qr.view.ts, 100001). */
const CARD_Z = 100000
const ON = 'var(--hc-pools-on,#6fd39a)'
const ON_INK = 'rgb(var(--hc-panel-pane,12,19,27))'
const CLOSE_PATH = 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'
const PHONE_PATH = 'M16 1H8C6.34 1 5 2.34 5 4v16c0 1.66 1.34 3 3 3h8c1.66 0 3-1.34 3-3V4c0-1.66-1.34-3-3-3zm-2 20h-4v-1h4v1zm3.25-3H6.75V4h10.5v14z'

const STYLE = `
.hc-posts{position:fixed;inset:0;z-index:${CARD_Z};display:grid;place-items:center;box-sizing:border-box;
  padding:max(1rem,env(safe-area-inset-top,0px)) max(1rem,env(safe-area-inset-right,0px)) max(1rem,env(safe-area-inset-bottom,0px)) max(1rem,env(safe-area-inset-left,0px));
  background:rgba(4,7,11,0.78);backdrop-filter:blur(6px);pointer-events:auto;
  font-family:var(--hc-font,system-ui,sans-serif);font-size:calc(1rem * var(--hc-panel-scale,1));line-height:1.45;
  color:var(--hc-window-ink-plain,rgba(227,237,245,0.86));}
.hc-posts [hidden]{display:none !important;}
.hc-posts-card{box-sizing:border-box;width:min(36rem,100%);max-height:100%;overflow:auto;overscroll-behavior:contain;display:grid;gap:1.1rem;
  padding:1.4rem 1.5rem 1.5rem;border-radius:var(--hc-radius-floating,4px);background:rgb(var(--hc-panel-pane,12,19,27));
  border:1px solid var(--hc-window-line,rgba(227,237,245,0.16));border-top:2px solid ${ON};box-shadow:var(--md-elev-3,0 1.5rem 5rem rgba(0,0,0,0.6));}
.hc-posts-head{display:flex;align-items:center;gap:0.7rem;min-width:0;}
.hc-posts-mark{flex:none;display:inline-flex;color:${ON};}
.hc-posts-mark svg{width:1.6rem;height:1.6rem;fill:currentColor;}
.hc-posts-title{flex:1 1 auto;min-width:0;margin:0;font-size:1.35rem;font-weight:600;line-height:1.2;color:var(--hc-window-ink-loud,#eef2f5);overflow-wrap:anywhere;}
.hc-posts-lead{margin:0;color:var(--hc-window-ink-plain,rgba(227,237,245,0.86));overflow-wrap:anywhere;}
.hc-posts-line{display:flex;flex-wrap:wrap;align-items:baseline;gap:0.3rem 0.6rem;min-width:0;padding:0.6rem 0.75rem;
  border-radius:var(--hc-radius-card,3px);background:rgba(227,237,245,0.06);}
.hc-posts-say{flex:1 1 14rem;min-width:0;overflow-wrap:anywhere;color:var(--hc-window-ink-loud,#eef2f5);}
.hc-posts-say[data-tone="refused"]{color:var(--hc-status-warn,var(--hc-window-ink-loud,#eef2f5));font-weight:600;}
.hc-posts-say[data-tone="busy"]::before{content:"";display:inline-block;width:0.55em;height:0.55em;margin-right:0.5em;border-radius:50%;background:${ON};animation:hc-posts-pulse 1s ease-in-out infinite alternate;}
@keyframes hc-posts-pulse{from{opacity:0.25;}to{opacity:1;}}
@media (prefers-reduced-motion:reduce){.hc-posts-say[data-tone="busy"]::before{animation:none;}}
.hc-posts-whose{flex:none;font-size:0.8em;padding:0 0.4rem;border:1px solid var(--hc-window-line,rgba(227,237,245,0.24));border-radius:var(--hc-radius-control,2px);}
.hc-posts-kicker{margin:0 0 0.45rem;font-family:var(--hc-mono,ui-monospace,monospace);font-size:0.72rem;letter-spacing:0.16em;text-transform:uppercase;
  color:var(--hc-window-ink-quiet,rgba(227,237,245,0.68));}
.hc-posts-list{display:grid;gap:0.5rem;margin:0;padding:0;list-style:none;}
.hc-posts-pool{display:flex;flex-wrap:wrap;align-items:center;gap:0.4rem 0.6rem;min-width:0;padding:0.7rem 0.8rem;
  border:1px solid var(--hc-window-line,rgba(227,237,245,0.16));border-radius:var(--hc-radius-card,3px);}
.hc-posts-now .hc-posts-pool{border-left:2px solid ${ON};}
.hc-posts-pool-words{flex:1 1 100%;min-width:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums;color:var(--hc-window-ink-loud,#eef2f5);}
.hc-posts-earlier .hc-posts-pool{padding:0.45rem 0.6rem;}
.hc-posts-earlier .hc-posts-pool-words{flex:1 1 12rem;color:var(--hc-window-ink-plain,rgba(227,237,245,0.86));}
.hc-posts-earlier summary{cursor:pointer;min-height:2rem;display:flex;align-items:center;color:var(--hc-window-ink-quiet,rgba(227,237,245,0.68));}
.hc-posts-earlier summary:focus-visible{outline:2px solid var(--hc-focus,currentColor);outline-offset:2px;}
.hc-posts-earlier[open] summary{margin-bottom:0.4rem;}
.hc-posts-form{display:grid;gap:0.9rem;min-width:0;}
.hc-posts-field{display:grid;gap:0.3rem;min-width:0;color:var(--hc-window-ink-quiet,rgba(227,237,245,0.68));font-size:0.9rem;}
.hc-posts-field select,.hc-posts-field input{font:inherit;font-size:max(16px,1.05rem);min-height:2.75rem;width:100%;padding:0 0.7rem;box-sizing:border-box;
  border-radius:var(--hc-radius-control,2px);border:1px solid var(--hc-window-line-firm,rgba(227,237,245,0.26));
  background:rgba(var(--hc-panel-pane,12,19,27),0.9);color:var(--hc-window-ink-loud,#eef2f5);}
.hc-posts-field input:focus-visible,.hc-posts-field select:focus-visible{outline:2px solid var(--hc-focus,${ON});outline-offset:1px;}
.hc-posts-on{margin:0;color:var(--hc-window-ink-plain,rgba(227,237,245,0.86));overflow-wrap:anywhere;}
.hc-posts-extra{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:0.9rem;}
.hc-posts-actions,.hc-posts-confirm-actions{display:flex;flex-wrap:wrap;align-items:center;gap:0.5rem 0.7rem;}
.hc-posts-hint{flex:1 1 10rem;margin:0;font-size:0.9rem;color:var(--hc-window-ink-quiet,rgba(227,237,245,0.68));}
.hc-posts-confirm{display:grid;gap:0.8rem;padding:0.8rem;border:1px solid var(--hc-status-warn,var(--hc-window-line-firm,rgba(227,237,245,0.26)));border-radius:var(--hc-radius-card,3px);}
.hc-posts-confirm p{margin:0;overflow-wrap:anywhere;color:var(--hc-window-ink-loud,#eef2f5);}
.hc-posts button{appearance:none;font:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:0.4rem;
  min-height:2.75rem;padding:0 1rem;border-radius:var(--hc-radius-control,2px);border:1px solid var(--hc-window-line-firm,rgba(227,237,245,0.26));
  background:transparent;color:var(--hc-window-ink-loud,#eef2f5);}
.hc-posts button:hover:not(:disabled){background:rgba(227,237,245,0.08);}
.hc-posts button:focus-visible{outline:2px solid var(--hc-focus,currentColor);outline-offset:2px;}
.hc-posts button:disabled{cursor:default;opacity:0.5;}
.hc-posts button.hc-posts-open,.hc-posts button.hc-posts-code,.hc-posts button.hc-posts-start{padding:0 1.4rem;font-weight:600;border-color:${ON};background:${ON};color:${ON_INK};}
.hc-posts button.hc-posts-open:hover:not(:disabled),.hc-posts button.hc-posts-code:hover:not(:disabled),.hc-posts button.hc-posts-start:hover:not(:disabled){background:${ON};filter:brightness(1.08);}
.hc-posts button.hc-posts-start{justify-self:start;}
.hc-posts button.hc-posts-recycle,.hc-posts button.hc-posts-cancel,.hc-posts button.hc-posts-keep,.hc-posts button.hc-posts-more{border-color:transparent;padding:0 0.5rem;
  color:var(--hc-window-ink-plain,rgba(227,237,245,0.86));text-underline-offset:0.2em;}
.hc-posts button.hc-posts-more{justify-self:start;min-height:2.2rem;padding:0;text-align:left;white-space:normal;text-decoration:underline;
  text-decoration-color:var(--hc-window-line-firm,rgba(227,237,245,0.26));}
.hc-posts button.hc-posts-dismiss{flex:none;width:2.75rem;padding:0;border-color:transparent;}
.hc-posts button.hc-posts-dismiss svg{width:1.3rem;height:1.3rem;fill:currentColor;}
@media (max-width:560px){.hc-posts{padding:0;place-items:stretch;}.hc-posts-card{width:100%;max-height:none;height:100%;border-radius:0;border-left:0;border-right:0;
  padding:calc(env(safe-area-inset-top,0px) + 1rem) 1rem calc(env(safe-area-inset-bottom,0px) + 1rem);align-content:start;}}
@media (forced-colors:active){.hc-posts button.hc-posts-open,.hc-posts button.hc-posts-code,.hc-posts button.hc-posts-start{background:ButtonText;color:ButtonFace;border-color:ButtonText;}}
`

const piece = <K extends keyof HTMLElementTagNameMap>(tag: K, name: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  node.className = name
  if (text !== undefined) node.textContent = text
  return node
}

const glyph = (path: string): SVGSVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  shape.setAttribute('d', path)
  svg.append(shape)
  return svg
}

/** A page as a person says it: its address without the scheme. */
const pageWords = (page: string): string => page.replace(/^https?:\/\//, '').replace(/\/$/, '')

/** Has a pool stopped taking posts: closed in the index, or past the end it shows. */
const hasEnded = (pool: LeaderPool, nowSeconds: number): boolean => {
  const until = pool.known?.until ?? pool.until ?? 0
  return pool.state === 'closed' || (until > 0 && until <= nowSeconds)
}

/** Is a pool taking posts right now. */
export const isTakingPosts = (pool: LeaderPool, nowSeconds: number): boolean => pool.state === 'open' && !hasEnded(pool, nowSeconds)

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

/** The bar's one line about posts: how many pools take posts now, and the press that opens the card. */
export function entryPostsLine(say: EntryPostsSay, onOpen: () => void, now: () => number = Date.now): {
  element: HTMLElement
  update(state: EntryPostsState): void
} {
  const element = piece('div', 'hc-pools-row hc-pools-quiet hc-posts-bar')
  const words = piece('span', 'hc-posts-bar-words')
  const open = piece('button', 'hc-pools-text hc-posts-bar-open')
  open.type = 'button'
  open.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); onOpen() })
  element.append(words, open)
  const update = (state: EntryPostsState): void => {
    const nowSeconds = Math.floor(now() / 1000)
    const taking = state.pools.filter(one => isTakingPosts(one, nowSeconds)).length
    words.textContent = taking === 0
      ? say('pools.posts.bar.none', 'Phones can post to your page with a code.')
      : taking === 1
        ? say('pools.posts.bar.count.one', '1 page is taking posts from phones.', { count: 1 })
        : say('pools.posts.bar.count.other', '{count} pages are taking posts from phones.', { count: taking })
    open.textContent = say('pools.posts.card.title', 'Collect from phones')
  }
  return { element, update }
}

let panelsMade = 0

/**
 * Build the card: one full-screen dialog. `update` puts a state on the same
 * nodes; `dispose` takes the element away. `onDismiss` is its Close, the press
 * outside it, and Escape when no confirm is up.
 */
export function entryPostsPanel(say: EntryPostsSay, actions: EntryPostsActions, now: () => number = Date.now, options: { onDismiss?(): void } = {}): {
  element: HTMLElement
  update(state: EntryPostsState): void
  dispose(): void
} {
  const serial = ++panelsMade
  const element = piece('div', 'hc-posts')
  element.id = 'hc-posts'
  element.setAttribute('role', 'dialog')
  element.setAttribute('aria-modal', 'true')
  element.setAttribute('aria-labelledby', `hc-posts-title-${serial}`)
  // The card owns its keys and its wheel: Escape is answered here (keyboard/escape-cascade.ts).
  element.setAttribute('data-escape-local', '')
  element.setAttribute('data-consumes-wheel', '')
  const style = document.createElement('style')
  style.textContent = STYLE
  const card = piece('div', 'hc-posts-card')

  const button = (name: string, onPress: () => void): HTMLButtonElement => {
    const node = piece('button', name)
    node.type = 'button'
    node.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (!node.disabled) onPress() })
    return node
  }
  const dismissNow = (): void => options.onDismiss?.()

  const mark = piece('span', 'hc-posts-mark')
  mark.append(glyph(PHONE_PATH))
  const title = piece('h2', 'hc-posts-title')
  title.id = `hc-posts-title-${serial}`
  title.tabIndex = -1
  const dismiss = button('hc-posts-dismiss', dismissNow)
  dismiss.append(glyph(CLOSE_PATH))
  const head = piece('header', 'hc-posts-head')
  head.append(mark, title, dismiss)
  const intro = piece('p', 'hc-posts-lead')

  const lead = piece('span', 'hc-posts-say')
  lead.setAttribute('role', 'status')
  const whose = piece('span', 'hc-posts-whose')
  whose.hidden = true
  const line = piece('div', 'hc-posts-line')
  line.append(lead, whose)

  const nowKicker = piece('h3', 'hc-posts-kicker')
  const list = piece('ul', 'hc-posts-list')
  const nowBox = piece('section', 'hc-posts-now')
  nowBox.append(nowKicker, list)

  const start = button('hc-posts-start', actions.onStart)

  const field = <T extends HTMLElement>(label: HTMLLabelElement, words: HTMLSpanElement, control: T): T => {
    label.append(words, control)
    return control
  }
  const nameWords = piece('span', 'hc-posts-label')
  const nameLabel = piece('label', 'hc-posts-field')
  const name = field(nameLabel, nameWords, piece('input', 'hc-posts-name'))
  name.type = 'text'
  name.maxLength = ENTRY_LIMITS.title
  name.autocomplete = 'off'
  /** Whether the leader has typed in the name since the form came up: a typed name is never written over. */
  let typed = false
  name.addEventListener('input', () => { typed = true; actions.onChoose('title', name.value) })
  name.addEventListener('keydown', event => { if (event.key === 'Enter' && !open.disabled) { event.preventDefault(); actions.onOpen() } })
  const pageLabelWords = piece('span', 'hc-posts-label')
  const pageLabel = piece('label', 'hc-posts-field')
  const page = field(pageLabel, pageLabelWords, piece('select', 'hc-posts-page'))
  page.addEventListener('change', () => actions.onChoose('page', page.value))
  const onPage = piece('p', 'hc-posts-on')
  const daysWords = piece('span', 'hc-posts-label')
  const daysLabel = piece('label', 'hc-posts-field')
  const days = field(daysLabel, daysWords, piece('select', 'hc-posts-days'))
  days.addEventListener('change', () => actions.onChoose('days', days.value))
  const formWords = piece('span', 'hc-posts-label')
  const formLabel = piece('label', 'hc-posts-field')
  const template = field(formLabel, formWords, piece('select', 'hc-posts-template'))
  template.addEventListener('change', () => actions.onChoose('template', template.value))
  /** The end and the form stay at what they are until the leader asks to change them. */
  let choosing = false
  const more = button('hc-posts-more', () => { choosing = true; if (last) update(last); days.focus() })
  const extra = piece('div', 'hc-posts-extra')
  extra.append(daysLabel, formLabel)
  const open = button('hc-posts-open', actions.onOpen)
  const cancel = button('hc-posts-cancel', actions.onCancel)
  const hint = piece('p', 'hc-posts-hint')
  const formActions = piece('div', 'hc-posts-actions')
  formActions.append(open, cancel, hint)
  const form = piece('div', 'hc-posts-form')
  form.append(nameLabel, pageLabel, onPage, more, extra, formActions)

  const confirmWords = piece('p', 'hc-posts-confirm-words')
  confirmWords.id = `hc-posts-confirm-words-${serial}`
  const bring = button('hc-posts-bring', () => actions.onConfirm(true))
  const without = button('hc-posts-without', () => actions.onConfirm(false))
  const keep = button('hc-posts-keep', actions.onCancel)
  const confirmActions = piece('div', 'hc-posts-confirm-actions')
  confirmActions.append(bring, without, keep)
  const confirm = piece('div', 'hc-posts-confirm')
  confirm.setAttribute('role', 'alertdialog')
  confirm.setAttribute('aria-describedby', confirmWords.id)
  confirm.append(confirmWords, confirmActions)

  const earlierWords = piece('summary', 'hc-posts-earlier-words')
  const old = piece('ul', 'hc-posts-list hc-posts-old')
  const earlier = piece('details', 'hc-posts-earlier')
  earlier.append(earlierWords, old)

  card.append(head, intro, line, nowBox, start, form, confirm, earlier)
  element.append(style, card)

  // A press on the dark around the card closes it, the way the code's own backdrop does.
  element.addEventListener('click', event => { if (event.target === element) dismissNow() })
  // THE KEYS ARE THE CARD'S. Escape answers the confirm first (it cancels, and nothing is recycled), then closes the
  // card; Tab goes round the card and never out to the hive; no other key reaches the hive from here.
  element.addEventListener('keydown', event => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      if (last?.confirm) { if (!keep.disabled) actions.onCancel() } else dismissNow()
      return
    }
    if (event.key !== 'Tab') return
    const stops = [...card.querySelectorAll<HTMLElement>('button,input,select,summary')]
      .filter(stop => !(stop as HTMLButtonElement).disabled && !stop.hidden && !stop.closest('[hidden]') && (stop.tagName === 'SUMMARY' || !stop.closest('details:not([open])')))
    const first = stops[0]
    const final = stops[stops.length - 1]
    if (!first || !final) return
    const at = document.activeElement
    if (event.shiftKey ? at === first || at === title : at === final) {
      event.preventDefault()
      ;(event.shiftKey ? final : first).focus()
    }
  })

  /** A select's options, made again only when what it offers changed. */
  const offer = (select: HTMLSelectElement, choices: readonly { value: string; words: string }[], chosen: string): void => {
    const stamp = JSON.stringify(choices)
    if (select.dataset['stamp'] !== stamp) {
      select.replaceChildren(...choices.map(one => {
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
  /** Whether the form was up at the last update: the title takes the focus once as it comes up. */
  let formed = false
  /** The confirm last shown, so the focus moves into it once as it comes up. */
  let asked: EntryPostsState['confirm'] = null
  /** Where the focus goes back to once the confirm is gone and nothing is running: the press that asked. */
  let returnTo: { readonly kind: 'open' | 'recycle'; readonly pool: string } | null = null
  /** Whether the focus was let go: on nothing, or on a press the confirm took off the page. */
  const focusLost = (): boolean => {
    const held = document.activeElement
    return !held || held === document.body || confirm.contains(held) || !(held as HTMLElement).isConnected || !!(held as HTMLElement).closest('[hidden]')
  }
  const rows = (): HTMLElement[] => [...element.querySelectorAll<HTMLElement>('.hc-posts-pool')]
  /** The wake at the next end the card shows, so "ends ..." turns to "closed" without anyone pressing anything. */
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
    title.textContent = say('pools.posts.card.title', 'Collect from phones')
    intro.textContent = say('pools.posts.card.lead', 'Show a code on your screen. Anyone who scans it can post an entry to your page from their phone, with no account.')
    const closeWords = say('pools.posts.card.close', 'Close')
    dismiss.title = closeWords
    dismiss.setAttribute('aria-label', closeWords)

    lead.textContent = state.busy
      || state.said?.text
      || (state.reading ? say('pools.posts.reading', 'Reading your pools...') : '')
    const refusal = !state.busy && !!state.said && !state.said.ok
    if (refusal) lead.dataset['tone'] = 'refused'
    else if (busy) lead.dataset['tone'] = 'busy'
    else delete lead.dataset['tone']
    const fixer = refusal ? entryWhoseWords(state.said?.whose) : ''
    whose.textContent = fixer
    whose.hidden = !fixer
    line.hidden = !lead.textContent
    if (busy) element.setAttribute('aria-busy', 'true')
    else element.removeAttribute('aria-busy')

    const nowSeconds = Math.floor(now() / 1000)
    const taking = state.pools.filter(one => isTakingPosts(one, nowSeconds))
    const rest = state.pools.filter(one => !isTakingPosts(one, nowSeconds))
    // Whether each pool has ended is part of what the card shows, so it is part of the stamp.
    const stamp = JSON.stringify([state.pools.map(one => [one.pool, one.state, one.code !== '', one.entries, one.known?.until ?? one.until, one.known?.title ?? one.title, hasEnded(one, nowSeconds)]), busy, document.documentElement.lang])
    if (stamp !== listStamp) {
      listStamp = stamp
      // A press the focus was on is made again: the focus goes to the one made in its place.
      const holding = document.activeElement instanceof HTMLButtonElement && (list.contains(document.activeElement) || old.contains(document.activeElement)) ? document.activeElement : null
      const heldAt = holding ? { pool: holding.closest<HTMLElement>('li')?.dataset['pool'] ?? '', name: holding.className } : null
      const item = (pool: LeaderPool): HTMLLIElement => {
        const row = piece('li', 'hc-posts-pool')
        row.dataset['pool'] = pool.pool
        row.append(piece('span', 'hc-posts-pool-words', entryPoolWords(say, pool, nowSeconds)))
        if (pool.code) {
          const code = button('hc-posts-code', () => actions.onCode(pool))
          code.textContent = say('pools.posts.card.code', 'Show the code')
          code.disabled = busy
          row.append(code)
        }
        if (pool.state === 'open') {
          const close = button('hc-posts-close', () => actions.onClose(pool))
          close.textContent = say('pools.posts.card.stop', 'Stop taking posts')
          close.disabled = busy
          row.append(close)
        }
        // Every pool can be recycled, one opened on another device too: its keys are the leader's own.
        const recycle = button('hc-posts-recycle', () => actions.onRecycle(pool))
        recycle.textContent = say('pools.posts.recycle', 'Recycle')
        recycle.disabled = busy
        row.append(recycle)
        return row
      }
      list.replaceChildren(...taking.map(item))
      old.replaceChildren(...rest.map(item))
      if (heldAt) {
        const row = rows().find(one => one.dataset['pool'] === heldAt.pool)
        const again = [...(row?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(press => press.className === heldAt.name)
        if (again) { if (old.contains(again)) earlier.open = true; again.focus() }
      }
    }
    nowKicker.textContent = say('pools.posts.card.now', 'Taking posts now')
    nowBox.hidden = !taking.length
    earlierWords.textContent = say('pools.posts.card.earlier', 'Earlier ({count})', { count: rest.length })
    earlier.hidden = !rest.length
    rewake(state, nowSeconds)

    start.textContent = state.pools.length ? say('pools.posts.card.another', 'Start another') : say('pools.posts.card.start', 'Start collecting')
    start.hidden = state.forming || !!state.confirm
    start.disabled = busy

    form.hidden = !state.forming || !!state.confirm
    nameWords.textContent = say('pools.posts.card.name', 'What is it for?')
    name.placeholder = say('pools.posts.form.title-hint', 'Tuesday class')
    if (form.hidden) typed = false
    if (name.value !== state.choice.title && (!typed || document.activeElement !== name)) {
      name.value = state.choice.title
      if (document.activeElement === name) name.select()
    }
    pageLabelWords.textContent = say('pools.posts.card.page', 'Which page shows the form?')
    offer(page, state.pages.map(one => ({ value: one, words: pageWords(one) })), state.choice.page)
    pageLabel.hidden = state.pages.length < 2
    onPage.textContent = state.choice.page ? say('pools.posts.card.on-page', 'People post on {page}.', { page: pageWords(state.choice.page) }) : ''
    onPage.hidden = state.pages.length !== 1
    daysWords.textContent = say('pools.posts.form.ends', 'Ends in')
    const dayWords = (count: number): string => count === 1 ? say('pools.posts.form.days.one', '1 day', { count }) : say('pools.posts.form.days.other', '{count} days', { count })
    offer(days, ENTRY_END_DAYS.map(count => ({ value: String(count), words: dayWords(count) })), String(state.choice.days))
    formWords.textContent = say('pools.posts.form.template', 'What people fill in')
    offer(template, state.templates.map(one => ({ value: one.sig, words: one.name })), state.choice.template)
    const chosenForm = state.templates.find(one => one.sig === state.choice.template)?.name ?? ''
    more.textContent = say('pools.posts.card.more', 'Ends in {days}. People fill in "{form}". Change', { days: dayWords(state.choice.days), form: chosenForm })
    more.hidden = choosing || !chosenForm
    extra.hidden = !choosing
    open.textContent = say('pools.posts.card.go', 'Start')
    const untitled = !state.choice.title.trim()
    open.disabled = busy || !state.pages.length || !state.templates.length || untitled
    cancel.textContent = say('pools.posts.form.cancel', 'Cancel')
    cancel.disabled = !!state.busy
    // Cancel goes back to the pools; with none to go back to, the card's own Close is the way out.
    cancel.hidden = !state.pools.length
    hint.textContent = !busy && untitled && state.pages.length && state.templates.length ? say('pools.posts.card.hint.title', 'Give it a name to start.') : ''
    hint.hidden = !hint.textContent
    if (!form.hidden && !formed && element.isConnected && !busy) { name.focus(); name.select() }
    formed = !form.hidden && !busy

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
      const row = rows().find(one => one.dataset['pool'] === back.pool)
      const again = back.kind === 'recycle' ? row?.querySelector<HTMLButtonElement>('.hc-posts-recycle') ?? null : open
      if (again && old.contains(again)) earlier.open = true
      const target = [again, start, dismiss].find(press => !!press && !press.disabled && !press.hidden && !press.closest('[hidden]'))
      if (target && focusLost()) target.focus()
    }
    // The focus never rests on something the card took away.
    if (element.isConnected && element.contains(document.activeElement) && (document.activeElement as HTMLElement).closest('[hidden]')) title.focus()
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
  /** Whether the leader typed the name: until then it is the form's name and today's date. */
  #named = false

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
    const template = templates.some(one => one.sig === choice.template) ? choice.template : templates[0]?.sig ?? ''
    this.#set({
      reading: false, host: read.host, pages: read.pages, pools: read.pools, templates,
      choice: {
        ...choice,
        page: read.pages.includes(choice.page) ? choice.page : read.pages[0] ?? '',
        template,
        title: this.#named ? choice.title : this.#defaultTitle(templates, template),
      },
      ...(read.told.length ? { said: { text: read.told.join(' '), ok: true } } : keepSaid ? {} : { said: null }),
    })
  }

  /** The name a pool gets until the leader types one: what people fill in, and today. '' with no form to name. */
  #defaultTitle(templates: readonly EntryPostsTemplate[], sig: string): string {
    const form = templates.find(one => one.sig === sig)?.name ?? ''
    if (!form) return ''
    const now = new Date((this.#deps.now ?? Date.now)())
    let date = ''
    try { date = now.toLocaleDateString(document.documentElement.lang || undefined, { day: 'numeric', month: 'short' }) } catch { date = now.toISOString().slice(0, 10) }
    return this.#say('pools.posts.form.title-default', '{form}, {date}', { form, date }).slice(0, ENTRY_LIMITS.title)
  }

  async #templates(): Promise<EntryPostsTemplate[]> {
    const out: EntryPostsTemplate[] = []
    for (const form of (this.#deps.forms ?? entryForms)()) {
      for (const one of await form.templates().catch(() => [])) out.push({ ...one, meaning: form.meaning })
    }
    return out
  }

  /**
   * The card came up: read the pools, and when nothing is taking posts go straight to the form, since starting is
   * what the leader came for. With a pool taking posts the card shows it, and "Start another" asks for the form.
   */
  async begin(): Promise<void> {
    this.#set({ forming: false, confirm: null, said: null })
    await this.refresh()
    if (this.#state.said && !this.#state.said.ok) return
    const nowSeconds = Math.floor((this.#deps.now ?? Date.now)() / 1000)
    if (!this.#state.pools.some(one => isTakingPosts(one, nowSeconds))) await this.start(false)
  }

  /** The form, with the pools read fresh unless they just were. With no page to offer it says so and stops. */
  async start(read = true): Promise<void> {
    this.#set({ forming: true, confirm: null, ...(read ? { said: null } : {}) })
    if (read) await this.refresh()
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
    if (field === 'title') this.#named = true
    // Another form, and the name not typed yet: the name follows the form.
    if (field === 'template' && !this.#named) choice.title = this.#defaultTitle(this.#state.templates, choice.template)
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
    this.#named = false
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
