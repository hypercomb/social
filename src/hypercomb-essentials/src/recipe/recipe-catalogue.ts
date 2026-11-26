// recipe/recipe-catalogue.ts
//
// THE CATALOGUE: one page that answers "what is here?". It lists recipe entries
// grouped by where they come from, and it is the same page in two places: the
// recipe view's Browse inside a hive (rows from the domains a reader follows
// and the classmates in their room), and the face a published location shows a
// visitor who arrives with nothing chosen (rows published at that address).
//
// The table is the union of what the nodes offer, one row per signature (T9),
// and the FROM is the reader's own: a node switched off shows nothing, a node
// switched on heads its own group (T5). A row several nodes offer stands under
// each of them. Search lights, it never removes: clear the field and every row
// is back (H7). A row is an offer, and nothing is taken until a press (T4).
//
// A NODE MAY CARRY ONE PRESS of the caller's beside its name: the leader's
// Hide on a poster in a pool they opened for posts. A ROW MAY CARRY ONE TOO,
// under its card, for that node: the leader's Hide on one entry. A node the
// caller holds back (a poster the leader hid) heads a group of its own with no
// rows, under the others, so Show again is always beside it; a held-back line
// may carry its own press instead (one hidden entry, with its Show again).
// Which press a node or a row carries and what it does are the caller's; this
// page only draws it.
//
// An opened entry is not drawn here. `onOpen` hands the signature to the
// caller, which mounts `recipePage` with `readOnly` over this page: both sit at
// the same height, so the one mounted later is on top.
//
// PURE DOM. No IoC, no store, no network, no EffectBus, no registration. Every
// name came from a stranger's host and reaches the page through textContent,
// and a cover is a signature the caller resolves (I2): an image element is made
// only from an address the caller answers, so showing this page can make the
// browser contact nobody (T7).

import { poolNodeInitials, poolNodeKey, poolNodeTitle, uniquePoolNodes, type PoolNode } from '../pools/pool-node.js'
import { ensureRecipeStyles, recipeEl, recipeMark, recipeWords, type RecipeSay } from './recipe-style.js'

export const RECIPE_CATALOGUE_STYLE_ID = 'hc-recipe-catalogue-style'

/** A recipe entry as a row: its signature, what it is called, and who offers it. */
export interface RecipeCatalogueRow {
  /** The entry's signature: what a press answers with. */
  readonly sig: string
  readonly name: string
  /** The cover picture, by signature. The caller resolves it. */
  readonly cover?: string
  /** Every node that offers this row. A row with none belongs to no group and is not shown. */
  readonly nodes: readonly PoolNode[]
  /** When it was offered. Newer rows come first inside a group. */
  readonly at?: number
}

/** A press beside a node's name: its words, and what it does. */
export interface RecipeCatalogueNodeAction {
  readonly label: string
  /** Said to a screen reader and on hover: what the press does, to whom. */
  readonly title?: string
  readonly busy?: boolean
  onPress(): void
}

/** A node the caller holds back: it offers no rows here, and says why in one line. */
export interface RecipeCatalogueHeldBack {
  readonly node: PoolNode
  readonly note: string
  /** The line's own press, in place of the node's: one held-back entry's Show again. A line with its own press is
   *  drawn even when the node heads a group of rows. */
  readonly action?: RecipeCatalogueNodeAction
  /** Tells two lines of one node apart. */
  readonly id?: string
}

/** The rows one node offers. */
export interface RecipeCatalogueGroup {
  readonly node: PoolNode
  readonly rows: RecipeCatalogueRow[]
}

export interface RecipeCatalogueOptions {
  say: RecipeSay
  /** "Recipes from your nodes", or the location's name on a published door. */
  title: string
  /** One quiet line: where these come from. */
  note?: string
  rows: readonly RecipeCatalogueRow[]
  /** The nodes switched on. When given, only rows from one of them show. */
  nodes?: readonly PoolNode[]
  query?: string
  /** True while the nodes are still being asked. */
  loading?: boolean
  /** The src of a picture held by signature, or '' until it is ready: then no image element is made. */
  pictureUrl(sig: string): string
  /** A row was chosen. */
  onOpen(sig: string): void
  /** The search as typed. Without it there is no search field. */
  onQuery?(query: string): void
  /** Without it there is no Close: a published door has nothing to go back to. */
  onClose?(): void
  /** The press a node carries beside its name, if any. Asked at each paint. */
  nodeAction?(node: PoolNode): RecipeCatalogueNodeAction | null
  /** The press a row carries under its card, in the group of one node, if any. Asked at each paint. */
  rowAction?(row: RecipeCatalogueRow, node: PoolNode): RecipeCatalogueNodeAction | null
  /** Nodes that head an empty group of their own, under the others. */
  heldBack?: readonly RecipeCatalogueHeldBack[]
}

