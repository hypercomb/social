// sealed-page.spec.ts — SOMEONE ELSE'S PAGE RUNS IN A FRAME OF ITS OWN (jwize
// 2026-11-16: "You are putting yourself and others at risk if you accept
// unvetted code" … "make sure we aren't vulnerable").
//
// The website view and the post-it view mounted every page that may run in the
// hive's own document, where its scripts hold the hive's storage, its signing
// key and every service. A page this hive did not author (page-run-gate.ts
// pageRunsSealed) now runs in the frame a version of a page runs in
// (revision-viewer.model.ts): scripts only, an opaque origin, no network, its
// bytes handed in beforehand — and one frame deeper inside a wrapper that
// refuses every navigation of it, so it can never move itself to a URL. Its
// links come up only while pressed. Nothing of someone else's is seated into a
// page that runs as the hive, and the views that cannot seal (the lounge, the
// room) refuse what is not the hive's own.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FRAME_POLICY, pageFrame, versionFrame, type FrameReader } from '../../history/revision-viewer.model.js'
import { SEALED_PAGE_SANDBOX, SEALED_WRAPPER_POLICY, sealedPageWindow, sealedWrapper } from './page-run-gate.js'

const sig = (ch: string): string => ch.repeat(64)
const SRC = join(process.cwd(), 'hypercomb-essentials', 'src')
const read = (...path: string[]): string => readFileSync(join(SRC, ...path), 'utf8')
const SITE = read('presentation', 'tiles', 'site-view.drone.ts')
const POSTIT = read('presentation', 'tiles', 'postit-view.drone.ts')
const body = (source: string, signature: string): string => {
  const start = source.indexOf(signature)
  expect(start, `${signature} not found`).toBeGreaterThan(-1)
  return source.slice(start, source.indexOf('\n  }\n', start))
}
const parse = (doc: string): Document => new DOMParser().parseFromString(doc, 'text/html')
const dataOf = (doc: string): Record<string, unknown> =>
  JSON.parse(parse(doc).getElementById('hc-revision-data')!.textContent!) as Record<string, unknown>

const page = '<!doctype html><html><head><link rel="stylesheet" href="resource:' + sig('c') + '"></head><body><a href="/next">next</a></body></html>'
const held = new Map<string, Uint8Array>([
  [sig('a'), new TextEncoder().encode(page)],
  [sig('c'), new TextEncoder().encode('body{color:red}')],
])
const reader: FrameReader = { bytes: async s => held.get(s) ?? null, missing: () => false }

