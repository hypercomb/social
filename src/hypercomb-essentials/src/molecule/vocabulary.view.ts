// molecule/vocabulary.view.ts
//
// THE VOCABULARY WINDOW — what this hive can say, and the two acts that make
// it public.
//
// ── READING IS FREE, LOCAL, AND WRITES NOTHING ──────────────────────────
//
// Opening this window resolves the molecule reader out of IoC and asks it
// three questions, reads this device's own publish ledger, and stops. It does
// not resolve a signing key (`readerPubkey()` MINTS AND PERSISTS a secp256k1
// secret on a miss — a participant who opened a window and closed it must not
// walk away holding an identity they never asked for), it does not read a
// host, and it does not mint a claim.
//
// ── WHY THERE IS NO PREVIEW OF THE CLAIM ────────────────────────────────
//
// `HostSyncService` auto-enqueues every `content:wrote` signature, so MINTING
// IS UPLOADING. Building a preview "just to show its size in the dialog" —
// by storing the body, or by calling the door with `confirmed: false` to read
// the summary back — is a leak, and the routine's own ordering spec exists to
// catch it. So this panel's count comes from `declaredVocabulary()`, a local
// read of the derived index, and the panel SAYS that the claim will carry a
// different (usually smaller) number rather than reconciling the two.
//
// ── THE WRITE HALF IS NOT IN THE MODULE GRAPH UNTIL THE PRESS ───────────
//
// The live deps are reached through `await import(...)` inside the click
// handler. That keeps `presentation/tiles/tile-actions.drone.ts` — which
// registers a drone at module load — out of the boot graph and out of every
// spec's graph, and it means a participant who never presses the button never
// evaluates a line of the publish stack.
//
// ── AN ELEMENT, NOT A COMPONENT ─────────────────────────────────────────
//
// Module chrome is a framework-free custom element added to the
// ShellSurfaceRegistry over IoC — never a tag in either app.html, never an
// Angular class in the shared barrel. The tool-window recipe is restated in
// plain CSS with the shared values.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { cachedPubkey } from '../sharing/head-claim-signer.js'
import { MOLECULE_INDEX_SERVICE_KEY, type MoleculeIndexReader } from './molecule-index.service.js'
import {
  listVocabularyRecords,
  type VocabularyPublishRecord,
} from './vocabulary-ledger.js'
import type {
  VocabularyPublishDeps,
  VocabularyPublishResult,
} from './vocabulary-publish.deps.js'
import {
  NAME_UNKNOWN_LOCALLY,
  NO_READER,
  OPEN_STAMP_MS,
  PANEL_INTENT_PUBLISH,
  PANEL_INTENT_WITHDRAW,
  PANEL_NEVER_PUBLISHED,
  PANEL_NO_IDENTITY,
  PANEL_PARTIAL,
  PANEL_PRIVATE,
  PANEL_SCOPE,
  PANEL_WARNING,
  PANEL_WHOLE,
  VOCABULARY_OPEN,
  namelessFooter,
} from './vocabulary-words.js'

const SURFACE = 'hc-vocabulary'
const STYLE_ID = 'hc-vocabulary-style'
const OWNER = '@diamondcoreprocessor.com/VocabularyView'

const STEEL = '126, 182, 214'
const ACCENT = '201, 162, 39'

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  try {
    const text = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    return text && text !== key ? text : interpolate(fallback, params)
  } catch { return interpolate(fallback, params) }
}

const interpolate = (text: string, params?: Record<string, string | number>): string =>
  params ? text.replace(/\{(\w+)\}/g, (whole, name) => String(params[name] ?? whole)) : text

// ---------------------------------------------------------------------------
// THE READING — pure, injectable, and provably write-free
// ---------------------------------------------------------------------------

export interface VocabularyPanelIo {
  /** The registered READ half. `undefined` when the molecule index is not
   *  running — which is a state with its own words, never an empty list. */
  readonly reader: () => MoleculeIndexReader | undefined
  /** This device's own publish ledger. Read-only; the pool is opened without
   *  `create`, so reading cannot bring it into existence. */
  readonly records: () => Promise<{ claim: string; record: VocabularyPublishRecord }[]>
  /** The CACHED key. Never `readerPubkey()` — resolving mints one. */
  readonly pubkey: () => string | null
}

