// molecule/vocabulary-find.view.ts
//
// THE LOOKUP WINDOW — four outcomes, and the surface never merges two.
//
//   HELD HERE   this hive holds the word (local, certain)
//   DECLARED    a publisher's signed claim names it
//   NOT HELD    a COMPLETE signed claim omits it — an absence with evidence
//   CANNOT SAY  everything else, and it is a first-class row
//
// ── THE DISPLAY IS THE POINT ────────────────────────────────────────────
//
// `host-packages.ts` says in writing that "publishes nothing, cannot be
// reached, and is not a host at all — the three are deliberately one outcome
// here." That is the defect. So:
//
//   * CANNOT SAY rows are NEVER faded, NEVER collapsed, and NEVER behind a
//     disclosure. They carry the same weight as a declared row. NOT HELD is
//     full weight too — a signed absence is a real answer.
//   * Marking never rests on colour: a filled disc, a hollow ring, a question
//     mark, PLUS an uppercase word.
//   * The counter line always renders THREE labelled numbers, even at zero.
//     One number can be misread; three that sum to the row count cannot.
//   * Every publisher row shows ITS OWN DOORS underneath it. An aggregate
//     hides exactly the distinction that matters.
//   * Every row is drawn BEFORE any I/O, in an ASKING state, so the shape of
//     the question is visible immediately and a hung host visibly sits in
//     ASKING until its deadline flips it. Never a spinner over a blank panel.
//
// ── IT NEVER BLOCKS THE SHELL ───────────────────────────────────────────
//
// `VOCABULARY_DEADLINES` caps an index read at 2.5s, an atom at 4s, a
// publisher's leg at 8s and the whole search at 10s. A slow host degrades to
// `unreachable`, which is a CANNOT SAY row — never a no. A generation token
// discards a stale search's result. We do NOT claim a request was cancelled:
// `fetchHiveIndex(host, pubkey)` takes two arguments and ignores the abort
// signal, so the row times out while the fetch runs on.
//
// ── ONE LOCAL WRITE, DISCLOSED ──────────────────────────────────────────
//
// `rememberProvenSeq` puts `{at, seq}` per publisher into
// `sign('vocabulary:seen')`. It carries NO stranger's signature by design and
// it is load-bearing for honest absence: without a proven high-water, a host
// replaying an older COMPLETE claim can manufacture a NOT HELD. Nothing else
// on this path writes, and `readerPubkey()` is never touched — verification is
// always against the CLAIMANT's key, and resolving a reader key would give a
// read-only visitor an identity they never asked for.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { MOLECULE_INDEX_SERVICE_KEY, type MoleculeIndexReader } from './molecule-index.service.js'
import { buildHorizon, type HorizonSources } from './vocabulary-horizon.js'
import { loadProvenSeqs, rememberProvenSeq } from './vocabulary-ledger.js'
import {
  searchVocabulary,
  unknownCount,
  vocabularySurface,
  type VocabularyFinding,
  type VocabularyHorizon,
  type VocabularySearch,
  type VocabularySearchDeps,
} from './vocabulary-search.js'
import {
  EMPTY_HORIZON,
  HORIZON_FAILED,
  LOCAL_CANNOT_SAY,
  LOCAL_HELD,
  LOCAL_NOT_HELD,
  NO_ADDRESS,
  NO_READER,
  OPEN_STAMP_MS,
  VERDICT_LABEL,
  VERDICT_MARK,
  VOCABULARY_FIND,
  allUnknownWords,
  counterWords,
  doorWords,
  unknownFooter,
} from './vocabulary-words.js'

const SURFACE = 'hc-vocabulary-find'
const STYLE_ID = 'hc-vocabulary-find-style'
const OWNER = '@diamondcoreprocessor.com/VocabularyFindView'

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
// THE LOCAL ANSWER — the fourth outcome, and the only certain one
// ---------------------------------------------------------------------------

export type LocalVerdict = 'held' | 'not-held' | 'cannot-say' | 'no-reader'

/**
 * A local miss under an INCOMPLETE picture is an unknown, not an absence.
 * Collapsing those two is the same defect one scope smaller.
 */
