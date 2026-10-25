// howto/howto.queen.ts
//
// `howto` — lay the how-to site (jwize, 2026-10-25: "every beehavior needs to
// have a how to page that can be published for clarity").
//
//   howto            lay (or refresh) the site and walk into it
//   howto <word>     the same, then walk to that word's page
//
// The site is ONE tile, `how`, at the root of the hive, with a child tile for
// every word the hive understands and a page on each (howto-page.ts makes the
// pages from what each word declares about itself). Publish it once —
// `publish /how on <domain>` — and the whole language has a front door.
//
// Idempotent: a tile that is already there is kept, and a page whose
// signature has not changed is not rewritten, so saying it again after a new
// build adds only the words that are new and refreshes only the pages that
// changed. The pages are a DERIVATION of the words, never a second copy of
// them to keep in step by hand.

import { QueenBee, EffectBus, hypercomb, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { listDecorations, replaceDecoration } from '../commands/decoration-manifest.js'
import { defaultViewAt, writeDefaultView } from '../commands/view-default.js'
import { savedRoots } from '../history/saved-roots.js'
import { readChildrenStrict, type PlacementHistory } from '../history/layer-placement.js'
import { extractPageRefSigs } from '../sharing/decoration-closure.js'
import { markAuthored } from '../sharing/authored-sigs.js'
import { HOWTO_ROOT, factsOf, indexPageHtml, wordPageHtml, type HowToFacts } from './howto-page.js'

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

/** The page kind a published hive site draws (website.queen.ts `#page`). */
const PAGE_KIND = 'visual:website:page'

/** Tiles laid per commit round: the committer settles between rounds. */
const BATCH = 25

type CensusShape = { entries?: () => readonly Record<string, unknown>[] }
type PreloaderShape = { wakeWord?: (word: string) => Promise<unknown> }
type StoreShape = { putResource?: (blob: Blob) => Promise<string> }
type LineageShape = { explorerSegments?: () => readonly string[]; domain?: unknown }
type NavigationShape = { goRaw?: (segments: readonly string[]) => void }
type CommitterShape = { settled?: () => Promise<void> }
type CursorShape = { state?: { rewound?: boolean } }
type PreviewShape = { previewActive?: boolean }

const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const CURSOR_KEY = '@diamondcoreprocessor.com/HistoryCursorService'
type PagePayload = { htmlSig?: string }

export class HowToQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'howto'
  override description = 'Lay the how-to site: one tile, how, with a page for every word the hive understands, made from what each word declares. Publish it once to give the whole language a front door'
  override descriptionKey = 'slash.howto'
  override options = ['<word>']
  override examples = [
    { input: 'howto', result: 'The tile "how" is laid at the root of your hive with a page for every word, and you walk into it' },
    { input: 'howto publish', result: 'The same, then you walk to the page for "publish"' },
  ]

  /** One run at a time: a second `howto` while one lays tiles would race the
   *  committer for the same children. */
  #running = false

  protected async execute(args: string): Promise<void> {
    const word = args.trim().toLowerCase()
    if (this.#running) {
      this.#say(this.#t('howto.busy', 'howto is already laying the site — give it a moment'))
      return
    }
    this.#running = true
    try {
      const facts = await this.#census()
      if (!facts.length) {
        this.#say(this.#t('howto.empty', 'howto — the hive lists no words yet, so there is nothing to explain'), 'warning')
        return
      }
      if (word && !facts.some(f => f.name === word)) {
        this.#say(this.#t('howto.unknown', `howto — there is no word "${word}"`, { word }), 'warning')
        return
      }
      // The committer writes nothing while you look at the past or a preview
      // is open, and says nothing: tiles would be painted, pages stored, and
      // none of it kept. Refuse up front, as `save` and `use` do.
      if (get<CursorShape>(CURSOR_KEY)?.state?.rewound || get<PreviewShape>(HISTORY_KEY)?.previewActive) {
        this.#say(this.#t('howto.rewound', 'howto — you’re looking at the past; step forward to now first'), 'warning')
        return
      }
      // A saved root named `how` is the same bag as a tile `how` at the root.
      const roots = savedRoots()
      await roots.ready()
      if (roots.isSaved(HOWTO_ROOT)) {
        this.#say(this.#t('howto.saved', `howto — “${HOWTO_ROOT}” is already a saved root, and the how-to site needs that name`, { root: HOWTO_ROOT }), 'warning')
        return
      }
      const made = await this.#lay(facts)
      if (!made) return
      const to = word ? [HOWTO_ROOT, word] : [HOWTO_ROOT]
      get<NavigationShape>('@hypercomb.social/Navigation')?.goRaw?.(to)
      this.#say(this.#t('howto.done',
        `The how-to site is laid: ${made.pages} pages (${made.written} written), ${made.tiles} new tiles — publish it with: publish /${HOWTO_ROOT} on <domain>`,
        { pages: made.pages, written: made.written, tiles: made.tiles, root: HOWTO_ROOT }), 'success')
    } finally {
      this.#running = false
    }
  }

  /** Every word the hive understands, as the census lists it.
   *
   *  A queen asleep until her word is said is listed by a stand-in that knows
   *  only her word and a one-line description — no examples, no forms. So every
   *  word is woken first (a word already awake is a no-op, and a shell that
   *  loads everything has no preloader to ask), and the census is read again:
   *  her own provider has replaced the stand-in, with everything she declares. */
  async #census(): Promise<HowToFacts[]> {
    const drone = get<CensusShape>('@diamondcoreprocessor.com/SlashBehaviourDrone')
    const preloader = get<PreloaderShape>('@hypercomb.social/ScriptPreloader')
    if (preloader?.wakeWord) {
      const names = (drone?.entries?.() ?? []).map(e => String(e.name ?? '')).filter(Boolean)
      await Promise.allSettled(names.map(name => preloader.wakeWord!(name)))
    }
    const entries = drone?.entries?.() ?? []
    const seen = new Set<string>()
    const facts: HowToFacts[] = []
    for (const entry of entries) {
      // A word that is only here because of this machine (an installed
      // agent CLI) is not part of the language: it would tell the world
      // what is installed here, and be a page for a word no one else has.
      if (entry['local'] === true) continue
      const f = factsOf(entry)
      if (!f.name || seen.has(f.name)) continue
      seen.add(f.name)
      facts.push(f)
    }
    return facts
  }

  /** Tiles first, then pages. Returns what it did, or null when it could not. */
  async #lay(facts: readonly HowToFacts[]): Promise<{ pages: number; written: number; tiles: number } | null> {
    const store = get<StoreShape>('@hypercomb.social/Store')
    if (!store?.putResource) {
      this.#say(this.#t('howto.nostore', 'howto — the hive is not ready to keep pages yet'), 'warning')
      return null
    }
    let tiles = 0
    if (!(await this.#children([])).includes(HOWTO_ROOT)) {
      await this.#addTiles([], [HOWTO_ROOT])
      if (!(await this.#children([])).includes(HOWTO_ROOT)) return this.#didNotLand(1, 0)
      tiles++
    }
    const held = new Set(await this.#children([HOWTO_ROOT]))
    const missing = facts.map(f => f.name).filter(name => !held.has(name))
    for (let i = 0; i < missing.length; i += BATCH) await this.#addTiles([HOWTO_ROOT], missing.slice(i, i + BATCH))
    // Count what landed, not what was asked for: the committer can drop a write.
    const after = new Set(await this.#children([HOWTO_ROOT]))
    const landed = missing.filter(name => after.has(name)).length
    if (landed < missing.length) return this.#didNotLand(missing.length, landed)
    tiles += landed

    let written = 0
    if (await this.#dress(store.putResource.bind(store), [HOWTO_ROOT], 'how', indexPageHtml(facts))) written++
    // The site opens as its pages, not as a grid of ~160 hexagons: published,
    // the front door is the index, and each word below it opens as its page.
    if ((await defaultViewAt([HOWTO_ROOT])) !== 'website') await writeDefaultView([HOWTO_ROOT], 'website')
    for (const f of facts) {
      if (await this.#dress(store.putResource.bind(store), [HOWTO_ROOT, f.name], f.name, wordPageHtml(f))) written++
    }
    await this.#settled()
    return { pages: facts.length + 1, written, tiles }
  }

  /** Say how many tiles did not land, and stop: a site missing words is not laid. */
  #didNotLand(wanted: number, landed: number): null {
    this.#say(this.#t('howto.landed', `howto — only ${landed} of ${wanted} tiles landed; say it again in a moment`, { landed, wanted }), 'warning')
    return null
  }

  /** Make the tiles of one page that are not there yet, the way the command
   *  line does: announce them, let the processor run, wait for the commit. */
  async #addTiles(page: readonly string[], names: readonly string[]): Promise<number> {
    for (const cell of names) EffectBus.emit('cell:added', { cell, segments: [...page] })
    await new hypercomb().act()
    await this.#settled()
    return names.length
  }

  /** Dress a tile with its page unless it already wears exactly this one.
   *  True when it wrote. */
  async #dress(
    put: (blob: Blob) => Promise<string>,
    segments: readonly string[],
    label: string,
    html: string,
  ): Promise<boolean> {
    const sig = await put(new Blob([html], { type: 'text/html' }))
    const worn = await listDecorations<PagePayload>({ kind: PAGE_KIND, segments })
    if (worn.some(w => w.record.payload?.htmlSig === sig)) return false
    markAuthored(sig)
    await replaceDecoration({
      kind: PAGE_KIND,
      appliesTo: segments,
      segments,
      payload: { htmlSig: sig, icon: 'web', label, order: 0 },
      mark: 'persistent',
      refs: [sig, ...extractPageRefSigs(html)],
    })
    return true
  }

  async #children(segments: readonly string[]): Promise<string[]> {
    const history = get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<LineageShape>('@hypercomb.social/Lineage')
    if (!history || !lineage) return []
    try { return (await readChildrenStrict(history, lineage.domain, segments))?.map(r => r.name) ?? [] } catch { return [] }
  }

  async #settled(): Promise<void> {
    try { await get<CommitterShape>('@diamondcoreprocessor.com/LayerCommitter')?.settled?.() } catch { /* unacknowledged: proceed */ }
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    const value = get<I18nProvider>(I18N_IOC_KEY)?.t(key, params)
    return value && value !== key ? value : fallback
  }

  #say(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    EffectBus.emit('activity:log', { message, icon: '◫' })
    if (type !== 'info') EffectBus.emit('toast:show', { type, message })
  }
}

const _howto = new HowToQueenBee()
window.ioc.register('@diamondcoreprocessor.com/HowToQueenBee', _howto)
