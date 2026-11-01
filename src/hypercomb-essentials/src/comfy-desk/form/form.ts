// comfy-desk/form/form.ts
//
// THE WORDS AND KNOBS IN HAND. A textarea whose value round-trips through the
// bus on every keystroke fights the typist and loses the caret, so the form is
// held here and the whole set leaves once, with `comfy:generate`.
//
// What arrives is the SEED: what the active workflow's seams hold. The form
// takes it the first time a model and its LoRAs are used. After that, moving
// away remembers the form and moving back continues from it, and that memory
// is `comfy:drafts`, one copy per combination (comfy/comfy-draft.ts).

import type { ComfyRenderPayload } from '../../comfy/comfy.drone.js'
import { continuationKey, type ComfyDraft } from '../../comfy/comfy-draft.js'
import { NUMBER_KNOBS, type FormHandle, type FormPart, type FormValues, type Intent } from '../parts.js'

const SAVE_MS = 400

type Held = ComfyDraft & { fromTile: boolean; reviewers: number }

const text = (value: unknown): string => value === undefined || value === null ? '' : String(value)

const heldFrom = (row: Partial<ComfyDraft> | undefined): Held => {
  const reviewers = Number(row?.reviewers)
  return {
    positive: text(row?.positive),
    negative: text(row?.negative),
    seed: text(row?.seed),
    width: text(row?.width),
    height: text(row?.height),
    steps: text(row?.steps),
    cfg: text(row?.cfg),
    batch: text(row?.batch),
    fromTile: row?.fromTile === true,
    reviewers: Number.isFinite(reviewers) ? reviewers : 3,
  }
}

class Form implements FormHandle {
  readonly #intent: Intent
  #values: FormValues = { positive: '', negative: '', seed: '', numbers: {}, fromTile: false, reviewers: 3 }
  #knobs: readonly string[] = []
  /** Which model and LoRAs the form belongs to. */
  #key = ''
  /** A continuation read has landed, or the participant has edited. Until then
   *  a save would replace a stored form with the recipe defaults. */
  #settled = false
  /** Changed after it was filled: a late read must not write over that. */
  #touched = false
  readonly #memory = new Map<string, Held>()
  readonly #saved = new Map<string, string>()
  #timer: ReturnType<typeof setTimeout> | null = null
  readonly #onHide = (): void => { if (document.visibilityState === 'hidden') this.flush() }

