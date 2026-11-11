// dub/dub.drone.ts
//
// POINT AND CLICK TO DUB (jwize, 2026-11-11: "when the video is playing you
// click the text and get a prompt to record").
//
// A presentation page shows one sentence at a time and plays its voice. Which
// voice, and which words, is answered here from pools:
//
//   1. YOUR OWN RECORD for the sentence (`presentation:dubs`, dub-bank.ts) —
//      a take you recorded, words you edited, or your choice of the original.
//   2. else THE BANK YOU CHOSE (`dub use <name>`), when it has the sentence.
//   3. else THE DEFAULT: a bank offered by the host the page is served from.
//   4. else what the page was built with.
//
// The page and this bee agree on a small face, registered as the DubBank:
//
//   urlOf(key)   the take to play for a sentence, or '' — asked on every play
//   textOf(key)  the sentence's edited words, or ''
//   want(keys)   the sentences a page shows; their takes are read ahead of use
//   canRecord    whether a press may open the audio editor here
//
// and on two DOM events: the page says `hc-sentence` (bubbling, with the
// sentence), and this bee says `hc-dubs-changed` on the window when a take is
// kept, put down, or read. The page names no module and this bee names no
// page: any page that marks its sentences this way can be dubbed.

import { Drone, EffectBus } from '@hypercomb/core'
import { DUB_POOL, asDubRecord, asSoundbank, foldSentence, putDub, readDub, soundbankOf, type DubRecord, type DubStore, type Soundbank } from './dub-bank.js'
import { bankFor, claimDubPool, hostOf, publishSoundbank, readSoundbanksFrom, readTake, type DubPublishDeps, type OfferedBank } from './dub-network.js'
import { DubQueenBee } from './dub.queen.js'
import { setHiveRoot } from '../sharing/hive-pointer.js'
import { PUBLIC_CONTENT_HOSTS } from '../sharing/hive-link.js'
import { zoneDoor } from '../sharing/zone-door.js'
import { listCommunityHosts } from '../sharing/community-hosts.js'
import { originUrl } from '../sharing/published-pools.js'

const STORE_KEY = '@hypercomb.social/Store'
const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
export const DUB_BANK_KEY = '@diamondcoreprocessor.com/DubBank'

/** What the page says of a pressed sentence: `say` is what it shows now,
 *  `original` the words it was built with (the same unless reworded). */
type Sentence = { key?: unknown; say?: unknown; original?: unknown; at?: unknown; of?: unknown }

type FullStore = DubStore & {
  getResourceLocal?: (signature: string) => Promise<Blob | null>
  putResource?: (blob: Blob, options?: { emit?: boolean }) => Promise<string>
}
type HostSyncLike = {
  publishAtoms?(host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>):
    Promise<{ ok: true; sent: number; held: number } | { ok: false; error: string }>
}

const iocGet = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.(key) as T | undefined
const store = (): FullStore | undefined => iocGet<FullStore>(STORE_KEY)

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const fill = (text: string): string =>
    params ? text.replace(/\{(\w+)\}/g, (whole, name: string) => name in params ? String(params[name]) : whole) : text
  const i18n = iocGet<{ t?: (key: string, params?: Record<string, string | number>) => string }>('@hypercomb.social/I18n')
  const said = i18n?.t?.(key, params)
  return said && said !== key ? said : fill(fallback)
}

const toast = (message: string, type: 'info' | 'success' | 'warning' = 'info'): void => {
  EffectBus.emit('toast:show', { type, title: '/dub', message, duration: 6000 })
}

const SIG = /^[a-f0-9]{64}$/
/** The pool's own documents, beside the per-sentence records. */
const INDEX_DOC = 'index'
const BANKS_DOC = 'banks'
const CHOICE_DOC = 'choice'
/** The choice that means "no bank: my own takes, and the page's voice". */
export const NO_BANK = '-'

const visitor = (): boolean => {
  try { return document.documentElement.dataset['hypercombMode'] === 'visitor' } catch { return true }
}

/** The bank as the page sees it. */
export class DubBank {
  /** Sentence → the object URL of the take that plays ('' once resolved to none). */
  readonly #urls = new Map<string, string>()
  /** Sentence → the words shown in place of the page's own ('' for none). */
  readonly #texts = new Map<string, string>()
  /** Sentence → your own record, once read. */
  readonly #records = new Map<string, DubRecord>()
  readonly #reading = new Map<string, Promise<void>>()
  /** Every sentence a page has asked about this session, to re-resolve on a change. */
  readonly #wanted = new Set<string>()
  /** The sentences you hold a record for. */
  #index = new Set<string>()
  #offered: OfferedBank[] = []
  /** '' the default, NO_BANK, or a bank's signature. */
  #chosen = ''
  #loaded: Promise<void> | null = null

