// dub/dub.drone.ts
//
// POINT AND CLICK TO DUB (jwize, 2026-11-11: "when the video is playing you
// click the text and get a prompt to record").
//
// A presentation page shows one sentence at a time and plays its voice. In
// your own hive, pressing the sentence opens the recorder (dub-recorder.ts);
// the take you keep becomes that sentence's voice here at once, and is held in
// the `presentation:dubs` pool by the sentence's name (dub-bank.ts).
//
// The page and this bee agree on a small face, registered as the DubBank:
//
//   urlOf(key)   the take to play for a sentence, or '' — asked on every play
//   want(keys)   the sentences a page shows; their takes are read ahead of use
//   canRecord    whether a press may record here (never on a visitor's page)
//
// and on two DOM events: the page says `hc-sentence` (bubbling, with the
// sentence), and this bee says `hc-dubs-changed` on the window when a take is
// kept, put down, or read. The page names no module and this bee names no
// page: any page that marks its sentences this way can be dubbed.

import { Drone, EffectBus } from '@hypercomb/core'
import { foldSentence, putDub, readDub, type DubRecord, type DubStore } from './dub-bank.js'
import { DubQueenBee } from './dub.queen.js'

const STORE_KEY = '@hypercomb.social/Store'
export const DUB_BANK_KEY = '@diamondcoreprocessor.com/DubBank'

/** What the page says of a pressed sentence: `say` is what it shows now,
 *  `original` the words it was built with (the same unless reworded). */
type Sentence = { key?: unknown; say?: unknown; original?: unknown; at?: unknown; of?: unknown }

const store = (): DubStore | undefined =>
  (window as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.(STORE_KEY) as DubStore | undefined

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const fill = (text: string): string =>
    params ? text.replace(/\{(\w+)\}/g, (whole, name: string) => name in params ? String(params[name]) : whole) : text
  const i18n = (window as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.('@hypercomb.social/I18n') as
    | { t?: (key: string, params?: Record<string, string | number>) => string } | undefined
  const said = i18n?.t?.(key, params)
  return said && said !== key ? said : fill(fallback)
}

const SIG = /^[a-f0-9]{64}$/

/** The bank as the page sees it. */
export class DubBank {
  /** Sentence → the object URL of its take ('' once read and found empty). */
  readonly #urls = new Map<string, string>()
  /** Sentence → its record, once read. */
  readonly #records = new Map<string, DubRecord>()
  readonly #reading = new Map<string, Promise<void>>()

  /** The audio editor's switch. Off on every load; the word `dub` turns it on
   *  for the session (dub.queen.ts). Never persisted: an authoring tool left on
   *  must not be waiting in the next session, or in anything published. */
  editing = false

  /** A press records only while the editor is on. A visitor's page plays; it
   *  never records, whatever the switch says. */
  get canRecord(): boolean {
    if (!this.editing) return false
    try { if (document.documentElement.dataset['hypercombMode'] === 'visitor') return false } catch { return false }
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
  }

  urlOf = (key: string): string => this.#urls.get(key) ?? ''

  /** The sentence's words when they were edited in place, or '' for the page's own. */
  textOf = (key: string): string => {
    const record = this.#records.get(key)
    return record?.reworded ? record.text : ''
  }

  /** Read the takes of these sentences ahead of their use. */
  want = (keys: readonly string[]): void => {
    const fresh = [...new Set(keys)].filter(key => SIG.test(key) && !this.#urls.has(key) && !this.#reading.has(key))
    if (!fresh.length) return
    void Promise.all(fresh.map(key => this.#read(key))).then(() => {
      if (fresh.some(key => this.#urls.get(key) || this.textOf(key))) this.#changed()
    })
  }

  #read(key: string): Promise<void> {
    const reading = (async () => {
      const record = await readDub(store(), key)
      await this.#place(key, record)
    })().finally(() => this.#reading.delete(key))
    this.#reading.set(key, reading)
    return reading
  }

  async #place(key: string, record: DubRecord | null): Promise<void> {
    const before = this.#urls.get(key)
    let url = ''
    if (record?.voice) {
      const blob = await store()?.getResource?.(record.voice).catch(() => null)
      if (blob) url = URL.createObjectURL(record.type ? new Blob([blob], { type: record.type }) : blob)
    }
    this.#urls.set(key, url)
    if (record) this.#records.set(key, record); else this.#records.delete(key)
    if (before) URL.revokeObjectURL(before)
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
      await this.#place(sentence.key, record)
      this.#changed()
      return true
    } catch { return false }
  }

  /** Tell every page showing sentences that the bank, or the switch, changed. */
  changed(): void { this.#changed() }

  #changed(): void {
    try { window.dispatchEvent(new CustomEvent('hc-dubs-changed')) } catch { /* no window */ }
  }
}

export class DubDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description = 'Records a voice for a sentence in place: press the sentence under a playing presentation, read it with the cursor, keep the take.'

  protected override deps = {}
  protected override listens = ['dub:editing']
  protected override emits = ['activity:log']

  #bound = false
  readonly #bank = new DubBank()
  #onSentence = (event: Event): void => { void this.#record(event) }

  protected override heartbeat = async (): Promise<void> => {
    if (this.#bound) return
    this.#bound = true
    window.ioc.register(DUB_BANK_KEY, this.#bank)
    document.addEventListener('hc-sentence', this.#onSentence)
    // The bus lives for the session, so the editor starts off on every load;
    // an ask made before this bee was listening is replayed and still counts.
    this.onEffect<{ on?: boolean; toggle?: boolean }>('dub:editing', payload => {
      this.#setEditing(payload?.toggle ? !this.#bank.editing : payload?.on === true)
    })
  }

  #setEditing(on: boolean): void {
    const visitor = document.documentElement.dataset['hypercombMode'] === 'visitor'
    const next = on && !visitor
    if (this.#bank.editing === next) return
    this.#bank.editing = next
    if (!next) void import('./dub-recorder.js').then(view => view.closeDubRecorder()).catch(() => undefined)
    this.#bank.changed()
    EffectBus.emit('activity:log', { message: next
      ? t('dub.on', 'Audio editor on: press a sentence to record it or edit its words')
      : t('dub.off', 'Audio editor off') })
  }

  /** Let go while the hive runs: the listener, the recorder if it is open. */
  dispose(): void {
    document.removeEventListener('hc-sentence', this.#onSentence)
    window.ioc.unregister?.(DUB_BANK_KEY)
    void import('./dub-recorder.js').then(view => view.closeDubRecorder()).catch(() => undefined)
    this.#bound = false
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
      // Above the viewer, never over it: the scene of the page that asked.
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
