// commands/save.queen.ts
//
// `save as <name>` — file this root under <name> and stand on an empty root.
//
//   save as summer      → the root's tiles are filed under "summer"; the root is empty
//   use summer          → (use.queen.ts) turns it back on as the root
//
// jwize, 2026-10-10: "no new hive functionality just save as then you are on an
// empty slate". The model, the record and the guards: history/saved-roots.ts.
//
// LINE START ONLY. `save` is a sub-word of `layout save`, `template save` and
// `website save`, and the command line runs every behaviour word on a line —
// so `save` never lights mid-line (lineStart). It is listed in autocomplete,
// and typed at the start of a line it runs, in either stance. Everything after
// the word is this queen's, verbatim (rawArgs).

import { EffectBus, get, I18N_IOC_KEY, QueenBee, isReservedPoolWord, validatePoolSpelling, type I18nProvider } from '@hypercomb/core'
import type { HistoryService } from '../history/history.service.js'
import {
  afterSaveAs, fileUnder, holdsTiles, isBehaviourWord, readRootHead, savedRoots, savedWordOf, setRoot, slateFrom, wordIsTaken,
  type RootHistory,
} from '../history/saved-roots.js'

const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const COMMITTER_KEY = '@diamondcoreprocessor.com/LayerCommitter'
const CURSOR_KEY = '@diamondcoreprocessor.com/HistoryCursorService'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const PORTALS_KEY = '@hypercomb.social/RecentPortalsStore'

export class SaveQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'save'
  override rawArgs = true
  /** Listed in autocomplete; runs only as the first word of a line. */
  readonly lineStart = true
  override description = 'Save as <name> — file this root under a name and start on an empty root'
  override descriptionKey = 'slash.save'
  override options = ['as <name>']
  override examples = [
    { input: 'save as summer', result: 'The root’s tiles are filed under “summer” and the root is empty — use summer turns it back on' },
  ]

  protected async execute(args: string): Promise<void> {
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    const t = (key: string, fallback: string, params?: Record<string, unknown>): string =>
      i18n?.t(key, params as never) ?? fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`))

    const said = /^\s*as\s+(.+?)\s*$/i.exec(String(args ?? ''))
    if (!said) return this.#refuse(t('save.usage', 'Say save as <name> — it files this root under <name> and leaves you an empty root.'))
    const word = savedWordOf(said[1])
    if (!word || word.includes('/') || !validatePoolSpelling(word).ok || word.includes(':')) {
      return this.#refuse(t('save.refused.spelling', 'A saved name is one word (letters, digits, hyphens).'))
    }
    if (isReservedPoolWord(word)) return this.#refuse(t('save.refused.reserved', '“{name}” is a reserved word — it is the address of a system pool. Choose another name.', { name: word }))
    if (isBehaviourWord(word)) return this.#refuse(t('save.refused.behaviour', '“{name}” is a word the command line runs — choose another name.', { name: word }))

    const roots = savedRoots()
    await roots.ready()
    if (roots.isSaved(word)) return this.#refuse(t('save.refused.saved', '“{name}” already holds a saved root — use {name} turns it on.', { name: word }))

    const history = get<HistoryService>(HISTORY_KEY) as unknown as RootHistory | undefined
    if (!history) return this.#refuse(t('save.refused.unready', 'The hive is not ready yet — try again in a moment.'))
    if (get<{ state?: { rewound?: boolean } }>(CURSOR_KEY)?.state?.rewound || history.previewActive) {
      return this.#refuse(t('save.refused.rewound', 'You’re looking at the past — step forward to now first.'))
    }
    await get<{ settled?: () => Promise<void> }>(COMMITTER_KEY)?.settled?.()

    const head = await readRootHead(history)
    if (!head || !holdsTiles(head.layer)) return this.#refuse(t('save.refused.empty', 'The root is already empty — nothing to save.'))
    if (await wordIsTaken(history, word, head.sig)) {
      return this.#refuse(t('save.refused.in-use', '“{name}” is already a tile in this hive — saving under it would join the two. Choose another name.', { name: word }))
    }

    // RECORD FIRST: the naming gestures and prune key off it. A failed move
    // puts the record back, so nothing claims a root that was never filed.
    const before = roots.record
    roots.write(afterSaveAs(before, word))
    try {
      if (before.active) await fileUnder(history, before.active, head)
      await fileUnder(history, word, head)
      await setRoot(history, head, slateFrom(head.layer))
    } catch (error) {
      roots.write(before)
      console.warn('[save] the root was not filed', error)
      return this.#refuse(t('save.refused.failed', 'The root could not be filed — nothing changed. Try again.'))
    }

    // The root's history marks the place it was filed from.
    if (head.marker) {
      await (history as unknown as HistoryService).setMarkerMeta?.(head.location, head.marker, { label: `saved as ${word}`, marked: true })?.catch?.(() => {})
    }
    const released = this.#releaseHome()
    this.#repaint()
    EffectBus.emit('root:saved', { word })
    EffectBus.emit('toast:show', {
      type: 'success',
      title: t('save.title', 'Saved'),
      message: t('save.done', 'Saved as {name}. The root is empty — use {name} turns it back on.', { name: word })
        + (released ? ' ' + t('save.home-released', 'Home released.') : ''),
    })
  }

  /** A pinned Home would keep showing a portal at '/' instead of the empty
   *  root — the save releases it, and says so. */
  #releaseHome(): boolean {
    const portals = get<{ home?: unknown; unpin?: () => void }>(PORTALS_KEY)
    if (!portals?.home || !portals.unpin) return false
    portals.unpin()
    return true
  }

  #repaint(): void {
    const lineage = get<{ explorerSegments?: () => readonly string[]; showDomainRoot?: () => void }>(LINEAGE_KEY)
    EffectBus.emit('fs:changed', { segments: [] })
    if ((lineage?.explorerSegments?.() ?? []).length > 0) lineage?.showDomainRoot?.()
  }

  #refuse(message: string): void {
    EffectBus.emit('toast:show', { type: 'info', title: 'save as', message })
  }
}

const _save = new SaveQueenBee()
window.ioc.register('@diamondcoreprocessor.com/SaveQueenBee', _save)
