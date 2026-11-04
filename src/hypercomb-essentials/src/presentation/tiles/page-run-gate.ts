// presentation/tiles/page-run-gate.ts
//
// MAY THIS PAGE RUN HERE? One answer for every surface that mounts a page the
// participant may not have authored — the site view and the post-it view —
// so neither can forget to ask. It is T5's activation gate: a FOREIGN page
// (published by a domain that is not yours, or sitting under an adopted root)
// runs only once it is verified — reviewed-and-accepted, bypassed, or from a
// trusted domain (sharing/feature-availability.ts). Your own authoring is
// never gated.
//
// A page that may not run is never blank and never executes: the surface
// shows it INERT — its text, with nothing that runs (scripts, styles, frames)
// taken out — until the participant reviews it. The post-it view did not ask
// at all before 2026-11-04 and re-created every <script> a foreign post-it
// carried; the site view asked with its own copy of this question.

import { featureNeedsReview } from '../../sharing/feature-availability.js'

const BROKER_KEY = '@diamondcoreprocessor.com/ContentBrokerDrone'

/** The domain that published the page at `sig`, as the broker learned it from
 *  the mesh or a host; '' when nothing is attributed. */
export const pagePublisherDomain = (sig: string): string => {
  try {
    const broker = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
      ?.get<{ getKnownDomains?: (s: string) => string[] }>(BROKER_KEY)
    return broker?.getKnownDomains?.(sig)?.[0] ?? ''
  } catch { return '' }
}

/** May the page at `sig`, mounted at `segments`, execute — its scripts run,
 *  its resources stream? False means: show it inert and offer the review. */
export const mayRunPage = (segments: readonly string[], sig: string, publisher: string = pagePublisherDomain(sig)): boolean =>
  !featureNeedsReview(segments, sig, publisher)

const BLOCKS = 'p,div,section,article,header,footer,main,aside,nav,h1,h2,h3,h4,h5,h6,li,tr,pre,blockquote,figure,figcaption,details,summary,dt,dd,br,hr'

/** The page with nothing in it that runs: its visible text, one line per
 *  block, scripts, styles, frames and templates gone. Never empty — a page
 *  that is only code says so, instead of showing nothing. */
export const inertPageText = (html: string): string => {
  const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html')
  doc.querySelectorAll('script,style,noscript,template,iframe,object,embed,link').forEach(n => n.remove())
  doc.body?.querySelectorAll(BLOCKS).forEach(n => n.after(doc.createTextNode('\n')))
  const text = (doc.body?.textContent ?? '')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text || '(this page has no text of its own)'
}
