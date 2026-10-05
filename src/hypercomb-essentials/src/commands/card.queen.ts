// commands/card.queen.ts
//
// `card` — what a business card wears, and wearing a template.
//
//   card                                         what this tile's card wears
//   card jaime-weise                             what that tile's card wears
//   card wear business-card/template/graphite    this card wears that template
//   card jaime-weise wear /jaime-weise/business-card/template/emerald
//
// Routes are relative to where you stand, or from the hive root with a leading '/'.
// Wearing is two references and never a copy (card-wear.ts): the tile's page becomes the template's
// page, and its card keeps its own details and takes the template's theme. Both writes are ordinary
// decoration commits, so they undo like any other, and a visitor sees the change once the branch is
// published again. Full doctrine: documentation/business-card.md.
//
// No aliases: a behaviour declares none (aliases are the participant's own).
import { QueenBee, EffectBus } from '@hypercomb/core'
import { listDecorations, replaceDecoration } from './decoration-manifest.js'
import { CARD_DATA_KIND, CARD_PAGE_KIND, planWear, parseCardArgs, routeFrom, type CardRecords } from './card-wear.js'

type LineageLike = { explorerSegments?: () => readonly string[] }
type StoreLike = { getResource?: (sig: string) => Promise<Blob | null> }

const SIG = /^[0-9a-f]{64}$/

async function recordsAt(segments: readonly string[]): Promise<CardRecords> {
  const [page] = await listDecorations<Record<string, unknown>>({ kind: CARD_PAGE_KIND, segments })
  const [card] = await listDecorations<Record<string, unknown>>({ kind: CARD_DATA_KIND, segments })
  return { page: page?.record?.payload ?? null, card: card?.record?.payload ?? null }
}

/** The theme's own name, from its JSON — Honeycomb Edge when the card names none. */
async function themeLabel(card: Record<string, unknown> | null | undefined): Promise<string> {
  const sig = String(card?.['themeSig'] ?? '')
  if (!SIG.test(sig)) return 'Honeycomb Edge'
  try {
    const blob = await window.ioc.get<StoreLike>('@hypercomb.social/Store')?.getResource?.(sig)
    const label = blob ? (JSON.parse(await blob.text()) as { label?: unknown }).label : ''
    return typeof label === 'string' && label.trim() ? label.trim() : 'its own theme'
  } catch { return 'its own theme' }
}

const say = (message: string, type: 'info' | 'error' = 'info'): void => {
  EffectBus.emit('activity:log', { message, icon: '▣' })
  EffectBus.emit('toast:show', { type, message })
}

export class CardQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'card'
  override description = 'What a business card wears, and wearing a card template'
  override descriptionKey = 'slash.card'
  override options = ['<tile>', 'wear <template>', '<tile> wear <template>']
  override examples = [
    { input: '/card', result: 'Says which template and theme this card wears' },
    { input: '/card wear business-card/template/graphite', result: 'This card wears the Graphite template' },
    { input: '/card jaime-weise wear /jaime-weise/business-card/template', result: 'jaime-weise wears the template' },
  ]

  // a template's route may contain a behaviour word (`template` is one) — the whole line is this word's
  override rawArgs = true

  protected async execute(args: string): Promise<void> {
    const parsed = parseCardArgs(args)
    if ('error' in parsed) { say('card: say "card", "card <tile>", or "card wear <template>"', 'error'); return }

    const here = (window.ioc.get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    const target = parsed.target ? routeFrom(here, parsed.target) : here
    const name = target[target.length - 1] ?? '/'
    if (target.length === 0) { say('card: stand on a card\'s tile, or name one', 'error'); return }

    const own = await recordsAt(target)

    if (!parsed.verb) {
      if (!own.page && !own.card) { say(`"${name}" has no card`); return }
      say(`"${name}" wears ${await themeLabel(own.card)}${own.page ? '' : ' (no card page)'}`)
      return
    }

    if (!parsed.template) { say('card wear: say which template — card wear <template>', 'error'); return }
    const templateRoute = routeFrom(here, parsed.template)
    const plan = planWear(own, await recordsAt(templateRoute))
    const shown = templateRoute.join('/')

    if ('refuse' in plan) {
      say(plan.refuse === 'not-a-template'
        ? `card wear: "${shown}" has no card page — it is not a card template`
        : `card wear: neither "${name}" nor "${shown}" has a card to wear it with`, 'error')
      return
    }
    if ('same' in plan) { say(`"${name}" already wears ${await themeLabel(own.card)}`); return }

    // The card first, then the page: a page that remounts on the new record reads the new card.
    await replaceDecoration({ kind: CARD_DATA_KIND, appliesTo: target, segments: target, payload: plan.card, mark: 'persistent' })
    await replaceDecoration({ kind: CARD_PAGE_KIND, appliesTo: target, segments: target, payload: plan.page, mark: 'persistent' })

    // A page already mounted on this tile reads its card again (the page stays mounted when only the
    // theme changed, because its own signature did not).
    window.dispatchEvent(new CustomEvent('hypercomb-card', { detail: { type: 'hypercomb-card:wear', segments: [...target] } }))
    say(`"${name}" now wears ${await themeLabel(plan.card)} — publish to show visitors`)
  }
}

const _card = new CardQueenBee()
window.ioc.register('@diamondcoreprocessor.com/CardQueenBee', _card)
