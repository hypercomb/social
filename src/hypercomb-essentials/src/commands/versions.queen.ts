// commands/versions.queen.ts
//
// `/versions` — the minimal build's own history, held in this browser.
//
//   /versions               → the revisions this browser holds, newest first,
//                             each with who signed it
//   /versions pull [host]   → take the version pools a host serves (this
//                             origin when none is named), every file verified,
//                             into this browser's storage, kept persistently
//   /versions drafts        → the drafts staged here and where each stands:
//                             the hosts of open asks are asked what their
//                             builders said, and a built draft is taken whole
//                             (sharing/version-answers.ts); then each draft
//                             reads staged, asked, lapsed, built, refused or
//                             failed — a builder's why shown as it said it
//   /versions ask <host> [draft]
//                           → sign the ask for a draft (the newest when none is
//                             named) and send it with its files to a host under
//                             this key's grant; a builder there builds it
//
// The code of the minimal build lives only through replication
// (sharing/version-pools.ts): pulling makes this device a backup of it, with
// nothing on any disk outside the browser.

import { EffectBus, I18N_IOC_KEY, QueenBee, get, type I18nProvider } from '@hypercomb/core'
import { keepPools, pullVersionPools, versionRevisions, type Revision } from '../sharing/version-pools.js'
import { askBuild, draftClosure, listDrafts, readRevisionFile, revisionFiles, signerHere, stageDraft } from '../sharing/version-drafts.js'
import { draftStatus, takeAnswers, type DraftStatus } from '../sharing/version-answers.js'

const SHOWN = 12

export class VersionsQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'history'
  readonly command = 'versions'
  override description =
    'The minimal build’s own history: pull the version pools from a host into this browser, verified, and list the revisions with who signed them'
  override descriptionKey = 'slash.versions'
  override options = ['pull [host]', 'list', 'drafts', 'ask <host> [draft]']
  override examples = [
    { input: '/versions', result: 'Lists the revisions this browser holds, with their signatures' },
    { input: '/versions pull', result: 'Takes the version pools this origin serves into this browser' },
    { input: '/versions pull example.com', result: 'Takes them from another host' },
    { input: '/versions drafts', result: 'Asks what builders made of your drafts, and lists where each stands' },
  ]

  protected override listens = []
  protected override emits = ['toast:show', 'activity:log']

  public override slashComplete(args: string): readonly string[] {
    const q = String(args ?? '').trim().toLowerCase()
    return ['pull', 'list', 'drafts', 'ask'].filter(option => !q || option.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const [verb = '', host = '', which = ''] = String(args ?? '').trim().split(/\s+/)
    if (verb.toLowerCase() === 'pull') return this.#pull(host || location.origin)
    if (verb.toLowerCase() === 'drafts') return this.#drafts()
    if (verb.toLowerCase() === 'ask') return this.#ask(host, which)
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

  async #drafts(): Promise<void> {
    const me = await signerHere()?.getPublicKeyHex?.().catch(() => null) ?? null
    if (me) {
      this.#activity(this.#t('versions.answering', 'asking the hosts of open asks what their builders said…'), '●')
      try {
        const report = await takeAnswers()
        for (const host of report.hosts) if (!host.answered) this.#activity(this.#t('versions.unlisted', '{host} did not list its answers', { host: host.host }), '…')
        for (const pending of report.pending) this.#activity(`answer ${pending.answer.slice(0, 12)} not taken: ${pending.why}`, '…')
        if (report.files) this.#activity(this.#t('versions.tookbuilt', '{files} file(s) taken for built drafts', { files: report.files }), '◆')
      } catch (error) {
        this.#activity(this.#t('versions.answersfailed', 'the answers could not be taken just now: {why}', { why: error instanceof Error ? error.message : String(error) }), '…')
      }
    } else {
      this.#activity(this.#t('versions.nokey', 'no key here: what builders answered is listed only to the key that asked'), '…')
    }
    const drafts = await draftStatus(undefined, { me, staged: true })
    if (!drafts.length) {
      this.#toast('info', this.#t('versions.nodrafts', 'No drafts are staged here.'))
      return
    }
    const revisions = drafts.some(d => d.built.length) ? await versionRevisions().catch(() => []) : []
    for (const draft of drafts.slice(0, SHOWN)) this.#activity(`${draft.draft.slice(0, 12)} ${draft.label} · ${draft.paths.join(', ')} · ${stateLine(draft, revisions)}`, STATE_ICONS[draft.state])
    const counts = new Map<string, number>()
    for (const draft of drafts) counts.set(draft.state, (counts.get(draft.state) ?? 0) + 1)
    this.#toast('info', this.#t('versions.drafts', '{count} draft(s): {states}.', { count: drafts.length, states: [...counts].map(([state, n]) => `${n} ${state}`).join(', ') }))
  }

  async #ask(host: string, which: string): Promise<void> {
    if (!host) {
      this.#toast('info', this.#t('versions.askwhere', 'Name the host to send it to: /versions ask <host>.'))
      return
    }
    const drafts = await listDrafts()
    const draft = which ? drafts.find(d => d.sig.startsWith(which.toLowerCase())) : drafts[0]
    if (!draft) {
      this.#toast('info', this.#t('versions.nodraft', 'No such draft is staged here.'))
      return
    }
    const outcome = await askBuild(draft.sig, host)
    if (!outcome.ok) {
      this.#toast('warning', outcome.error)
      return
    }
    this.#activity(`ask ${outcome.ask} for draft ${outcome.draft.slice(0, 12)} — a builder there: builds.mjs build-draft ${host} ${outcome.ask}`, '✉')
    this.#toast('success', this.#t('versions.asked', 'Sent to {host}: {sent} new file(s), {held} already there. The ask is {ask}.',
      { host, sent: outcome.sent, held: outcome.held, ask: outcome.ask.slice(0, 12) }))
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
        + (signed.length ? ` · signed: ${signed.join(', ')}` : ' · unsigned') + (unsigned ? ' · a signature does not verify' : '')
        + (revision.from ? (revision.from.author ? ` · from ${revision.from.author.slice(0, 12)}'s draft` : ' · from a draft whose ask does not verify') : '')
        + (revision.awaitingReview ? ' · awaiting review' : revision.reviewed ? ` · reviewed (${revision.reviewed.slice(0, 12)})` : ''), '◆')
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