/** What changed. A field left out keeps the value it had; `note` and `nodes` given as undefined are cleared. */
export type RecipeCatalogueUpdate = Partial<Pick<RecipeCatalogueOptions, 'title' | 'note' | 'rows' | 'nodes' | 'query' | 'loading' | 'heldBack'>>

export interface RecipeCatalogueHandle {
  readonly element: HTMLElement
  /** Redraw with what changed. Every cover is asked for again, so a picture that became ready shows. */
  update(next: RecipeCatalogueUpdate): void
  /** Put focus inside the page: on the card last opened, else the search field, else the first card. */
  focus(): void
  dispose(): void
}

// ── the grouping ────────────────────────────────────────────────────────────

/** Your own node first, then participants, then domains. */
const nodeRank = (node: PoolNode): number => (node.you ? 0 : node.kind === 'participant' ? 1 : 2)

const byNode = (a: RecipeCatalogueGroup, b: RecipeCatalogueGroup): number =>
  nodeRank(a.node) - nodeRank(b.node)
  || poolNodeTitle(a.node).localeCompare(poolNodeTitle(b.node), undefined, { sensitivity: 'base' })
  || (a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0)

/**
 * The rows as groups, one per node that offers something.
 *  - the same signature is one row, offered by every node any mention named;
 *  - with `nodes`, only those nodes head a group;
 *  - with a query, a row stays only if it says every word, in its own name or
 *    in the name of a node that offers it;
 *  - groups run your own node, participants, domains, each by name; rows run
 *    newest first, and those with no date keep the order they were given in.
 */
export function recipeCatalogueGroups(rows: readonly RecipeCatalogueRow[], nodes?: readonly PoolNode[], query = ''): RecipeCatalogueGroup[] {
  // Every node once, with the fullest name any mention gave it.
  const known = new Map(uniquePoolNodes([...(nodes ?? []), ...rows.flatMap(row => row.nodes)]).map(node => [poolNodeKey(node), node] as const))
  const on = nodes ? new Set(nodes.map(poolNodeKey)) : undefined

  const bySig = new Map<string, RecipeCatalogueRow>()
  for (const row of rows) {
    const held = bySig.get(row.sig)
    const from = uniquePoolNodes([...(held?.nodes ?? []), ...row.nodes]).map(node => known.get(poolNodeKey(node)) ?? node)
    bySig.set(row.sig, { ...(held ?? row), nodes: from })
  }

  const wanted = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const offeredBy = new Map<string, RecipeCatalogueRow[]>()
  for (const row of bySig.values()) {
    const said = [row.name, ...row.nodes.map(poolNodeTitle)].join('\n').toLocaleLowerCase()
    if (!wanted.every(word => said.includes(word))) continue
    for (const node of row.nodes) {
      const key = poolNodeKey(node)
      if (on && !on.has(key)) continue
      const group = offeredBy.get(key)
      if (group) group.push(row)
      else offeredBy.set(key, [row])
    }
  }

  const groups: RecipeCatalogueGroup[] = []
  for (const [key, offered] of offeredBy) {
    const node = known.get(key)
    if (node) groups.push({ node, rows: offered.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)) })
  }
  return groups.sort(byNode)
}

// ── the look ────────────────────────────────────────────────────────────────