export interface VocabularyPanelModel {
  /** Did a reader answer at all? */
  readonly reading: boolean
  /** Molecule ADDRESSES, sorted. `declaredVocabulary()` returns addresses and
   *  not words, and `vocabulary()` is EMPTY ON A MISS — a panel that listed
   *  `vocabulary()` alone would show a full hive as holding nothing. */
  readonly addresses: readonly string[]
  /** address → display spelling, from `vocabulary()` UNIONED with
   *  `fallbackVocabulary()`. Missing is normal and is rendered, not hidden. */
  readonly spellings: ReadonlyMap<string, string>
  /** How many addresses have no local spelling. */
  readonly nameless: number
  /** `declaredVocabularyPartial()`. Defaults to TRUE and a throw must not be
   *  inverted into "complete". */
  readonly partial: boolean
  readonly last: VocabularyPublishRecord | null
  readonly pubkey: string | null
}

/**
 * READ THE PANEL. Every call below is a local read, and there is deliberately
 * no branch here that writes, signs, hashes or fetches.
 */
export const readVocabularyPanel = async (io: VocabularyPanelIo): Promise<VocabularyPanelModel> => {
  const reader = io.reader()
  const records = await io.records().catch(() => [])
  const last = records[0]?.record ?? null
  const pubkey = (() => { try { return io.pubkey() } catch { return null } })()

  if (!reader) {
    return { reading: false, addresses: [], spellings: new Map(), nameless: 0, partial: true, last, pubkey }
  }

  // A THROWN vocabulary read is not an empty vocabulary. Swallowing it into
  // `new Set()` drew "declares 0 word addresses" beside "This picture is
  // whole" whenever the SEPARATE partiality call succeeded — two awaits, one
  // transient failure, and the panel called a crash a complete zero.
  let declared: ReadonlySet<string>
  let readFailed = false
  try { declared = await reader.declaredVocabulary() } catch { declared = new Set(); readFailed = true }
  const addresses = [...declared].sort()
  // PESSIMISTIC ON FAILURE. "I could not finish looking" is not "complete",
  // and neither is "the list itself would not read".
  const partial = readFailed || await reader.declaredVocabularyPartial().catch(() => true)

  // THE COLD WALK IS NOT FREE. `fallbackVocabulary` walks every manifest under
  // the root (up to COLD_WALK_NODES), and a whole index buys the reader
  // nothing if the walk runs anyway. So: the accelerator always, the walk
  // only when the picture is admitted partial and a name may be missing.
  const spellings = new Map<string, string>()
  const sources = partial ? [reader.vocabulary, reader.fallbackVocabulary] : [reader.vocabulary]
  for (const source of sources) {
    const map = await source().catch(() => new Map())
    for (const [address, word] of map) {
      const name = typeof word?.n === 'string' ? word.n : ''
      if (name && !spellings.has(address)) spellings.set(address, name)
    }
  }
  const nameless = addresses.reduce((n, a) => n + (spellings.has(a) ? 0 : 1), 0)

  return { reading: true, addresses, spellings, nameless, partial, last, pubkey }
}

// ---------------------------------------------------------------------------
// THE RESULT WORDS — one line per outcome, and never two outcomes merged
// ---------------------------------------------------------------------------

/**
 * `declined` is the human guard and `not-confirmed` is the API guard. They are
 * distinct facts: one is a participant saying no, the other is a bug in this
 * file. Rendering them the same way would hide the bug behind a decision.
 */
