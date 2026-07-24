// diamondcoreprocessor.com/commands/restore.queen.ts
//
// `/restore <name>` — make a named snapshot the current hive again.
//
//   /restore before the redesign   → that tree becomes the live tree
//   /restore                       → lists what you can go back to
//
// ── How it works ──────────────────────────────────────────────────────
//
// A snapshot names a sealed merkle root. Restoring walks that root and
// appends a head marker at every location whose content differs, via
// `promoteToHead` → `commitLayer`. Nothing is deleted and nothing is
// rewritten: history stays linear and append-only, exactly like the
// Make-HEAD promote the history viewer already performs. Locations whose
// head already matches cost nothing — commitLayer dedups byte-identical
// content without writing a marker.
//
// Tiles that exist now but not in the snapshot simply stop being
// reachable from the new head. Their bags, markers and bytes all
// survive, and the markers written before the restore still name them —
// which is precisely what makes "go back to where I was" work. Being
// enabled IS being reachable from the current root; there is no separate
// flag to flip, here or in the installer.
//
// ── Two safeties ──────────────────────────────────────────────────────
//
// 1. A restore point is taken FIRST, automatically. Restore appends a
//    marker at many locations, so undo (which is per-location) is a poor
//    way back. Snapshotting the current state first makes the way back
//    the same gesture: /restore the auto-named point.
//
// 2. The `snapshots` slot is carried FORWARD rather than reverted. The
//    seal holds the index as it was, so promoting it verbatim would
//    erase every later restore point and make restore a one-way door.
//    See snapshots-slot.ts — the index is monotonic by design.

import { EffectBus, get, requestConfirm, I18N_IOC_KEY, QueenBee, type I18nProvider } from '@hypercomb/core'
import { SNAPSHOTS_SLOT, readSnapshots, findSnapshot } from '../history/snapshots-slot.js'
import type { HistoryService } from '../history/history.service.js'

const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const SNAPSHOT_QUEEN_KEY = '@diamondcoreprocessor.com/SnapshotQueenBee'

interface LineageLike { explorerSegments?: () => readonly string[] }
interface SnapshotQueenLike { invoke?: (args: string) => Promise<void> }

