// diamondcoreprocessor.com/commands/save-session.queen.ts
//
// /save-session — collapse every history entry created during the
// current browser-tab session at the current location into one head
// entry. Previous (pre-session) entries stay untouched. Same primitive
// as multi-select merge, just with the selection pre-computed from
// entry timestamps vs the session boot time.
//
// Optional: a setting enables auto-save on pagehide. With the setting
// on, leaving the tab triggers the same collapse, so history doesn't
// accumulate noise across sessions.
//
// Session boundary = when this JS module first loaded. That's stable
// per tab, resets on hard refresh or new tab — matches the user's
// mental model of "a session" ("until you leave the screen" / "until
// I reload").

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { HistoryService } from '../history/history.service.js'
import type { HistoryCursorService } from '../history/history-cursor.service.js'

const SESSION_START = Date.now()
const AUTO_SAVE_KEY = 'hc:auto-save-session-on-leave'

export class SaveSessionQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'save-session'
  override readonly aliases = ['session-save', 'save']
  override description = 'Collapse this session\'s history entries at the current location into one head'

  protected async execute(args: string): Promise<void> {
    const trimmed = args.trim().toLowerCase()

    // /save-session auto on|off — toggles the pagehide auto-save setting.
    if (trimmed === 'auto on' || trimmed === 'auto') {
      localStorage.setItem(AUTO_SAVE_KEY, 'true')
      EffectBus.emit('activity:log', { message: 'auto-save session on leave: ON', icon: '💾' })
      return
    }
    if (trimmed === 'auto off') {
      localStorage.removeItem(AUTO_SAVE_KEY)
      EffectBus.emit('activity:log', { message: 'auto-save session on leave: OFF', icon: '💾' })
      return
    }

    await collapseSessionAtCurrentLocation()
  }
}

async function collapseSessionAtCurrentLocation(): Promise<void> {
  const history = get('@diamondcoreprocessor.com/HistoryService') as HistoryService | undefined
  const cursor = get('@diamondcoreprocessor.com/HistoryCursorService') as HistoryCursorService | undefined
  if (!history || !cursor) return
  const locationSig = cursor.state.locationSig
  if (!locationSig) return

  const entries = await history.listLayers(locationSig)
  const sessionEntries = entries.filter(e => e.at >= SESSION_START)
  // Need at least two entries from this session for merge to be meaningful
  // (one entry from this session is already a "single head" — nothing to
  // collapse). Promote-to-head on a single entry would just duplicate it.
  if (sessionEntries.length < 2) return

  await history.mergeEntries(locationSig, sessionEntries.map(e => e.filename))
  const after = await history.listLayers(locationSig)
  cursor.seek(after.length)
}

// ── Auto-save on pagehide ──────────────────────────────
//
// If the setting is on, leaving the tab (pagehide covers tab close,
// navigation away, and mobile app-switch) collapses this session's
// entries at the current location. pagehide is strictly preferable
// to beforeunload here: it fires reliably on all platforms and
// doesn't block navigation with a prompt. We can't await async work
// reliably in the handler — OPFS writes inside pagehide sometimes
// get truncated — so the user is encouraged to trigger /save-session
// manually as the primary path; the auto-save is a best-effort tail.

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (localStorage.getItem(AUTO_SAVE_KEY) !== 'true') return
    // Fire and forget — best-effort. Most browsers allow a short
    // sync tail after pagehide; the actual OPFS writes may or may
    // not complete, but the user will usually have already clicked
    // /save-session if they care about exact preservation.
    void collapseSessionAtCurrentLocation()
  })
}

// ── registration ────────────────────────────────────────

const _save = new SaveSessionQueenBee()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/SaveSessionQueenBee', _save)
