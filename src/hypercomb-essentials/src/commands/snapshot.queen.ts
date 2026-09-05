// commands/snapshot.queen.ts
//
// `/snapshot` — freeze the whole hive under a name you can come back to.
//
//   /snapshot before the redesign   → takes a snapshot with that name
//   /snapshot                       → takes one named snapshot-N
//   /snapshot list                  → lists what you have
//
// ── The sequence ──────────────────────────────────────────────────────
//
//   1. sealSubtree([]) — a merkle-coherent root re-derived from LIVE
//      location heads. Commits are per-page (the leaf→root cascade is
//      retired), so a stored parent's child sig is only a hint; the seal
//      is what makes one signature name the current tree. Heal + retry
//      once, then fail LOUD — a snapshot that cannot dereference is
//      worse than no snapshot.
//   2. Write the record + append its sig to the root layer's `snapshots`
//      slot — one commit, one marker, undoable like anything else.
//
// A SNAPSHOT IS LOCAL. It used to push its sealed closure to DCP and wait
// for receipts before claiming to be a backup; that transport was deleted
// with the installer on 2026-08-30 and the push channel behind it followed
// (`sharing/retired-push-pool.ts` says why). The seal is a merkle root over
// content this hive already holds, so it dereferences here and now — what it
// is NOT is an off-machine copy. Getting the bytes to another node is a
// separate act with its own gesture: replication from a host, or the
// host-sync opt-in. Do not re-add a push here; a snapshot that silently
// uploaded would be publishing without a gesture (write-conformance check 10).
//
// ── What it does NOT do ───────────────────────────────────────────────
//
// No install state, no feature on/off — see snapshots-slot.ts for why
// both are deliberately outside the seal. Nothing here touches DCP's
// toggle stores: those gate MODULE CODE and are trust-gated, and a tile
// is "enabled" purely by being reachable from the current seal.

import { EffectBus, get, I18N_IOC_KEY, QueenBee, type I18nProvider } from '@hypercomb/core'
import { SNAPSHOTS_SLOT, readSnapshots, type SnapshotRecord } from '../history/snapshots-slot.js'
import type { HistoryService } from '../history/history.service.js'

const STORE_KEY = '@hypercomb.social/Store'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const COMMITTER_KEY = '@diamondcoreprocessor.com/LayerCommitter'

const SIG_RE = /^[a-f0-9]{64}$/

interface StoreLike {
  putResource?: (b: Blob) => Promise<string>
}
interface CommitterLike {
  commitSlotAppend?: (segments: readonly string[], slot: string, sig: string) => Promise<void>
}