// The page's own vocabulary, said again for this root: the recipe sheet scopes
// it to the page and the picker. The field and the tool button are that sheet's.
const RECIPE_CATALOGUE_STYLE = `
.hc-recipe-catalogue{
  --rp-ink:var(--hc-panel-ink,227,237,245);
  --rp-pane:var(--hc-panel-pane,12,19,27);
  --rp-loud:var(--hc-window-ink-loud,rgba(var(--rp-ink),0.96));
  --rp-plain:var(--hc-window-ink-plain,rgba(var(--rp-ink),0.86));
  --rp-quiet:var(--hc-window-ink-quiet,rgba(var(--rp-ink),0.66));
  --rp-line:var(--hc-window-line,rgba(var(--rp-ink),0.14));
  --rp-line-firm:var(--hc-window-line-firm,rgba(var(--rp-ink),0.28));
  --rp-tint:var(--hc-window-tint,rgba(var(--rp-ink),0.045));
  --rp-tint-strong:var(--hc-window-tint-strong,rgba(var(--rp-ink),0.09));
  --rp-accent:var(--hc-window-accent,var(--md-primary,#7ec3ee));
  --rp-control:var(--hc-radius-control,2px);
  box-sizing:border-box;position:fixed;inset:0;z-index:var(--hc-recipe-z,60020);display:flex;flex-direction:column;
  background:rgb(var(--rp-pane));
  font-family:var(--hc-font,system-ui,-apple-system,'Segoe UI',sans-serif);
  font-size:calc(1.0625rem * var(--hc-panel-scale,1));line-height:1.5;
  color:var(--rp-plain);-webkit-text-size-adjust:100%;text-size-adjust:100%;
}
.hc-recipe-catalogue:focus{outline:none;}
.hc-recipe-catalogue *,.hc-recipe-catalogue *::before,.hc-recipe-catalogue *::after{box-sizing:border-box;}
.hc-recipe-catalogue [hidden]{display:none !important;}
.hc-recipe-catalogue svg{display:block;flex:none;width:1.25rem;height:1.25rem;fill:currentColor;}
.hc-recipe-catalogue :focus-visible{outline:2px solid var(--rp-accent);outline-offset:2px;}

.hc-recipe-catalogue-head{flex:none;border-bottom:1px solid var(--rp-line);
  padding:calc(env(safe-area-inset-top,0px) + 0.5rem) max(1rem,env(safe-area-inset-right,0px)) 0.6rem max(1rem,env(safe-area-inset-left,0px));}
.hc-recipe-catalogue-bar{display:flex;flex-wrap:wrap;align-items:center;gap:0.5rem 0.75rem;max-width:72rem;margin:0 auto;}
.hc-recipe-catalogue-title{flex:1 1 12rem;min-width:0;margin:0;font-size:1.25rem;font-weight:500;line-height:1.3;color:var(--rp-loud);overflow-wrap:anywhere;}
.hc-recipe-catalogue-search{flex:0 1 20rem;}
.hc-recipe-catalogue-note{max-width:72rem;margin:0.25rem auto 0;font-size:0.9rem;color:var(--rp-quiet);overflow-wrap:anywhere;}

.hc-recipe-catalogue-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;}
.hc-recipe-catalogue-column{display:flex;flex-direction:column;gap:2.25rem;max-width:72rem;margin:0 auto;
  padding:1.5rem max(1rem,env(safe-area-inset-right,0px)) calc(4rem + env(safe-area-inset-bottom,0px)) max(1rem,env(safe-area-inset-left,0px));}
.hc-recipe-catalogue-group{display:flex;flex-direction:column;gap:0.85rem;min-width:0;}
.hc-recipe-catalogue-from{display:flex;align-items:center;gap:0.6rem;min-width:0;margin:0;font-size:1.05rem;font-weight:500;line-height:1.3;color:var(--rp-loud);}
.hc-recipe-catalogue-from-name{min-width:0;overflow-wrap:anywhere;}
.hc-recipe-catalogue-count{flex:none;font-size:0.85rem;font-weight:400;color:var(--rp-quiet);white-space:nowrap;}
.hc-recipe-catalogue-from-row{display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;min-width:0;}
.hc-recipe-catalogue-node-action,.hc-recipe-catalogue-row-action{appearance:none;flex:none;margin-left:auto;min-height:2rem;padding:0 0.7rem;border:1px solid var(--rp-line-firm);
  border-radius:var(--rp-control);background:transparent;color:var(--rp-plain);font:inherit;font-size:0.85rem;font-weight:400;cursor:pointer;}
.hc-recipe-catalogue-node-action:hover,.hc-recipe-catalogue-row-action:hover{background:var(--rp-tint-strong);}
.hc-recipe-catalogue-node-action[disabled],.hc-recipe-catalogue-row-action[disabled]{opacity:0.55;cursor:default;}

.hc-recipe-catalogue-chip{flex:none;display:inline-grid;place-items:center;width:1.75rem;height:1.75rem;border:1px solid var(--rp-line-firm);
  border-radius:var(--rp-control);background:var(--rp-tint-strong);color:var(--rp-loud);
  font-family:var(--hc-font,system-ui,-apple-system,'Segoe UI',sans-serif);font-size:0.7rem;font-weight:600;line-height:1;letter-spacing:0.02em;
  white-space:nowrap;overflow:hidden;}
.hc-recipe-catalogue-chip.is-person{border-radius:50%;}
.hc-recipe-catalogue-chip.is-you{border-color:var(--rp-accent);}

.hc-recipe-catalogue-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(13rem,1fr));gap:0.85rem;margin:0;padding:0;list-style:none;}
.hc-recipe-catalogue-grid li{display:flex;flex-direction:column;gap:0.35rem;min-width:0;}
.hc-recipe-catalogue-grid li > .hc-recipe-catalogue-card{flex:1 1 auto;}
.hc-recipe-catalogue-row-action{margin-left:0;align-self:flex-start;}
.hc-recipe-catalogue-card{appearance:none;display:flex;flex-direction:column;width:100%;min-width:0;min-height:3.5rem;margin:0;padding:0;
  border:1px solid var(--rp-line);border-radius:var(--rp-control);background:var(--rp-tint);color:var(--rp-plain);
  font:inherit;text-align:left;cursor:pointer;overflow:hidden;transition:border-color 120ms ease,background-color 120ms ease;}
.hc-recipe-catalogue-card:hover{border-color:var(--rp-line-firm);background:var(--rp-tint-strong);}
.hc-recipe-catalogue-cover{flex:none;display:grid;place-items:center;width:100%;aspect-ratio:4 / 3;background:var(--rp-tint-strong);overflow:hidden;}
.hc-recipe-catalogue-cover img{display:block;width:100%;height:100%;object-fit:cover;}
.hc-recipe-catalogue-plate{font-size:1.75rem;font-weight:500;line-height:1;letter-spacing:0.06em;color:var(--rp-quiet);}
.hc-recipe-catalogue-words{display:flex;flex-direction:column;gap:0.45rem;min-width:0;padding:0.7rem 0.8rem 0.8rem;}
.hc-recipe-catalogue-name{font-size:1.05rem;font-weight:500;line-height:1.3;color:var(--rp-loud);overflow-wrap:anywhere;}
.hc-recipe-catalogue-also{display:flex;flex-wrap:wrap;align-items:center;gap:0.3rem;}
.hc-recipe-catalogue-also .hc-recipe-catalogue-chip{width:1.5rem;height:1.5rem;font-size:0.62rem;}
.hc-recipe-catalogue-more{font-size:0.8rem;color:var(--rp-quiet);}
.hc-recipe-catalogue-quiet{margin:0;font-size:0.95rem;color:var(--rp-quiet);overflow-wrap:anywhere;}

@media (max-width:560px){
  .hc-recipe-catalogue-search{flex:1 1 100%;}
  .hc-recipe-catalogue-column{gap:1.75rem;padding-top:1.25rem;}
  .hc-recipe-catalogue-grid{grid-template-columns:minmax(0,1fr);}
  .hc-recipe-catalogue-card{flex-direction:row;align-items:stretch;min-height:6.5rem;}
  .hc-recipe-catalogue-cover{width:6.5rem;aspect-ratio:auto;}
  .hc-recipe-catalogue-words{flex:1 1 auto;justify-content:center;}
}
@media (prefers-reduced-motion:reduce){
  .hc-recipe-catalogue *{transition:none !important;animation:none !important;}
}
`