export const resultWords = (
  result: VocabularyPublishResult,
  withdrawal: boolean,
): { text: string; tone: 'ok' | 'quiet' | 'bad' } => {
  if (result.ok) {
    return withdrawal
      ? {
          text: `Withdrawn. seq ${result.seq} declares nothing. Readers now get a signed “no” instead of ` +
                `“unknown”. Nothing already published was deleted.`,
          tone: 'ok',
        }
      : {
          text: `Published. seq ${result.seq} · ${result.count} word address${result.count === 1 ? '' : 'es'} · ` +
                `${result.complete ? 'complete' : 'INCOMPLETE, and the claim says so'} · served from ${result.host}`,
          tone: 'ok',
        }
  }
  switch (result.failure) {
    case 'declined':
      return { text: 'Nothing was published. You said no.', tone: 'quiet' }
    case 'not-confirmed':
      return {
        text: 'Refused: the act reached the door without a confirmation. This is a bug — nothing was published.',
        tone: 'bad',
      }
    case 'nothing-published':
      return {
        text: 'Nothing to publish. No branch is marked public, or your public branches have never been ' +
              'served, so there are no words to declare.',
        tone: 'quiet',
      }
    case 'no-signer':
      return { text: 'No signing key could be resolved. Nothing was published.', tone: 'bad' }
    case 'no-host':
      return { text: 'No door to publish on. Give a public branch a host first.', tone: 'bad' }
    case 'sign-failed':
      return { text: 'The claim would not sign. Nothing was published.', tone: 'bad' }
    case 'mint-failed':
      return { text: 'The claim would not mint. Nothing was published.', tone: 'bad' }
    case 'not-available':
      return {
        text: 'The claim was minted, but your host has not served it yet — so your index was NOT advanced. ' +
              'Nothing you publish will ever point at bytes nobody can fetch. Try again in a moment.',
        tone: 'bad',
      }
    case 'index-unsafe':
      return { text: 'Your host refused to advance your index. Nothing changed.', tone: 'bad' }
    default:
      return { text: 'Nothing was published.', tone: 'bad' }
  }
}

/** The write half, as this window is allowed to see it. */
export interface VocabularyAct {
  publishVocabulary(
    options: { readonly confirmed?: boolean }, deps: VocabularyPublishDeps,
  ): Promise<VocabularyPublishResult>
  withdrawVocabulary(
    options: { readonly confirmed?: boolean }, deps: VocabularyPublishDeps,
  ): Promise<VocabularyPublishResult>
  defaultVocabularyPublishDeps(): VocabularyPublishDeps
}

// ---------------------------------------------------------------------------
// THE ELEMENT
// ---------------------------------------------------------------------------

export class VocabularyElement extends HTMLElement {

  #panel: HTMLElement | null = null
  #model: VocabularyPanelModel | null = null
  #intent = ''
  #said: { text: string; tone: 'ok' | 'quiet' | 'bad' } | null = null
  #busy = false
  #cleanup: (() => void)[] = []

  /** THE READ SEAM. Replaced wholesale in the spec, so no pool, no IoC and no
   *  key is touched there. */
  io: VocabularyPanelIo = {
    reader: () => ioc<MoleculeIndexReader>(MOLECULE_INDEX_SERVICE_KEY),
    records: () => listVocabularyRecords(),
    // `cachedPubkey()`, NEVER `readerPubkey()`: the latter falls through to
    // `resolveSecretKeyHex()`, which mints and persists a secret on a miss.
    // Null here means "no identity yet", which is the honest reading — never
    // a reason to make one.
    pubkey: () => cachedPubkey(),
  }

  /** THE WRITE SEAM. A dynamic import, so nothing under it is evaluated —
   *  or even resolved — until the participant presses a button. */
  loadAct: () => Promise<VocabularyAct> = () => import('./vocabulary-publish.deps.js')

