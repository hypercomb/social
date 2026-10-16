// commands/use.queen.ts
//
// `use <name>` — turn a saved root back on as your root.
//
//   use summer          → summer's tiles are the root again
//   use                 → lists the roots you can turn on
//
// jwize, 2026-10-13: "your home page is your root. Saving as lets you create a
// new entrance, save it, and turn it on as your current root at any time." The
// root you leave goes back under the name it came from; an unnamed root with
// tiles on it is refused — "save as <name> first" — so nothing is ever lost.
// The model and the record: history/saved-roots.ts.
//
// LINE START ONLY. `use` is a sub-word of `harness use <name>`, and the
// command line runs every behaviour word on a line — so `use` never lights
// mid-line (lineStart). It is listed in autocomplete; typed at the start of a
// line it runs.

import { EffectBus, get, I18N_IOC_KEY, QueenBee, type I18nProvider } from '@hypercomb/core'
import type { HistoryService } from '../history/history.service.js'
import {
  afterUse, fileUnder, holdsTiles, readRootHead, readSavedHead, savedRoots, savedWordOf, setRoot, withLiveSnapshots,
  type RootHistory,
} from '../history/saved-roots.js'

const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const COMMITTER_KEY = '@diamondcoreprocessor.com/LayerCommitter'
const CURSOR_KEY = '@diamondcoreprocessor.com/HistoryCursorService'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const PORTALS_KEY = '@hypercomb.social/RecentPortalsStore'

export class UseQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'use'
  override rawArgs = true
  /** Listed in autocomplete; runs only as the first word of a line. */
  readonly lineStart = true
  override description = 'Use <name> — turn a saved root back on as your root'
  override descriptionKey = 'slash.use'
  override options = ['<name>']
  override examples = [
    { input: 'use summer', result: 'The root saved as “summer” is your root again; the one you leave goes back under its name' },
    { input: 'use', result: 'Lists the roots you can turn on' },
  ]

  protected async execute(args: string): Promise<void> {
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    const t = (key: string, fallback: string, params?: Record<string, unknown>): string =>
      i18n?.t(key, params as never) ?? fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`))

    const roots = savedRoots()
    await roots.ready()
    const record = roots.record
    const name = String(args ?? '').trim()

    if (!name) {
      if (record.saved.length === 0) return this.#say(t('use.none', 'No saved roots yet — save as <name> files this root under a name.'))
      for (const word of record.saved) EffectBus.emit('activity:log', { message: word === record.active ? `${word} ◆ ${t('use.current', 'your root now')}` : word, icon: '◆' })
      return this.#say(t('use.pick', 'Run use <name> — your saved roots are in the activity log.'))
    }

    const word = savedWordOf(name)
    if (!roots.isSaved(word)) return this.#say(t('use.unknown', 'No saved root named “{name}” — save as <name> files one.', { name: word }))
    if (record.active === word) return this.#say(t('use.already', '“{name}” is already your root.', { name: word }))

    const history = get<HistoryService>(HISTORY_KEY) as unknown as RootHistory | undefined
    if (!history) return this.#say(t('save.refused.unready', 'The hive is not ready yet — try again in a moment.'))
    if (get<{ state?: { rewound?: boolean } }>(CURSOR_KEY)?.state?.rewound || history.previewActive) {
      return this.#say(t('save.refused.rewound', 'You’re looking at the past — step forward to now first.'))
    }
    await get<{ settled?: () => Promise<void> }>(COMMITTER_KEY)?.settled?.()

    const head = await readRootHead(history)
    const target = await readSavedHead(history, word)
    if (!head || !target || !holdsTiles(target.layer)) {
      return this.#say(t('use.unreadable', 'The root saved as “{name}” can’t be read here yet — try again in a moment.', { name: word }))
    }
    // The root you leave: back under its own name, or — with no name and tiles
    // on it — refused, so turning a root on can never lose one.
    if (!record.active && holdsTiles(head.layer)) {
      return this.#say(t('use.unnamed', 'This root has tiles and no name — save as <name> first, then use {name}.', { name: word }))
    }

    roots.write(afterUse(record, word))
    try {
      if (record.active) await fileUnder(history, record.active, head)
      await setRoot(history, head, withLiveSnapshots(target.layer, head.layer))
    } catch (error) {
      roots.write(record)
      console.warn('[use] the root was not switched', error)
      return this.#say(t('use.failed', 'The root could not be switched — nothing changed. Try again.'))
    }

    const portals = get<{ home?: unknown; unpin?: () => void }>(PORTALS_KEY)
    if (portals?.home && portals.unpin) portals.unpin()
    const lineage = get<{ explorerSegments?: () => readonly string[]; showDomainRoot?: () => void }>(LINEAGE_KEY)
    EffectBus.emit('fs:changed', { segments: [] })
    if ((lineage?.explorerSegments?.() ?? []).length > 0) lineage?.showDomainRoot?.()
    EffectBus.emit('root:used', { word })
    EffectBus.emit('toast:show', {
      type: 'success',
      title: t('use.title', 'Root'),
      message: record.active
        ? t('use.done-from', '“{name}” is your root. “{from}” is saved under its name.', { name: word, from: record.active })
        : t('use.done', '“{name}” is your root.', { name: word }),
    })
  }

  #say(message: string): void {
    EffectBus.emit('toast:show', { type: 'info', title: 'use', message })
  }
}

const _use = new UseQueenBee()
window.ioc.register('@diamondcoreprocessor.com/UseQueenBee', _use)
