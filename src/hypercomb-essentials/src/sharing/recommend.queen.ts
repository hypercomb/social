// sharing/recommend.queen.ts
//
// `recommend` — leave a word on a linked creation (jwize, 2026-10-15: "we can
// add other recommendations"). A recommendation is a PHEROMONE: an authored,
// signed interest signal deposited on the creation's head signature
// (documentation/pheromones.md). It travels with the content; a reader whose
// own interests match the word sees it beside the link, nobody else does.
// It never labels what the creation IS — it says what someone found it for.
//
//   recommend business-card cigars            one of ours, by name
//   recommend card.pointblanksolutions.ca consulting
//
// The last word of the sentence is the deposit; everything before it names
// the creation, as `raise` reads it. The link control says this word on a
// click, asking for the word first.

import { EffectBus, get, QueenBee, type MachineGrammar } from '@hypercomb/core'
import { readLinkHead, resolveLink, splitLastWord } from './link-acts.js'
import { mintDeposit } from '../pheromones/pheromone-deposits.js'
import { latestByLineageKey } from './publish-heads.js'

export class RecommendQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'recommend'
  override description = 'Leave a word on a linked creation: a signed pheromone on its head, shown to readers whose interests match the word'
  override descriptionKey = 'slash.recommend'
  override options = ['<name> <word>', '<address> <word>']
  override examples = [
    { input: '/recommend business-card cigars', result: 'The word "cigars" is deposited on that creation\'s head, signed by you' },
  ]
  override rawArgs = true
  override machine: MachineGrammar = {
    forms: 'recommend <name> <word> | recommend <address> <word>',
    example: 'recommend business-card cigars',
    reach: 'additive',
    scope: 'hive',
  }

  protected async execute(args: string): Promise<void> {
    const { head: what, last: word } = splitLastWord(args)
    if (!what || !word) { this.#say(this.#t('recommend.usage', 'Recommend: say which and the word, for example "recommend business-card cigars"')); return }

    const link = await resolveLink(what)
    if (link.kind === 'none') { this.#say(this.#t('recommend.none', 'Recommend: nothing published is called "{what}"', { what })); return }

    let target = ''
    let label = what
    if (link.kind === 'own') {
      const entry = (await latestByLineageKey().catch(() => new Map())).get(link.door.lineageKey)
      target = String(entry?.sealed ?? '')
      label = link.door.name
      if (!target) {
        const read = await readLinkHead(link.door.address)
        if ('error' in read) { this.#say(this.#t('recommend.no-head', 'Recommend: {name} has no published head to deposit on ({error})', { name: link.door.name, error: read.error })); return }
        target = read.head
      }
    } else {
      const read = await readLinkHead(link.address)
      if ('error' in read) { this.#say(this.#t('recommend.unread', 'Recommend: {address} could not be read ({error})', { address: link.address, error: read.error })); return }
      target = read.head
      label = read.title || link.address
    }

    const minted = await mintDeposit(target, word)
    if (!minted.ok) { this.#say(this.#t('recommend.refused', 'Recommend: the deposit was refused ({reason})', { reason: minted.reason })); return }
    this.#say(this.#t('recommend.left', 'Recommend: "{word}" left on {label}, signed by you', { word, label }))
    EffectBus.emit('toast:show', { type: 'success', message: this.#t('recommend.toast', '"{word}" left on {label}', { word, label }) })
  }

  /** Localized text; `t()` hands the key back when it has none. */
  #t(key: string, fallback: string, params?: Record<string, unknown>): string {
    const i18n = get<{ t(k: string, p?: Record<string, unknown>): string }>('@hypercomb.social/I18n')
    const text = i18n?.t?.(key, params)
    if (text && text !== key) return text
    return fallback.replace(/\{(\w+)\}/g, (all, token: string) => params && token in params ? String(params[token]) : all)
  }

  #say(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '✦' })
  }
}

const _recommend = new RecommendQueenBee()
window.ioc.register('@diamondcoreprocessor.com/RecommendQueenBee', _recommend)