const STATE_ICONS: Record<DraftStatus['state'], string> = { staged: '✎', asked: '✉', lapsed: '⌛', built: '◆', refused: '✕', failed: '✕' }

/** Where one draft stands, in one line. A builder's why is quoted: its
 *  words, as it said them. A build a held revision was adopted from reads
 *  adopted. */
const stateLine = (draft: DraftStatus, revisions: readonly Revision[] = []): string => {
  const by = draft.answer ? draft.answer.builder.slice(0, 12) : ''
  switch (draft.state) {
    case 'staged': return 'staged — /versions ask <host> sends it to a builder'
    case 'asked': return `asked at ${draft.ask?.origin ?? '?'} — no builder has answered yet`
    case 'lapsed': return `asked at ${draft.ask?.origin ?? '?'} — no builder answered in time; ask again`
    case 'built': {
      const as = draft.built.map(b => `${b.label} ${b.version} (${b.sig.slice(0, 12)})`).join(', ') || 'a revision not held here'
      const adopted = revisions.filter(r => r.reviewed && draft.built.some(b => b.sig === r.reviewed))
      return `built by ${by} as ${as} — ${adopted.length ? `adopted as ${adopted.map(r => `${r.label} ${r.version}`).join(', ')}` : 'awaiting review'}`
    }
    case 'refused': return `refused by ${by}: “${draft.answer?.why ?? ''}”`
    case 'failed': return `failed at ${by}: “${draft.answer?.why ?? ''}”`
  }
}

window.ioc.register('@diamondcoreprocessor.com/VersionsQueenBee', new VersionsQueenBee())

// THE SAME ACTS, FOR A HAND THAT IS NOT TYPING: the harness (a model acting
// for the participant) reads a revision's files, stages a draft, asks a
// builder and learns what became of it through these, exactly as the words
// above do. `status` reads only what is held here; `answers` asks the hosts.
window.ioc.register('@diamondcoreprocessor.com/VersionDrafts', {
  revisions: () => versionRevisions(),
  pull: (host: string) => pullVersionPools(host),
  files: (revision: string) => revisionFiles(revision),
  read: (revision: string, path: string) => readRevisionFile(revision, path),
  stage: (request: Parameters<typeof stageDraft>[0]) => stageDraft(request),
  closure: (draft: string) => draftClosure(draft),
  drafts: () => listDrafts(),
  ask: (draft: string, host: string) => askBuild(draft, host),
  // Read-only, and asked every /agent turn: the key only if already known —
  // never minted, never a prompt.
  status: async () => draftStatus(undefined, { me: await signerHere()?.knownPublicKeyHex?.().catch(() => null) ?? null }),
  answers: (hosts?: readonly string[]) => takeAnswers({ hosts }),
})
