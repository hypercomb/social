// editor/tile-title.ts
//
// THE NAME FIELD'S MEMORY. A tile's name is its ADDRESS and never moves; what
// the person edits here is the tile's TITLE — how it reads in their language,
// a `title` decoration written by `DecorationService.setTitle`. This class owns
// everything about that edit that is not drawing: the text as typed, the text as
// stored, the write in flight, and what the write answered.
//
// WHY IT EXISTS. The heading used to commit on `blur` alone, and it called a
// fire-and-forget `setTitle`. A browser does not fire blur on a field that is
// removed from the page, so a name typed and then lost to Escape, a tile switch,
// a displaced window or a close was dropped with no word; Save could not be
// refused by a duplicate; and a refusal that arrived after the panel was gone
// was swallowed. Here:
//
//   • the edit is BOUND TO THE TILE IT WAS LOADED FOR — a write that lands after
//     the editor has moved on still goes to the right tile, and a refusal that
//     nobody is looking at any more is said in a toast;
//   • a commit is a promise the caller can AWAIT (Save, switching tile), so a
//     refusal can stop the save;
//   • writes to one tile are chained, and each reads the LATEST text when its
//     turn comes, so typing past a slow write collapses into one;
//   • a name not yet written counts as an unsaved change (`dirty`).
//
// No DOM and no IoC here: the decoration service and the toast are injected, so
// the whole thing is specified without a browser (tile-title.spec.ts).

export type TitleOutcome = 'set' | 'cleared' | 'noop' | 'duplicate' | 'error'

export type TitleStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'saving' }
  | { readonly state: 'saved' }
  /** Another tile on this page already reads this way; `sibling` is how it reads, `siblingAddress` is where it lives. */
  | { readonly state: 'refused'; readonly sibling: string; readonly siblingAddress: string }
  | { readonly state: 'failed' }

const IDLE: TitleStatus = { state: 'idle' }

export type TitleDecorations = {
  titleOf(segments: readonly string[], locale?: string): Promise<string>
  setTitle(segments: readonly string[], text: string, locale?: string): Promise<'set' | 'cleared' | 'noop' | 'duplicate'>
  duplicateTitle(segments: readonly string[], text: string, locale?: string): Promise<{ reading: string; address: string } | null>
}

export type TileTitleDeps = {
  decorations: () => TitleDecorations | undefined
  /** Said when a write is refused or fails AFTER the editor has moved on. */
  toast: (message: string, tone: 'warning') => void
  /** Caption lookup with its English stand-in. */
  t: (key: string, fallback: string, params?: Record<string, string | number>) => string
}

export class TileTitle extends EventTarget {

  readonly #deps: TileTitleDeps
  #segments: readonly string[] = []
  #key = ''
  #stored = ''
  #draft = ''
  #touched = false
  #status: TitleStatus = IDLE
  #inflight = 0
  #generation = 0
  #chain: Promise<unknown> = Promise.resolve()
  /** Refusals already said aloud, so a blur-commit and a detach-commit of the same text say it once. */
  readonly #said = new Set<string>()

  constructor(deps: TileTitleDeps) {
    super()
    this.#deps = deps
  }

