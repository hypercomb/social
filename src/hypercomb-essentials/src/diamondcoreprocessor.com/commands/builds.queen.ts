// diamondcoreprocessor.com/commands/builds.queen.ts
//
// `/builds` — build revisions for the cell you are standing on.
//
//   /builds                      → list this subtree's build revisions
//   /builds record before-redesign → seal this subtree under that name
//   /builds restore build-3      → that build's tree becomes live again
//
// A build revision is a SCOPED SNAPSHOT (builds-slot.ts): producers mint
// one automatically at the end of a multi-file pass (bridge op
// `build-record`), and this queen gives the participant the same gesture
// by hand plus the way back. Restore is forward-only via the shared
// seal-restore walk — nothing rewinds, nothing is deleted, and the
// `builds` index is carried forward so restoring an old build never
// erases the newer ones from the list.
//
// A restore point is minted FIRST, automatically (same safety as
// /restore): going back is then the same gesture, not N undos. Because
// minting no-ops on an unchanged seal, the safety record costs nothing
// when the subtree is already at a recorded build.

import { EffectBus, get, requestConfirm, I18N_IOC_KEY, QueenBee, type I18nProvider } from '@hypercomb/core'
import { BUILDS_SLOT, mintBuildRecord, readBuildsAt, type BuildRecord } from '../history/builds-slot.js'
import { applySealAt } from '../history/seal-restore.js'

const LINEAGE_KEY = '@hypercomb.social/Lineage'

interface LineageLike { explorerSegments?: () => readonly string[] }

/** Case-insensitive label lookup, newest match wins; `build-N` and bare
 *  indexes (`3`) also resolve so the list output is directly citeable. */
function findBuild(records: readonly BuildRecord[], key: string): BuildRecord | null {
  const want = String(key ?? '').trim().toLowerCase()
  if (!want) return null
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].label.trim().toLowerCase() === want) return records[i]
  }
  const index = Number.parseInt(want.replace(/^build-/, ''), 10)
  if (Number.isFinite(index) && index >= 1 && index <= records.length) return records[index - 1]
  return null
}