  connectedCallback(): void {
    ensureStyles()
    this.#cleanup.push(EffectBus.on<{ intent?: string; at?: number }>(VOCABULARY_OPEN, payload => {
      if (Math.abs(Date.now() - (payload?.at ?? 0)) > OPEN_STAMP_MS) return
      this.#intent = String(payload?.intent ?? '')
      this.open()
    }))
  }

  disconnectedCallback(): void {
    for (const off of this.#cleanup) off()
    this.#cleanup = []
    this.close()
  }

  open(): void {
    if (!this.#panel) {
      const panel = document.createElement('aside')
      panel.className = 'hc-vocab'
      panel.setAttribute('role', 'dialog')
      panel.setAttribute('aria-label', t('vocabulary.title', 'Your vocabulary'))
      panel.tabIndex = -1
      panel.setAttribute('data-consumes-wheel', '')
      panel.addEventListener('keydown', this.#onKey)
      this.appendChild(panel)
      this.#panel = panel
    }
    this.#render()
    void this.refresh()
  }

  close(): void {
    if (!this.#panel) return
    this.#panel.removeEventListener('keydown', this.#onKey)
    this.#panel.remove()
    this.#panel = null
  }

  get open$(): boolean { return !!this.#panel }

  /** Read, then draw. Exposed so a spec can await the reading. */
  async refresh(): Promise<void> {
    const model = await readVocabularyPanel(this.io).catch(() => null)
    this.#model = model
    this.#render()
  }

  readonly #onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    this.close()
  }

  // ── the drawing ─────────────────────────────────────────────────────────

  #head(): HTMLElement {
    const head = document.createElement('header')
    head.className = 'hc-vocab-head'
    const title = document.createElement('span')
    title.className = 'hc-vocab-title'
    title.textContent = t('vocabulary.title', 'Your vocabulary')
    head.appendChild(title)
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'hc-vocab-close'
    close.textContent = '×'
    close.setAttribute('aria-label', t('panel.close', 'Close'))
    close.addEventListener('click', () => this.close())
    head.appendChild(close)
    return head
  }

  #render(): void {
    const panel = this.#panel
    if (!panel) return
    panel.replaceChildren()
    panel.appendChild(this.#head())

    const body = document.createElement('div')
    body.className = 'hc-vocab-body'
    panel.appendChild(body)

    const model = this.#model
    if (!model) {
      body.appendChild(note('hc-vocab-quiet', t('vocabulary.reading', 'Reading this hive’s words…')))
      return
    }

    // ── 1. THE COUNT, AND WHAT IT IS NOT ────────────────────────────────
    if (!model.reading) {
      body.appendChild(note('hc-vocab-unknown', NO_READER))
    } else {
      body.appendChild(note('hc-vocab-count', t('vocabulary.count',
        'This hive declares {n} word address{plural}.',
        { n: model.addresses.length, plural: model.addresses.length === 1 ? '' : 'es' })))
    }
    body.appendChild(note('hc-vocab-quiet', PANEL_PRIVATE))

    // ── 2. PARTIALITY, ABOVE THE LIST AND NEVER A FOOTNOTE ──────────────
    body.appendChild(note(
      model.partial ? 'hc-vocab-partial' : 'hc-vocab-whole',
      model.partial ? `⚠ ${PANEL_PARTIAL}` : PANEL_WHOLE,
    ))

    // ── 3. THE SCOPE GAP, SAID OUT LOUD ─────────────────────────────────
    body.appendChild(note('hc-vocab-quiet', PANEL_SCOPE))

    // ── THE WORDS ───────────────────────────────────────────────────────
    if (model.addresses.length) {
      const list = document.createElement('ul')
      list.className = 'hc-vocab-words'
      for (const address of model.addresses.slice(0, 400)) {
        const row = document.createElement('li')
        const name = model.spellings.get(address)
        row.className = name ? 'hc-vocab-word' : 'hc-vocab-word is-nameless'
        row.textContent = name || NAME_UNKNOWN_LOCALLY
        row.title = address
        list.appendChild(row)
      }
      body.appendChild(list)
      if (model.addresses.length > 400) {
        body.appendChild(note('hc-vocab-quiet', t('vocabulary.more',
          '{n} more, not listed here.', { n: model.addresses.length - 400 })))
      }
      if (model.nameless > 0) body.appendChild(note('hc-vocab-quiet', namelessFooter(model.nameless)))
    }

    // ── 4. WHAT HAS ALREADY BEEN SAID ───────────────────────────────────
    body.appendChild(this.#ledgerLine(model))

    // ── THE GESTURE ─────────────────────────────────────────────────────
    const acts = document.createElement('div')
    acts.className = 'hc-vocab-acts'
    acts.appendChild(this.#button(
      t('vocabulary.publish', 'Publish these words…'), 'publish', this.#intent === 'publish',
    ))
    acts.appendChild(this.#button(
      t('vocabulary.withdraw', 'Withdraw…'), 'withdraw', this.#intent === 'withdraw',
    ))
    body.appendChild(acts)
    body.appendChild(note('hc-vocab-warn', PANEL_WARNING))
    if (this.#intent === 'publish') body.appendChild(note('hc-vocab-aim', PANEL_INTENT_PUBLISH))
    if (this.#intent === 'withdraw') body.appendChild(note('hc-vocab-aim', PANEL_INTENT_WITHDRAW))

    if (this.#said) body.appendChild(note(`hc-vocab-said is-${this.#said.tone}`, this.#said.text))
  }

  #ledgerLine(model: VocabularyPanelModel): HTMLElement {
    if (!model.last) {
      const wrap = document.createElement('div')
      wrap.appendChild(note('hc-vocab-never', PANEL_NEVER_PUBLISHED))
      if (!model.pubkey) wrap.appendChild(note('hc-vocab-quiet', PANEL_NO_IDENTITY))
      return wrap
    }
    const r = model.last
    return note('hc-vocab-last', t('vocabulary.last',
      'LAST PUBLISHED — seq {seq} · {count} words · {complete} · {host}',
      {
        seq: r.seq, count: r.count,
        complete: r.complete ? 'complete' : 'incomplete, and the claim says so',
        host: r.host || '(no host recorded)',
      }))
  }

  #button(label: string, verb: 'publish' | 'withdraw', aimed: boolean): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = aimed ? 'hc-vocab-do is-aimed' : 'hc-vocab-do'
    button.dataset['verb'] = verb
    button.textContent = label
    button.disabled = this.#busy
    button.addEventListener('click', () => { void this.act(verb) })
    if (aimed) queueMicrotask(() => button.focus())
    return button
  }

  /**
   * THE ACT. `confirmed: true` is built HERE, at the press, and exists nowhere
   * above this line — not on the queen, not on the effect payload.
   *
   * No second dialog is written: `defaultVocabularyPublishDeps()` already
   * carries the confirmation, and its copy is load-bearing.
   */
  async act(verb: 'publish' | 'withdraw'): Promise<VocabularyPublishResult | null> {
    if (this.#busy) return null
    this.#busy = true
    this.#said = null
    this.#render()
    try {
      const act = await this.loadAct()
      const deps = act.defaultVocabularyPublishDeps()
      const result = verb === 'withdraw'
        ? await act.withdrawVocabulary({ confirmed: true }, deps)
        : await act.publishVocabulary({ confirmed: true }, deps)
      this.#said = resultWords(result, verb === 'withdraw')
      if (!result.ok && result.failure === 'not-confirmed') {
        console.warn('[vocabulary] the door was reached without a confirmation — nothing was published')
      }
      return result
    } catch (err) {
      this.#said = { text: `Nothing was published. ${String(err)}`, tone: 'bad' }
      return null
    } finally {
      this.#busy = false
      await this.refresh()
    }
  }
}

const note = (className: string, text: string): HTMLElement => {
  const p = document.createElement('p')
  p.className = className
  p.textContent = text
  return p
}

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    /* The same material as every other tool window. A module cannot @use the
       shared stylesheet, so the recipe is restated with the SHARED values. */
    ${SURFACE} { display: contents; }
    .hc-vocab {
      position: fixed;
      top: max(calc(2.3rem * var(--hc-header-zoom, 1.0)), var(--hc-header-anchor, 0px));
      right: var(--hc-controls-right, 0px); bottom: 0;
      width: 360px; min-width: 260px; max-width: calc(100vw - 1.5rem);
      box-sizing: border-box; display: flex; flex-direction: column;
      z-index: 100002;
      background: rgba(13, 15, 21, 0.975);
      backdrop-filter: blur(14px) saturate(1.04);
      -webkit-backdrop-filter: blur(14px) saturate(1.04);
      border: 0; border-left: 1px solid rgba(${STEEL}, 0.38); border-radius: 0;
      box-shadow: -14px 0 44px rgba(0, 0, 0, 0.46);
      color: #eef2f5;
      font-family: var(--hc-mono, system-ui);
      font-size: calc(0.8125rem * var(--hc-panel-scale, 1));
      line-height: 1.45; overflow: hidden; outline: none;
    }
    .hc-vocab-head {
      flex: 0 0 auto; box-sizing: border-box; display: flex; align-items: center;
      gap: 0.5rem; height: 2.875rem; min-height: 2.875rem; padding: 0 0.75rem;
      background: linear-gradient(180deg, rgba(255,255,255,0.018), rgba(255,255,255,0.006));
      border-bottom: 1px solid rgba(${STEEL}, 0.25);
    }
    .hc-vocab-title {
      flex: 1; font-weight: 600; font-size: 0.9em; letter-spacing: 0.06em;
      text-transform: uppercase; color: rgba(${ACCENT}, 0.95);
    }
    .hc-vocab-close {
      margin-left: auto; display: inline-grid; place-items: center;
      width: 1.75rem; height: 1.75rem; padding: 0;
      background: none; border: 0; border-radius: var(--hc-radius-control, 2px);
      color: rgba(238, 244, 248, 0.62); font: inherit; font-size: 1.125rem;
      line-height: 1; cursor: pointer;
    }
    .hc-vocab-close:hover { color: #fff; background-color: rgba(255,255,255,0.075); }

    .hc-vocab-body {
      flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden;
      padding: 0.7rem 0.75rem 1.2rem;
    }
    .hc-vocab-body > p { margin: 0 0 0.5rem; line-height: 1.55; }
    .hc-vocab-count { font-size: 1.02em; color: rgba(${ACCENT}, 0.95); }
    .hc-vocab-quiet { color: rgba(238, 244, 248, 0.5); font-size: 0.85em; }
    /* PARTIALITY IS FULL WEIGHT. A surface that hides it is not honest. */
    .hc-vocab-partial {
      padding: 0.45rem 0.55rem; font-size: 0.88em;
      border: 1px solid rgba(${ACCENT}, 0.55); border-radius: 2px;
      background: rgba(${ACCENT}, 0.08); color: rgba(238, 244, 248, 0.92);
    }
    .hc-vocab-whole { font-size: 0.85em; color: rgba(${STEEL}, 0.85); }
    /* "The index is not running" is its own state, never an empty list. */
    .hc-vocab-unknown {
      padding: 0.45rem 0.55rem; font-size: 0.9em;
      border: 1px dashed rgba(${STEEL}, 0.6); border-radius: 2px;
      color: rgba(238, 244, 248, 0.92);
    }
    .hc-vocab-words {
      margin: 0.3rem 0 0.6rem; padding: 0.35rem 0.5rem; list-style: none;
      max-height: 40vh; overflow-y: auto;
      border: 1px solid rgba(${STEEL}, 0.2); border-radius: 2px;
      background: rgba(255, 255, 255, 0.02); font-size: 0.88em;
    }
    .hc-vocab-word { padding: 0.05rem 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hc-vocab-word.is-nameless { color: rgba(238, 244, 248, 0.45); font-style: italic; }
    .hc-vocab-last { font-size: 0.88em; color: rgba(${STEEL}, 0.95); }
    .hc-vocab-never { font-size: 0.88em; color: rgba(238, 244, 248, 0.8); }

    .hc-vocab-acts { display: flex; gap: 0.35rem; margin: 0.8rem 0 0.5rem; }
    .hc-vocab-do {
      flex: 1 1 0; padding: 0.4rem 0.5rem;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(${STEEL}, 0.3); border-radius: var(--hc-radius-control, 2px);
      color: inherit; font: inherit; font-size: 0.85em; letter-spacing: 0.05em;
      cursor: pointer;
    }
    .hc-vocab-do:hover:not(:disabled) { border-color: rgba(${ACCENT}, 0.8); }
    .hc-vocab-do:disabled { opacity: 0.45; cursor: default; }
    .hc-vocab-do.is-aimed { border-color: rgba(${ACCENT}, 0.95); }
    .hc-vocab-warn { font-size: 0.82em; color: rgba(238, 244, 248, 0.62); }
    .hc-vocab-aim { font-size: 0.85em; color: rgba(${ACCENT}, 0.92); }
    .hc-vocab-said {
      margin-top: 0.6rem; padding: 0.45rem 0.55rem; font-size: 0.88em;
      border: 1px solid rgba(${STEEL}, 0.3); border-radius: 2px;
    }
    .hc-vocab-said.is-ok { border-color: rgba(${ACCENT}, 0.7); }
    .hc-vocab-said.is-quiet { color: rgba(238, 244, 248, 0.62); }
    .hc-vocab-said.is-bad { border-color: rgba(214, 126, 126, 0.75); }
  `
  document.head.appendChild(style)
}

// Contribute the surface the doctrine way: define the element, then add it to
// the registry — never a tag in either app.html.
;(window as { ioc?: { whenReady?: (k: string, cb: (v: { add(s: unknown): void }) => void) => void } })
  .ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', registry => {
    if (!customElements.get(SURFACE)) customElements.define(SURFACE, VocabularyElement)
    try {
      registry.add({ name: SURFACE, owner: OWNER, element: SURFACE, order: 140 })
    } catch {
      // duplicate add (hot reload) — the mounted surface is already live
    }
  })
