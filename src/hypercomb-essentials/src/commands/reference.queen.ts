// commands/reference.queen.ts
//
// `/reference` — drop a REFERENCE tile at the current location:
// a live pointer to another lineage. Clicking the tile portals to the target
// (see tile-overlay #navigateInto). This is the
// atom that lets a set collect references to your own tiles without
// duplicating their content — the same target can be referenced from many
// places (reference sets / pools of meaning).
//
// Syntax:
//   /reference <path>            — tile named after the target leaf
//   /reference <name> = <path>   — explicit tile name
//
// <path> is a full hive path (slash-separated names from the root), e.g.
//   /reference interests/music/jazz
// creates a tile "jazz" here that portals to /interests/music/jazz.
//
// ── The FILTER tail: `+ <marks>` ─────────────────────────────────────────────
//
//   /reference people = friends/people + family
//   /reference people = friends/people + family, @field-notes
//
// A portal can demand pheromones of what it shows ("People, but only family").
// That demand used to be reachable only by writing the reference and then
// running `/requires` on it — two commands for one decision, and the second one
// needs a name that only exists because the first one ran.
//
// So the demand is sayable in the same breath, in the SAME VOCABULARY
// `/requires` speaks: bare words are marks, `@word` is a bouquet. Not a second
// spelling of the same idea — literally the same parser rules and the same
// record builder, so a reference written either way mints the same signature.
//
// `+` rather than `=` because `=` is already the path separator on this line,
// and because `/requires <cell> + <mark>` already reads as "and demands this".
// The tail is split at the first `+` AFTER the `=`, so a target path is never
// mistaken for a mark list.
//
// Marks come from the DECLARED vocabulary, never minted here — a typo'd demand
// matches nothing, which reads as "this portal is empty" rather than as a
// mistake. Same guard, same reason, as `/requires`.

import {
  CANONICAL_REFERENCE_SERVICE_KEY,
  QueenBee,
  EffectBus,
  canonicalReferenceName,
  normalizeReferenceMarks,
  type CanonicalReferenceService,
} from '@hypercomb/core'

const get = <T,>(key: string): T | undefined => (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

/** Parse a slash path into clean segments (drops separators, control chars,
 *  and empty parts — so a leading '/' is fine). */
const parsePath = (raw: string): string[] =>
  raw.split('/').map(canonicalReferenceName).filter(Boolean)

/** Split a mark list on commas or whitespace — the `/requires` rule verbatim. */
const parseMarks = (raw: string): string[] =>
  raw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)

type LineageShape = { explorerSegments?: () => readonly string[] }
type CursorShape = { jumpToLatest?(): void }

