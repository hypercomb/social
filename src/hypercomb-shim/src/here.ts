// hypercomb-shim/src/here.ts
//
// WHERE THIS HOST IS SERVED FROM: the folder its page declares as <base href>
// (a hive location is the URL path, so the page's own address is no guide).
// At a domain's root that is '/'; beside another build on the same origin it
// is that folder ('/minimal/', written by host/start-points.mjs). The host's
// NAMED files (the page, the kernel, the processor, the worker, pin, locales)
// live there and resolve against it. Signature-named files are origin-wide:
// their name is their content, so any start point on the origin may serve
// them, and a seed host answers them at its root.
//
// The kernel (a classic script that imports nothing) repeats these three
// lines; keep the two in step.

export const HERE = new URL('./', document.baseURI)

/** The origin path of a named file of this host. */
export const here = (name: string): string => new URL(name, HERE).pathname

/** This host's worker. Its scope is HERE, so it never answers another start
 *  point's pages, and another build's worker never answers this one's. */
export const WORKER = new URL('hypercomb.worker.js', HERE)

/** Is the page controlled by THIS host's worker? A page can be controlled by
 *  another build's worker on the same origin (its first visit, before ours is
 *  registered); that worker answers none of our addresses. */
export const controlledHere = (): boolean =>
  navigator.serviceWorker?.controller?.scriptURL?.split('?')[0] === WORKER.href