  constructor(intent: Intent) {
    this.#intent = intent
    document.addEventListener('visibilitychange', this.#onHide)
  }

  get values(): FormValues { return this.#values }

  offers(knob: string): boolean { return this.#knobs.includes(knob) }

  read(p: ComfyRenderPayload): boolean {
    const before = this.#values
    this.#knobs = p.knobs ?? []

    // A different model or LoRA set continues from the last time it was used.
    // The same set keeps what is on screen, even when the workflow name changes.
    const key = continuationKey(p.weights ?? [])
    if (key && key !== this.#key) {
      const arriving = this.#key === '' && this.#touched
      if (this.#key) this.flush()
      const known = this.#memory.get(key)
      if (!arriving) {
        if (known) this.#take(known)
        else this.#seed(p.seeds)
        this.#touched = false
      } else {
        this.#memory.set(key, this.#capture())
      }
      this.#key = key
      this.#settled = !!known || arriving
    }
    if (p.draftReady && key && key === this.#key) {
      if (p.resume && !this.#memory.has(key)) {
        const resumed = heldFrom(p.resume)
        this.#memory.set(key, resumed)
        if (!this.#touched) this.#take(resumed)
      }
      this.#settled = true
    }

    // After the continuation, so a kept state or a roll replaces it.
    if (p.applyPrompt?.text) {
      const row = p.applyPrompt
      this.#values = {
        ...this.#numbersOf(row),
        positive: row.text,
        negative: row.negative ?? '',
        seed: row.seed === undefined ? '' : String(row.seed),
        fromTile: row.fromTile === true,
        reviewers: typeof row.reviewers === 'number' ? row.reviewers : this.#values.reviewers,
      }
      this.#help()
      this.#touch()
    }
    if (p.generation) {
      const row = p.generation
      this.#values = {
        ...this.#numbersOf(row),
        ...(row.positive !== undefined ? { positive: row.positive } : {}),
        ...(row.negative !== undefined ? { negative: row.negative } : {}),
        ...(row.seed !== undefined ? { seed: String(row.seed) } : {}),
      }
      this.#touch()
    }
    if (typeof p.rolled === 'string' && p.rolled) {
      this.#values = { ...this.#values, positive: p.rolled }
      this.#touch()
    }
    this.#arm()
    return this.#values !== before
  }

  set(patch: Partial<Omit<FormValues, 'numbers'>>): void {
    this.#values = { ...this.#values, ...patch }
    if ('fromTile' in patch || 'reviewers' in patch) this.#help()
    this.#touch()
    this.#arm()
  }

  setNumber(knob: string, value: string): void {
    this.#values = { ...this.#values, numbers: { ...this.#values.numbers, [knob]: value } }
    this.#touch()
    this.#arm()
  }

  params(): ReturnType<FormHandle['params']> {
    const held = this.#values
    const params: ReturnType<FormHandle['params']> = { fromTile: held.fromTile, reviewers: held.reviewers }
    if (this.offers('positive')) params.positive = held.positive
    if (this.offers('negative')) params.negative = held.negative
    // A blank seed means a new one every time: that is what blank IS here.
    const seed = Number(held.seed)
    if (this.offers('seed') && held.seed.trim() && Number.isFinite(seed)) params.seed = seed
    for (const knob of NUMBER_KNOBS) {
      if (!this.offers(knob)) continue
      const value = held.numbers[knob]
      if (value !== undefined && value.trim() !== '' && Number.isFinite(Number(value))) params[knob] = Number(value)
    }
    return params
  }

  /** An edit is worth keeping. An untouched recipe default is not: it would
   *  replace a continuation the read has not applied yet. */
  flush(): void {
    if (this.#timer !== null) { clearTimeout(this.#timer); this.#timer = null }
    if (!this.#key || (!this.#settled && !this.#touched)) return
    this.#remember(this.#key, this.#capture())
  }

  dispose(): void {
    this.flush()
    document.removeEventListener('visibilitychange', this.#onHide)
  }

  #numbersOf(row: Partial<Record<(typeof NUMBER_KNOBS)[number], number>>): FormValues {
    const numbers = { ...this.#values.numbers }
    for (const knob of NUMBER_KNOBS) {
      const value = row[knob]
      if (typeof value === 'number') numbers[knob] = String(value)
    }
    return { ...this.#values, numbers }
  }

  /** The workflow's own defaults. The help switch stays as it is. */
  #seed(seeds: ComfyRenderPayload['seeds'] | undefined): void {
    const held = seeds ?? {}
    const numbers: Record<string, string> = {}
    for (const knob of NUMBER_KNOBS) {
      const value = held[knob]
      if (value !== undefined) numbers[knob] = String(value)
    }
    this.#values = {
      ...this.#values,
      positive: text(held.positive),
      negative: text(held.negative),
      seed: text(held.seed),
      numbers,
    }
  }

  #take(row: Held): void {
    this.#values = {
      positive: row.positive,
      negative: row.negative,
      seed: row.seed,
      numbers: { width: row.width, height: row.height, steps: row.steps, cfg: row.cfg, batch: row.batch },
      fromTile: row.fromTile,
      reviewers: row.reviewers,
    }
    this.#help()
  }

  #capture(): Held {
    const { positive, negative, seed, numbers, fromTile, reviewers } = this.#values
    return {
      positive, negative, seed,
      width: numbers['width'] ?? '',
      height: numbers['height'] ?? '',
      steps: numbers['steps'] ?? '',
      cfg: numbers['cfg'] ?? '',
      batch: numbers['batch'] ?? '',
      fromTile, reviewers,
    }
  }

  #help(): void {
    this.#intent('comfy:set-help', { fromTile: this.#values.fromTile, reviewers: this.#values.reviewers })
  }

  #touch(): void {
    this.#touched = true
    this.#settled = true
  }

  #arm(): void {
    if (!this.#key || !this.#settled) return
    const key = this.#key
    const draft = this.#capture()
    if (this.#timer !== null) { clearTimeout(this.#timer); this.#timer = null }
    if (this.#saved.get(key) === JSON.stringify(draft)) return
    this.#timer = setTimeout(() => {
      this.#timer = null
      this.#remember(key, draft)
    }, SAVE_MS)
  }

  #remember(key: string, draft: Held): void {
    const body = JSON.stringify(draft)
    this.#memory.set(key, draft)
    if (this.#saved.get(key) === body) return
    this.#saved.set(key, body)
    this.#intent('comfy:remember', { key, draft })
  }
}

export const formPart: FormPart = {
  create: intent => new Form(intent),
}
