// assistant/doctrine.queen.ts
//
// THE PARTICIPANT'S DOCTRINE. The rules every model is sent first, and that
// Jev judges every change against, are a hive artifact (anatomy/doctrine.ts).
// A model may PROPOSE a section through the write fence, always reviewed; these
// words are the participant's own and no model can say them — this queen
// declares no machine grammar on purpose:
//
//   doctrine              the sections the anatomy carries now, numbered
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
  override options = ['back', 'drop <n>', 'seed']
  override examples = [
    { input: '/doctrine', result: 'Lists the doctrine sections, numbered' },
    { input: '/doctrine back', result: 'Puts back the doctrine the last change replaced' },
  ]

  override slashComplete(args: string): readonly string[] {
    const typed = args.trim().toLowerCase()
    return ['back', 'drop ', 'seed'].filter(word => word.startsWith(typed) && word.trim() !== typed)
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
    if (!word || word === 'list') {
      const listed = doctrine.sections().map(section => `${section.index} ${section.heading || '(no heading)'}`).join(' · ')
      const pending = doctrine.seedPending() ? ` ${t('doctrine.pending', 'This build ships newer doctrine: say doctrine seed to take it.')}` : ''
      toast(`${t('doctrine.list', 'Doctrine:')} ${listed}${pending}`)
      return
    }
    if (word === 'back') return done(await doctrine.back(), t('doctrine.backed', 'Stepped back.'))
    if (word === 'seed') return done(await doctrine.seed(), t('doctrine.seeded', 'Took the build\'s doctrine.'))
    if (word === 'drop') {
      const index = Number(rest[0])
      return done(await doctrine.drop(index), t('doctrine.dropped', 'Dropped section {index}; doctrine back puts it back.', { index: rest[0] ?? '' }))
    }
    toast(t('doctrine.usage', '/doctrine takes back, drop <n> or seed; alone it lists the sections.'), 'warning')
  }
}