/** Inject the catalogue's one stylesheet into a document, once. */
export function ensureRecipeCatalogueStyles(doc: Document): void {
  if (doc.getElementById(RECIPE_CATALOGUE_STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = RECIPE_CATALOGUE_STYLE_ID
  style.textContent = RECIPE_CATALOGUE_STYLE
  ;(doc.head ?? doc.documentElement).appendChild(style)
}

// ── the page ────────────────────────────────────────────────────────────────

/** How many other nodes a card shows as chips before it says how many more there are. */
const CHIPS_SHOWN = 4

/** A recipe's own initials for the plate that stands in for a cover: the rule a participant's name is cut by. */
const recipeInitials = (name: string): string => poolNodeInitials({ kind: 'participant', id: name, name })

/** A card that was drawn, and what it was drawn from: an unchanged card is kept, so its picture is not loaded again. */
interface DrawnCard {
  stamp: string
  line: HTMLLIElement
}

let cataloguesMade = 0

/** Build the catalogue. Its caller fetches the rows, mounts it, and opens what a press chooses. */
export function recipeCatalogue(options: RecipeCatalogueOptions): RecipeCatalogueHandle {
  const doc = document
  ensureRecipeStyles(doc)
  ensureRecipeCatalogueStyles(doc)
  const say = (key: string, fallback: string, params?: Record<string, string | number>): string => recipeWords(options.say, key, fallback, params)
  const serial = `hc-recipe-catalogue-${++cataloguesMade}`
  let rows = options.rows
  let nodes = options.nodes
  let heldBack = options.heldBack ?? []
  let query = options.query ?? ''
  let loading = options.loading === true
  let disposed = false
  let drawn = new Map<string, DrawnCard>()
  let cardsMade = 0
  /** The card a press last opened: where focus returns when the caller comes back. */
  let opened: { sig: string; node: string } | undefined

  // ── the frame ───────────────────────────────────────────────────────────

  const root = recipeEl('section', 'hc-recipe-catalogue')
  // Focusable by script only: a press on an empty part of the page keeps the keys here.
  root.tabIndex = -1
  const heading = recipeEl('h1', 'hc-recipe-catalogue-title', options.title)
  heading.id = `${serial}-title`
  root.setAttribute('aria-labelledby', heading.id)

  const bar = recipeEl('div', 'hc-recipe-catalogue-bar')
  if (options.onClose) {
    const closeWords = say('recipe.catalogue.close', 'Close')
    const close = recipeEl('button', 'hc-recipe-tool')
    close.type = 'button'
    close.title = closeWords
    close.setAttribute('aria-label', closeWords)
    close.append(recipeMark('back'))
    close.addEventListener('click', () => options.onClose?.())
    bar.append(close)
  }
  bar.append(heading)

  const searchField = (): HTMLInputElement => {
    const searchWords = say('recipe.catalogue.search', 'Search recipes')
    const field = recipeEl('input', 'hc-recipe-field hc-recipe-catalogue-search')
    field.type = 'search'
    field.value = query
    field.placeholder = searchWords
    field.autocomplete = 'off'
    field.setAttribute('aria-label', searchWords)
    return field
  }
  const search = options.onQuery ? searchField() : undefined
  if (search) bar.append(search)

  const note = recipeEl('p', 'hc-recipe-catalogue-note', options.note ?? '')
  note.hidden = !options.note
  const head = recipeEl('header', 'hc-recipe-catalogue-head')
  head.append(bar, note)

  const asking = recipeEl('p', 'hc-recipe-catalogue-quiet', say('recipe.catalogue.loading', 'Asking the nodes you draw from'))
  asking.setAttribute('role', 'status')
  const nothing = recipeEl('p', 'hc-recipe-catalogue-quiet')
  nothing.dataset['none'] = ''
  const column = recipeEl('main', 'hc-recipe-catalogue-column')
  const scroll = recipeEl('div', 'hc-recipe-catalogue-scroll')
  scroll.append(column)
  root.append(head, scroll)

  // ── the parts ───────────────────────────────────────────────────────────

  /** What a node is called in words: "You" for the reader's own, else its whole name. */
  const nodeWords = (node: PoolNode): string => (node.you ? say('recipe.catalogue.you', 'You') : poolNodeTitle(node))

  /** A node's plate: its initials to the eye, its whole name on hover and to a screen reader. Round for a person, square for a domain. */
  const chipOf = (node: PoolNode): HTMLElement => {
    const chip = recipeEl('span', 'hc-recipe-catalogue-chip', poolNodeInitials(node))
    if (node.kind === 'participant') chip.classList.add('is-person')
    if (node.you) chip.classList.add('is-you')
    const whole = poolNodeTitle(node)
    chip.title = whole
    chip.setAttribute('role', 'img')
    chip.setAttribute('aria-label', whole)
    return chip
  }

  const plateOf = (name: string): HTMLElement => {
    const plate = recipeEl('span', 'hc-recipe-catalogue-plate', recipeInitials(name))
    plate.setAttribute('aria-hidden', 'true')
    return plate
  }

  /** The address of a row's cover, or '' when it has none or it is not ready. */
  const coverOf = (row: RecipeCatalogueRow): string => {
    if (!row.cover) return ''
    try { return options.pictureUrl(row.cover) || '' } catch { return '' }
  }

  const cardOf = (row: RecipeCatalogueRow, node: PoolNode, others: readonly PoolNode[], src: string, action: RecipeCatalogueNodeAction | null): HTMLLIElement => {
    const id = `${serial}-card-${++cardsMade}`
    const card = recipeEl('button', 'hc-recipe-catalogue-card')
    card.type = 'button'
    card.dataset['sig'] = row.sig
    card.dataset['node'] = poolNodeKey(node)

    const cover = recipeEl('span', 'hc-recipe-catalogue-cover')
    if (src) {
      const img = recipeEl('img')
      img.alt = row.name
      img.draggable = false
      img.setAttribute('loading', 'lazy')
      img.setAttribute('decoding', 'async')
      // A picture that does not arrive leaves the plate, never a broken frame.
      img.addEventListener('error', () => cover.replaceChildren(plateOf(row.name)), { once: true })
      img.src = src
      cover.append(img)
    } else {
      cover.append(plateOf(row.name))
    }

    const name = recipeEl('span', 'hc-recipe-catalogue-name', row.name)
    name.id = `${id}-name`
    const words = recipeEl('span', 'hc-recipe-catalogue-words')
    words.append(name)
    // The card is named by its words alone: the name once, then who else offers it.
    const namedBy = [name.id]
    if (others.length) {
      const also = recipeEl('span', 'hc-recipe-catalogue-also')
      also.id = `${id}-also`
      also.setAttribute('role', 'group')
      also.setAttribute('aria-label', say('recipe.catalogue.also', 'Also from {nodes}', { nodes: others.map(nodeWords).join(', ') }))
      also.append(...others.slice(0, CHIPS_SHOWN).map(chipOf))
      if (others.length > CHIPS_SHOWN) {
        also.append(recipeEl('span', 'hc-recipe-catalogue-more', say('recipe.catalogue.more', '+{count}', { count: others.length - CHIPS_SHOWN })))
      }
      words.append(also)
      namedBy.push(also.id)
    }
    card.setAttribute('aria-labelledby', namedBy.join(' '))
    card.append(cover, words)
    card.addEventListener('click', () => {
      opened = { sig: row.sig, node: poolNodeKey(node) }
      options.onOpen(row.sig)
    })

    const line = recipeEl('li')
    line.append(card)
    // The row's press sits under its card, never inside it: a button holds no other control.
    if (action) line.append(pressOf(action, 'hc-recipe-catalogue-row-action', poolNodeKey(node), row.sig))
    return line
  }

  /** A caller's press as a button: its words, what it says to a screen reader, and busy while it runs. */
  const pressOf = (action: RecipeCatalogueNodeAction, name: string, node: string, sig?: string): HTMLButtonElement => {
    const press = recipeEl('button', name, action.label)
    press.type = 'button'
    press.dataset['node'] = node
    if (sig) press.dataset['sig'] = sig
    if (action.title) {
      press.title = action.title
      press.setAttribute('aria-label', action.title)
    }
    press.disabled = action.busy === true
    const run = action.onPress
    press.addEventListener('click', event => { event.stopPropagation(); if (!press.disabled) run() })
    return press
  }

  /** The caller's press under a row's card in one node's group, when it has one. */
  const rowActionOf = (row: RecipeCatalogueRow, node: PoolNode): RecipeCatalogueNodeAction | null => {
    try { return options.rowAction?.(row, node) ?? null } catch { return null }
  }

  /** The caller's press beside a node's name, when it has one for this node. */
  const actionOf = (node: PoolNode): HTMLButtonElement | null => {
    let action: RecipeCatalogueNodeAction | null = null
    try { action = options.nodeAction?.(node) ?? null } catch { action = null }
    return action ? pressOf(action, 'hc-recipe-catalogue-node-action', poolNodeKey(node)) : null
  }

  const cards = (): HTMLButtonElement[] => Array.from(column.querySelectorAll<HTMLButtonElement>('.hc-recipe-catalogue-card'))

  /** The card for a row, under one node or under any. Found by walking, never by a selector built from what a host wrote. */
  const cardAt = (sig: string | undefined, node?: string): HTMLButtonElement | undefined =>
    cards().find(card => card.dataset['sig'] === sig && (node === undefined || card.dataset['node'] === node))

  const paint = (): void => {
    const active = doc.activeElement instanceof HTMLElement && column.contains(doc.activeElement) ? doc.activeElement : null
    const groups = recipeCatalogueGroups(rows, nodes, query)
    const next = new Map<string, DrawnCard>()
    const sections: HTMLElement[] = []

    groups.forEach((group, at) => {
      const key = poolNodeKey(group.node)
      const from = recipeEl('h2', 'hc-recipe-catalogue-from')
      const name = recipeEl('span', 'hc-recipe-catalogue-from-name', nodeWords(group.node))
      name.id = `${serial}-from-${at}`
      const count = recipeEl('span', 'hc-recipe-catalogue-count', group.rows.length === 1
        ? say('recipe.catalogue.count.one', '1 recipe', { count: 1 })
        : say('recipe.catalogue.count.other', '{count} recipes', { count: group.rows.length }))
      count.id = `${serial}-count-${at}`
      // The heading is read as its words: the chip beside them says the same name.
      from.setAttribute('aria-labelledby', `${name.id} ${count.id}`)
      from.append(chipOf(group.node), name, count)
      const press = actionOf(group.node)

      const grid = recipeEl('ul', 'hc-recipe-catalogue-grid')
      grid.setAttribute('role', 'list')
      for (const row of group.rows) {
        const others = row.nodes.filter(other => poolNodeKey(other) !== key)
        const src = coverOf(row)
        const action = rowActionOf(row, group.node)
        const stamp = JSON.stringify([row.name, src, others.map(other => [poolNodeKey(other), poolNodeTitle(other), other.you === true]),
          action ? [action.label, action.title ?? '', action.busy === true] : null])
        const kept = drawn.get(`${key}\n${row.sig}`)
        // A kept card keeps its press too: the press calls the caller back by what it was drawn with.
        const line = kept?.stamp === stamp ? kept.line : cardOf(row, group.node, others, src, action)
        next.set(`${key}\n${row.sig}`, { stamp, line })
        grid.append(line)
      }

      const section = recipeEl('section', 'hc-recipe-catalogue-group')
      section.dataset['node'] = key
      // The press sits beside the heading, never inside it: a heading holds no control.
      const head = recipeEl('div', 'hc-recipe-catalogue-from-row')
      head.append(from)
      if (press) head.append(press)
      section.append(head, grid)
      sections.push(section)
    })
    drawn = next

    // The nodes held back, each with its press, under everything that is shown.
    const shownKeys = new Set(groups.map(group => poolNodeKey(group.node)))
    heldBack.filter(held => held.action || !shownKeys.has(poolNodeKey(held.node))).forEach((held, at) => {
      const from = recipeEl('h2', 'hc-recipe-catalogue-from')
      const name = recipeEl('span', 'hc-recipe-catalogue-from-name', nodeWords(held.node))
      name.id = `${serial}-held-${at}`
      from.setAttribute('aria-labelledby', name.id)
      from.append(chipOf(held.node), name)
      const head = recipeEl('div', 'hc-recipe-catalogue-from-row')
      head.append(from)
      const press = held.action ? pressOf(held.action, 'hc-recipe-catalogue-node-action', poolNodeKey(held.node)) : actionOf(held.node)
      if (press) head.append(press)
      const section = recipeEl('section', 'hc-recipe-catalogue-group')
      section.dataset['node'] = poolNodeKey(held.node)
      section.dataset['held'] = held.id ?? ''
      section.append(head, recipeEl('p', 'hc-recipe-catalogue-quiet', held.note))
      sections.push(section)
    })

    const asked = query.trim()
    asking.hidden = !loading
    // While the nodes are still being asked, "nothing" would be said too soon.
    nothing.hidden = groups.length > 0 || loading
    if (!groups.length) {
      nothing.textContent = asked && recipeCatalogueGroups(rows, nodes).length
        ? say('recipe.catalogue.none', 'Nothing matches "{query}".', { query: asked })
        : nodes && rows.length
          ? say('recipe.catalogue.off', 'The nodes you switched on offer nothing here.')
          : say('recipe.catalogue.empty', 'Nothing is published here yet.')
    }
    column.replaceChildren(...sections, nothing, asking)

    // The lists were rebuilt: focus goes back to the card it was on, or to the same row under another node.
    if (!active) return
    const again = active.isConnected ? active : cardAt(active.dataset['sig'], active.dataset['node']) ?? cardAt(active.dataset['sig'])
    ;(again ?? search ?? root).focus({ preventScroll: true })
  }

  // ── keys ────────────────────────────────────────────────────────────────

  /** The card an arrow leads to. Left and right walk in order; up and down go to the nearest card in the row above or below. */
  const neighbour = (from: HTMLButtonElement, key: string): HTMLButtonElement | undefined => {
    const all = cards()
    const at = all.indexOf(from)
    if (key === 'ArrowRight') return all[at + 1]
    if (key === 'ArrowLeft') return at > 0 ? all[at - 1] : undefined
    const down = key === 'ArrowDown'
    const ahead = down ? all.slice(at + 1) : all.slice(0, at).reverse()
    const box = from.getBoundingClientRect()
    // Nothing is laid out (the page is not on screen): walk in order.
    if (!box.width && !box.height) return ahead[0]
    const beyond = ahead.filter(card => {
      const top = card.getBoundingClientRect().top
      return down ? top > box.top + 1 : top < box.top - 1
    })
    const first = beyond[0]
    if (!first) return undefined
    const rowTop = first.getBoundingClientRect().top
    const off = (card: HTMLButtonElement): number => Math.abs(card.getBoundingClientRect().left - box.left)
    return beyond
      .filter(card => Math.abs(card.getBoundingClientRect().top - rowTop) < 1)
      .reduce((best, card) => (off(card) < off(best) ? card : best), first)
  }

  const take = (event: KeyboardEvent): void => {
    event.preventDefault()
    event.stopPropagation()
  }

  /** Escape clears the search, then closes. Enter opens a card. Arrows move between cards and to and from the search. */
  const onKey = (event: KeyboardEvent): void => {
    if (disposed || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'Escape') {
      if (search && query) {
        // Stopped here: the first press only empties the field.
        take(event)
        query = ''
        search.value = ''
        paint()
        search.focus()
        options.onQuery?.('')
      } else if (options.onClose) {
        take(event)
        options.onClose()
      }
      return
    }
    const from = event.target instanceof Element ? event.target : null
    const card = from?.closest<HTMLButtonElement>('.hc-recipe-catalogue-card') ?? undefined
    if (event.key === 'Enter') {
      if (!card) return
      // Taken here so the press is one press: the browser's own click on Enter does not follow.
      take(event)
      card.click()
      return
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
    if (search && from === search) {
      const first = event.key === 'ArrowDown' ? cards()[0] : undefined
      if (!first) return
      take(event)
      first.focus()
      return
    }
    if (!card) return
    const to = neighbour(card, event.key) ?? (event.key === 'ArrowUp' ? search : undefined)
    if (!to) return
    take(event)
    to.focus()
  }

  root.addEventListener('keydown', onKey)
  if (search) {
    search.addEventListener('input', () => {
      query = search.value
      paint()
      options.onQuery?.(query)
    })
  }

  paint()

  return {
    element: root,
    update(next) {
      if (next.title !== undefined) heading.textContent = next.title
      if ('note' in next) {
        note.textContent = next.note ?? ''
        note.hidden = !next.note
      }
      if (next.rows !== undefined) rows = next.rows
      if ('nodes' in next) nodes = next.nodes
      if (next.heldBack !== undefined) heldBack = next.heldBack
      if (next.loading !== undefined) loading = next.loading
      if (next.query !== undefined && next.query !== query) {
        query = next.query
        if (search && search.value !== query) search.value = query
      }
      paint()
    },
    focus() {
      const back = opened ? cardAt(opened.sig, opened.node) : undefined
      opened = undefined
      ;(back ?? search ?? cards()[0] ?? root).focus()
    },
    dispose() {
      disposed = true
      root.remove()
    },
  }
}
