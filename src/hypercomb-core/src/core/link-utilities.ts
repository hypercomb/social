// core/link-utilities.ts — URL grammar + external-link policy primitives.
//
// ── THE SHELL DOCUMENT NEVER NAVIGATES ───────────────────────────────
// A view is an overlay INSIDE the running shell, not a page: anything that
// changes the shell's own URL is a reboot (drones unload, the store
// re-opens), and in the native client `window.open` returns null while a
// plain href navigates the whole webview off tauri.localhost with no
// address bar to come back with. External links therefore go to the
// operating system natively, and to a new tab on the web — never the
// shell's own document. `openExternalLink` IS that policy.
//
// These live in core because both module code (essentials) and shell
// chrome (shared/ui) need them, and shared must never import from a
// module: the dependency direction is modules → core only, so the shared
// primitives sit at the bottom. (Moved down from
// essentials/link/youtube.ts and essentials/presentation/tiles/
// document-view-links.ts, which re-export them for their existing
// call sites.)

type NativeInvoke = (command: string, args: Record<string, unknown>) => Promise<unknown>

const nativeInvoke = (): NativeInvoke | null => {
  const invoke = (globalThis as { __TAURI__?: { core?: { invoke?: NativeInvoke } } })
    .__TAURI__?.core?.invoke
  return typeof invoke === 'function' ? invoke : null
}

/** Open a link OUTSIDE the hive — the OS browser natively, a new tab on the
 *  web. Never the shell's own document, on either. */
export function openExternalLink(href: string): void {
  const invoke = nativeInvoke()
  if (invoke) {
    // The host validates the scheme again before it reaches the OS; this
    // side keeps the failure visible rather than silent.
    void Promise.resolve(invoke('open_external', { url: href })).catch(err =>
      console.warn('[link] host could not open', href, err))
    return
  }
  window.open(href, '_blank', 'noopener,noreferrer')
}

/**
 * Extract a YouTube video ID from common URL formats.
 * Handles: youtu.be/{id}, youtube.com/watch?v={id}, /embed/{id}, /shorts/{id}
 * Returns null if the URL is not a recognised YouTube link or the ID is invalid.
 */
export function parseYouTubeVideoId(link: string): string | null {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase()
  let videoId: string | null = null

  if (host === 'youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0] || null
  }

  if (!videoId && host.includes('youtube.com')) {
    if (url.pathname === '/watch') {
      videoId = url.searchParams.get('v')
    } else if (url.pathname.startsWith('/embed/')) {
      videoId = url.pathname.split('/')[2] || null
    } else if (url.pathname.startsWith('/shorts/')) {
      videoId = url.pathname.split('/')[2] || null
    }
  }

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return null
  }

  return videoId
}
