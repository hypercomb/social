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

import { EffectBus, mountToolWindow, translateOr, type ToolWindow } from '@hypercomb/core'
import { MOLECULE_INDEX_SERVICE_KEY, type MoleculeIndexReader } from './molecule-index.service.js'
import { buildHorizon, publishersFromCards, type HorizonSources } from './vocabulary-horizon.js'
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
  OFFER_HEAD,
  OFFER_SHOW,
  OFFER_SHOWN,
  OPEN_STAMP_MS,
  VERDICT_LABEL,
  VERDICT_MARK,
  VOCABULARY_FIND,
  allUnknownWords,
  counterWords,
  doorWords,
  offerWords,
  unknownFooter,
} from './vocabulary-words.js'
// TYPE ONLY. This window keeps its whole reach behind dynamic imports so an
// unopened surface costs nothing at boot; a type is erased and costs nothing
// either way.
import type { StaticOffer } from '../sharing/static-peers.js'

const SURFACE = 'hc-vocabulary-find'
const STYLE_ID = 'hc-vocabulary-find-style'
const OWNER = '@diamondcoreprocessor.com/VocabularyFindView'

const FIND_WINDOW = 'vocabulary-find'
const ACCENT_RGB = [201, 162, 39] as const

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

/** The offers authority. Named by its key rather than imported, so this
 *  window still pulls nothing into the boot bundle. */
type StaticPeersLike = {
  offers?: () => readonly StaticOffer[]
  isOffered?: (name: string) => boolean
}
const staticPeers = (): StaticPeersLike | undefined =>
  ioc<StaticPeersLike>('@diamondcoreprocessor.com/StaticPeersDrone')

