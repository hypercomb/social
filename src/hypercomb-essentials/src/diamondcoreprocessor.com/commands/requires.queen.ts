// diamondcoreprocessor.com/commands/requires.queen.ts
//
// `/requires` — manage what a REFERENCE demands of what it shows.
//
// A reference can carry `requiredMarks`: "People, but only family". Those marks
// narrow the page while you stand inside what the reference points at (see
// reference-requirement.drone). They are NOT tag decorations and never appear
// as chips, so this behaviour — and the Organizer panel — are the only ways to
// change them. That is deliberate: a chip could be switched off, and switching
// a requirement off is not relaxing a lens, it is editing the reference.
//
// Syntax (the cell is a reference tile living HERE):
//   /requires <cell>              — show what it demands
//   /requires <cell> = a, b       — demand exactly these
//   /requires <cell> = @family    — demand a BOUQUET (a named set of marks)
//   /requires <cell> + a          — add one
//   /requires <cell> ~ a          — drop one (the `~` removal convention
//                                   /keyword already uses)
//   /requires <cell> ~ @family    — drop the bouquet
//   /requires <cell> =            — demand nothing
//
// A `@name` token names a bouquet from the pheromone panel. It is stored as
// the bouquet's resource SIG (`requiredBouquet`), not its marks and not its
// name: the marks expand at read time in the decoration index, and the sig
// freezes the set — renaming or editing the bouquet later never silently
// re-scopes a portal that demanded the old set. One bouquet per reference;
// inline marks and the bouquet's marks are unioned by the reader.
//
// EDITING IS RE-MINTING. A reference decoration is `appliesTo: []`, so its
// payload IS its identity: changing the marks mints a NEW decoration sig and
// swaps it in. That is not a workaround, it is the model — `People(family)` and
// `People(work)` are genuinely different references to one place, which is what
// lets many references point at one target and each demand something different.
// Consequences that fall out of it: one layer per change, undo landing in the
// reference's own bag, and two references that end up demanding the same thing
// of the same target sharing one sig for free.
//
// The record is assembled here rather than through `replaceDecoration` on
// purpose: that helper auto-declares every 64-hex sig in the payload as a
// resource `ref`, and `targetSig` is a LINEAGE address, not resource bytes —
// declaring it would put a sig in the closure that no store can serve, and the
// extra field would change the record's bytes so identical references written
// by `/reference` and by `/requires` would stop deduplicating.

import { QueenBee, EffectBus } from '@hypercomb/core'
import { REFERENCE_DECORATION_KIND } from './decoration-kind-index.js'
import { listDecorations, removeDecoration } from './decoration-manifest.js'

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: <U>(k: string) => U | undefined } }).ioc?.get?.<T>(key)

const BACKSLASH = String.fromCharCode(92)

/** Names become path segments — same guard `/reference` uses. */
const safeName = (raw: string): string =>
  [...raw].filter(ch => ch !== '/' && ch !== BACKSLASH && ch.charCodeAt(0) > 31).join('').trim()

/** Split a mark list on commas or whitespace. */
const parseMarks = (raw: string): string[] =>
  raw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)

/** The one normalization every writer must agree on: sorted, deduped, and
 *  EMPTY MEANS ABSENT. Two references demanding the same things in different
 *  orders have to mint the same sig, and an emptied demand has to be
 *  byte-identical to a reference that never had one — otherwise it would never
 *  dedup with a plain reference to the same place. */
export const normalizeRequiredMarks = (marks: readonly string[]): string[] =>
  [...new Set(marks.map(m => String(m ?? '').trim()).filter(Boolean))].sort()

/** Assemble a reference payload in the ONE field order every writer must use.
 *
 *  A reference decoration is content-addressed, so the bytes are the identity:
 *  two references to the same place demanding the same things have to serialize
 *  identically or they stop deduplicating, and an emptied demand has to be
 *  byte-identical to a reference that never carried one. Field order, omitted
 *  empties and mark normalization are therefore part of the contract, not
 *  formatting.
 *
 *  `/reference` and the Organizer's drop build the same shape by hand. Folding
 *  all three onto this builder needs it to live in CORE — the Organizer is in
 *  shared, and shared may not import essentials. Until then this is the
 *  reference spelling and the spec below is what holds the others to it. */
export const buildReferencePayload = (opts: {
  targetSegments: readonly string[]
  targetSig?: string
  requiredMarks?: readonly string[]
  requiredBouquet?: string
}): Record<string, unknown> => {
  const payload: Record<string, unknown> = { targetSegments: [...opts.targetSegments] }
  if (opts.targetSig && /^[0-9a-f]{64}$/.test(opts.targetSig)) payload['targetSig'] = opts.targetSig
  const marks = normalizeRequiredMarks(opts.requiredMarks ?? [])
  if (marks.length > 0) payload['requiredMarks'] = marks
  if (opts.requiredBouquet && /^[0-9a-f]{64}$/.test(opts.requiredBouquet)) {
    payload['requiredBouquet'] = opts.requiredBouquet
  }
  return payload
}

