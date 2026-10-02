// @vitest-environment node
//
// Two builds on one origin (host/start-points.mjs): the current build at the
// root, the minimal host in a folder beside it, its signature-named files at
// the root, and a start-point switch at the top of each page.

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error — plain ESM tool, no declarations
import { compose, START_KEY, switchScript } from './start-points.mjs'

const SIG = 'a'.repeat(64)
const POOL = 'b'.repeat(64)
let work = ''

const put = async (path: string, text: string) => {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, text)
}
const exists = async (path: string) => !!await stat(path).catch(() => null)

const builds = async () => {
  const current = join(work, 'current'), minimal = join(work, 'minimal')
  await put(join(current, 'index.html'), '<!doctype html>\n<html>\n  <head>\n    <meta charset="utf-8">\n    <title>current</title>\n  </head>\n</html>\n')
  await put(join(current, 'main-ABC.js'), 'angular')
  await put(join(current, 'staticwebapp.config.json'), JSON.stringify({ routes: [{ route: '/content/*', headers: { a: 'b' } }], navigationFallback: { rewrite: '/index.html' } }))
  await put(join(current, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n')
  await put(join(minimal, 'index.html'), '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <base href="/" />\n    <script src="./main.js"></script>\n  </head>\n</html>\n')
  for (const name of ['main.js', 'hypercomb.worker.js', 'hypercomb-core.runtime.js', 'theme.css', 'fonts/fonts.css']) await put(join(minimal, name), name)
  await put(join(minimal, 'pin'), `${SIG}\n`)
  await put(join(minimal, SIG), 'the host bundle')
  await put(join(minimal, POOL, 'index.html'), `${SIG}\n`)
  for (const name of ['staticwebapp.config.json', '_headers', '_redirects', '_routes.json', '404.txt']) await put(join(minimal, name), 'the minimal host alone')
  return { current, minimal, out: join(work, 'origin') }
}

beforeEach(async () => { work = await mkdtemp(join(tmpdir(), 'hc-start-points-')) })
afterEach(async () => { await rm(work, { recursive: true, force: true }) })

describe('composing one origin from two builds', () => {
  it('keeps the current build at the root, the minimal host in its folder, and its signed files at the root', async () => {
    const dirs = await builds()
    const report = await compose(dirs)
    expect(report.places).toEqual({ current: '/', minimal: '/minimal/' })
    expect(await readFile(join(dirs.out, 'main-ABC.js'), 'utf8')).toBe('angular')
    for (const name of ['main.js', 'hypercomb.worker.js', 'hypercomb-core.runtime.js', 'pin', 'fonts/fonts.css']) {
      expect(await exists(join(dirs.out, 'minimal', name)), name).toBe(true)
    }
    expect(await readFile(join(dirs.out, SIG), 'utf8')).toBe('the host bundle')
    expect(await exists(join(dirs.out, POOL, 'index.html'))).toBe(true)
    expect(await exists(join(dirs.out, 'minimal', SIG))).toBe(false)
    // The origin's configuration is the root build's, extended; the minimal
    // host's own (written for a whole origin) is left out.
    for (const name of ['staticwebapp.config.json', '_headers', '_redirects', '_routes.json', '404.txt']) {
      expect(await exists(join(dirs.out, 'minimal', name)), name).toBe(false)
    }
  })

  it('declares the folder as the minimal page\'s base, since its address is a hive location', async () => {
    const dirs = await builds()
    await compose(dirs)
    expect(await readFile(join(dirs.out, 'minimal', 'index.html'), 'utf8')).toContain('<base href="/minimal/" />')
    expect(await readFile(join(dirs.out, 'index.html'), 'utf8')).not.toContain('<base href="/minimal/"')
    await rm(dirs.out, { recursive: true })
    await put(join(dirs.minimal, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head></html>')
    await expect(compose(dirs)).rejects.toThrow(/does not declare <base href="\/">/)
  })

  it('puts the switch first in each page, after the charset', async () => {
    const dirs = await builds()
    await compose(dirs)
    for (const [page, here] of [['index.html', 'current'], ['minimal/index.html', 'minimal']]) {
      const html = await readFile(join(dirs.out, page), 'utf8')
      const charset = html.search(/<meta charset/)
      const at = html.indexOf('<!-- hc:start-point -->')
      expect(at).toBeGreaterThan(charset)
      expect(html.indexOf('<script', charset)).toBeGreaterThan(at)
      expect(html).toContain(`here = "${here}"`)
    }
  })

  it('serves the folder\'s files as themselves and every other path in it as its page, and lets other origins read', async () => {
    const dirs = await builds()
    await compose(dirs)
    const config = JSON.parse(await readFile(join(dirs.out, 'staticwebapp.config.json'), 'utf8'))
    const routes = config.routes.map((r: { route: string }) => r.route)
    const fallback = routes.indexOf('/minimal/*')
    expect(config.routes[fallback].rewrite).toBe('/minimal/index.html')
    // First match wins: every file and folder of the host is routed before the fallback.
    for (const name of ['/minimal/main.js', '/minimal/pin', '/minimal/theme.css', '/minimal/fonts/*']) {
      expect(routes.indexOf(name), name).toBeGreaterThan(-1)
      expect(routes.indexOf(name), name).toBeLessThan(fallback)
    }
    for (const name of ['main.js', 'hypercomb.worker.js', 'pin']) {
      expect(config.routes).toContainEqual({ route: `/minimal/${name}`, headers: { 'cache-control': 'no-cache, no-store, must-revalidate' } })
    }
    expect(config.routes).toContainEqual({ route: '/minimal/theme.css', headers: { 'cache-control': 'public, max-age=0, must-revalidate' } })
    expect(config.routes.at(-1)).toEqual({ route: '/content/*', headers: { a: 'b' } })
    expect(config.navigationFallback).toEqual({ rewrite: '/index.html' })
    expect(config.globalHeaders['access-control-allow-origin']).toBe('*')
    const headers = await readFile(join(dirs.out, '_headers'), 'utf8')
    expect(headers).toMatch(/^\/\*\n {2}X-Content-Type-Options: nosniff\n/)
    expect(headers).toMatch(/\/\*\n {2}Access-Control-Allow-Origin: \*/)
    expect(headers).toMatch(/\/minimal\/pin\n {2}Cache-Control: no-cache/)
  })

  it('refuses what would break the origin', async () => {
    const dirs = await builds()
    await expect(compose({ ...dirs, folder: '../up' })).rejects.toThrow(/one plain name/)
    await expect(compose({ ...dirs, fallback: 'elsewhere' })).rejects.toThrow(/--default/)
    await put(join(dirs.out, 'held'), 'x')
    await expect(compose(dirs)).rejects.toThrow(/not empty/)
    await rm(dirs.out, { recursive: true })
    await put(join(dirs.current, SIG), 'other bytes')
    await expect(compose(dirs)).rejects.toThrow(/differs/)
    await rm(join(dirs.current, SIG))
    await put(join(dirs.current, 'minimal', 'x'), 'x')
    await rm(dirs.out, { recursive: true, force: true })
    await expect(compose(dirs)).rejects.toThrow(/already has \/minimal\//)
  })
})

/** Run a page's switch against a stand-in for the browser. */
const visit = (here: 'current' | 'minimal', url: string, kept: string | null, fallback = 'current') => {
  const html = switchScript({ here, places: { current: '/', minimal: '/minimal/' }, fallback })
  const code = html.slice(html.indexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'))
  const at = new URL(url, 'https://hypercomb.com')
  const store = new Map<string, string>(kept ? [[START_KEY, kept]] : [])
  const seen = { replaced: null as string | null, rewritten: null as string | null, stopped: false }
  const location = { pathname: at.pathname, search: at.search, hash: at.hash, replace: (to: string) => { seen.replaced = to } }
  const localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } }
  const history = { state: null, replaceState: (_s: unknown, _t: string, to: string) => { seen.rewritten = to } }
  const window = { stop: () => { seen.stopped = true } }
  new Function('location', 'localStorage', 'history', 'window', code)(location, localStorage, history, window)
  return { ...seen, kept: store.get(START_KEY) ?? null }
}

describe('the start-point switch', () => {
  it('the front door stays on the current build for a person who never chose', () => {
    expect(visit('current', '/', null)).toMatchObject({ replaced: null, kept: null })
  })

  it('?start=minimal keeps the choice and carries the hive location and the rest of the query', () => {
    expect(visit('current', '/garden/kitchen?start=minimal&x=1#note', null))
      .toEqual({ replaced: '/minimal/garden/kitchen?x=1#note', rewritten: null, stopped: true, kept: 'minimal' })
  })

  it('the front door sends a person to the start point they kept, at the same location', () => {
    expect(visit('current', '/garden/[a,b]', 'minimal')).toMatchObject({ replaced: '/minimal/garden/[a,b]', kept: 'minimal' })
    expect(visit('current', '/', 'minimal')).toMatchObject({ replaced: '/minimal/', kept: 'minimal' })
  })

  it('a folder link is honored as asked, without changing the kept choice', () => {
    expect(visit('minimal', '/minimal/garden', 'current')).toMatchObject({ replaced: null, kept: 'current' })
  })

  it('?start=current returns from the minimal host to the same location and keeps that', () => {
    expect(visit('minimal', '/minimal/garden/kitchen?start=current#d', 'minimal')).toMatchObject({ replaced: '/garden/kitchen#d', kept: 'current' })
    expect(visit('minimal', '/minimal/?start=current', 'minimal')).toMatchObject({ replaced: '/', kept: 'current' })
  })

  it('asking for the start point already open keeps it and drops the flag from the address', () => {
    expect(visit('minimal', '/minimal/garden?start=minimal&y=2#e', null))
      .toEqual({ replaced: null, rewritten: '/minimal/garden?y=2#e', stopped: false, kept: 'minimal' })
  })

  it('an unknown start point is neither kept nor followed', () => {
    expect(visit('current', '/?start=elsewhere', 'minimal')).toMatchObject({ replaced: '/minimal/', kept: 'minimal' })
    expect(visit('current', '/?start=elsewhere', null)).toEqual({ replaced: null, rewritten: '/', stopped: false, kept: null })
  })

  it('never loops: the current page answering inside the folder is a fallback, not a start point', () => {
    expect(visit('current', '/minimal/garden', 'minimal')).toMatchObject({ replaced: null })
  })

  it('the railroad switch: a person who never chose starts at the default, a kept choice still wins', () => {
    expect(visit('current', '/', null, 'minimal')).toMatchObject({ replaced: '/minimal/', kept: null })
    expect(visit('current', '/', 'current', 'minimal')).toMatchObject({ replaced: null, kept: 'current' })
  })

  it('a browser that refuses storage stays where it is', () => {
    const html = switchScript({ here: 'current', places: { current: '/', minimal: '/minimal/' }, fallback: 'minimal' })
    const code = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'))
    const refusing = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    let replaced = false
    expect(() => new Function('location', 'localStorage', 'history', 'window', code)(
      { pathname: '/', search: '', hash: '', replace: () => { replaced = true } }, refusing, {}, {})).not.toThrow()
    expect(replaced).toBe(false)
  })
})