export class ReferenceQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'reference'
  override description = 'Drop a reference tile here — a live pointer to another location'
  override descriptionKey = 'slash.reference'
  override options = ['<path>', '<name> = <path>', '<name> = <path> + <marks>']
  override examples = [
    { input: '/reference interests/music/jazz', result: 'Adds a "jazz" tile that portals to /interests/music/jazz' },
    { input: '/reference favourites = interests/music', result: 'Adds a "favourites" reference to /interests/music' },
    { input: '/reference people = friends/people + family', result: 'A "people" portal that shows only what is marked family' },
    { input: '/reference people = friends/people + @field-notes', result: 'A "people" portal demanding the field-notes bouquet' },
  ]

  /**
   * Completions for the FILTER TAIL — the pheromones and bouquets a portal can
   * demand. This is where the drag gesture hands over: the drop composes the
   * name and the path (it knows both), and the only thing left to decide is what
   * the portal should show of its target.
   *
   * Offered ONLY past the `+`. Before it the line is a name and a path — a name
   * is being invented, so there is nothing to choose from, and completing a
   * path the participant is halfway through typing would fight them. Position
   * is meaning: the same word means a mark here and nothing at all one token
   * earlier.
   *
   * `@` lists bouquets, everything else lists marks. Both come from the pools
   * themselves (TagRegistry / BouquetRegistry), so painting a new pheromone
   * anywhere grows this list with no code — membership has an honest source,
   * and the vocabulary can never drift from what `/requires` accepts.
   *
   * Synchronous, like every completer: the dropdown draws now. A cold registry
   * answers empty and fills in on its next keystroke rather than blocking one.
   */
  override slashComplete(args: string): readonly string[] {
    const eq = args.indexOf('=')
    const plus = args.indexOf('+', eq === -1 ? 0 : eq + 1)
    if (plus === -1) return []

    // The token being typed — the same "last whitespace-or-comma separated
    // word" the tail parser will read it as.
    const tail = args.slice(plus + 1)
    const sep = Math.max(tail.lastIndexOf(','), tail.lastIndexOf(' '))
    const fragment = (sep === -1 ? tail : tail.slice(sep + 1)).trim()

    // Marks already spoken for on this line — offering one twice is offering a
    // no-op, and the writer dedups them anyway.
    const already = new Set(parseMarks(tail.slice(0, sep === -1 ? 0 : sep)))

    if (fragment.startsWith('@')) {
      const wanted = fragment.slice(1).toLowerCase()
      const registry = get<{ all?: Array<{ name: string }> }>('@hypercomb.social/BouquetRegistry')
      return (registry?.all ?? [])
        .map(b => `@${b.name}`)
        .filter(n => !already.has(n) && n.slice(1).toLowerCase().startsWith(wanted))
    }

    const registry = get<{ names?: string[] }>('@hypercomb.social/TagRegistry')
    const q = fragment.toLowerCase()
    return (registry?.names ?? [])
      .filter(n => !already.has(n) && (!q || n.toLowerCase().startsWith(q)))
  }

  protected async execute(args: string): Promise<void> {
    const raw = args.trim()
    if (!raw) { this.#log('Reference — usage: /reference <path>  or  /reference <name> = <path>'); return }

    // The FILTER tail is split off first, at the first `+` after the `=`. Doing
    // it in that order is what keeps a target path from being read as a mark
    // list when the name half happens to contain a `+`.
    const eq = raw.indexOf('=')
    const plus = raw.indexOf('+', eq === -1 ? 0 : eq + 1)
    const body = plus === -1 ? raw : raw.slice(0, plus)
    const tail = plus === -1 ? [] : parseMarks(raw.slice(plus + 1))

    // Split explicit "name = path"; otherwise the whole arg is the path and the
    // tile takes the target's leaf name.
    let namePart = ''
    let pathPart = body
    if (eq !== -1) {
      namePart = canonicalReferenceName(body.slice(0, eq))
      pathPart = body.slice(eq + 1)
    }

    const targetSegments = parsePath(pathPart)
    if (targetSegments.length === 0) { this.#log('Reference — needs a target path (e.g. /reference music/jazz)'); return }

    const name = canonicalReferenceName(namePart || targetSegments[targetSegments.length - 1])
    if (!name) { this.#log('Reference — could not derive a name; try /reference <name> = <path>'); return }

    // `@name` names a BOUQUET; everything else is an inline mark. One bouquet
    // per reference (the payload has one slot), so a second `@` supersedes.
    const bouquetNames = tail.filter(t => t.startsWith('@')).map(t => t.slice(1)).filter(Boolean)
    const marks = normalizeReferenceMarks(tail.filter(t => !t.startsWith('@')))

    const unknown = await this.#unknownMarks(marks)
    if (unknown.length > 0) { this.#log(`Reference — no such pheromone: ${unknown.join(', ')}`); return }

    let bouquet = ''
    if (bouquetNames.length > 0) {
      const wanted = bouquetNames[bouquetNames.length - 1]
      bouquet = await this.#bouquetSig(wanted)
      // A demand that cannot be expanded would narrow NOTHING — a filter that
      // fails open, which is the one failure a requirement must never have. So
      // an unknown bouquet refuses the whole command rather than quietly
      // writing a portal that admits everything.
      if (!bouquet) { this.#log(`Reference — no such bouquet: @${wanted}`); return }
    }

    await this.#createReference(name, targetSegments, marks, bouquet)
  }

  /** Marks the hive has never heard of. An empty registry (cold, or a hive with
   *  no pheromones yet) vetoes nothing — refusing every mark because the
   *  registry has not loaded is worse than accepting one. Same rule as
   *  `/requires`. */
  async #unknownMarks(marks: readonly string[]): Promise<string[]> {
    if (marks.length === 0) return []
    const registry = get<{ names: string[]; ensureLoaded(): Promise<void> }>('@hypercomb.social/TagRegistry')
    if (!registry) return []
    try { await registry.ensureLoaded() } catch { return [] }
    const known = new Set(registry.names ?? [])
    if (known.size === 0) return []
    return marks.filter(m => !known.has(m))
  }

  /** Resolve a bouquet NAME to its marks-resource sig. The sig is what gets
   *  stored, never the name and never the marks: it freezes the set, so editing
   *  the bouquet later can never silently re-scope portals already written. */
  async #bouquetSig(name: string): Promise<string> {
    const registry = get<{ ensureLoaded(): Promise<void>; sigOf(n: string): string | undefined }>(
      '@hypercomb.social/BouquetRegistry')
    if (!registry) return ''
    try { await registry.ensureLoaded() } catch { return '' }
    return registry.sigOf?.(name) ?? ''
  }

  #segments(): string[] {
    const lineage = get<LineageShape>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  /** Create a child tile carrying a `reference` decoration — baked into the
   *  same commit (the race-free create+decorate shape). The child's own bag
   *  is fresh (no contention), so its commit stays direct; the PARENT link
   *  rides the LayerCommitter FIFO as a surgical children append — a direct
   *  read-modify-write commitLayer of the parent would clobber any
   *  interleaved FIFO commit's child (true tile loss). */
  async #createReference(
    name: string,
    targetSegments: readonly string[],
    requiredMarks: readonly string[] = [],
    requiredBouquet = '',
  ): Promise<void> {
    const references = get<CanonicalReferenceService>(CANONICAL_REFERENCE_SERVICE_KEY)
    if (!references?.place) { this.#log('Reference — unavailable'); return }
    const parentSegments = this.#segments()
    try {
      const made = await references.place({
        name,
        sourceSegments: targetSegments,
        parentSegments,
        requiredMarks,
        requiredBouquet,
      })
      if (!made) {
        this.#log(`Reference — a tile named "${name}" already lives here, or its source is unavailable`)
        return
      }

      get<{ invalidate?: () => void }>('@hypercomb.social/Lineage')?.invalidate?.()
      const cursor = get<CursorShape>('@diamondcoreprocessor.com/HistoryCursorService')
      cursor?.jumpToLatest?.()

      const demand = requiredMarks.length || requiredBouquet
        ? ` (only ${[...requiredMarks, ...(requiredBouquet ? ['a bouquet'] : [])].join(', ')})`
        : ''
      this.#log(`Reference — "${name}" → /${name}${demand}`, '⇥')
    } catch (err) {
      console.warn('[/reference] failed', err)
      this.#log('Reference — could not create (see console)')
    }
  }

  #log(message: string, icon = '⇥'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _reference = new ReferenceQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ReferenceQueenBee', _reference)