type LineageShape = { explorerSegments?: () => readonly string[] }
type StoreShape = { putResource(blob: Blob, options?: { emit?: boolean }): Promise<string> }
type TagRegistryShape = { names: string[]; ensureLoaded(): Promise<void> }
type BouquetRegistryShape = {
  ensureLoaded(): Promise<void>
  sigOf(name: string): string | undefined
  all: Array<{ name: string; sig: string }>
}
type ReferencePayloadShape = {
  targetSegments?: unknown
  targetSig?: unknown
  requiredMarks?: unknown
  requiredBouquet?: unknown
}

export class RequiresQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'requires'
  override readonly aliases = ['require']
  override description = 'Manage the pheromones a reference demands of what it shows'
  override descriptionKey = 'slash.requires'
  override options = ['<cell>', '<cell> = <marks>', '<cell> = @<bouquet>', '<cell> + <mark>', '<cell> ~ <mark>']
  override examples = [
    { input: '/requires people', result: 'Shows what the "people" reference demands' },
    { input: '/requires people = family', result: 'That reference now shows only family' },
    { input: '/requires people = @field-notes', result: 'That reference now demands the field-notes bouquet' },
    { input: '/requires people ~ family', result: 'Drops the family requirement' },
  ]

  protected async execute(args: string): Promise<void> {
    const raw = args.trim()
    if (!raw) { this.#log('Requires — usage: /requires <cell> = <marks>'); return }

    // The operator splits cell from marks. Checked longest-first so a cell name
    // containing no operator falls through to the "just show me" form.
    let op: '=' | '+' | '~' | null = null
    let at = -1
    for (const candidate of ['=', '+', '~'] as const) {
      const i = raw.indexOf(candidate)
      if (i !== -1 && (at === -1 || i < at)) { at = i; op = candidate }
    }

    const name = safeName(at === -1 ? raw : raw.slice(0, at))
    if (!name) { this.#log('Requires — needs a reference tile name'); return }
    const given = at === -1 ? [] : parseMarks(raw.slice(at + 1))
    // `@name` tokens name a BOUQUET; everything else is an inline mark.
    const bouquetNames = given.filter(t => t.startsWith('@')).map(t => t.slice(1)).filter(Boolean)
    const plain = given.filter(t => !t.startsWith('@'))

    const here = (get<LineageShape>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    const segments = [...here, name]

    // Read the LIVE record rather than the index: the index answers "what does
    // this cell demand", but a rewrite needs the rest of the payload (the route
    // and the identity) carried across untouched.
    const priors = await listDecorations<ReferencePayloadShape>({
      kind: REFERENCE_DECORATION_KIND, segments,
    })
    if (priors.length === 0) {
      this.#log(`Requires — "${name}" is not a reference`)
      return
    }
    // Last wins: a cell should only ever carry one reference record, but if an
    // older duplicate survives, the newest is the live one and all of them are
    // replaced below.
    const current = priors[priors.length - 1].record.payload ?? {}
    const currentMarks = normalizeRequiredMarks(
      Array.isArray(current.requiredMarks)
        ? current.requiredMarks.filter((m): m is string => typeof m === 'string')
        : [],
    )
    const currentBouquet = typeof current.requiredBouquet === 'string'
      && /^[0-9a-f]{64}$/.test(current.requiredBouquet)
      ? current.requiredBouquet
      : ''

    if (op === null) {
      this.#log(`Requires — "${name}" demands ${await this.#describe(currentMarks, currentBouquet)}`)
      return
    }

    let next: string[]
    if (op === '=') next = normalizeRequiredMarks(plain)
    else if (op === '+') next = normalizeRequiredMarks([...currentMarks, ...plain])
    else next = currentMarks.filter(m => !plain.includes(m))

    // The bouquet is a single slot. `=` demands exactly what was listed (no
    // `@` token clears it); `+` swaps one in; `~ @anything` drops it — the
    // token expresses "drop the bouquet", no name-match required, because a
    // renamed bouquet would otherwise be undroppable.
    let nextBouquet = op === '=' ? '' : currentBouquet
    if (op === '~') {
      if (bouquetNames.length > 0) nextBouquet = ''
    } else if (bouquetNames.length > 0) {
      const wanted = bouquetNames[bouquetNames.length - 1]
      const resolved = await this.#bouquetSig(wanted)
      if (!resolved) {
        this.#log(`Requires — no such bouquet: @${wanted}`)
        return
      }
      nextBouquet = resolved
    }

    if (op !== '=' && given.length === 0) {
      this.#log(`Requires — needs a mark: /requires ${name} ${op} <mark>`)
      return
    }

    // Marks come from the DECLARED vocabulary, never minted on the fly — a
    // typo'd requirement matches nothing, which reads as "this collection is
    // empty" rather than as a mistake. Bouquet marks were declared when the
    // bouquet was gathered, so only the inline ones are checked here.
    if (op !== '~') {
      const unknown = await this.#unknownMarks(plain)
      if (unknown.length > 0) {
        this.#log(`Requires — no such pheromone: ${unknown.join(', ')}`)
        return
      }
    }

    if (next.join(',') === currentMarks.join(',') && nextBouquet === currentBouquet) {
      this.#log(`Requires — "${name}" already demands ${await this.#describe(currentMarks, currentBouquet)}`)
      return
    }

    await this.#rewrite(name, segments, priors.map(p => p.sig), current, next, nextBouquet)
  }

  /** Human-readable demand: inline marks, the bouquet (by name when the
   *  registry still knows the sig, short sig otherwise), or "nothing". */
  async #describe(marks: readonly string[], bouquetSig: string): Promise<string> {
    const parts: string[] = []
    if (marks.length > 0) parts.push(marks.join(', '))
    if (bouquetSig) parts.push(`bouquet "${await this.#bouquetName(bouquetSig)}"`)
    return parts.length > 0 ? parts.join(' + ') : 'nothing'
  }

  /** Resolve a bouquet NAME to its marks-resource sig via the registry the
   *  pheromone panel maintains. Loose IoC coupling, no import — the registry
   *  lives in shared, and modules may not reach upstream at compile time. */
  async #bouquetSig(name: string): Promise<string> {
    const registry = get<BouquetRegistryShape>('@hypercomb.social/BouquetRegistry')
    if (!registry) return ''
    try { await registry.ensureLoaded() } catch { return '' }
    return registry.sigOf?.(name) ?? ''
  }

  /** Resolve a bouquet sig back to its current name, falling back to the
   *  short sig — a demanded bouquet outlives renames and deletions. */
  async #bouquetName(sig: string): Promise<string> {
    const registry = get<BouquetRegistryShape>('@hypercomb.social/BouquetRegistry')
    if (registry) {
      try {
        await registry.ensureLoaded()
        const hit = (registry.all ?? []).find(b => b.sig === sig)
        if (hit) return hit.name
      } catch { /* fall through to the short sig */ }
    }
    return sig.slice(0, 8)
  }

  /** Marks the hive has never heard of. An empty registry (not loaded, or a
   *  hive with no pheromones yet) vetoes nothing — refusing every mark because
   *  the registry is cold would be worse than accepting one. */
  async #unknownMarks(marks: readonly string[]): Promise<string[]> {
    const registry = get<TagRegistryShape>('@hypercomb.social/TagRegistry')
    if (!registry) return []
    try { await registry.ensureLoaded() } catch { return [] }
    const known = new Set(registry.names ?? [])
    if (known.size === 0) return []
    return marks.filter(m => !known.has(m))
  }

  /** Mint the new reference record and swap it in for the old one(s). */
  async #rewrite(
    name: string,
    segments: readonly string[],
    priorSigs: readonly string[],
    current: ReferencePayloadShape,
    marks: readonly string[],
    bouquet: string,
  ): Promise<void> {
    const store = get<StoreShape>('@hypercomb.social/Store')
    if (!store?.putResource) { this.#log('Requires — unavailable'); return }

    const targetSegments = Array.isArray(current.targetSegments)
      ? current.targetSegments.map(s => String(s)).filter(Boolean)
      : []
    const targetSig = typeof current.targetSig === 'string' && /^[0-9a-f]{64}$/.test(current.targetSig)
      ? current.targetSig
      : ''

    // Rebuilt in the same field order `/reference` and the Organizer's drop use,
    // and with `requiredMarks` OMITTED when empty — same content must produce
    // the same sig no matter which of the three wrote it.
    const payload = buildReferencePayload({
      targetSegments, targetSig, requiredMarks: marks, requiredBouquet: bouquet,
    })

    try {
      const record = { kind: REFERENCE_DECORATION_KIND, appliesTo: [], payload }
      const sig = await store.putResource(
        new Blob([JSON.stringify(record)], { type: 'application/json' }))

      for (const prior of priorSigs) {
        if (prior !== sig) removeDecoration({ sig: prior, segments })
      }
      EffectBus.emit('decorations:changed', { segments, op: 'append', sig })

      this.#log(marks.length || bouquet
        ? `Requires — "${name}" now demands ${await this.#describe(marks, bouquet)}`
        : `Requires — "${name}" demands nothing`, '⇥')
    } catch (err) {
      console.warn('[/requires] failed', err)
      this.#log('Requires — could not write (see console)')
    }
  }

  #log(message: string, icon = '⇥'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _requires = new RequiresQueenBee()
window.ioc.register('@diamondcoreprocessor.com/RequiresQueenBee', _requires)