  /** The audio editor's switch. Off on every load; the word `dub` turns it on
   *  for the session (dub.queen.ts). Never persisted: an authoring tool left on
   *  must not be waiting in the next session, or in anything published. */
  editing = false

  /** A press records only while the editor is on. A visitor's page plays; it
   *  never records, whatever the switch says. */
  get canRecord(): boolean {
    if (!this.editing || visitor()) return false
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
  }

  urlOf = (key: string): string => this.#urls.get(key) ?? ''

  /** The sentence's words when they were edited in place, or '' for the page's own. */
  textOf = (key: string): string => this.#texts.get(key) ?? ''

  /** Read the takes of these sentences ahead of their use. */
  want = (keys: readonly string[]): void => {
    const fresh = [...new Set(keys)].filter(key => SIG.test(key) && !this.#urls.has(key) && !this.#reading.has(key))
    for (const key of fresh) this.#wanted.add(key)
    if (!fresh.length) return
    void Promise.all(fresh.map(key => this.#read(key))).then(() => {
      if (fresh.some(key => this.#urls.get(key) || this.#texts.get(key))) this.#changed()
    })
  }

  // ── the pool's own documents ──────────────────────────────────────────────

  async #doc<T>(subKey: string): Promise<T | null> {
    try {
      const held = store()
      const pool = await held?.getPool?.(DUB_POOL)
      const bytes = pool ? await held?.getPoolDoc?.(pool, subKey) : null
      return bytes ? JSON.parse(new TextDecoder().decode(bytes)) as T : null
    } catch { return null }
  }

  async #putDoc(subKey: string, value: unknown): Promise<boolean> {
    try {
      const held = store()
      const pool = await held?.getPool?.(DUB_POOL)
      if (!pool || !held?.putPoolDoc) return false
      const bytes = new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer
      return !!(await held.putPoolDoc(pool, bytes, subKey, { keep: 'current' }))
    } catch { return false }
  }

  /** What this hive remembers between sessions: which sentences are yours, the
   *  banks hosts have offered, and the one you chose. Read once. */
  #load(): Promise<void> {
    return this.#loaded ??= (async () => {
      const index = await this.#doc<{ keys?: unknown }>(INDEX_DOC)
      this.#index = new Set((Array.isArray(index?.keys) ? index!.keys as unknown[] : []).filter((key): key is string => typeof key === 'string' && SIG.test(key)))
      const choice = await this.#doc<{ bank?: unknown }>(CHOICE_DOC)
      const bank = String(choice?.bank ?? '')
      this.#chosen = bank === NO_BANK || SIG.test(bank) ? bank : ''
      const banks = await this.#doc<{ banks?: unknown }>(BANKS_DOC)
      for (const row of (Array.isArray(banks?.banks) ? banks!.banks as Array<{ sig?: unknown; origin?: unknown; bank?: unknown }> : [])) {
        const bankDoc = asSoundbank(row?.bank)
        const sig = String(row?.sig ?? '')
        if (bankDoc && SIG.test(sig) && typeof row?.origin === 'string' && !this.#offered.some(offer => offer.sig === sig)) {
          this.#offered.push({ sig, origin: row.origin, bank: bankDoc })
        }
      }
    })()
  }

  #read(key: string): Promise<void> {
    const reading = (async () => {
      await this.#load()
      if (!this.#records.has(key)) {
        const record = await readDub(store(), key)
        if (record) this.#records.set(key, record)
      }
      await this.#resolve(key)
    })().finally(() => this.#reading.delete(key))
    this.#reading.set(key, reading)
    return reading
  }

  /** Decide what plays and shows for a sentence, by the order in the header. */
  async #resolve(key: string): Promise<void> {
    const before = this.#urls.get(key)
    let url = ''
    let text = ''
    const own = this.#records.get(key)
    if (own) {
      text = own.reworded ? own.text : ''
      if (own.voice) {
        const blob = await store()?.getResource?.(own.voice).catch(() => null)
        if (blob) url = URL.createObjectURL(own.type ? new Blob([blob], { type: own.type }) : blob)
      }
    } else if (this.#chosen !== NO_BANK) {
      const offer = bankFor(key, this.#offered, this.#chosen, typeof location === 'undefined' ? '' : location.host)
      const entry = offer?.bank.voices[key]
      if (offer && entry) {
        text = entry.text ?? ''
        if (entry.voice) {
          const bytes = await readTake(offer.origin, entry.voice)
          if (bytes) url = URL.createObjectURL(new Blob([bytes], entry.type ? { type: entry.type } : undefined))
        }
      }
    }
    this.#urls.set(key, url)
    this.#texts.set(key, text)
    if (before) URL.revokeObjectURL(before)
  }

  /** Resolve every sentence a page has asked about again, then say so. */
  async #resolveAll(): Promise<void> {
    await Promise.all([...this.#wanted].map(key => this.#resolve(key)))
    this.#changed()
  }

  /**
   * Save what changed for a sentence, as one record:
   *   take    a Blob keeps that take; null puts the kept one down (the page's
   *           own voice plays); left out, the take already kept stays.
   *   text    the sentence's words now. Different from the page's own
   *           (`sentence.say`) they are shown and read in their place; the
   *           same, the page's words stand again.
   */
  keep = async (
    sentence: { key: string; say: string },
    change: { take?: Blob | null; seconds?: number; text?: string },
  ): Promise<boolean> => {
    const held = store()
    if (!held?.putResource) return false
    try {
      await this.#load()
      const before = this.#records.get(sentence.key) ?? await readDub(held, sentence.key)
      const voice = change.take === undefined ? (before?.voice ?? '') : change.take ? await held.putResource(change.take) : ''
      const type = change.take === undefined ? (before?.type ?? '') : (change.take?.type ?? '')
      const seconds = change.take === undefined ? (before?.seconds ?? 0) : change.take ? (change.seconds ?? 0) : 0
      const words = foldSentence(change.text ?? (before?.reworded ? before.text : sentence.say))
      const reworded = !!words && words !== foldSentence(sentence.say)
      const record: DubRecord = {
        kind: 'presentation:dub', v: 1, say: sentence.key, text: reworded ? words : foldSentence(sentence.say),
        voice, type, seconds, at: Date.now(), ...(reworded ? { reworded: true } : {}),
      }
      if (!(await putDub(held, record))) return false
      this.#records.set(sentence.key, record)
      if (!this.#index.has(sentence.key)) {
        this.#index.add(sentence.key)
        await this.#putDoc(INDEX_DOC, { keys: [...this.#index].sort() })
      }
      this.#wanted.add(sentence.key)
      await this.#resolve(sentence.key)
      this.#changed()
      return true
    } catch { return false }
  }

  // ── banks ─────────────────────────────────────────────────────────────────

  /** Your own bank: every sentence you hold a take or new words for. */
  ownBank = async (name: string): Promise<Soundbank> => {
    await this.#load()
    const held = store()
    const records: DubRecord[] = []
    for (const key of this.#index) {
      const record = this.#records.get(key) ?? await readDub(held, key)
      const read = record ? asDubRecord(record) : null
      if (read) records.push(read)
    }
    return soundbankOf(records, name, Date.now())
  }

  /** The banks hosts have offered, newest first, and which one is chosen. */
  banks = async (): Promise<{ offered: readonly OfferedBank[]; chosen: string }> => {
    await this.#load()
    return { offered: [...this.#offered].sort((a, b) => b.bank.at - a.bank.at), chosen: this.#chosen }
  }

  /** Take a bank a host offered. Yours stay on top of it. */
  accept = async (offers: readonly OfferedBank[]): Promise<number> => {
    await this.#load()
    let added = 0
    for (const offer of offers) {
      if (this.#offered.some(held => held.sig === offer.sig)) continue
      this.#offered.push(offer)
      added++
    }
    if (!added) return 0
    await this.#putDoc(BANKS_DOC, { banks: this.#offered })
    await this.#resolveAll()
    return added
  }

  /** Choose a bank by signature, NO_BANK for none, or '' for the default. */
  use = async (bank: string): Promise<boolean> => {
    await this.#load()
    if (bank !== '' && bank !== NO_BANK && !this.#offered.some(offer => offer.sig === bank)) return false
    this.#chosen = bank
    await this.#putDoc(CHOICE_DOC, { bank })
    await this.#resolveAll()
    return true
  }

  /** Tell every page showing sentences that the bank, or the switch, changed. */
  changed(): void { this.#changed() }

  #changed(): void {
    try { window.dispatchEvent(new CustomEvent('hc-dubs-changed')) } catch { /* no window */ }
  }
}

/** A host as a URL: loopback on http, everything else https. */
const hostUrl = (host: string): string => originUrl(zoneDoor(host))

/** What this hive publishes with: its store to put, its host service to ship, its key to stamp. */
const publishDeps = (): DubPublishDeps | null => {
  const held = store()
  const sync = iocGet<HostSyncLike>(HOST_SYNC_KEY)
  const putResource = held?.putResource?.bind(held)
  const publishAtoms = sync?.publishAtoms?.bind(sync)
  if (!putResource || !publishAtoms) return null
  const bytesOf = async (sig: string): Promise<Uint8Array | null> => {
    const blob = await (held?.getResourceLocal?.(sig).catch(() => null) ?? Promise.resolve(null))
      ?? await (held?.getResource?.(sig).catch(() => null) ?? Promise.resolve(null))
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null
  }
  return {
    put: (text, type) => putResource(new Blob([text], { type }), { emit: false }),
    publish: async (host, sigs) => { const done = await publishAtoms(host, sigs, bytesOf); return done.ok ? { ok: true } : { ok: false, error: done.error } },
    stamp: (host, key, sig) => setHiveRoot(host, key, sig),
  }
}

export class DubDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description = 'Fills a presentation\'s sentences from pools: your own takes and words, a bank you chose, or the host\'s. With the audio editor on, a press on a sentence records it in place.'

  protected override deps = {}
  protected override listens = ['dub:editing', 'dub:offer', 'dub:sync', 'dub:use', 'dub:banks']
  protected override emits = ['activity:log', 'toast:show']

  #bound = false
  readonly #bank = new DubBank()
  #onSentence = (event: Event): void => { void this.#record(event) }

  protected override heartbeat = async (): Promise<void> => {
    if (this.#bound) return
    this.#bound = true
    window.ioc.register(DUB_BANK_KEY, this.#bank)
    document.addEventListener('hc-sentence', this.#onSentence)
    // A domain the participant learns may offer banks through the same probe
    // every published pool takes; placing the offer is what brings them in.
    claimDubPool(offer => { void this.#bank.accept([offer]) })
    // The bus lives for the session, so the editor starts off on every load;
    // an ask made before this bee was listening is replayed and still counts.
    this.onEffect<{ on?: boolean; toggle?: boolean }>('dub:editing', payload => {
      this.#setEditing(payload?.toggle ? !this.#bank.editing : payload?.on === true)
    })
    // The words are acts, never state: the queen sends them transient, so
    // nothing is replayed to a bee that loads later (an offer is never re-sent).
    this.onEffect<{ host?: string }>('dub:offer', payload => { void this.#offer(String(payload?.host ?? '')) })
    this.onEffect<{ host?: string }>('dub:sync', payload => { void this.#sync(String(payload?.host ?? '')) })
    this.onEffect<{ bank?: string }>('dub:use', payload => { void this.#use(String(payload?.bank ?? '')) })
    this.onEffect('dub:banks', () => { void this.#list() })
  }

  /** Let go while the hive runs: the listener, the recorder if it is open. */
  override dispose(): void {
    document.removeEventListener('hc-sentence', this.#onSentence)
    window.ioc.unregister?.(DUB_BANK_KEY)
    void import('./dub-recorder.js').then(view => view.closeDubRecorder()).catch(() => undefined)
    this.#bound = false
  }

  #setEditing(on: boolean): void {
    const next = on && !visitor()
    if (this.#bank.editing === next) return
    this.#bank.editing = next
    if (!next) void import('./dub-recorder.js').then(view => view.closeDubRecorder()).catch(() => undefined)
    this.#bank.changed()
    EffectBus.emit('activity:log', { message: next
      ? t('dub.on', 'Audio editor on: press a sentence to record it or edit its words')
      : t('dub.off', 'Audio editor off') })
  }

  /** `dub offer @host`: your bank, its takes, and the pointer under your key. */
  async #offer(rawHost: string): Promise<void> {
    // A WRITE goes only to the host the participant names — there is no default.
    const host = zoneDoor(rawHost)
    if (!host) { toast(t('dub.nohost', 'Your soundbank was not offered: no host is named. Say dub offer @<host>.'), 'warning'); return }
    const deps = publishDeps()
    if (!deps) { toast(t('dub.unoffered', 'Your soundbank was not offered: {reason}', { reason: 'the store or the host service is not loaded' }), 'warning'); return }
    const bank = await this.#bank.ownBank(hostOf(typeof location === 'undefined' ? '' : location.host))
    const done = await publishSoundbank(host, bank, deps)
    if (!done.ok) { toast(t('dub.unoffered', 'Your soundbank was not offered: {reason}', { reason: done.error }), 'warning'); return }
    toast(t('dub.offered', 'Offered your soundbank to {host}: {count} sentences, {takes} takes, under your key. The host lists it once its operator lists presentation:dubs.', {
      host, count: Object.keys(bank.voices).length, takes: done.takes,
    }), 'success')
    EffectBus.emit('dub:offered', { host, bank: done.sig, sentences: Object.keys(bank.voices).length })
  }

  /** `dub sync [@host]`: read the banks the hosts you follow carry. */
  async #sync(rawHost: string): Promise<void> {
    const named = zoneDoor(rawHost)
    const here = typeof location === 'undefined' ? '' : location.host
    const hosts = [...new Set([...(named ? [named] : []), here, ...PUBLIC_CONTENT_HOSTS, ...(await listCommunityHosts().catch(() => []))].map(zoneDoor).filter(Boolean))]
    let answered = 0
    const found: OfferedBank[] = []
    for (const host of hosts) {
      const read = await readSoundbanksFrom(hostUrl(host))
      if (read.answered) answered++
      found.push(...read.banks)
    }
    const added = await this.#bank.accept(found)
    if (!found.length) { toast(t('dub.nosync', 'No soundbanks found on {hosts} hosts.', { hosts: answered }), 'warning'); return }
    toast(t('dub.synced', 'Found {count} soundbanks on {hosts} hosts, {added} new. Say dub banks to see them.', { count: found.length, hosts: answered, added }), 'success')
  }

  /** `dub use <name|signature|default|none>`. */
  async #use(raw: string): Promise<void> {
    const word = raw.trim().toLowerCase()
    const { offered } = await this.#bank.banks()
    const bank = word === '' || word === 'default' ? ''
      : word === 'none' || word === 'mine' ? NO_BANK
        : offered.find(offer => offer.sig === word || offer.sig.startsWith(word) || offer.bank.name.toLowerCase() === word || hostOf(offer.origin) === word)?.sig
    if (bank === undefined || !(await this.#bank.use(bank))) {
      toast(t('dub.nobank', 'No soundbank answers to "{name}". Say dub banks to see the ones you have.', { name: raw.trim() }), 'warning')
      return
    }
    toast(bank === '' ? t('dub.use-default', 'Sentences play the host\'s soundbank again, under your own takes.')
      : bank === NO_BANK ? t('dub.use-none', 'Only your own takes play; every other sentence keeps the voice it was built with.')
        : t('dub.use-bank', 'Sentences play the soundbank you chose, under your own takes.'), 'success')
  }

  /** `dub banks`: what you have, and which one plays. */
  async #list(): Promise<void> {
    const { offered, chosen } = await this.#bank.banks()
    if (!offered.length) { toast(t('dub.nobanks', 'You have no soundbanks from a host yet. Say dub sync to look.')); return }
    const lines = offered.map(offer =>
      `${offer.sig === chosen ? '● ' : ''}${offer.bank.name || offer.sig.slice(0, 8)} @${hostOf(offer.origin)} (${Object.keys(offer.bank.voices).length})`)
    toast(lines.join(' · '))
  }

  async #record(event: Event): Promise<void> {
    const detail = (event as CustomEvent<Sentence>).detail
    const key = String(detail?.key ?? '')
    const say = String(detail?.say ?? '')
    if (!SIG.test(key) || !say.trim() || !this.#bank.canRecord) return
    const { openDubRecorder } = await import('./dub-recorder.js')
    // The record is placed against the words the page was built with.
    const original = String(detail?.original ?? '').trim() || say
    const sentence = { key, say: original }
    openDubRecorder({
      say,
      original,
      at: Number(detail?.at) || 0,
      of: Number(detail?.of) || 1,
      kept: this.#bank.urlOf(key),
      // The scene of the page that asked: the editor leaves when it does.
      above: event.target instanceof Element ? event.target.querySelector('.scene') : null,
      t,
      keep: async (take, seconds, text) => {
        const ok = await this.#bank.keep(sentence, { take, seconds, text })
        if (ok) EffectBus.emit('activity:log', { message: t('dub.kept', 'Your take is this sentence\'s voice now') })
        return ok
      },
      reword: async (text) => {
        const ok = await this.#bank.keep(sentence, { text })
        if (ok) EffectBus.emit('activity:log', { message: t('dub.reworded', 'The sentence reads your words now') })
        return ok
      },
      originalVoice: async () => {
        const ok = await this.#bank.keep(sentence, { take: null })
        if (ok) EffectBus.emit('activity:log', { message: t('dub.put-down', 'This sentence plays its original voice again') })
        return ok
      },
    })
  }
}

const _dub = new DubDrone()
window.ioc.register('@diamondcoreprocessor.com/DubDrone', _dub)
// THE BEE WIRES: the word that turns the audio editor on and off is this
// feature's, so this module registers it.
window.ioc.register('@diamondcoreprocessor.com/DubQueenBee', new DubQueenBee())
