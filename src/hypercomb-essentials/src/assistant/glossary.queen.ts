// assistant/glossary.queen.ts
//
// THE GLOSSARY, SAID. Hypercomb's terms answered at once, from the hive, with
// no model asked (documentation/glossary-tiles.md):
//
//   glossary              how many terms there are, and how to ask
//   glossary <term>       the term's definition: from its tile when one stands
//                         on this page or above it, else from the glossary
//                         this build ships
//   glossary tiles        the glossary laid out as tiles on this page, one
//                         tile per section and one per term, to browse and
//                         to answer from
//
// Everything after the word is the term (rawArgs): a term may be a behaviour
// word of its own (`hive`, `clipboard`), and it must not run as one. These
// words are the participant's own: laying tiles is a write, so this queen
// declares no machine grammar and no model can say them.

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { glossarySlug, parseGlossary, type GlossarySection } from './glossary.js'

/** One note on its line; past this, cut and said so. */
const NOTE_CHARS = 2_000

export class GlossaryQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  readonly command = 'glossary'
  override description = 'Answer a Hypercomb term at once from its glossary tile, or lay the glossary out as tiles'
  override descriptionKey = 'slash.glossary'
  override options = ['<term>', 'tiles']
  override examples = [
    { input: '/glossary sigbag', result: 'Says what a history bag (sigbag) is, from its glossary tile, with no model asked' },
    { input: '/glossary tiles', result: 'Lays the glossary out as tiles on this page, one tile per section and per term' },
  ]
  override rawArgs = true

  #sections: Promise<readonly GlossarySection[]> | null = null
  #words: readonly string[] = []

  override slashComplete(args: string): readonly string[] {
    void this.#glossary()
    const typed = args.trim().toLowerCase()
    return ['tiles', ...this.#words].filter(word => word.startsWith(typed) && word !== typed)
  }

  protected async execute(args: string): Promise<void> {
    const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
    const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
      const value = i18n?.t?.(key, params)
      return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
    }
    const toast = (message: string, type = 'info'): void => { EffectBus.emit('toast:show', { type, message }) }
    const say = (message: string): void => { EffectBus.emit('activity:log', { message, icon: '📖' }) }

    const sections = await this.#glossary()
    const asked = args.trim()

    if (!asked) {
      const count = sections.reduce((sum, section) => sum + section.terms.length, 0)
      toast(t('glossary.usage', 'The glossary has {count} terms: say glossary <term> to have one answered, or glossary tiles to lay them out as tiles on this page.', { count }))
      return
    }

    if (asked.toLowerCase() === 'tiles') {
      const { makeGlossaryTiles } = await import('./glossary-tiles.js')
      toast(t('glossary.tiling', 'Laying the glossary out as tiles…'))
      const outcome = await makeGlossaryTiles(sections)
      if (outcome.ok) {
        toast(t('glossary.tiled', 'The glossary is on this page as the tile glossary: {made} notes added, {kept} already there.', { made: outcome.made, kept: outcome.kept }), 'success')
      } else if (outcome.reason === 'unloaded') {
        toast(t('glossary.unloaded', 'The notes are not loaded yet; say glossary tiles again in a moment.'), 'warning')
      } else if (outcome.reason === 'rewound') {
        toast(t('glossary.rewound', 'You are viewing the past, so nothing can be written; step forward, then say glossary tiles again.'), 'error')
      } else if (outcome.reason === 'refused') {
        toast(t('glossary.refused', 'The tile {path} could not be made ({detail}).', { path: outcome.path, detail: outcome.detail }), 'error')
      } else {
        toast(t('glossary.unnoted', 'The note on {path} could not be written ({detail}).', { path: outcome.path, detail: outcome.detail }), 'error')
      }
      return
    }

    const { answerGlossary } = await import('./glossary-tiles.js')
    const reply = await answerGlossary(sections, asked)
    if (!reply.answers.length) {
      say(reply.near.length
        ? t('glossary.near', 'No term is named "{asked}"; the terms that hold it: {terms}.', { asked, terms: reply.near.join(', ') })
        : t('glossary.none', 'No term in the glossary is named "{asked}" or holds it.', { asked }))
      return
    }
    for (const answer of reply.answers) {
      for (const note of answer.notes) {
        const text = note.replace(/\s*\n\s*/g, ' / ')
        say(text.length > NOTE_CHARS ? `${text.slice(0, NOTE_CHARS)}… (${text.length})` : text)
      }
      say(answer.from === 'tile'
        ? t('glossary.from-tile', 'From the tile /{route}.', { route: (answer.at ?? []).join('/') })
        : t('glossary.from-build', 'From the glossary this build ships: no glossary tile stands on this page or above it. Say glossary tiles to lay it out.'))
    }
  }

  /** The glossary, read once, when the word is first used or completed. */
  #glossary(): Promise<readonly GlossarySection[]> {
    return this.#sections ??= import('./glossary.generated.js').then(({ GLOSSARY_SOURCE }) => {
      const sections = parseGlossary(GLOSSARY_SOURCE)
      const head = (term: string): string => glossarySlug(term.replace(/\([^)]*\)/g, ' ')).replace(/-/g, ' ')
      this.#words = [...new Set(sections.flatMap(section => section.terms.map(term => head(term.term))))]
      return sections
    }, error => { this.#sections = null; throw error })
  }
}

const _glossary = new GlossaryQueenBee()
window.ioc.register('@diamondcoreprocessor.com/GlossaryQueenBee', _glossary)
