// diamondcoreprocessor.com/sharing/repush.queen.ts
//
// `/repush` — the sharer's re-push surface. Re-walks the closure of
// everything queued or previously receipted on the host (HostSyncService
// .reDrain()): stale receipts are re-verified against the live host and
// revoked, missing bytes are re-staged and pushed, and the HOLES are
// reported — refs held by no local store and served by no host, the
// never-pushed content behind a recipient's 404s.
//
// SlashBehaviourDrone auto-wraps this registered object into a slash
// provider (command/description/invoke) — no other registration needed.

import { EffectBus, get } from '@hypercomb/core'

const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'

interface HostSyncLike {
  isEnabled?: () => boolean
  isPublicHostEnabled?: () => boolean
  reDrain?: () => Promise<{ queued: number; pushed: number; failed: number; skippedMissingLocal: string[] }>
}

export class RepushQueenBee {
  readonly command = 'repush'
  readonly description = 'Re-push shared content to your host and report holes'
  readonly descriptionKey = 'slash.repush'

  async invoke(_args: string): Promise<void> {
    const hostSync = get<HostSyncLike>(HOST_SYNC_KEY)
    if (!hostSync?.reDrain) {
      this.#toast('error', 'Re-push', 'Host sync is not ready yet.')
      return
    }
    // Same gate reality as drain(): with no enabled target the queue sits
    // on disk untouched — say so instead of reporting a hollow "0 pushed".
    if (!hostSync.isEnabled?.() && !hostSync.isPublicHostEnabled?.()) {
      this.#toast('error', 'Re-push',
        'No push target is enabled — turn on host sync (with a self-domain), then run /repush again.')
      return
    }

    const summary = await hostSync.reDrain()
    const holes = summary.skippedMissingLocal
    const parts: string[] = [
      `${summary.pushed} pushed`,
      summary.failed > 0 ? `${summary.failed} still queued (retries automatically)` : 'queue empty',
    ]
    if (holes.length > 0) {
      const sample = holes.slice(0, 3).map(s => s.slice(0, 12) + '…').join(', ')
      parts.push(`${holes.length} hole${holes.length === 1 ? '' : 's'} — content this browser never held ` +
        `and no host serves (${sample}${holes.length > 3 ? ', …' : ''}); recipients 404 on these until they are re-authored or imported here.`)
      console.warn('[repush] missing-local holes:', holes)
    }
    this.#toast(
      holes.length > 0 ? 'info' : (summary.failed > 0 ? 'info' : 'success'),
      'Re-push',
      `Re-walked ${summary.queued} queued entr${summary.queued === 1 ? 'y' : 'ies'}: ${parts.join('; ')}.`,
    )
  }

  #toast = (type: string, title: string, message: string): void => {
    EffectBus.emit('toast:show', { type, title, message })
  }
}

const _repush = new RepushQueenBee()
window.ioc.register('@diamondcoreprocessor.com/RepushQueenBee', _repush)
