// commands/versions.queen.ts
//
// `/versions` — the minimal build's own history, held in this browser.
//
//   /versions               → the revisions this browser holds, newest first,
//                             each with who signed it
//   /versions pull [host]   → take the version pools a host serves (this
//                             origin when none is named), every file verified,
//                             into this browser's storage, kept persistently
//
// The code of the minimal build lives only through replication
// (sharing/version-pools.ts): pulling makes this device a backup of it, with
// nothing on any disk outside the browser.

import { EffectBus, I18N_IOC_KEY, QueenBee, get, type I18nProvider } from '@hypercomb/core'
import { keepPools, pullVersionPools, versionRevisions } from '../sharing/version-pools.js'

const SHOWN = 12

export class VersionsQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'history'
  readonly command = 'versions'
  override description =
    'The minimal build’s own history: pull the version pools from a host into this browser, verified, and list the revisions with who signed them'
  override descriptionKey = 'slash.versions'
  override options = ['pull [host]', 'list']
  override examples = [
    { input: '/versions', result: 'Lists the revisions this browser holds, with their signatures' },
    { input: '/versions pull', result: 'Takes the version pools this origin serves into this browser' },
    { input: '/versions pull jwize.com', result: 'Takes them from another host' },
  ]

  protected override listens = []
  protected override emits = ['toast:show', 'activity:log']

  public override slashComplete(args: string): readonly string[] {
    const q = String(args ?? '').trim().toLowerCase()
    return ['pull', 'list'].filter(option => !q || option.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const [verb = '', host = ''] = String(args ?? '').trim().split(/\s+/)
    if (verb.toLowerCase() === 'pull') return this.#pull(host || location.origin)
    return this.#list()
  }

  async #pull(host: string): Promise<void> {
    const kept = await keepPools()
    this.#activity(this.#t('versions.pulling', 'taking the version pools from {host}…', { host }), '●')
    const report = await pullVersionPools(host)
    if (!report.answered) {
      this.#toast('info', this.#t('versions.none', '{host} serves no version pools.', { host }))
      return
    }
    const parts = [this.#t('versions.taken', '{taken} new file(s) from {host}', { taken: report.taken, host })]
    if (report.refused) parts.push(this.#t('versions.refused', '{refused} refused (not what they are named)', { refused: report.refused }))
    if (!kept) parts.push(this.#t('versions.notkept', 'this browser may clear them when it needs room'))
    this.#toast(report.refused ? 'warning' : 'success', parts.join(' · '))
    await this.#list()
  }

  async #list(): Promise<void> {
    const all = await versionRevisions()
    if (!all.length) {
      this.#toast('info', this.#t('versions.empty', 'This browser holds no revisions yet — /versions pull takes them from a host.'))
      return
    }
    for (const revision of all.slice(0, SHOWN)) {
      const signed = revision.signers.filter(s => s.ok).map(s => s.role)
      const unsigned = revision.signers.some(s => !s.ok)
      this.#activity(`${revision.label} ${revision.version} ${revision.sig.slice(0, 12)} · ${revision.parts.join(' ')}`
        + (signed.length ? ` · signed: ${signed.join(', ')}` : ' · unsigned') + (unsigned ? ' · a signature does not verify' : ''), '◆')
    }
    this.#toast('info', this.#t('versions.listed', '{count} revision(s) held here — the newest in the activity log.', { count: all.length }))
  }

  #t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    const text = i18n?.t(key, params)
    return text && text !== key ? text : fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
  }

  #activity = (message: string, icon: string): void => { EffectBus.emit('activity:log', { message, icon }) }
  #toast = (type: string, message: string): void => { EffectBus.emit('toast:show', { type, title: this.#t('versions.title', 'Versions'), message }) }
}

window.ioc.register('@diamondcoreprocessor.com/VersionsQueenBee', new VersionsQueenBee())
