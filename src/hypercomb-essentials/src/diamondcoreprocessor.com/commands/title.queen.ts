// diamondcoreprocessor.com/commands/title.queen.ts
//
// `/title` — set a tile's DISPLAY name without moving the tile.
//
// A tile's name is its ADDRESS: the lineage bag is `sha256(lineageKey(segments))`,
// so changing a name re-addresses the tile and strands everything keyed by its
// path — the history bag, viewport, substrate override, tile properties, usage
// weight, the swarm channel sig, the published host-manifest entry, static
// followers, hidden-feature keys, and every inbound reference.
//
// So `/title` never touches the address. It writes a `title` decoration, and the
// tile draws under the new text while every path-keyed record stays valid. Being
// an ordinary decoration, it commits as one layer, undoes like anything else, and
// travels to peers with the tile.
//
// A title is not a second name — it is the tile's name INTERPRETED in one
// language, so it is stored per-locale and applies to the ACTIVE locale.
// Renaming and translating are the same act at different moments: `/title` sets
// the reading for the language you are in, `/translate-sweep` can fill the rest,
// and a tile with no reading for your locale simply shows its address.
//
// Syntax:
//   /title <text>            — retitle the tile you are inside
//   /title <cell> = <text>   — retitle a child tile on this page
//   /title <cell> =          — clear this locale's title, drawing the raw name
//
// The trade is deliberate: the path and URL keep the name the tile was born
// with. Re-addressing a tile for real is a separate, heavier operation.

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'

const get = <T,>(key: string): T | undefined => (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

const BACKSLASH = String.fromCharCode(92)

/** A cell argument names a path segment — same guard as /reference. */
const safeName = (raw: string): string =>
  [...raw].filter(ch => ch !== '/' && ch !== BACKSLASH && ch.charCodeAt(0) > 31).join('').trim()

type LineageShape = { explorerSegments?: () => readonly string[] }

type DecorationShape = {
  setTitle(
    segments: readonly string[],
    text: string,
    locale?: string,
  ): Promise<'set' | 'cleared' | 'noop' | 'duplicate'>
  duplicateTitle(
    segments: readonly string[],
    text: string,
    locale?: string,
  ): Promise<string | null>
}

export class TitleQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'title'
  override description = "Set a tile's display name without moving it"
  override descriptionKey = 'slash.title'
  override options = ['<text>', '<cell> = <text>', '<cell> =']
  override examples = [
    { input: '/title Chapter One', result: 'The tile you are inside draws as "Chapter One"' },
    { input: '/title jazz = Jazz Standards', result: 'The child tile "jazz" draws as "Jazz Standards"' },
    { input: '/title jazz =', result: 'Clears the title — "jazz" draws under its own name again' },
  ]

  protected async execute(args: string): Promise<void> {
    const raw = args.trim()
    if (!raw) { this.#log('Title — usage: /title <text>  or  /title <cell> = <text>'); return }

    // With an '=', the left side names a child on this page and the right side
    // is the text (possibly empty, which clears). Without one, the whole
    // argument titles the tile we are currently inside.
    const here = this.#segments()
    const eq = raw.indexOf('=')
    let segments: readonly string[]
    let text: string

    if (eq === -1) {
      if (here.length === 0) { this.#log('Title — the hive root has no title; try /title <cell> = <text>'); return }
      segments = here
      text = raw
    } else {
      const cell = safeName(raw.slice(0, eq))
      if (!cell) { this.#log('Title — needs a tile name before the "="'); return }
      segments = [...here, cell]
      text = raw.slice(eq + 1).trim()
    }

    await this.#applyTitle(segments, text)
  }

  #segments(): string[] {
    const lineage = get<LineageShape>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  /** Thin wrapper over DecorationService.setTitle, which owns the merge and
   *  replace semantics so the tile editor gets identical behaviour. */
  async #applyTitle(segments: readonly string[], text: string): Promise<void> {
    const decorations = get<DecorationShape>('@diamondcoreprocessor.com/DecorationService')
    if (!decorations?.setTitle) { this.#log('Title — unavailable'); return }

    const locale = get<I18nProvider>(I18N_IOC_KEY)?.locale ?? 'en'
    const label = segments[segments.length - 1]
    try {
      const outcome = await decorations.setTitle(segments, text, locale)
      if (outcome === 'duplicate') {
        // Name the tile that took it — "already used" without saying by what
        // leaves the participant hunting for it.
        const clash = await decorations.duplicateTitle(segments, text, locale)
        this.#log(`Title — a tile here already reads "${clash ?? text}"`)
        return
      }
      if (outcome === 'noop') { this.#log(`Title — "${label}" already reads that way in ${locale}`); return }
      this.#log(outcome === 'cleared'
        ? `Title — cleared the ${locale} title, "${label}" draws under its own name`
        : `Title — "${label}" draws as "${text}" in ${locale}`)
    } catch (err) {
      console.warn('[/title] failed', err)
      this.#log('Title — could not apply (see console)')
    }
  }

  #log(message: string, icon = '⇥'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _title = new TitleQueenBee()
window.ioc.register('@diamondcoreprocessor.com/TitleQueenBee', _title)
