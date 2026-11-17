// assistant/doctrine.queen.ts
//
// THE PARTICIPANT'S DOCTRINE. The rules every model is sent first, and that
// Jev judges every change against, are a hierarchy of tiles at the hive's root
// (anatomy/doctrine-tree.ts): the `doctrine` tile, a tile per tier, a tile per
// rule. A rule changes by editing its tile's note, leaves by removing its
// tile (a hide lasts only the session), and comes back by the tile's history.
// A hive gets its doctrine by adopting a host's `doctrine` branch, or by these
// words:
//
//   doctrine          open the doctrine page (first in the docs browser):
//                     what the doctrine tiles hold now, or why there is none
//   doctrine tiles    lay the build's copy out as the doctrine tiles, at the root
//
// These words are the participant's own and no model can say them — this
// queen declares no machine grammar on purpose. RETIRED 2026-11-16 (tiles
// only): `doctrine list`, `back`, `drop <n>`, `seed` and the doctrine window.

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { ANATOMY_IOC_KEY, type AnatomyLike } from './anatomy/anatomy.service.js'

export class DoctrineQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'doctrine'
  override description = 'Read the doctrine every model is taught, or lay its tiles out'
  override descriptionKey = 'slash.doctrine'
  override options = ['tiles']
  override examples = [
    { input: '/doctrine', result: 'Opens the doctrine page: every tier and rule the doctrine tiles hold, exactly what every model is taught' },
    { input: '/doctrine tiles', result: 'Lays the build\'s copy of the doctrine out at the root, one tile per tier and per rule' },
  ]

  override slashComplete(args: string): readonly string[] {
    const typed = args.trim().toLowerCase()
    return ['tiles'].filter(word => word.startsWith(typed) && word !== typed)
  }

  protected async execute(args: string): Promise<void> {
    const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
    const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
      const value = i18n?.t?.(key, params)
      return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
    }
    const toast = (message: string, type = 'info'): void => { EffectBus.emit('toast:show', { type, message }) }
    const doctrine = (window.ioc?.get?.(ANATOMY_IOC_KEY) as AnatomyLike | undefined)?.doctrine
    if (!doctrine) { toast(t('doctrine.unavailable', 'The doctrine is not available here.'), 'warning'); return }

    const word = args.trim().toLowerCase()
    if (!word) {
      await doctrine.ready
      const status = doctrine.status()
      if (status.kind === 'read') toast(t('doctrine.status', 'Every model is taught the doctrine tiles: {tiers} tiers, {rules} rules.', { tiers: status.tiers, rules: status.rules }))
      else if (status.kind === 'broken') toast(t('doctrine.broken', 'The doctrine tiles do not hold, so no model is taught them: {problems}.', { problems: status.problems.join('; ') }), 'error')
      else toast(t('doctrine.absent', 'This hive has no doctrine: adopt a host\'s doctrine branch, or say doctrine tiles at the root to lay out the build\'s copy.'), 'warning')
      // The page, in the docs browser beside the documentation: the doctrine
      // read, written out (anatomy/doctrine-page.ts). Transient: a surface
      // that mounts later must not open it again.
      EffectBus.emitTransient('docs:open', { page: 'doctrine' })
      return
    }
    if (word === 'tiles') {
      const [{ makeDoctrineTiles }, { ANATOMY_CODEX }, { parseCodex }] = await Promise.all([
        import('./doctrine-tiles.js'), import('./anatomy/anatomy.generated.js'), import('./anatomy/codex.js'),
      ])
      toast(t('doctrine.tiling', 'Laying the doctrine out as tiles…'))
      const outcome = await makeDoctrineTiles(parseCodex(ANATOMY_CODEX))
      if (!outcome.ok) { toast(outcome.error, 'error'); return }
      toast(t('doctrine.tiled', 'The doctrine is the tile doctrine: {made} lines added, {kept} already there. It applies from the next message.', { made: outcome.made, kept: outcome.kept }), 'success')
      return
    }
    toast(t('doctrine.usage', '/doctrine alone opens the doctrine page; /doctrine tiles lays it out.'), 'warning')
  }
}
