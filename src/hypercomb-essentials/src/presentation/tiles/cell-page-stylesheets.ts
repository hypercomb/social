// cell-page-stylesheets.ts — a cell page's linked CSS lands before its content.
//
// A browser holds a document's first paint (and its scripts) until the
// `<link rel="stylesheet">` in its <head> have loaded. A cell page is mounted
// into the LIVE document instead, and a link a script inserts there holds back
// nothing: the page's content painted bare, and its sheet restyled it a beat
// later. Every site the website skill builds links one shared `chrome.css`, so
// every such site flashed on load.
//
// The page mounts (site view, Revolución room) hoist the sheets first and wait
// for them to settle before any of the page goes in, so it paints once, styled.

/** Longest a page waits on its linked sheets. A sheet that never answers costs
 *  this much delay — never the page. */
export const STYLESHEET_WAIT_MS = 3000

/** Hoist a parsed page's `<link rel="stylesheet">` into the live <head>, tagged
 *  with the page sig so its unmount removes exactly these (and not anyone
 *  else's). An external sheet is fetched by the browser, so its text can't be
 *  scoped the way inline CSS is — a page that wants to travel as an artifact
 *  should inline its styles. */
export function hoistPageStylesheets(parsed: Document, pageSig: string): HTMLLinkElement[] {
  return Array.from(parsed.querySelectorAll('link[rel="stylesheet"]'), link => {
    const live = document.createElement('link')
    live.setAttribute('data-hc-cell-page', pageSig)
    for (const attr of Array.from(link.attributes)) live.setAttribute(attr.name, attr.value)
    document.head.appendChild(live)
    return live
  })
}

/** Resolves once every link has loaded or failed, or after `timeoutMs` —
 *  whichever comes first. Never rejects: a broken sheet still mounts its page.
 *  Call it in the same task that inserted the links, so no load is missed. */
export function stylesheetsSettled(
  links: readonly HTMLLinkElement[],
  timeoutMs = STYLESHEET_WAIT_MS,
): Promise<void> {
  const pending = links.filter(link => !link.sheet)
  if (!pending.length) return Promise.resolve()
  return new Promise(resolve => {
    let left = pending.length
    const timer = setTimeout(resolve, timeoutMs)
    const settle = (): void => {
      if (--left > 0) return
      clearTimeout(timer)
      resolve()
    }
    for (const link of pending) {
      link.addEventListener('load', settle, { once: true })
      link.addEventListener('error', settle, { once: true })
    }
  })
}