  /** The tile this name is for — the page it sits on, then its address. */
  get segments(): readonly string[] { return this.#segments }
  /** The address: the last segment. It never changes. */
  get address(): string { return this.#segments[this.#segments.length - 1] ?? '' }
  /** What is stored for the active language ('' when the tile has none). */
  get stored(): string { return this.#stored }
  /** What the field says right now. */
  get draft(): string { return this.#draft }
  get status(): TitleStatus { return this.#status }
  /** A write is on its way. */
  get saving(): boolean { return this.#inflight > 0 }
  /** What the tile reads as: the draft when there is one, else the address. */
  get reading(): string { return this.#draft.trim() || this.address }
  /** A name typed and not yet written — an unsaved change. */
  get dirty(): boolean {
    return this.#inflight > 0 || (this.#segments.length > 0 && this.#draft.trim() !== this.#stored)
  }

  /** Point at a tile and read its stored name. Calling it for the tile already
   *  loaded does nothing. A name left unwritten on the tile being left is
   *  written for THAT tile first, so moving on never loses it. */
  async load(segments: readonly string[]): Promise<void> {
    const key = segments.join('/')
    if (key === this.#key) return
    this.detach()
    this.#generation++
    const generation = this.#generation
    this.#segments = [...segments]
    this.#key = key
    this.#stored = ''
    this.#draft = ''
    this.#touched = false
    this.#status = IDLE
    this.#announce()
    const decorations = this.#deps.decorations()
    if (!decorations?.titleOf || segments.length === 0) return
    try {
      // A write for the tile just left may still be in flight; the stored title
      // is read after it has landed, never before.
      await this.#chain
      if (generation !== this.#generation) return
      const text = await decorations.titleOf(segments)
      if (generation !== this.#generation) return
      this.#stored = text ?? ''
      // Typing began before the read landed: the person's words win.
      if (!this.#touched) this.#draft = this.#stored
      this.#announce()
    } catch { /* no title is a normal state */ }
  }

  /** The field changed. */
  edit(text: string): void {
    this.#draft = text
    this.#touched = true
    if (this.#status.state === 'refused' || this.#status.state === 'failed' || this.#status.state === 'saved') {
      this.#status = IDLE
    }
    this.#announce()
  }

  /** Let go of what was typed (Escape) and show what is stored. */
  revert(): void {
    this.#draft = this.#stored
    this.#touched = false
    if (this.#status.state !== 'saving') this.#status = IDLE
    this.#announce()
  }

  /** Write the name. Resolves with how that write ended: 'set', 'cleared',
   *  'noop' (nothing to write), 'duplicate' (a sibling reads that way) or
   *  'error'. Safe to call from every place the name is let go of. */
  commit(options: { detached?: boolean } = {}): Promise<TitleOutcome> {
    const segments = this.#segments
    const generation = this.#generation
    const asked = this.#draft.trim()
    // Counted from the moment of asking, so `saving` and `dirty` are true the
    // instant a commit is requested, not a turn later when the chain reaches it.
    this.#inflight++
    const run = async (): Promise<TitleOutcome> => {
      try { return await this.#write(segments, generation, asked, options.detached === true) }
      finally { this.#inflight-- }
    }
    const next = this.#chain.then(run, run)
    this.#chain = next.catch(() => undefined)
    return next
  }

  /** Settle everything in flight and write what is left — what Save and a tile
   *  switch await. 'ok' means nothing is owed any more; 'duplicate' or 'error'
   *  is the caller's cue to stay open and let the person see why. */
  async flush(): Promise<'ok' | 'duplicate' | 'error'> {
    await this.#chain
    if (this.dirty) await this.commit()
    await this.#chain
    const status = this.#status
    if (status.state === 'refused') return 'duplicate'
    if (status.state === 'failed') return 'error'
    return 'ok'
  }

  /** The field is about to disappear (the panel closes, the tile changes): write
   *  what is owed for the tile it belongs to, and say aloud if it is refused. */
  detach(): void {
    if (this.#segments.length === 0) return
    if (this.#draft.trim() === this.#stored) return
    void this.commit({ detached: true })
  }

  dispose(): void {
    this.detach()
    this.#generation++
    this.#segments = []
    this.#key = ''
  }

  async #write(
    segments: readonly string[],
    generation: number,
    asked: string,
    detached: boolean,
  ): Promise<TitleOutcome> {
    const decorations = this.#deps.decorations()
    if (!decorations?.setTitle || segments.length === 0) return 'noop'
    const live = (): boolean => generation === this.#generation
    // Still on this tile: the latest text, not the text asked for, because
    // typing may have gone on while an earlier write was in flight.
    const wanted = live() ? this.#draft.trim() : asked
    const against = live() ? this.#stored : null
    if (against !== null && wanted === against) {
      if (live() && this.#status.state === 'saving') { this.#status = IDLE; this.#announce() }
      return 'noop'
    }
    if (live()) { this.#status = { state: 'saving' }; this.#announce() }
    let outcome: TitleOutcome
    let sibling = ''
    let siblingAddress = ''
    try {
      outcome = await decorations.setTitle(segments, wanted)
      if (outcome === 'duplicate') {
        const clash = await decorations.duplicateTitle(segments, wanted).catch(() => null)
        sibling = clash?.reading ?? wanted
        siblingAddress = clash?.address ?? ''
      }
    } catch (error) {
      console.warn('[tile-editor] title failed', error)
      outcome = 'error'
    }

    if (live()) {
      if (outcome === 'set' || outcome === 'cleared' || outcome === 'noop') {
        this.#stored = wanted
        this.#status = outcome === 'noop' ? IDLE : { state: 'saved' }
      } else if (outcome === 'duplicate') {
        this.#status = { state: 'refused', sibling, siblingAddress }
      } else {
        this.#status = { state: 'failed' }
      }
      this.#announce()
    } else if (outcome === 'duplicate' || outcome === 'error') {
      const key = `${segments.join('/')}|${outcome}|${wanted}`
      if (!this.#said.has(key)) {
        this.#said.add(key)
        this.#deps.toast(outcome === 'duplicate'
          ? this.#deps.t('editor.name-refused', 'The name was not saved — “{name}” already reads that way.', { name: sibling })
          : this.#deps.t('editor.name-failed', 'Could not save the name.'), 'warning')
      }
    }
    return outcome
  }

  #announce(): void {
    this.dispatchEvent(new CustomEvent('change'))
  }
}