export const localVerdict = async (
  reader: MoleculeIndexReader | undefined,
  word: string,
): Promise<LocalVerdict> => {
  if (!reader) return 'no-reader'
  // A THROWN read is not a "no". `catch(() => false)` here was an inversion:
  // the reader raised, and the raise was rendered "NOT HELD HERE" whenever
  // the SEPARATE partiality call happened to succeed. Those are two awaits
  // and only one has to fail for the lie to draw.
  let held: boolean
  try { held = await reader.holds(word) } catch { return 'cannot-say' }
  if (held) return 'held'
  const partial = await reader.declaredVocabularyPartial().catch(() => true)
  return partial ? 'cannot-say' : 'not-held'
}

export const localWords = (verdict: LocalVerdict): { mark: string; text: string } => {
  switch (verdict) {
    case 'held': return { mark: '●', text: LOCAL_HELD }
    case 'not-held': return { mark: '○', text: LOCAL_NOT_HELD }
    case 'no-reader': return { mark: '?', text: NO_READER }
    default: return { mark: '?', text: LOCAL_CANNOT_SAY }
  }
}

/** How many rows landed on each verdict. All three are always rendered. */
export const tallyOf = (
  findings: readonly VocabularyFinding[],
): { declared: number; absent: number; unknown: number } => ({
  declared: findings.filter(f => f.verdict === 'declared').length,
  absent: findings.filter(f => f.verdict === 'absent').length,
  unknown: findings.filter(f => f.verdict === 'unknown').length,
})

/** What one publisher row SAYS, beneath its label. `unknown` always names the
 *  reason; `absent` always says what the evidence was. */
export const findingWords = (finding: VocabularyFinding): string => {
  if (finding.verdict === 'unknown') return doorWords(finding.why)
  if (finding.verdict === 'absent') {
    return `this publisher signed a complete list at seq ${finding.seq} and the word is not in it`
  }
  return `declared at seq ${finding.seq}${finding.complete ? ', complete' : ', and the list admits it is incomplete'}`
}

// ---------------------------------------------------------------------------
// THE ELEMENT
// ---------------------------------------------------------------------------

interface FindState {
  word: string
  address: string | null
  local: LocalVerdict | null
  horizon: VocabularyHorizon | null
  /** `gatherHorizon` THREW. An empty horizon is "you follow nobody", a claim
   *  about the participant; a thrown gather is "could not work out who to
   *  ask", a claim about this device. Never the same row. */
  horizonFailed: boolean
  search: VocabularySearch | null
  /** Did any door actually open? The counter line is drawn ONLY when this is
   *  true — a lookup that returned before I/O must not report doors it never
   *  opened. */
  asked: boolean
  asking: boolean
}

export class VocabularyFindElement extends HTMLElement {

  #panel: HTMLElement | null = null
  #generation = 0
  #state: FindState = { word: '', address: null, local: null, horizon: null, horizonFailed: false, search: null, asked: false, asking: false }
  #cleanup: (() => void)[] = []

  /** SEAMS. Every one of them replaced in the spec, so no test opens a socket
   *  or a pool, and no test contacts a real host. */
  reader: () => MoleculeIndexReader | undefined =
    () => ioc<MoleculeIndexReader>(MOLECULE_INDEX_SERVICE_KEY)

  /** The routing table, from what this reader already holds. Gathered by
   *  DYNAMIC import so a window nobody opened costs nothing at boot. */
  gatherHorizon: () => Promise<VocabularyHorizon> = async () => {
    const link = await import('../sharing/hive-link.js').catch(() => null)
    const [visits, zones] = await Promise.all([
      import('../sharing/visit-genome.js')
        .then(m => m.visitRecords().map(v => ({ pubkey: v.pubkey, domain: v.domain })))
        .catch(() => [] as HorizonSources['visits'] & object),
      import('../sharing/community-hosts.js').then(m => m.listCommunityHosts()).catch(() => [] as string[]),
    ])
    let follows: Record<string, { pubkey?: string; hosts?: string[] }> = {}
    try {
      if (link) follows = JSON.parse(globalThis.localStorage?.getItem(link.STATIC_FOLLOWS_KEY) ?? '{}')
    } catch { follows = {} }
    return buildHorizon({
      visits,
      follows,
      communityZones: zones,
      fallbackHosts: link?.PUBLIC_CONTENT_HOSTS ?? [],
    })
  }