const t = translateOr

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

  #window: ToolWindow | null = null
  #generation = 0
  #state: FindState = { word: '', address: null, local: null, horizon: null, horizonFailed: false, search: null, asked: false, asking: false }
  #cleanup: (() => void)[] = []

  /** WHAT EACH PUBLISHER PUBLISHES, keyed by their key — gathered on the way
   *  to the horizon and kept BESIDE it, because a finding names a publisher
   *  and what you can hold is a creation. A seam like the other four, so a
   *  test can hand the window creations without a ledger. Cleared at the top
   *  of every look, so a stale search's creations can never be clicked. */
  takeable = new Map<string, StaticOffer[]>()

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
    // WHAT YOU HAVE BEEN OFFERED (static-peers.drone.ts) — a publisher whose
    // creation stands shaded in your hive is one you can ask.
    const statics = staticPeers()
    const takeable = new Map<string, StaticOffer[]>()
    const remember = (offer: StaticOffer | null): void => {
      if (!offer) return
      const held = takeable.get(offer.pubkey) ?? []
      if (!held.some(o => o.name === offer.name)) takeable.set(offer.pubkey, [...held, offer])
    }
    for (const o of statics?.offers?.() ?? []) {
      follows[`offer:${o.name}`] = { pubkey: o.pubkey, hosts: [...o.hosts] }
      remember(o)
    }
    // THE COMMUNITY'S LEDGERS — every publisher every host you carry lists.
    // This is what makes a word findable ACROSS DOMAINS with nothing visited
    // and nothing offered: the hosts you added are the horizon. One small
    // JSON per host, read at lookup time; a host that does not answer
    // contributes nobody.
    try {
      const { fetchPublicationCards } = await import('../sharing/publications-ledger.js')
      // The mapping from a plate to an offer lives with the offers, and the
      // plate is only whole HERE — `publishersFromCards` keeps a key and its
      // doors, and `foldHorizon` rebuilds every row from those two fields, so
      // a creation attached to a horizon row would never survive to a result.
      const { offerFromCard } = await import('../sharing/static-peers.js')
      const originOf = (zone: string): string => {
        const bare = zone.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
        const local = /^(localhost|127\.)/.test(bare)
        return bare ? `${local ? 'http' : 'https'}://${bare}` : ''
      }
      const ledgers = await Promise.all(zones.map(z => {
        const origin = originOf(z)
        return origin ? fetchPublicationCards({}, origin).catch(() => null) : Promise.resolve(null)
      }))
      const cards = ledgers.flatMap(list => list ?? [])
      Object.assign(follows, publishersFromCards(cards))
      for (const card of cards) remember(offerFromCard(card))
    } catch { /* a ledger that cannot be read is nobody to ask, not a failure to ask */ }
    // The side table, not the horizon: the search re-folds what it is handed.
    this.takeable = takeable
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
    // The offers authority says when a creation arrives or leaves — the same
    // signal the host directory reads. Redrawing here is what keeps a switch
    // from having to guess whether its own click landed.
    this.#cleanup.push(EffectBus.on('community:offers-render', () => {
      if (this.#window) this.#render()
    }))
  }

  disconnectedCallback(): void {
    for (const off of this.#cleanup) off()
    this.#cleanup = []
    this.close()
  }

  open(): void {
    if (this.#window) return
    // The base layer (core/panels/tool-window.ts) is the shell, the header,
    // the lane and the session; this window adds the word field, Look, and
    // what the doors answer.
    const win = mountToolWindow(this, {
      id: FIND_WINDOW,
      title: t('findword.title', 'Find a word'),
      accent: ACCENT_RGB,
      className: 'hc-find',
      defaultWidth: 400,
      minWidth: 280,
      onClose: () => this.close(),
    })
    win.actions.append(...this.#headControls())
    this.#window = win
    this.#render()
  }

  close(): void {
    if (!this.#window) return
    // Any leg still running belongs to a generation nothing will read.
    this.#generation++
    this.#window.dispose()
    this.#window = null
  }

  get open$(): boolean { return !!this.#window }

  /**
   * The chips for one publisher: every creation of theirs this reader has seen
   * listed, with the switch's state read LIVE from the offers authority — so a
   * creation offered from the community page or the host directory already
   * reads as shown the moment this window draws it.
   */
  #takesFor(pubkey: string): TakeChip[] {
    const peers = staticPeers()
    return (this.takeable.get(pubkey) ?? []).map(offer => {
      const offered = peers?.isOffered?.(offer.name) === true
      return {
        offer,
        offered,
        toggle: (): void => {
          // The offer is the whole act. Nothing here folds, adopts a branch,
          // or navigates — the creation stands shaded and the walk in is the
          // adopt (static-peers.ts).
          if (offered) EffectBus.emit('community:withdraw', { name: offer.name })
          else EffectBus.emit('community:offer', offer)
        },
      }
    })
  }

  /**
   * ASK. Local first and immediately, then the doors — every row drawn before
   * a socket opens.
   */
  async look(word: string): Promise<void> {
    const mine = ++this.#generation
    this.open()
    this.takeable = new Map()
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
    const body = this.#window?.body
    if (!body) return
    body.replaceChildren()
    const input = this.#window?.actions.querySelector('.hc-find-input') as HTMLInputElement | null
    if (input && input.value !== this.#state.word && document.activeElement !== input) input.value = this.#state.word

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
    for (const finding of search.findings) body.appendChild(findingRow(finding, this.#takesFor(finding.publisher)))

    const unknowns = unknownCount(search)
    if (unknowns > 0 && unknowns === search.findings.length) {
      body.appendChild(note('hc-find-unknown', allUnknownWords(search.findings.length)))
    }
    if (unknowns > 0) {
      body.appendChild(note('hc-find-footer', unknownFooter(unknowns, search.findings.length)))
    }
  }

  /** The window's own header controls: the word, and Look. */
  #headControls(): HTMLElement[] {
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

    const look = document.createElement('button')
    look.type = 'button'
    look.className = 'hc-tw-button hc-find-do'
    look.textContent = t('findword.look', 'Look')
    look.addEventListener('click', () => { void this.look(input.value) })
    return [input, look]
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

const findingRow = (finding: VocabularyFinding, takes: readonly TakeChip[] = []): HTMLElement => {
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
  if (takes.length) row.appendChild(takeStrip(takes))
  return row
}

/** One creation of one publisher, and whether it stands in your hive. */
interface TakeChip {
  readonly offer: StaticOffer
  readonly offered: boolean
  readonly toggle: () => void
}

/**
 * THE ACT ON A RESULT. A row says a publisher declares the word; these say
 * what that publisher publishes, and each one is the same offer the community
 * page and the host directory make — one creation, shaded, taken by walking
 * into it. A publisher whose creations this reader has never seen listed gets
 * no strip at all rather than a switch that cannot work.
 *
 * The strip is drawn AFTER the doors so it reads as an act on the row and
 * never as part of the evidence. It never removes, reorders or fades a row:
 * what a search found stands exactly as it was found.
 */
const takeStrip = (takes: readonly TakeChip[]): HTMLElement => {
  const strip = document.createElement('div')
  strip.className = 'hc-find-takes'
  const head = document.createElement('span')
  head.className = 'hc-find-takes-head'
  head.textContent = OFFER_HEAD
  strip.appendChild(head)
  for (const take of takes) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = take.offered ? 'hc-find-take is-on' : 'hc-find-take'
    chip.textContent = `${take.offer.name} · ${take.offered ? OFFER_SHOWN : OFFER_SHOW}`
    chip.title = offerWords(take.offer.name, take.offered)
    chip.setAttribute('aria-pressed', String(take.offered))
    chip.addEventListener('click', take.toggle)
    strip.appendChild(chip)
  }
  return strip
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
    /* The shell, header, title, close and body are the tool window's base
       layer (core/panels/tool-window.ts); this is the slice, painted from the
       theme's roles (its text used to be near-white literals). */
    ${SURFACE} { display: contents; }
    .hc-find {
      --hc-tw-steel: color-mix(in srgb, rgb(126, 182, 214), rgb(var(--hc-panel-ink)) var(--hc-deepen, 0%));
    }
    /* The word field takes the header's free width (the base gives the
       controls what the title leaves). */
    .hc-find-input {
      flex: 1 1 auto; min-width: 0; box-sizing: border-box; padding: 0.3rem 0.4rem;
      background: rgba(var(--hc-panel-ink), 0.05);
      border: 1px solid color-mix(in srgb, var(--hc-tw-steel) 30%, transparent); border-radius: var(--hc-radius-control, 2px);
      color: inherit; font: inherit; font-size: 0.95em;
    }
    .hc-find-input:focus-visible { outline: 1px solid color-mix(in srgb, var(--hc-window-accent) 80%, transparent); outline-offset: -1px; }
    .hc-find-takes {
      display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem 0.4rem;
      margin-top: 0.4rem;
    }
    .hc-find-takes-head {
      font-size: 0.72em; letter-spacing: 0.06em; text-transform: uppercase;
      color: color-mix(in srgb, var(--hc-tw-steel) 75%, transparent);
    }
    .hc-find-take {
      padding: 0.2rem 0.5rem;
      background: rgba(var(--hc-panel-ink), 0.06);
      border: 1px solid color-mix(in srgb, var(--hc-tw-steel) 30%, transparent); border-radius: var(--hc-radius-control, 2px);
      color: inherit; font: inherit; font-size: 0.78em; cursor: pointer;
    }
    .hc-find-take:hover { border-color: color-mix(in srgb, var(--hc-window-accent) 80%, transparent); }
    .hc-find-take:focus-visible { outline: 1px solid color-mix(in srgb, var(--hc-window-accent) 80%, transparent); outline-offset: 1px; }
    /* ON IS A STATE, NOT A PRESSED BUTTON — and never a fade: this window may
       not use opacity to say anything, because a dimmed row is how an unknown
       gets read as an absence. */
    .hc-find-take.is-on {
      border-color: color-mix(in srgb, var(--hc-window-accent) 85%, transparent);
      background: color-mix(in srgb, var(--hc-window-accent) 16%, transparent);
    }

    .hc-find-address {
      font-size: 0.78em; color: var(--hc-window-ink-faint);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .hc-find-quiet { color: var(--hc-window-ink-faint); font-size: 0.85em; }
    .hc-find-local {
      padding: 0.45rem 0.55rem; font-size: 0.92em;
      border: 1px solid color-mix(in srgb, var(--hc-tw-steel) 30%, transparent); border-radius: var(--hc-radius-control, 2px);
    }
    .hc-find-local.is-held { border-color: color-mix(in srgb, var(--hc-window-accent) 80%, transparent); }
    /* AN UNKNOWN IS NEVER FADED AND NEVER COLLAPSED. Full weight, dashed edge
       — the shape says "a state of the evidence", the opacity says nothing. */
    .hc-find-local.is-unknown, .hc-find-unknown {
      border: 1px dashed color-mix(in srgb, var(--hc-tw-steel) 65%, transparent); border-radius: var(--hc-radius-control, 2px);
      padding: 0.45rem 0.55rem; color: var(--hc-panel-text);
    }
    .hc-find-count, .hc-find-tally {
      font-size: 0.78em; letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--hc-window-ink-faint);
    }
    .hc-find-tally { color: color-mix(in srgb, var(--hc-window-accent) 85%, transparent); font-variant-numeric: tabular-nums; }

    .hc-find-row {
      margin: 0 0 0.55rem; padding: 0.4rem 0.5rem;
      border: 1px solid color-mix(in srgb, var(--hc-tw-steel) 22%, transparent); border-radius: var(--hc-radius-control, 2px);
      background: rgba(var(--hc-panel-ink), 0.02);
    }
    /* Same weight as a declared row, deliberately. Only the LEFT EDGE differs,
       and it is a shape (dashed) rather than a dimming. */
    .hc-find-row.is-unknown { border-left: 3px dashed color-mix(in srgb, var(--hc-tw-steel) 80%, transparent); }
    .hc-find-row.is-declared { border-left: 3px solid color-mix(in srgb, var(--hc-window-accent) 90%, transparent); }
    .hc-find-row.is-absent { border-left: 3px solid color-mix(in srgb, var(--hc-tw-steel) 90%, transparent); }
    .hc-find-row.is-asking { border-left: 3px dotted color-mix(in srgb, var(--hc-tw-steel) 60%, transparent); }

    .hc-find-verdict {
      display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.4rem;
      margin: 0 0 0.25rem; font-size: 0.88em;
    }
    .hc-find-mark { font-weight: 600; letter-spacing: 0.08em; }
    .hc-find-key {
      font-family: var(--hc-mono, ui-monospace), monospace;
      color: var(--hc-window-ink-faint);
    }
    .hc-find-why { flex: 1 0 100%; color: var(--hc-window-ink-quiet); font-size: 0.95em; }

    /* The doors, in the shell's two-column list shape. */
    .hc-find-doors {
      margin: 0.2rem 0 0; padding: 0 0 0 0.6rem; list-style: none;
      display: grid; grid-template-columns: fit-content(16rem) minmax(0, 1fr);
      gap: 0.1rem 0.6rem; font-size: 0.82em;
    }
    .hc-find-door { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; }
    .hc-find-door > :first-child {
      font-family: var(--hc-mono, ui-monospace), monospace;
      color: var(--hc-window-ink-quiet);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .hc-find-door > :last-child { color: var(--hc-window-ink-faint); }

    .hc-find-footer {
      margin-top: 0.6rem; padding-top: 0.5rem; font-size: 0.88em;
      border-top: 1px solid color-mix(in srgb, var(--hc-tw-steel) 25%, transparent);
      color: var(--hc-panel-text);
    }
  `
  document.head.appendChild(style)
}

// molecule/vocabulary-find.queen.ts defines this element and adds it to the shell's surface registry
// (atomic-modules-plan.md): a dependency registers nothing.
export { SURFACE as VOCABULARY_FIND_SURFACE, OWNER as VOCABULARY_FIND_VIEW_KEY }
