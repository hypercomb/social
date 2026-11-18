// sharing/public.queen.ts
//
// `public` — the tile you stand on, published AND in the community (jwize 2026-11-18: set from the tile, by a word).
//
//   public             make the tile you stand on public
//   public /a/b        the same, for the tile a route names
//
// Staged on the hosts the tile names (asking your consent when it is on none yet), then switched on in the community of
// each, signed under your key. The counterpart is `private`. The rule and its spec: tile-visibility.ts.

import { EffectBus, QueenBee, get, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { liveVisibilityDeps, makePublic } from './tile-visibility.js'

const t = (key: string, fallback: string, params: Record<string, string> = {}): string => {
  const value = get<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
  return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '')
}

/** The tile a line names: a route said first (`/a/b`), else where you stand. */
export const tileOf = (args: string): string[] => {
  const text = String(args ?? '').trim()
  const said = text.startsWith('/') ? text.split(/\s+/)[0]!.split('/') : get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? []
  return said.map(s => String(s ?? '').trim()).filter(Boolean)
}

export class PublicQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'
  readonly command = 'public'
  override description = 'Make the tile you stand on public — staged on its hosts and on in their community'
  override descriptionKey = 'slash.public'
  override options = ['/<route>']
  override examples = [
    { input: '/public', result: 'The tile you stand on is staged on its hosts and switched on in their community' },
    { input: '/public /recipes/bread', result: 'The same, for the tile that route names' },
  ]

  // A route is exact, never prose.
  override rawArgs = true

  protected async execute(args: string): Promise<void> {
    const segments = tileOf(args)
    if (segments.length === 0) { this.#say(t('public.notile', 'Go into the tile you want to make public first — the hive root is not a tile.'), 'warning'); return }
    const name = segments[segments.length - 1]!
    const result = await makePublic(segments, liveVisibilityDeps())
    if (!result.ok) {
      this.#say(result.reason === 'no-host' ? t('public.nohost', '{name} names no host yet — say: stage on <domain>, then public.', { name })
        : result.reason === 'no-signer' ? t('public.nosigner', 'This place has no signing key.')
        : result.reason === 'not-staged' ? t('public.notstaged', '{name} was not staged, so it is not public.', { name })
        : t('public.notile', 'Go into the tile you want to make public first — the hive root is not a tile.'), 'warning')
      return
    }
    const refused = result.refused.map(r => `${r.zone} (${r.reason})`).join(', ')
    if (result.on.length) this.#say(t('public.done', '{name} is public on {zones}.', { name, zones: result.on.join(', ') }), 'success')
    if (refused) this.#say(t('public.refused', '{name} is not in the community of {zones}.', { name, zones: refused }), 'warning')
  }

  #say(message: string, type = 'info'): void {
    EffectBus.emit('activity:log', { message, icon: '◉' })
    EffectBus.emit('toast:show', { type, message })
  }
}

const _public = new PublicQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PublicQueenBee', _public)