  search: (
    address: string, horizon: VocabularyHorizon, deps: VocabularySearchDeps,
  ) => Promise<VocabularySearch> = searchVocabulary

  searchDeps: () => Promise<VocabularySearchDeps> = async () => {
    const seen = await loadProvenSeqs().catch(() => new Map<string, number>())
    return {
      surface: await vocabularySurface(),
      provenSeq: (pubkey: string) => seen.get(pubkey),
      rememberSeq: rememberProvenSeq,
    }
  }

  connectedCallback(): void {
    ensureStyles()
    this.#cleanup.push(EffectBus.on<{ word?: string; at?: number }>(VOCABULARY_FIND, payload => {
      if (Math.abs(Date.now() - (payload?.at ?? 0)) > OPEN_STAMP_MS) return
      this.open()
      const word = String(payload?.word ?? '').trim()
      if (word) void this.look(word)
    }))
  }

  disconnectedCallback(): void {
    for (const off of this.#cleanup) off()
    this.#cleanup = []
    this.close()
  }

  open(): void {
    if (this.#panel) return
    const panel = document.createElement('aside')
    panel.className = 'hc-find'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', t('findword.title', 'Find a word'))
    panel.tabIndex = -1
    panel.setAttribute('data-consumes-wheel', '')
    panel.addEventListener('keydown', this.#onKey)
    this.appendChild(panel)
    this.#panel = panel
    this.#render()
  }

  close(): void {
    if (!this.#panel) return
    // Any leg still running belongs to a generation nothing will read.
    this.#generation++
    this.#panel.removeEventListener('keydown', this.#onKey)
    this.#panel.remove()
    this.#panel = null
  }

  get open$(): boolean { return !!this.#panel }

  readonly #onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    this.close()
  }

  /**
   * ASK. Local first and immediately, then the doors — every row drawn before
   * a socket opens.
   */
  async look(word: string): Promise<void> {
    const mine = ++this.#generation
    this.open()
    const asked = String(word ?? '').trim()
    this.#state = { word: asked, address: null, local: null, horizon: null, horizonFailed: false, search: null, asked: false, asking: true }
    this.#render()

    const reader = this.reader()
    const address = reader ? await reader.addressOf(asked).catch(() => null) : null
    const local = await localVerdict(reader, asked)
    if (mine !== this.#generation) return
    this.#state = { ...this.#state, address, local }
    this.#render()

    // THE ROWS, BEFORE ANY I/O. A gather that THROWS is its own state — it is
    // not an empty horizon, and it must never be drawn as "nobody to ask".
    let horizon: VocabularyHorizon
    let horizonFailed = false
    try { horizon = await this.gatherHorizon() } catch { horizon = { publishers: [] }; horizonFailed = true }
    if (mine !== this.#generation) return
    const canAsk = !!address && !horizonFailed && horizon.publishers.length > 0
    this.#state = { ...this.#state, horizon, horizonFailed, asked: canAsk }
    this.#render()

    if (!canAsk) {
      this.#state = { ...this.#state, asking: false }
      this.#render()
      return
    }

    let search: VocabularySearch | null = null
    try {
      search = await this.search(address, horizon, await this.searchDeps())
    } catch {
      // Every prefilled row stands as CANNOT SAY. A thrown search must never
      // shrink into "nobody has it".
      search = null
    }
    if (mine !== this.#generation) return
    this.#state = { ...this.#state, search, asking: false }
    this.#render()
  }

  // ── the drawing ─────────────────────────────────────────────────────────

  #render(): void {
    const panel = this.#panel
    if (!panel) return
    panel.replaceChildren()
    panel.appendChild(this.#head())
    const body = document.createElement('div')
    body.className = 'hc-find-body'
    panel.appendChild(body)

    const state = this.#state
    if (!state.word) {
      body.appendChild(note('hc-find-quiet',
        t('findword.ask', 'Type a word above. Nothing is asked until you press Look.')))
      return
    }

    if (state.address) {
      const address = document.createElement('p')
      address.className = 'hc-find-address'
      address.textContent = state.address
      address.title = state.address
      body.appendChild(address)
    }

    // ── BLOCK ONE — HERE ────────────────────────────────────────────────
    if (state.local) {
      const words = localWords(state.local)
      const row = document.createElement('p')
      row.className = state.local === 'held' ? 'hc-find-local is-held'
        : state.local === 'not-held' ? 'hc-find-local is-absent'
          : 'hc-find-local is-unknown'
      row.textContent = `${words.mark} ${words.text}`
      body.appendChild(row)
    }

    // ── BLOCK TWO — THE HOSTS ───────────────────────────────────────────
    const horizon = state.horizon
    if (!horizon) {
      body.appendChild(note('hc-find-quiet', t('findword.gathering', 'Working out who to ask…')))
      return
    }
    if (state.horizonFailed) {
      body.appendChild(note('hc-find-unknown', HORIZON_FAILED))
      return
    }
    if (horizon.publishers.length === 0) {
      body.appendChild(note('hc-find-unknown', EMPTY_HORIZON))
      return
    }
    // No address could be derived, so no door was opened. Say that — never
    // "Asked N publishers", and never a column of ASKING rows for a question
    // that was not put.
    if (!state.asked) {
      if (!state.asking) body.appendChild(note('hc-find-unknown', NO_ADDRESS))
      return
    }

    const doors = horizon.publishers.reduce((n, p) => n + p.hosts.length, 0)
    body.appendChild(note('hc-find-count', t('findword.asked',
      'Asked {p} publisher{ps} across {d} door{ds}.',
      {
        p: horizon.publishers.length, ps: horizon.publishers.length === 1 ? '' : 's',
        d: doors, ds: doors === 1 ? '' : 's',
      })))

    const search = state.search
    if (!search) {
      for (const publisher of horizon.publishers) {
        body.appendChild(askingRow(publisher.pubkey, publisher.hosts))
      }
      if (!state.asking) {
        body.appendChild(note('hc-find-unknown', allUnknownWords(horizon.publishers.length)))
      }
      return
    }

    const tally = tallyOf(search.findings)
    body.appendChild(note('hc-find-tally', counterWords(tally.declared, tally.absent, tally.unknown)))
    for (const finding of search.findings) body.appendChild(findingRow(finding))

    const unknowns = unknownCount(search)
    if (unknowns > 0 && unknowns === search.findings.length) {
      body.appendChild(note('hc-find-unknown', allUnknownWords(search.findings.length)))
    }
    if (unknowns > 0) {
      body.appendChild(note('hc-find-footer', unknownFooter(unknowns, search.findings.length)))
    }
  }

  #head(): HTMLElement {
    const head = document.createElement('header')
    head.className = 'hc-find-head'
    const title = document.createElement('span')
    title.className = 'hc-find-title'
    title.textContent = t('findword.title', 'Find a word')
    head.appendChild(title)

    const input = document.createElement('input')
    input.className = 'hc-find-input'
    input.type = 'text'
    input.value = this.#state.word
    input.setAttribute('aria-label', t('findword.word', 'Word'))
    // A DATALIST, never a completer on the command line: an autocompleted
    // dotted argument would be rewritten into two words before it was asked.
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      void this.look(input.value)
    })
    head.appendChild(input)

    const look = document.createElement('button')
    look.type = 'button'
    look.className = 'hc-find-do'
    look.textContent = t('findword.look', 'Look')
    look.addEventListener('click', () => { void this.look(input.value) })
    head.appendChild(look)

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'hc-find-close'
    close.textContent = '×'
    close.setAttribute('aria-label', t('panel.close', 'Close'))
    close.addEventListener('click', () => this.close())
    head.appendChild(close)
    return head
  }
}

// ---------------------------------------------------------------------------
// ROWS
// ---------------------------------------------------------------------------

const shortKey = (pubkey: string): string => (pubkey ? `${pubkey.slice(0, 6)}…` : '(no key)')

const askingRow = (pubkey: string, hosts: readonly string[]): HTMLElement => {
  const row = document.createElement('div')
  row.className = 'hc-find-row is-asking'
  row.appendChild(label('… ASKING', shortKey(pubkey), ''))
  const list = document.createElement('ul')
  list.className = 'hc-find-doors'
  for (const host of hosts) list.appendChild(door(host, 'asking…'))
  row.appendChild(list)
  return row
}

const findingRow = (finding: VocabularyFinding): HTMLElement => {
  const row = document.createElement('div')
  row.className = `hc-find-row is-${finding.verdict}`
  row.appendChild(label(
    `${VERDICT_MARK[finding.verdict]} ${VERDICT_LABEL[finding.verdict]}`,
    shortKey(finding.publisher),
    findingWords(finding),
  ))
  const list = document.createElement('ul')
  list.className = 'hc-find-doors'
  for (const d of finding.doors) {
    list.appendChild(door(d.host, `${doorWords(d.outcome)}${d.seq === null ? '' : ` (seq ${d.seq})`}`))
  }
  if (finding.doors.length) row.appendChild(list)
  return row
}

const label = (verdict: string, who: string, why: string): HTMLElement => {
  const head = document.createElement('p')
  head.className = 'hc-find-verdict'
  const mark = document.createElement('span')
  mark.className = 'hc-find-mark'
  mark.textContent = verdict
  head.appendChild(mark)
  const key = document.createElement('span')
  key.className = 'hc-find-key'
  key.textContent = who
  head.appendChild(key)
  if (why) {
    const reason = document.createElement('span')
    reason.className = 'hc-find-why'
    reason.textContent = why
    head.appendChild(reason)
  }
  return head
}

const door = (host: string, outcome: string): HTMLElement => {
  const item = document.createElement('li')
  item.className = 'hc-find-door'
  const name = document.createElement('span')
  name.textContent = host
  item.appendChild(name)
  const said = document.createElement('span')
  said.textContent = outcome
  item.appendChild(said)
  return item
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
    ${SURFACE} { display: contents; }
    .hc-find {
      position: fixed;
      top: max(calc(2.3rem * var(--hc-header-zoom, 1.0)), var(--hc-header-anchor, 0px));
      right: var(--hc-controls-right, 0px); bottom: 0;
      width: 400px; min-width: 280px; max-width: calc(100vw - 1.5rem);
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
    .hc-find-head {
      flex: 0 0 auto; box-sizing: border-box; display: flex; align-items: center;
      gap: 0.4rem; min-height: 2.875rem; padding: 0.4rem 0.75rem; flex-wrap: wrap;
      background: linear-gradient(180deg, rgba(255,255,255,0.018), rgba(255,255,255,0.006));
      border-bottom: 1px solid rgba(${STEEL}, 0.25);
    }
    .hc-find-title {
      flex: 1 0 100%; font-weight: 600; font-size: 0.9em; letter-spacing: 0.06em;
      text-transform: uppercase; color: rgba(${ACCENT}, 0.95);
    }
    .hc-find-input {
      flex: 1 1 auto; min-width: 0; box-sizing: border-box; padding: 0.3rem 0.4rem;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(${STEEL}, 0.3); border-radius: var(--hc-radius-control, 2px);
      color: inherit; font: inherit; font-size: 0.95em;
    }
    .hc-find-input:focus-visible { outline: 1px solid rgba(${ACCENT}, 0.8); outline-offset: -1px; }
    .hc-find-do {
      flex: 0 0 auto; padding: 0.3rem 0.7rem;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(${STEEL}, 0.3); border-radius: var(--hc-radius-control, 2px);
      color: inherit; font: inherit; font-size: 0.85em; cursor: pointer;
    }
    .hc-find-do:hover { border-color: rgba(${ACCENT}, 0.8); }
    .hc-find-close {
      flex: 0 0 auto; display: inline-grid; place-items: center;
      width: 1.75rem; height: 1.75rem; padding: 0;
      background: none; border: 0; border-radius: var(--hc-radius-control, 2px);
      color: rgba(238, 244, 248, 0.62); font: inherit; font-size: 1.125rem;
      line-height: 1; cursor: pointer;
    }
    .hc-find-close:hover { color: #fff; background-color: rgba(255,255,255,0.075); }

    .hc-find-body {
      flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden;
      padding: 0.7rem 0.75rem 1.2rem;
    }
    .hc-find-body > p { margin: 0 0 0.5rem; line-height: 1.55; }
    .hc-find-address {
      font-size: 0.78em; color: rgba(238, 244, 248, 0.45);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .hc-find-quiet { color: rgba(238, 244, 248, 0.5); font-size: 0.85em; }
    .hc-find-local {
      padding: 0.45rem 0.55rem; font-size: 0.92em;
      border: 1px solid rgba(${STEEL}, 0.3); border-radius: 2px;
    }
    .hc-find-local.is-held { border-color: rgba(${ACCENT}, 0.8); }
    /* AN UNKNOWN IS NEVER FADED AND NEVER COLLAPSED. Full weight, dashed edge
       — the shape says "a state of the evidence", the opacity says nothing. */
    .hc-find-local.is-unknown, .hc-find-unknown {
      border: 1px dashed rgba(${STEEL}, 0.65); border-radius: 2px;
      padding: 0.45rem 0.55rem; color: rgba(238, 244, 248, 0.95);
    }
    .hc-find-count, .hc-find-tally {
      font-size: 0.78em; letter-spacing: 0.08em; text-transform: uppercase;
      color: rgba(238, 244, 248, 0.55);
    }
    .hc-find-tally { color: rgba(${ACCENT}, 0.85); font-variant-numeric: tabular-nums; }

    .hc-find-row {
      margin: 0 0 0.55rem; padding: 0.4rem 0.5rem;
      border: 1px solid rgba(${STEEL}, 0.22); border-radius: 2px;
      background: rgba(255, 255, 255, 0.02);
    }
    /* Same weight as a declared row, deliberately. Only the LEFT EDGE differs,
       and it is a shape (dashed) rather than a dimming. */
    .hc-find-row.is-unknown { border-left: 3px dashed rgba(${STEEL}, 0.8); }
    .hc-find-row.is-declared { border-left: 3px solid rgba(${ACCENT}, 0.9); }
    .hc-find-row.is-absent { border-left: 3px solid rgba(${STEEL}, 0.9); }
    .hc-find-row.is-asking { border-left: 3px dotted rgba(${STEEL}, 0.6); }

    .hc-find-verdict {
      display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.4rem;
      margin: 0 0 0.25rem; font-size: 0.88em;
    }
    .hc-find-mark { font-weight: 600; letter-spacing: 0.08em; }
    .hc-find-key {
      font-family: var(--hc-mono, ui-monospace), monospace;
      color: rgba(238, 244, 248, 0.55);
    }
    .hc-find-why { flex: 1 0 100%; color: rgba(238, 244, 248, 0.8); font-size: 0.95em; }

    /* The doors, in the shell's two-column list shape. */
    .hc-find-doors {
      margin: 0.2rem 0 0; padding: 0 0 0 0.6rem; list-style: none;
      display: grid; grid-template-columns: fit-content(16rem) minmax(0, 1fr);
      gap: 0.1rem 0.6rem; font-size: 0.82em;
    }
    .hc-find-door { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; }
    .hc-find-door > :first-child {
      font-family: var(--hc-mono, ui-monospace), monospace;
      color: rgba(238, 244, 248, 0.7);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .hc-find-door > :last-child { color: rgba(238, 244, 248, 0.55); }

    .hc-find-footer {
      margin-top: 0.6rem; padding-top: 0.5rem; font-size: 0.88em;
      border-top: 1px solid rgba(${STEEL}, 0.25);
      color: rgba(238, 244, 248, 0.9);
    }
  `
  document.head.appendChild(style)
}

;(window as { ioc?: { whenReady?: (k: string, cb: (v: { add(s: unknown): void }) => void) => void } })
  .ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', registry => {
    if (!customElements.get(SURFACE)) customElements.define(SURFACE, VocabularyFindElement)
    try {
      registry.add({ name: SURFACE, owner: OWNER, element: SURFACE, order: 141 })
    } catch {
      // duplicate add (hot reload) — the mounted surface is already live
    }
  })
