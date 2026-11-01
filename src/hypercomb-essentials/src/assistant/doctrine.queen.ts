// assistant/doctrine.queen.ts
//
// THE PARTICIPANT'S DOCTRINE. The rules every model is sent first, and that
// Jev judges every change against, are a hive artifact (anatomy/doctrine.ts).
// A model may PROPOSE a section through the write fence, always reviewed; these
// words are the participant's own and no model can say them — this queen
// declares no machine grammar on purpose:
//
//   doctrine              the viewer: choose which rules the anatomy carries
//   doctrine list         the sections the anatomy carries now, numbered
//   doctrine tiles        the codex laid out as tiles on this page, to browse
//   doctrine back         the doctrine the last change replaced, again
//   doctrine drop <n>     the doctrine without section n
//   doctrine seed         the doctrine this build ships, as the head
//
// Every act is a forward commit: a new record and a new marker in the
// `system:doctrine` bag. Nothing is removed, and `doctrine back` undoes any
// of them. A change applies from the next message.

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { ANATOMY_IOC_KEY, type AnatomyLike } from './anatomy/anatomy.service.js'
import type { DoctrineOutcome } from './anatomy/doctrine.js'

export class DoctrineQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'doctrine'
  override description = 'See, step back, drop or reseed the rules every model is sent'
  override descriptionKey = 'slash.doctrine'
  override options = ['list', 'tiles', 'back', 'drop <n>', 'seed']
  override examples = [
    { input: '/doctrine', result: 'Opens the doctrine viewer: choose which rules every model is sent' },
    { input: '/doctrine list', result: 'Lists the doctrine sections, numbered' },
    { input: '/doctrine tiles', result: 'Lays the rules out as tiles on this page, one tile per tier and per rule' },
    { input: '/doctrine back', result: 'Puts back the doctrine the last change replaced' },
  ]

  override slashComplete(args: string): readonly string[] {
    const typed = args.trim().toLowerCase()
    return ['list', 'tiles', 'back', 'drop ', 'seed'].filter(word => word.startsWith(typed) && word.trim() !== typed)
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
    await doctrine.ready

    const done = (outcome: DoctrineOutcome, success: string): void => {
      if (!outcome.ok) { toast(outcome.error, 'error'); return }
      toast(t('doctrine.changed', '{what} The doctrine has {count} sections; it applies from the next message.', { what: success, count: outcome.state.sections.length }), 'success')
    }

    const [word = '', ...rest] = args.trim().split(/\s+/).filter(Boolean)
    if (!word) { EffectBus.emit('doctrine:open', {}); return }
    if (word === 'list') {
      const listed = doctrine.sections().map(section => `${section.index} ${section.heading || '(no heading)'}`).join(' · ')
      const pending = doctrine.seedPending() ? ` ${t('doctrine.pending', 'This build ships newer doctrine: say doctrine seed to take it.')}` : ''
      toast(`${t('doctrine.list', 'Doctrine:')} ${listed}${pending}`)
      return
    }
    if (word === 'tiles') {
      const [{ makeDoctrineTiles }, { ANATOMY_CODEX }, { parseCodex }] = await Promise.all([
        import('./doctrine-tiles.js'), import('./anatomy/anatomy.generated.js'), import('./anatomy/codex.js'),
      ])
      toast(t('doctrine.tiling', 'Laying the doctrine out as tiles…'))
      const outcome = await makeDoctrineTiles(parseCodex(ANATOMY_CODEX))
      if (!outcome.ok) { toast(outcome.error, 'error'); return }
      toast(t('doctrine.tiled', 'The doctrine is on this page as the tile doctrine: {made} rules added, {kept} already there.', { made: outcome.made, kept: outcome.kept }), 'success')
      return
    }
    if (word === 'back') return done(await doctrine.back(), t('doctrine.backed', 'Stepped back.'))
    if (word === 'seed') return done(await doctrine.seed(), t('doctrine.seeded', 'Took the build\'s doctrine.'))
    if (word === 'drop') {
      const index = Number(rest[0])
      return done(await doctrine.drop(index), t('doctrine.dropped', 'Dropped section {index}; doctrine back puts it back.', { index: rest[0] ?? '' }))
    }
    toast(t('doctrine.usage', '/doctrine takes list, tiles, back, drop <n> or seed; alone it opens the viewer.'), 'warning')
  }
}


// THE VIEWER ARRIVES WITH ITS FIRST OPEN, not at boot (atomic-modules-plan.md,
// "adopt the proper load"): nothing needs its code until `/doctrine` asks, so it
// loads then, once. The view subscribes to `doctrine:open` as it is made and the
// bus replays the press that loaded it, so the first press opens it like every
// later one. The key is spelled here: importing even a constant from the view
// would keep it on boot.
const DOCTRINE_WINDOW_KEY = '@diamondcoreprocessor.com/DoctrineWindowView'
let doctrineWindow: Promise<void> | null = null
let doctrineBuilt = false
/** Presses heard while the viewer loads. The replay plays only the last, and
 *  every press toggles — so an even count ends closed. */
let doctrinePresses = 0

EffectBus.on('doctrine:open', () => {
  if (doctrineBuilt) return
  doctrinePresses++
  doctrineWindow ??= import('./doctrine-window.view.js').then(({ DoctrineWindowView }) => {
    // BUILT ONCE, even when making it throws: it subscribes before its replay
    // opens it, so a second one would answer every later press twice.
    doctrineBuilt = true
    try {
      const view = new DoctrineWindowView()
      window.ioc.register(DOCTRINE_WINDOW_KEY, view)
      if (doctrinePresses % 2 === 0) view.close()
    } catch (error) {
      console.error('[doctrine] the viewer could not be made', error)
    }
  }, (error: unknown) => {
    // A failed load says so, and the next press tries again.
    doctrineWindow = null
    doctrinePresses = 0
    EffectBus.emit('activity:log', { message: `Could not load the doctrine viewer: ${error instanceof Error ? error.message : String(error)}` })
  })
})