export class RestoreQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'restore'
  override description = 'Go back to a named snapshot — its tiles and behaviours become the live hive again'
  override descriptionKey = 'slash.restore'
  override options = ['<name>']
  override examples = [
    { input: '/restore before the redesign', result: 'That snapshot’s tree becomes the live hive' },
    { input: '/restore', result: 'Lists the snapshots you can go back to' },
  ]

  /** Completions are the snapshot labels themselves, so the participant
   *  can tab through their own restore points. Best-effort and sync —
   *  the labels are refreshed on every list/restore. */
  public override slashComplete(args: string): readonly string[] {
    const q = String(args ?? '').trim().toLowerCase()
    return this.#labels.filter(l => !q || l.toLowerCase().startsWith(q))
  }

  #labels: string[] = []

  protected async execute(args: string): Promise<void> {
    const name = String(args ?? '').trim()
    const records = await readSnapshots()
    this.#labels = records.map(r => r.label).filter(Boolean)
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined

    if (records.length === 0) {
      this.#toast('info', this.#t(i18n, 'restore.title', 'Restore'),
        this.#t(i18n, 'snapshot.none', 'No snapshots yet — run /snapshot <name> to take one.'))
      return
    }

    // Bare `/restore` lists rather than guessing which point was meant.
    if (!name) {
      for (const r of records) this.#activity(`${r.label} — ${r.seal.slice(0, 8)}`, '◆')
      this.#toast('info', this.#t(i18n, 'restore.title', 'Restore'),
        this.#t(i18n, 'restore.pick', 'Run /restore <name> — {count} snapshots are in the activity log.',
          { count: records.length }))
      return
    }

    const target = findSnapshot(records, name)
    if (!target) {
      this.#toast('error', this.#t(i18n, 'restore.title', 'Restore'),
        this.#t(i18n, 'restore.unknown', 'No snapshot named “{name}”. Run /restore to see the list.', { name }))
      return
    }

    const confirmed = await requestConfirm({
      title: 'restore.confirm.title',
      message: 'restore.confirm.message',
      messageParams: { name: target.label },
      confirmLabel: 'restore.confirm.go',
      cancelLabel: 'restore.confirm.cancel',
    })
    if (!confirmed) return

    // Safety 1 — a way back that is one gesture, not N undos.
    const snapshotQueen = get<SnapshotQueenLike>(SNAPSHOT_QUEEN_KEY)
    if (snapshotQueen?.invoke) {
      this.#activity(this.#t(i18n, 'restore.marking', 'saving a restore point first…'), '●')
      await snapshotQueen.invoke(`before restore to "${target.label}"`)
    }

    this.#activity(this.#t(i18n, 'restore.working', 'restoring “{name}”…', { name: target.label }), '●')
    const result = await this.#applySeal(target.seal)

    if (result.failed > 0 && result.changed === 0) {
      this.#toast('error', this.#t(i18n, 'restore.title', 'Restore'),
        this.#t(i18n, 'restore.failed',
          'Nothing could be restored — the snapshot’s layers are not available locally.'))
      return
    }

    this.#repaint()
    this.#toast(result.failed === 0 ? 'success' : 'info', this.#t(i18n, 'restore.title', 'Restore'),
      result.failed === 0
        ? this.#t(i18n, 'restore.done', 'Restored “{name}” — {changed} places changed.',
          { name: target.label, changed: result.changed })
        : this.#t(i18n, 'restore.done-partial',
          'Restored “{name}” — {changed} places changed, {failed} could not be resolved.',
          { name: target.label, changed: result.changed, failed: result.failed }))
  }

  /**
   * Walk the sealed tree and bring every location's head to it.
   *
   * Recursion is BY LOCATION (parent segments + the sealed child's own
   * `name`), the same addressing sealSubtree used on the way out, so a
   * child lands in the bag it belongs to rather than wherever a stale
   * hint pointed.
   */
  async #applySeal(seal: string): Promise<{ changed: number; failed: number }> {
    const history = get<HistoryService>(HISTORY_KEY)
    if (!history?.getLayerBySig || !history?.promoteToHead || !history?.commitLayer) {
      return { changed: 0, failed: 1 }
    }

    let changed = 0
    let failed = 0
    const seen = new Set<string>()

    const visit = async (segments: readonly string[], sealedSig: string, isRoot: boolean): Promise<void> => {
      if (seen.has(sealedSig)) return
      seen.add(sealedSig)

      const layer = await history.getLayerBySig(sealedSig)
      if (!layer) { failed++; return }

      const locSig = await history.sign({ explorerSegments: () => [...segments] })
      if (!locSig) { failed++; return }

      const before = await history.currentLayerAt(locSig)
      const beforeSnapshots = (before as Record<string, unknown> | null)?.[SNAPSHOTS_SLOT]

      // Safety 2 — the index is monotonic; never let a restore eat the map.
      const toCommit = (isRoot && Array.isArray(beforeSnapshots) && beforeSnapshots.length > 0)
        ? { ...layer, [SNAPSHOTS_SLOT]: beforeSnapshots }
        : layer

      const headBefore = await history.latestMarkerSigFor(locSig, layer.name ?? '')
      const after = await history.commitLayer(locSig, toCommit)
      if (after !== headBefore) changed++

      for (const raw of (Array.isArray(layer.children) ? layer.children : [])) {
        const childSig = String(raw ?? '').trim().toLowerCase()
        const child = await history.getLayerBySig(childSig)
        const childName = (child?.name ?? '').trim()
        if (!childName) { failed++; continue }
        await visit([...segments, childName], childSig, false)
      }
    }

    await visit([], seal, true)
    return { changed, failed }
  }

  // ── helpers ─────────────────────────────────────────────

  /** Invalidate the lineage caches and repaint where the participant is
   *  standing. The whole tree moved, so root and the current location
   *  both need the signal. */
  #repaint(): void {
    const lineage = get<LineageLike>(LINEAGE_KEY)
    const here = (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    EffectBus.emit('fs:changed', { segments: [] })
    if (here.length > 0) EffectBus.emit('fs:changed', { segments: here })
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

const _restore = new RestoreQueenBee()
window.ioc.register('@diamondcoreprocessor.com/RestoreQueenBee', _restore)
