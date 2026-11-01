// comfy-desk/parts.ts
//
// WHAT CROSSES BETWEEN THE PARTS, and nothing else (documentation/comfy-desk.md).
//
// The desk is one behaviour and thirteen parts. Each part is a folder holding one
// trait word's OWN version, so each is its own layer with its own signature and
// each is an extension point: something registered at `partKey(word)` replaces
// it, and with nothing there the part's own version runs. This file is the only
// file every part may read. A part never imports a part: the desk
// (desk/comfy-desk.view.ts) pieces them together.

import type { ComfyRenderPayload } from '../comfy/comfy.drone.js'
import type { ComfyGenerationRecord } from '../comfy/comfy.service.js'
import type { ComfyParams } from '../comfy/comfy-workflow.js'

export const PART_WORDS = [
  'form', 'assets', 'recipe', 'frame', 'callouts', 'shelf',
  'prompt', 'negative', 'knobs', 'workflow', 'machine', 'library', 'place',
] as const
export type PartWord = (typeof PART_WORDS)[number]

export const partKey = (word: PartWord): string => `@diamondcoreprocessor.com/ComfyDesk/${word}`

/** A caption, or its plain-English stand-in. */
export type Say = (key: string, fallback: string, params?: Record<string, string | number>) => string

/** Everything that leaves the desk leaves as an effect. */
export type Intent = (effect: string, payload?: unknown) => void

// ── the form ──────────────────────────────────────────────────────────

export const NUMBER_KNOBS = ['width', 'height', 'steps', 'cfg', 'batch'] as const
export type NumberKnob = (typeof NUMBER_KNOBS)[number]

export interface FormValues {
  readonly positive: string
  readonly negative: string
  readonly seed: string
  readonly numbers: Readonly<Record<string, string>>
  readonly fromTile: boolean
  readonly reviewers: number
}

/** The words and knobs in hand. A keystroke stays here; only the whole set leaves. */
export interface FormHandle {
  readonly values: FormValues
  offers(knob: string): boolean
  /** One render arrived. True when the values changed under the participant. */
  read(payload: ComfyRenderPayload): boolean
  set(patch: Partial<Omit<FormValues, 'numbers'>>): void
  setNumber(knob: string, value: string): void
  /** What Generate and Keep send. */
  params(): ComfyParams & { fromTile: boolean; reviewers: number }
  /** Write the form down now, before the desk goes. */
  flush(): void
  dispose(): void
}

export interface FormPart {
  create(intent: Intent): FormHandle
}

// ── the assets ────────────────────────────────────────────────────────

/** One made picture. The signature is the identity; nothing here is a copy. */
export interface Asset {
  readonly sig: string
  readonly record: ComfyGenerationRecord
}

export interface AssetsPart {
  /** Every picture this hive made, newest first. */
  list(): Promise<readonly Asset[]>
  /** An object URL over the bytes at this signature. The caller revokes it. */
  url(sig: string): Promise<string | null>
  /** What a row is called. */
  nameOf(asset: Asset): string
}

// ── the recipe: which callouts stand on the drawing ───────────────────

