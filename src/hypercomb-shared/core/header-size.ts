// hypercomb-shared/core/header-size.ts
//
// Header-size preset: persistence + boot restore + the `/header` slash command.
//
// The three sizes themselves are pure CSS (`styles/_header-size.scss`), keyed
// off a `data-header-size` attribute on <html>. This module is the shell-side
// glue around them:
//   • on import (boot) it re-applies the persisted choice BEFORE Angular
//     renders the header, so there's no flash of the default size;
//   • it registers a `/header` QueenBee so the user can switch + persist via
//     the command line;
//   • `setHeaderSize()` is exported for any other shell caller.
//
// It lives in shared — not essentials — because header chrome is a shell
// concern (the CSS is already in `hypercomb-shared/styles/`), and because a
// QueenBee registered on `window.ioc` auto-wires into the slash system with
// no essentials rebuild and no web OPFS push. The SlashBehaviourDrone scans
// existing registrations on setup and also listens via `ioc.onRegister`, so
// boot order doesn't matter.

import { QueenBee } from '@hypercomb/core'

const STORAGE_KEY = 'hc:header-size'
const VALID = new Set(['1', '2', '3'])
// '1' (compact) is the default — the original slim chrome. It matches the bare
// `:root` rule in `_header-size.scss` (1.0×), so the default is expressed by
// the ABSENCE of the attribute, and the app boots slim. Sizes '2' (medium) and
// '3' (large) step the chrome up. Keep these in sync.
const DEFAULT_SIZE = '1'

/** Reflect the preset onto <html> so the `:root[data-header-size]` CSS applies. */
function applyHeaderSize(size: string): void {
  // Default is the bare `:root` rule; drop the attribute rather than pinning a
  // value the CSS would otherwise own.
  if (size === DEFAULT_SIZE) document.documentElement.removeAttribute('data-header-size')
  else document.documentElement.dataset['headerSize'] = size
}

/** The persisted preset, or the default ('2') when nothing valid is stored. */
export function currentHeaderSize(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && VALID.has(stored)) return stored
  } catch { /* localStorage blocked (private mode) — fall through to default */ }
  return DEFAULT_SIZE
}

/** Validate, persist, and apply a header-size preset. Returns the applied value. */
export function setHeaderSize(size: string): string {
  const next = VALID.has(size) ? size : DEFAULT_SIZE
  try { localStorage.setItem(STORAGE_KEY, next) } catch { /* private mode — apply without persisting */ }
  applyHeaderSize(next)
  return next
}

// ── boot restore ─────────────────────────────────────────
// Module-eval (imported early in both shells' main.ts, after ioc.web) runs
// before `bootstrapApplication` paints the header → no flash of the default.
applyHeaderSize(currentHeaderSize())

// ── /header slash command ────────────────────────────────
// `/header 1|2|3` switches the size; `/header` alone prints the current one.
class HeaderSizeQueenBee extends QueenBee {
  readonly namespace = 'hypercomb.social'
  readonly command = 'header'
  override readonly aliases = []
  override description = 'Set the header size (1 = small, 2 = medium, 3 = large)'
  override descriptionKey = 'slash.header'

  override slashComplete(args: string): readonly string[] {
    const sizes = ['1', '2', '3']
    const q = args.trim()
    return q ? sizes.filter(s => s.startsWith(q)) : sizes
  }

  protected execute(args: string): void {
    const requested = args.trim()
    if (!requested) {
      console.log(`[/header] Current size: ${currentHeaderSize()}`)
      return
    }
    const applied = setHeaderSize(requested)
    console.log(`[/header] Header size set to: ${applied}`)
  }
}

const _header = new HeaderSizeQueenBee()
window.ioc?.register('@hypercomb.social/HeaderSizeQueenBee', _header)
