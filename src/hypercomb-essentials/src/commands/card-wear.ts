// commands/card-wear.ts
//
// WEARING A CARD TEMPLATE — the one rule behind `card wear <template>`.
//
// A business card is two records on a tile (documentation/business-card.md): the page every card wears
// (`visual:website:page` → htmlSig) and the tile's own card (`card:data` → dataSig, and optionally
// themeSig and artSig). A template is a tile that wears a card page, and usually names a theme.
//
// Wearing a template is two references, never a copy:
//   - the tile's page becomes the template's page (its own label and icon are kept);
//   - the tile's card keeps its own details and picture, and takes the template's theme.
// A tile with no card of its own starts from the template's card — the name slots someone fills in.
//
// Pure: the queen reads the records and writes what this returns.

export const CARD_PAGE_KIND = 'visual:website:page'
export const CARD_DATA_KIND = 'card:data'

const SIG = /^[0-9a-f]{64}$/

export interface CardRecords {
  /** The `visual:website:page` payload on the tile, if any. */
  page?: Record<string, unknown> | null
  /** The `card:data` payload on the tile, if any. */
  card?: Record<string, unknown> | null
}

export type WearPlan =
  | { refuse: 'not-a-template' | 'no-card' }
  | { same: true }
  | { page: Record<string, unknown>; card: Record<string, unknown> }

const sigOf = (v: unknown): string => {
  const s = String(v ?? '').trim().toLowerCase()
  return SIG.test(s) ? s : ''
}

export function planWear(own: CardRecords, template: CardRecords): WearPlan {
  const htmlSig = sigOf(template.page?.['htmlSig'])
  if (!htmlSig) return { refuse: 'not-a-template' }

  const dataSig = sigOf(own.card?.['dataSig']) || sigOf(template.card?.['dataSig'])
  if (!dataSig) return { refuse: 'no-card' }

  const themeSig = sigOf(template.card?.['themeSig'])
  const artSig = sigOf(own.card?.['artSig']) || sigOf(template.card?.['artSig'])

  const page: Record<string, unknown> = { ...(own.page ?? template.page ?? {}), htmlSig }
  const card: Record<string, unknown> = { ...(own.card ?? {}), dataSig }
  if (themeSig) card['themeSig'] = themeSig
  else delete card['themeSig']
  if (artSig) card['artSig'] = artSig
  else delete card['artSig']

  if (sigOf(own.page?.['htmlSig']) === htmlSig && sigOf(own.card?.['dataSig']) === dataSig
    && sigOf(own.card?.['themeSig']) === themeSig && sigOf(own.card?.['artSig']) === artSig) {
    return { same: true }
  }
  return { page, card }
}

export interface CardArgs {
  /** The tile the word acts on, relative to where the participant stands ('' = here). */
  target: string
  /** 'wear' or '' (report what the tile wears). */
  verb: '' | 'wear'
  /** The template's route: relative to where the participant stands, or from the hive root with a leading '/'. */
  template: string
}

/** `card` · `card <tile>` · `card wear <template>` · `card <tile> wear <template>`. */
export function parseCardArgs(raw: string): CardArgs | { error: 'unknown' } {
  const words = raw.trim().split(/\s+/).filter(Boolean)
  const at = words.findIndex(w => w.toLowerCase() === 'wear')
  if (at < 0) {
    if (words.length > 1) return { error: 'unknown' }
    return { target: words[0] ?? '', verb: '', template: '' }
  }
  if (at > 1 || words.length > at + 2) return { error: 'unknown' }
  return { target: at === 1 ? words[0] : '', verb: 'wear', template: words[at + 1] ?? '' }
}

/** A route typed on the command line, as segments: from the root with a leading '/', else from `here`. */
export function routeFrom(here: readonly string[], typed: string): string[] {
  const parts = typed.split('/').map(s => s.trim()).filter(Boolean)
  return typed.trim().startsWith('/') ? parts : [...here, ...parts]
}
