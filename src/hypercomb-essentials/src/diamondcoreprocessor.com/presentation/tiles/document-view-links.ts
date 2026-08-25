// Link policy for the trusted document views (Living Brief, Evidence Atlas,
// Knowledge Studio) — and the rule every future view inherits.
//
// ── THE SHELL DOCUMENT NEVER NAVIGATES ───────────────────────────────
//
// A view is an overlay INSIDE the running shell, not a page. Anything that
// changes the shell's own URL is not "a link" — it is a reboot: the drones
// unload, the store re-opens, every bee re-instantiates, and whatever the
// participant was reading is gone. Measured on the native client, a full
// boot is seconds; in the hive it should cost nothing at all.
//
// Two failures made this a rule rather than a preference, both verified on
// the Windows client (WebView2) against the real hive:
//
//   • `<a href="#brief-3">` — the ordinary in-page anchor — writes
//     `location.hash`. In this shell the hash is NOT scratch space: it is
//     the legacy tile-SELECTION form that `Navigation.getSelections()`
//     reads, and `go`/`replace` preserve it verbatim. So one contents
//     click leaves the shell believing a tile called `brief-3` is selected,
//     on every later navigation, until the tab is closed. (Found live:
//     `http://tauri.localhost/revolucion#brief-1`.)
//
//   • `window.open(url, '_blank')` returns **null** in the native shell and
//     an `<a target="_blank">` click does nothing at all — no window, no
//     navigation. External links are therefore silently dead on Windows
//     unless they are handed to the host. A plain `<a href="https://…">`
//     with no target is worse: it navigates the WHOLE webview off
//     `tauri.localhost`, and a native window has no address bar to come
//     back with.
//
// So: in-page jumps scroll (they never touch the URL), internal links move
// the lineage in place, external links go to the operating system, and
// nothing else is allowed to reach the document.

const EXTERNAL = /^(https?:|mailto:|tel:)/i
const INERT = /^(data:|blob:|javascript:|resource:)/i

// The policy helper itself lives in core (link-utilities.ts) so shell
// chrome can share it without importing a module; re-exported here for
// this domain's call sites.
import { openExternalLink } from '@hypercomb/core'

export { openExternalLink }

/** A contents/rail entry. A button, not an anchor, precisely because an
 *  anchor would have to carry an href to look like one. */
export function jumpEntry(text: string, targetId: string, host: HTMLElement): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'view-jump'
  button.textContent = text
  button.onclick = () => {
    host.querySelector(`#${CSS.escape(targetId)}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return button
}

/** Take over every anchor inside `host`. Authored notes carry links the view
 *  did not write, so this is a bubbling interceptor over the whole surface
 *  rather than a per-link decision at render time.
 *
 *  `onInternal` receives an in-hive href (`/a/b`, `./child`, `..`) — the view
 *  decides what that means for it, since a document view moves its own
 *  reading position where a site moves the lineage. Omitted → internal links
 *  are inert rather than navigational, which is still better than a reboot. */
export function bindDocumentLinks(
  host: HTMLElement,
  onInternal?: (href: string) => void,
): void {
  host.addEventListener('click', (event: MouseEvent) => {
    const anchor = (event.target as Element | null)?.closest?.('a')
    if (!anchor || !host.contains(anchor)) return
    const href = anchor.getAttribute('href') ?? ''
    if (!href) return

    // Prevented FIRST and unconditionally: whatever we decide below, the
    // document itself must not act on this click.
    event.preventDefault()
    event.stopPropagation()

    if (href.startsWith('#')) {
      host.querySelector(`#${CSS.escape(href.slice(1))}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    if (EXTERNAL.test(href)) { openExternalLink(href); return }
    if (INERT.test(href)) return
    onInternal?.(href)
  })
}