export class BuildsQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'history'
  readonly command = 'builds'
  override readonly aliases = ['build']
  override description =
    'Build revisions for this subtree — record the state after a build pass, list them, restore one'
  override descriptionKey = 'slash.builds'
  override options = ['record <name>', 'restore <name>', 'list']
  override examples = [
    { input: '/builds', result: 'Lists this subtree’s build revisions' },
    { input: '/builds record before-redesign', result: 'Seals this subtree under that name' },
    { input: '/builds restore build-3', result: 'That build’s tree becomes live again' },
  ]

  public override slashComplete(args: string): readonly string[] {
    const q = String(args ?? '').trim().toLowerCase()
    const base = ['record', 'restore', 'list']
    const withLabels = q.startsWith('restore')
      ? this.#labels.map(l => `restore ${l}`)
      : base
    return withLabels.filter(o => !q || o.toLowerCase().startsWith(q))
  }

  #labels: string[] = []

  protected async execute(args: string): Promise<void> {
    const trimmed = String(args ?? '').trim()
    const [sub, ...rest] = trimmed.split(/\s+/)
    const remainder = rest.join(' ').trim()

    switch ((sub ?? '').toLowerCase()) {
      case '':
      case 'list':
        return this.#list()
      case 'record':
        return this.#record(remainder)
      case 'restore':
        return this.#restore(remainder)
      default:
        // `/builds <name>` with no verb reads most naturally as a record.
        return this.#record(trimmed)
    }
  }

  #here(): readonly string[] {
    const lineage = get<LineageLike>(LINEAGE_KEY)
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  // ── list ────────────────────────────────────────────────

  async #list(): Promise<void> {
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    const records = await readBuildsAt(this.#here())
    this.#labels = records.map(r => r.label).filter(Boolean)
    if (records.length === 0) {
      this.#toast('info', this.#t(i18n, 'builds.title', 'Builds'),
        this.#t(i18n, 'builds.none',
          'No build revisions here yet — run /builds record <name>, or let a build pass mint one.'))
      return
    }
    for (const r of records) {
      this.#activity(`${r.label} — ${r.seal.slice(0, 8)}`, '◆')
    }
    this.#toast('info', this.#t(i18n, 'builds.title', 'Builds'),
      this.#t(i18n, 'builds.listed', '{count} build revisions — see the activity log.', { count: records.length }))
  }

  // ── record ──────────────────────────────────────────────

  async #record(label: string): Promise<void> {
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    const here = this.#here()
    if (here.length === 0) {
      this.#toast('info', this.#t(i18n, 'builds.title', 'Builds'),
        this.#t(i18n, 'builds.at-root', 'You are at the hive root — /snapshot already covers the whole hive.'))
      return
    }

    const result = await mintBuildRecord(here, label)
    if ('error' in result) {
      this.#toast('error', this.#t(i18n, 'builds.title', 'Builds'), result.error)
      return
    }
    if (result.unchanged) {
      this.#toast('info', this.#t(i18n, 'builds.title', 'Builds'),
        this.#t(i18n, 'builds.unchanged', 'Nothing changed since "{label}" — {seal}',
          { label: result.label, seal: result.seal.slice(0, 8) }))
      return
    }
    this.#toast('success', this.#t(i18n, 'builds.title', 'Builds'),
      this.#t(i18n, 'builds.saved', 'Recorded "{label}" — {seal}',
        { label: result.label, seal: result.seal.slice(0, 8) }))
  }

  // ── restore ─────────────────────────────────────────────

  async #restore(name: string): Promise<void> {
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    const here = this.#here()
    const records = await readBuildsAt(here)
    this.#labels = records.map(r => r.label).filter(Boolean)

    if (records.length === 0) {
      this.#toast('info', this.#t(i18n, 'builds.title', 'Builds'),
        this.#t(i18n, 'builds.none',
          'No build revisions here yet — run /builds record <name>, or let a build pass mint one.'))
      return
    }
    if (!name) {
      for (const r of records) this.#activity(`${r.label} — ${r.seal.slice(0, 8)}`, '◆')
      this.#toast('info', this.#t(i18n, 'builds.title', 'Builds'),
        this.#t(i18n, 'builds.pick', 'Run /builds restore <name> — {count} revisions are in the activity log.',
          { count: records.length }))
      return
    }

    const target = findBuild(records, name)
    if (!target) {
      this.#toast('error', this.#t(i18n, 'builds.title', 'Builds'),
        this.#t(i18n, 'builds.unknown', 'No build revision named “{name}”. Run /builds to see the list.', { name }))
      return
    }

    const confirmed = await requestConfirm({
      title: 'builds.confirm.title',
      message: 'builds.confirm.message',
      messageParams: { name: target.label },
      confirmLabel: 'builds.confirm.go',
      cancelLabel: 'builds.confirm.cancel',
    })
    if (!confirmed) return

    // The way back is one gesture — and free when nothing changed.
    this.#activity(this.#t(i18n, 'builds.marking', 'recording the current state first…'), '●')
    await mintBuildRecord(here, `before restore to "${target.label}"`)

    this.#activity(this.#t(i18n, 'builds.working', 'restoring “{name}”…', { name: target.label }), '●')
    const result = await applySealAt(here, target.seal, [BUILDS_SLOT])

    if (result.failed > 0 && result.changed === 0) {
      this.#toast('error', this.#t(i18n, 'builds.title', 'Builds'),
        this.#t(i18n, 'builds.failed',
          'Nothing could be restored — that build’s layers are not available locally.'))
      return
    }

    this.#repaint(here)
    this.#toast(result.failed === 0 ? 'success' : 'info', this.#t(i18n, 'builds.title', 'Builds'),
      result.failed === 0
        ? this.#t(i18n, 'builds.done', 'Restored “{name}” — {changed} places changed.',
          { name: target.label, changed: result.changed })
        : this.#t(i18n, 'builds.done-partial',
          'Restored “{name}” — {changed} places changed, {failed} could not be resolved.',
          { name: target.label, changed: result.changed, failed: result.failed }))
  }

  // ── helpers ─────────────────────────────────────────────

  /** The subtree and its ancestor chain both moved; signal the build root
   *  and the hive root so every dependent view refreshes. */
  #repaint(here: readonly string[]): void {
    EffectBus.emit('fs:changed', { segments: [] })
    if (here.length > 0) EffectBus.emit('fs:changed', { segments: [...here] })
  }

  #t = (i18n: I18nProvider | undefined, key: string, fallback: string, params?: Record<string, unknown>): string =>
    i18n?.t(key, params as never) ?? fallback

  #activity = (message: string, icon: string): void => {
    EffectBus.emit('activity:log', { message, icon })
  }

  #toast = (type: string, title: string, message: string): void => {
    EffectBus.emit('toast:show', { type, title, message })
  }
}

// ── registration ────────────────────────────────────────

const _builds = new BuildsQueenBee()
window.ioc.register('@diamondcoreprocessor.com/BuildsQueenBee', _builds)