export interface Box { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/** One labelled part of the drawing. Lengths are fractions of the frame. */
export interface RecipeRow {
  readonly id: string
  readonly labelKey: string
  readonly label: string
  readonly side: 'left' | 'right'
  /** Where the leader ends. Absent: a callout that is not on the picture. */
  readonly anchor?: { readonly x: number; readonly y: number }
  /** What lights on the picture, and what answers the pointer. */
  readonly region?: Box
  /** Lights the picture's whole outline: this part is about the frame itself. */
  readonly edge?: boolean
}

export interface RecipePart {
  /** The rows for this state. A knob that turns nothing is never drawn. */
  rows(knobs: readonly string[], asset: Asset | null): readonly RecipeRow[]
}

// ── the cards ─────────────────────────────────────────────────────────

/** What every card reads. */
export interface DeskState {
  readonly payload: ComfyRenderPayload
  readonly form: FormHandle
  /** The picture on the stage, when one is chosen. */
  readonly asset: Asset | null
}

export interface CardContext {
  readonly say: Say
  readonly intent: Intent
  readonly form: FormHandle
  /** The form changed: the tabs repaint. */
  changed(): void
  /** The list on the left turns to the tiles until one is chosen. */
  chooseTile(chosen: (tile: { name: string; parent: readonly string[] }) => void): void
}

export interface CardHandle {
  readonly el: HTMLElement
  /** The state moved. A field in the participant's hands is left alone. */
  paint(state: DeskState): void
  focus?(): void
}

export interface CardPart {
  create(context: CardContext): CardHandle
  /** The quiet words on the tab. */
  value(state: DeskState, say: Say): string
  /** This card needs the participant. */
  alert?(state: DeskState): boolean
}

// ── the parts that draw ───────────────────────────────────────────────

export type Lit = 'soft' | 'strong'

export interface FrameShown {
  /** The picture to draw, or null for the frame of the one to come. */
  readonly url: string | null
  readonly width: number
  readonly height: number
  /** 0..1 while a run reports steps. */
  readonly progress: number | null
  readonly busy: boolean
}

export interface FrameHandle {
  /** Stands inside the viewport; the callouts place themselves around it. */
  readonly el: HTMLElement
  /** The picture's box in the square stage, in px. */
  box(size: number, shown: FrameShown): Box
  show(size: number, shown: FrameShown, rows: readonly RecipeRow[]): void
  light(lit: ReadonlyMap<string, Lit>): void
}

export interface FramePart {
  create(events: {
    onEnter(part: string): void
    onLeave(part: string): void
    onPick(part: string): void
    onLook(): void
  }, say: Say): FrameHandle
}

export interface CalloutPlace {
  /** The square stage in the viewport. */
  readonly figure: { readonly left: number; readonly top: number }
  readonly size: number
  readonly picture: Box
  readonly viewport: { readonly width: number; readonly height: number }
  readonly unit: number
  readonly narrow: boolean
}

export interface CalloutsHandle {
  readonly el: HTMLElement
  /** The rows standing now, each with its card. */
  rows(rows: readonly RecipeRow[], cardOf: (id: string) => HTMLElement | null): void
  values(of: (id: string) => { readonly text: string; readonly alert: boolean }): void
  place(place: CalloutPlace): void
  open(id: string | null): void
  /** Hover from the drawing. */
  enter(part: string): void
  leave(part: string): void
  /** One rung of Escape. True when it took the press. */
  dismiss(): boolean
  dispose(): void
}

export interface CalloutsPart {
  create(events: { onLit(lit: ReadonlyMap<string, Lit>): void; onOpen(id: string | null): void }): CalloutsHandle
}

export interface ShelfRow {
  readonly asset: Asset
  readonly chosen: boolean
}

export interface ShelfHandle {
  readonly el: HTMLElement
  show(rows: readonly ShelfRow[], fresh: boolean): void
  /** What ComfyUI's own folder holds, while it is being looked through. */
  folder(pictures: readonly { readonly url: string; readonly filename: string; readonly size: number }[]): void
  /** What was hidden, in the fold at the foot. */
  hidden(rows: readonly { readonly sig: string; readonly label: string }[]): void
  dispose(): void
}

export interface ShelfPart {
  create(events: {
    onPick(asset: Asset | null): void
    onHide(asset: Asset): void
    onReveal(sig: string): void
    onKeep(index: number): void
    urlOf(sig: string): Promise<string | null>
    nameOf(asset: Asset): string
  }, say: Say): ShelfHandle
}

export interface DeskParts {
  readonly form: FormPart
  readonly assets: AssetsPart
  readonly recipe: RecipePart
  readonly frame: FramePart
  readonly callouts: CalloutsPart
  readonly shelf: ShelfPart
  readonly prompt: CardPart
  readonly negative: CardPart
  readonly knobs: CardPart
  readonly workflow: CardPart
  readonly machine: CardPart
  readonly library: CardPart
  readonly place: CardPart
}

/** Each word's filler, or its own version. */
export const fillParts = (own: DeskParts, filler: (key: string) => unknown): DeskParts => {
  const parts: Record<string, unknown> = {}
  for (const word of PART_WORDS) parts[word] = filler(partKey(word)) ?? own[word]
  return parts as unknown as DeskParts
}

/** A DOM node, from the same three arguments everywhere. */
export const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

/** A field in the participant's hands keeps its caret. */
export const setField = (field: HTMLInputElement | HTMLTextAreaElement, value: string): void => {
  if (document.activeElement !== field && field.value !== value) field.value = value
}

/** A field of words. Ctrl+Enter from any of them is Generate. */
export const wordField = (placeholder: string, rows: number, context: CardContext): HTMLTextAreaElement => {
  const field = make('textarea', 'cd-words')
  field.rows = rows
  field.placeholder = placeholder
  field.setAttribute('aria-label', placeholder)
  field.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    context.intent('comfy:generate', context.form.params())
  })
  return field
}