export class SnapshotQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'snapshot'
  override description =
    'Freeze the whole hive under a name you can come back to — tiles and behaviours in one signature'
  override descriptionKey = 'slash.snapshot'
  override options = ['<name>', 'list']
  override examples = [
    { input: '/snapshot before the redesign', result: 'Seals the hive and names that point "before the redesign"' },
    { input: '/snapshot list', result: 'Lists every snapshot you have taken' },
  ]

  protected async execute(args: string): Promise<void> {
    const trimmed = String(args ?? '').trim()
    if (trimmed.toLowerCase() === 'list') return this.#list()
    await this.#take(trimmed)
  }

  // ── take ────────────────────────────────────────────────

  public createRestorePoint(name: string): Promise<boolean> {
    return this.#take(String(name ?? '').trim())
  }

  public async suggestedRestorePointName(fallback = 'Before update'): Promise<string> {
    const existing = await readSnapshots()
    return existing.length === 0
      ? 'Default'
      : (String(fallback ?? '').trim() || `Restore point ${existing.length + 1}`)
  }

  async #take(name: string): Promise<boolean> {
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    const history = get<HistoryService>(HISTORY_KEY)
    const store = get<StoreLike>(STORE_KEY)
    const committer = get<CommitterLike>(COMMITTER_KEY)

    if (!history?.sealSubtree || !store?.putResource || !committer?.commitSlotAppend) {
      this.#toast('error', this.#t(i18n, 'snapshot.title', 'Snapshot'),
        this.#t(i18n, 'snapshot.not-ready', 'Core services are not ready yet — try again in a moment.'))
      return false
    }

    // 1. A merkle-coherent root from live heads, else fail LOUD — never
    //    name a tree that cannot dereference. No automatic heal: the old
    //    retry re-committed an ancestor's frozen hint OVER a newer child edit.
    this.#activity(this.#t(i18n, 'snapshot.sealing', 'sealing your hive…'), '●')
    const seal = await history.sealSubtree([])
    if (!seal || !SIG_RE.test(seal)) {
      const failure = history.lastSealFailure
      const path = failure ? `/${failure.path.join('/')}` : ''
      const signature = failure?.signature ? ` [${failure.signature.slice(0, 12)}]` : ''
      const reason = failure
        ? ({
            'invalid-location': 'the location could not be signed',
            'head-unresolvable': 'its current layer head is unavailable',
            'child-unresolvable': 'a referenced child layer is unavailable',
            'child-name-missing': 'a referenced child has no location name',
            cycle: 'the layer graph contains a content cycle',
          } as const)[failure.reason]
        : ''
      this.#toast('error', this.#t(i18n, 'snapshot.title', 'Snapshot'),
        failure
          ? `The hive could not be sealed at ${path || '/'}: ${reason}${signature}. The update was not applied.`
          : this.#t(i18n, 'snapshot.seal-failed',
            'The hive could not be sealed because its signed layer closure is incomplete. The update was not applied.'))
      return false
    }

    // 2. The record, then one commit on the root lineage.
    const label = name || await this.#autoName()
    const record: SnapshotRecord = { seal, label, at: Date.now() }
    const sig = await store.putResource(
      new Blob([JSON.stringify(record)], { type: 'application/json' }),
    )
    if (!sig || !SIG_RE.test(sig)) {
      this.#toast('error', this.#t(i18n, 'snapshot.title', 'Snapshot'),
        this.#t(i18n, 'snapshot.write-failed', 'The snapshot record could not be written.'))
      return false
    }
    await committer.commitSlotAppend([], SNAPSHOTS_SLOT, sig)

    // This commit is also the row Revision History displays. Give the marker
    // the restore-point name instead of leaving an opaque snapshots-slot diff.
    try {
      if (history.sign && history.listMarkerFilenames && history.setMarkerMeta) {
        const rootLocation = await history.sign({ explorerSegments: () => [] } as never)
        const markers = await history.listMarkerFilenames(rootLocation)
        const latest = [...markers].sort().at(-1)
        if (latest) await history.setMarkerMeta(rootLocation, latest, { label, marked: true, path: [] })
      }
    } catch (err) {
      console.warn('[snapshot] restore point committed but its revision label could not be written', err)
    }

    // Offer the seal a NAME on the sentinel bridge, if one is ever there to
    // take it. Nothing assigns `__sentinelBridge` since the installer was
    // deleted, so today this returns without doing anything — it is a pointer
    // hand-off, never a byte transfer, and it cannot fail the snapshot. It is
    // left in place rather than removed with the push channel because it
    // writes nothing anywhere: it is dead, not accumulating.
    await this.#recordWithInstaller(label, seal)

    const short = seal.slice(0, 8)
    this.#toast('success', this.#t(i18n, 'snapshot.title', 'Snapshot'),
      this.#t(i18n, 'snapshot.saved', 'Saved "{label}" — {seal}', { label, seal: short }))
    return true
  }

  // ── list ────────────────────────────────────────────────

  async #list(): Promise<void> {
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    const records = await readSnapshots()
    if (records.length === 0) {
      this.#toast('info', this.#t(i18n, 'snapshot.title', 'Snapshot'),
        this.#t(i18n, 'snapshot.none', 'No snapshots yet — run /snapshot <name> to take one.'))
      return
    }
    for (const r of records) {
      this.#activity(`${r.label} — ${r.seal.slice(0, 8)}`, '◆')
    }
    this.#toast('info', this.#t(i18n, 'snapshot.title', 'Snapshot'),
      this.#t(i18n, 'snapshot.listed', '{count} snapshots — see the activity log.', { count: records.length }))
  }

  /** Hand the installer a NAMED pointer at the seal (`save-branch` with a
   *  `sealSig` → DCP's `hive` lineage). Never throws and never blocks the
   *  gesture — absent bridge (dev shell) or a refusal both just mean the
   *  snapshot stays local until an installer is next reachable. */
  async #recordWithInstaller(label: string, seal: string): Promise<void> {
    const bridge = (globalThis as {
      __sentinelBridge?: { saveBranch?: (name: string, sealSig?: string) => Promise<string | null> }
    }).__sentinelBridge
    if (!bridge?.saveBranch) return
    try { await bridge.saveBranch(label, seal) } catch { /* best-effort */ }
  }

  /** `snapshot-N`, matching the installer's own `save-N` convention. */
  async #autoName(): Promise<string> {
    const existing = await readSnapshots()
    return `snapshot-${existing.length + 1}`
  }

  // ── helpers ─────────────────────────────────────────────

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

const _snapshot = new SnapshotQueenBee()
window.ioc.register('@diamondcoreprocessor.com/SnapshotQueenBee', _snapshot)