describe('the frame someone else\'s page runs in', () => {
  it('is the frame a version runs in: the same document, its sheets written in', async () => {
    const layer = { name: 'card', website: [sig('a')] }
    const version = await versionFrame(layer, ['card'], reader)
    expect(await pageFrame(page, sig('a'), layer, ['card'], reader)).toBe(version.doc)
    expect(version.doc).toContain('body{color:red}')
    expect(version.doc).not.toContain('resource:' + sig('c'))
  })

  it('carries only what the website view hands it: links, depth, the hive\'s look, the entry, the return', async () => {
    const plain = await pageFrame(page, sig('a'), {}, ['card'], reader)
    expect(dataOf(plain)).not.toHaveProperty('links')
    const walking = await pageFrame(page, sig('a'), {}, ['site', 'card'], reader, {
      links: true, depth: 2, theme: 'dark', rootClass: 'hc-dark', entry: ['site'], returning: true,
    })
    const data = dataOf(walking)
    expect(data).toMatchObject({ links: true, depth: 2, theme: 'dark', rootClass: 'hc-dark', entry: ['site'], returning: true })
    const host = parse(walking).body
    expect(host.getAttribute('data-hc-site-entry')).toBe('/site')
    expect(host.hasAttribute('data-hc-returning')).toBe(true)
    expect(walking).toContain('hand({ hcFrameLink: href, hcToken: token })')
    expect(walking).toContain('hand({ hcFrameMenu: { x: e.clientX, y: e.clientY }, hcToken: token })')
    // Only a real press is handed up, and the page's own scripts never see the secret.
    expect(walking).toContain('if (!e.isTrusted) return;')
    expect(walking).toContain('delete data.token;')
    expect(walking).toContain('holder.remove()')
    expect(walking).toContain('document.currentScript.remove()')
    expect(walking).toContain('hand({ hcFrameWiden: 1 })')
    expect(walking).toContain('for (var up = 0; up < (data.depth || 1); up++) viewer = viewer.parent;')
  })

  it('sits one frame deeper in a wrapper that refuses every navigation of it', async () => {
    expect(SEALED_PAGE_SANDBOX).toBe('allow-scripts')
    expect(SEALED_WRAPPER_POLICY).toContain(FRAME_POLICY)
    expect(SEALED_WRAPPER_POLICY).toContain("frame-src 'none'")
    expect(SEALED_WRAPPER_POLICY).toContain("child-src 'none'")
    const doc = await pageFrame(page, sig('a'), {}, ['card'], reader, { depth: 2 })
    const wrapper = parse(sealedWrapper(doc))
    expect(wrapper.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toBe(SEALED_WRAPPER_POLICY)
    const inner = wrapper.querySelectorAll('iframe')
    expect(inner).toHaveLength(1)
    expect(inner[0]!.getAttribute('sandbox')).toBe('allow-scripts')
    expect(inner[0]!.getAttribute('srcdoc')).toBe(doc)
  })

  it('hears only the page\'s own window, one frame down', () => {
    const page = {} as Window
    expect(sealedPageWindow({ contentWindow: { frames: [page] } } as unknown as HTMLIFrameElement)).toBe(page)
    expect(sealedPageWindow({ contentWindow: null } as unknown as HTMLIFrameElement)).toBeNull()
  })
})

describe('the website view', () => {
  it('asks whose page it is before mounting one that may run', () => {
    expect(SITE).toContain('if (pageRunsSealed(segments, cellPageSig)) await this.#mountSealedPage(segments, cellPageSig, store, gen)')
    expect(SITE).toContain('else await this.#mountCellPage(segments, cellPageSig, store, gen)')
  })

  it('mounts someone else\'s page in the sealed wrapper, composed as its own pages are', () => {
    const sealed = body(SITE, 'async #mountSealedPage(')
    expect(sealed).toContain("frame.setAttribute('sandbox', SEALED_PAGE_SANDBOX)")
    expect(sealed).toContain('frame.srcdoc = sealed.srcdoc')
    expect(sealed).toContain('await composeTraits(segments, await composeDivision(segments, authored))')
    expect(sealed).not.toContain("createElement('script')")
    expect(sealed).not.toContain('allow-same-origin')
  })

  it('a link counts only from a real press in the frame — its secret, its focus, a live press — and only from the page\'s own window', () => {
    const sealed = body(SITE, 'async #mountSealedPage(')
    expect(sealed).toContain('const token = crypto.randomUUID()')
    expect(sealed).toContain('const pressed = data.hcToken === token')
    expect(sealed).toContain('if (!pressed || document.activeElement !== frame) return')
    expect(sealed).toContain("data.hcFrameMenu && typeof data.hcFrameMenu === 'object' && pressed")
    expect(sealed).toContain('if (!event.source || event.source !== sealedPageWindow(frame)) return')
    expect(sealed).toContain('userActivation?.isActive) return')
    expect(sealed.indexOf('userActivation?.isActive')).toBeLessThan(sealed.indexOf('openExternalLink('))
    expect(sealed.indexOf('userActivation?.isActive')).toBeLessThan(sealed.indexOf('this.#resolveAndNavigate(href,'))
    expect(sealed).toMatch(/javascript:/)
  })

  it('keeps what sits outside the page: the right button, versions, the pick, widening', () => {
    const sealed = body(SITE, 'async #mountSealedPage(')
    expect(sealed).toContain('this.#back()')
    expect(sealed).toContain('openSiteContextMenu(')
    expect(sealed).toContain('this.#offerVersions(host, segments, pageSig, baseHtml')
    expect(sealed).toContain('this.#resolvePick(host, segments, pageSig, baseHtml)')
    expect(sealed).toContain('void this.#widenSealed(host)')
  })

  it('a back step\'s scroll never leaks onto the next page; a frame is built again for another tile, a newer layer or a byte that arrived — never for one that never comes', () => {
    const sealed = body(SITE, 'async #mountSealedPage(')
    expect(sealed.indexOf('this.#returningScroll = null')).toBeLessThan(sealed.indexOf('if (mounted?.sealed'))
    expect(sealed).toContain('const builtFrom = await sealedSourceAt(segments)')
    expect(sealed).toContain('builtFrom === mounted.builtFrom && !arrived')
    expect(sealed).toContain('absent: sealed.absent,')
    expect(sealed).toContain('builtFrom: sealed.builtFrom,')
  })

  it('never keeps one mount where the other is due', () => {
    expect(SITE).toContain('if (this.#mount && !this.#mount.sealed && this.#mount.pageSig === pageSig')
  })

  it('seats only the hive\'s own parts into a page that runs as the hive; a part from elsewhere runs the whole page sealed', () => {
    const inline = body(SITE, 'async #mountCellPage(')
    expect(inline).toContain('if (pageRunsSealed(route, sig)) { sealedPart = true; return false }')
    expect(inline).toContain('await composeTraits(segments, await composeDivision(segments, authored, ownPart), ownPart)')
    expect(inline).toContain('if (sealedPart) { await this.#mountSealedPage(segments, pageSig, store, gen); return }')
  })
})

describe('the parts a page is composed of', () => {
  it('a trait filler or a member not allowed in is left out before its page is read', () => {
    const traits = read('website', 'trait-seat.ts')
    const division = read('presentation', 'tiles', 'division-render.ts')
    expect(traits).toContain("if (!seats('route' in resolution && resolution.route.length ? resolution.route : at, pageSig)) return null")
    expect(traits.indexOf('if (!seats(')).toBeLessThan(traits.indexOf('fetchThroughContentHop(pageSig'))
    expect(division).toContain('if (!seats(segments, sig)) return null')
    expect(division.indexOf('if (!seats(segments, sig))')).toBeLessThan(division.indexOf('fetchThroughContentHop(sig'))
  })
})

describe('the post-it view', () => {
  it('runs someone else\'s page in the sealed wrapper, and re-creates scripts only for its own', () => {
    expect(POSTIT).toContain('pageRunsSealed(segments, payload.htmlSig)')
    expect(POSTIT).toContain('} else if (payload?.htmlSig && apart) {')
    expect(POSTIT).toContain("frame.setAttribute('sandbox', SEALED_PAGE_SANDBOX)")
    expect(POSTIT).toContain('frame.srcdoc = apartDoc.srcdoc')
    expect(POSTIT.indexOf('payload?.htmlSig && apart')).toBeLessThan(POSTIT.indexOf("shadow.querySelectorAll('script')"))
    expect(POSTIT).not.toContain('allow-same-origin')
  })
})

describe('the views that run in the hive and cannot seal', () => {
  it('the lounge runs only a room that is the hive\'s own, and a room named by hand is', () => {
    const view = read('revolucionstyle.com', 'lounge', 'lounge-view.drone.ts')
    expect(view).toContain('if (runsSealed(segments, bundle, pagePublisherDomain(bundle))) {')
    expect(view.indexOf('runsSealed(segments, bundle')).toBeLessThan(view.indexOf('this.#build(segments, payload)'))
    expect(read('revolucionstyle.com', 'lounge', 'lounge.queen.ts')).toContain('markAuthored(bundleSig)')
  })

  it('the room view never runs a page that runs sealed or may not run', () => {
    const view = read('revolucionstyle.com', 'welcome', 'room-view.drone.ts')
    expect(view).toContain('if (!mayRunPage(segments, pageSig) || pageRunsSealed(segments, pageSig)) {')
    expect(view.indexOf('pageRunsSealed(segments, pageSig)')).toBeLessThan(view.indexOf('runScripts'))
  })
})

describe('what counts as this hive\'s own', () => {
  it('nothing is marked as the hive\'s own by walking: the grandfathering walk is retired', () => {
    const walk = read('sharing', 'authored-bootstrap.worker.ts')
    expect(walk).not.toMatch(/markManyAuthored|markAuthored\(/)
    expect(walk).toContain('reconcileAuthoredPool()')
  })

  it('a page made from a page is the hive\'s own exactly when its source is; a tile file is', () => {
    const commit = read('files', 'page-commit.ts')
    expect(commit).toContain('if (committed.ok && source && isAuthored(source)) markAuthored(htmlSig)')
    expect(read('website', 'parts.queen.ts')).not.toMatch(/commitPageSig\(/)
    expect(read('website', 'style.queen.ts')).not.toMatch(/commitPageSig\(/)
    // Written over someone else's page, a file keeps their scripts: it stays from elsewhere.
    const files = read('files', 'tile-files.drone.ts')
    expect(files).toContain('const own = !current || isAuthored(current)')
    // A TRIAL IS NOT AUTHORED (2026-11-27, inline-code-in-input-audit.md H1/H2):
    // a model's page is marked when a person brings it home (try-page.ts
    // releaseTrial), and at once only on a managed site door, where no trial is.
    expect(files).toContain('rememberTrial(htmlSig, label, { own })')
    expect(files.match(/markAuthored\(/g)?.length).toBe(1)
    expect(files).toMatch(/if \(onManagedSiteDoor\(\)\) \{\s*if \(own\) markAuthored\(htmlSig\)/)
    // A page rebuilt from a model's part is staged as a trial, and the rebuild marks nothing.
    expect(files).toContain('await this.#stage(rebuild.page, rebuilt.sig, rebuilt.html, rebuilt.own)')
    const parts = read('files', 'page-parts-commit.ts')
    expect(parts).not.toMatch(/markAuthored\(|commitPageSigFrom\(/)
    expect(read('files', 'try-page.ts')).toContain('if (mine) markAuthored(sig)')
  })
})
