// diamondcoreprocessor.com/tutorial/tutorial-stage.ts
//
// THE STAGE — the only thing a lesson is allowed to touch.
//
// Every lesson is handed a stage and nothing else: the bee, the practice page,
// the chrome, and a small set of verbs that all run through the SAME paths a
// real participant's action takes (`keymap:invoke` for bound actions, the
// command line's prefill + remote-submit for typing, `Lineage.explorerEnter`
// for movement). A lesson can therefore never demonstrate something that would
// not happen for real — and it can never reach past its own step into the
// engine, so lessons stay independent and removable.
//
// Type-only module: the runner (bee-tutorial.drone.ts) implements it.

import type { TutorialLevel } from './tutorial-lesson.js'

export type StagePoint = { x: number; y: number }

export type StageRect = { left: number; top: number; width: number; height: number }

/** A ring around a cell, or a box around a piece of chrome. */
export type StageHighlight = { x: number; y: number; r: number } | StageRect | null

/** Draws a tile's cover at call time — never a bundled asset. */
export type CoverFactory = () => Promise<Blob>

/** Named for the stage — the overlay element has its own `SayOptions`. */
export type StageSayOptions = {
  /** i18n key for the bubble text; falls back to `tutorial.<chip>`. */
  readonly key?: string
  /** Interpolation tokens for the text. */
  readonly params?: Record<string, string | number>
  /** Override the Continue button's label. */
  readonly continueLabel?: string
}

export interface TutorialStage {
  /** Which course is running — a lesson may adapt its wording, never its path. */
  readonly level: TutorialLevel

  /** The disposable practice page this course opened. Everything a lesson
   *  creates must live inside it; it is deleted when the course ends, on abort,
   *  and by the provenance GC after a crash. */
  readonly practice: { readonly name: string; readonly base: readonly string[] }

  // ── talking ────────────────────────────────────────────────────────────
  /** One Continue-gated bubble. Aborts the course if the participant skips. */
  say(chip: string, chipFallback: string, text: string, opts?: StageSayOptions): Promise<void>
  /** Localized string with fallback — for names a lesson has to build itself. */
  t(key: string, fallback: string, params?: Record<string, string | number>): string

  // ── flying ─────────────────────────────────────────────────────────────
  flyTo(x: number, y: number): Promise<void>
  /** Fly beside a cell and ring it. No-op ring when the cell isn't on screen. */
  flyToCell(label: string): Promise<void>
  /** Fly beside a piece of chrome and box it. */
  flyToRect(rect: StageRect | null): Promise<void>
  highlight(target: StageHighlight): void
  /** The ghost cursor's click — ripple, optional Shift keycap, optional hold. */
  ghostClick(x: number, y: number, opts?: { shift?: boolean; hold?: number }): Promise<void>

  // ── moving ─────────────────────────────────────────────────────────────
  /** Ghost-click a cell and go inside it (the real enter path). */
  enterCell(label: string): Promise<void>
  /** Shift+click on empty canvas and step out one level. */
  leave(): Promise<void>
  /** Step out until back at the practice page's own level. */
  leaveTo(depth: number): Promise<void>
  /** The Home button — back to the front door. */
  goHome(): Promise<void>
  /** How deep we are, in segments. */
  depth(): number

  // ── doing (always the real path) ───────────────────────────────────────
  /** Type into the command line and submit — creation and every slash
   *  behaviour ride this. `slow` types character by character so the
   *  participant can read it. */
  typeAndSubmit(text: string, slow?: boolean): Promise<void>
  /** Fire a bound action exactly as its keystroke would. */
  invoke(cmd: string): void
  /** Raise an effect — for the handful of paths that have no binding. */
  emit(effect: string, payload: unknown): void

  /** Create one tile from the command line. The cover is generated and
   *  attached in the same beat, so the substrate can never slip a default
   *  image onto a tutorial tile. Returns the name actually used
   *  (collision-resolved). */
  create(name: string, cover?: CoverFactory): Promise<string>
  /** Create several in ONE bracket commit — the same atomic path `[a, b, c]`
   *  gives a real participant. Returns the names actually used. */
  createMany(names: readonly string[], cover?: (index: number) => Promise<Blob>): Promise<string[]>

  /** Open the tile editor on a cell — the same payload the pencil icon sends. */
  editCell(label: string): Promise<void>

  // ── selection ──────────────────────────────────────────────────────────
  select(labels: readonly string[]): void
  clearSelection(): void
  selectionCount(): number

  // ── looking around ─────────────────────────────────────────────────────
  /** Labels rendered at the current level, in render order. */
  labels(): readonly string[]
  /** A cell's centre in client pixels, or null when it isn't rendered. */
  point(label: string): StagePoint | null
  /** The hex circumradius in client pixels. */
  radius(): number
  /** The canvas centre in client pixels. */
  center(): StagePoint
  /** A controls-bar button by its i18n key (locale-proof aria-label lookup). */
  chrome(i18nKey: string): StageRect | null
  /** The command line's input box. */
  commandInput(): StageRect | null
  /** The address bar (breadcrumb strip). */
  breadcrumb(): StageRect | null
  /** Any shell element by selector — for chrome a lesson owns. */
  element(selector: string): StageRect | null

  // ── waiting ────────────────────────────────────────────────────────────
  wait(ms: number): Promise<void>
  /** Resolve once a cell with this name is rendered. */
  waitForLabel(name: string): Promise<void>
  /** Resolve once the rendered cell set satisfies the predicate. */
  waitForCells(pred: (labels: readonly string[]) => boolean, timeoutMs?: number): Promise<boolean>
  /** Cancellation checkpoint — call between beats in a long lesson. */
  check(): void
}
