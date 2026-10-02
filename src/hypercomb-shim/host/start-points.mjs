// hypercomb-shim/host/start-points.mjs
//
// TWO BUILDS, ONE ORIGIN. hypercomb.com serves the build people use today at
// its root and the minimal host beside it in a folder, so both read the same
// device storage: switching is arriving in your own hive, not an empty one.
//
//   node host/start-points.mjs --current <dir> --minimal <dir> --out <dir>
//                              [--folder minimal] [--default current|minimal]
//
// The layout:
//
//   <out>/            the current build, as built
//   <out>/<sig>       the minimal host's signature-named files and pools. Their
//                     name is their content, so they are origin-wide: any start
//                     point may read them, and the origin answers them at its
//                     root as a seed host (the kernel asks <seed>/<sig>).
//   <out>/minimal/    the minimal host's named files: its page, kernel,
//                     processor, worker, pin, theme, faces (src/here.ts). Its
//                     page declares the folder as <base href>, and every
//                     other path under it is a hive location there.
//
// THE START POINT is a word a person keeps on their device (localStorage
// `hc:start`). Any page takes `?start=minimal` or `?start=current`: it keeps
// the choice and goes there at the same hive location (the URL path under a
// start point's folder), with the rest of the query and the hash. The front door (the build at the root) sends a person to their kept
// start point; a start point's own folder is honored as asked, so a direct
// link into it never bounces. A person who never chose follows --default:
// THE RAILROAD SWITCH is that one setting, and moving everyone over is a
// deploy with `--default minimal`, while anyone who chose keeps their choice.
//
// The composer writes only into --out and leaves both builds generic: the
// switch exists only where two start points share an origin.

import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIG_NAME = /^[0-9a-f]{64}$/
/** A host's own configuration describes a whole origin; the composed origin
 *  keeps the root build's, extended below. */
const ORIGIN_FILES = new Set(['staticwebapp.config.json', '_headers', '_redirects', '_routes.json', '404.txt'])
/** The minimal host's mutable names: a pointer or the code channel. Never
 *  cached hard (host/serve.mjs, rule 4). */
const MUTABLE = ['index.html', 'main.js', 'hypercomb.worker.js', 'pin', 'build', 'locales.json']
export const START_KEY = 'hc:start'
const MARK = '<!-- hc:start-point -->'

/** The script each composed page runs first, before anything else in it. */
export const switchScript = ({ here, places, fallback }) => {
  const front = places[here] === '/'
  return `${MARK}<script>(function () {
  var places = ${JSON.stringify(places)}, here = ${JSON.stringify(here)}, fallback = ${JSON.stringify(fallback)}, key = ${JSON.stringify(START_KEY)};
  var known = function (name) { return !!name && Object.prototype.hasOwnProperty.call(places, name) };
  try {
    var query = new URLSearchParams(location.search), asked = query.get('start');
    if (asked !== null) { query.delete('start'); if (known(asked)) localStorage.setItem(key, asked) }
    var kept = localStorage.getItem(key);
    var start = known(asked) ? asked : ${front ? '(known(kept) ? kept : fallback)' : 'here'};
    var rest = query.toString(); rest = rest ? '?' + rest : '';
    var path = location.pathname, target = places[start], from = places[here];
    // Already inside the target's folder: this page is a fallback, not a start point.
    var inside = target !== '/' && path.indexOf(target) === 0;
    // The hive location is the path under a start point's folder; it comes along.
    var hive = from !== '/' && path.indexOf(from) === 0 ? path.slice(from.length) : path.slice(1);
    if (start !== here && !inside) { if (window.stop) window.stop(); location.replace(target + hive + rest + location.hash); return }
    if (asked !== null) history.replaceState(history.state, '', location.pathname + rest + location.hash);
  } catch (e) {}
})();</script>`
}

const inject = async (page, script) => {
  const html = await readFile(page, 'utf8')
  if (html.includes(MARK)) throw new Error(`[start-points] ${page} already carries a start-point switch`)
  // After the charset declaration, which must stay in the first 1024 bytes.
  const charset = /<meta\s+charset=["']?[\w-]+["']?\s*\/?>/i.exec(html)
  const head = /<head[^>]*>/i.exec(html)
  const anchor = charset ?? head
  if (!anchor) throw new Error(`[start-points] ${page} has no <head>`)
  const at = anchor.index + anchor[0].length
  await writeFile(page, `${html.slice(0, at)}\n    ${script}${html.slice(at)}`, 'utf8')
}

const sameBytes = async (a, b) => {
  const [x, y] = await Promise.all([readFile(a), readFile(b)])
  return x.equals(y)
}

/** Lay an origin-wide (signature-named) entry at the root. The same name is
 *  the same bytes; a different file under one name is a broken build. */
const placeSigned = async (from, to) => {
  const held = await stat(to).catch(() => null)
  if (!held) return cp(from, to, { recursive: true })
  if (held.isDirectory()) {
    for (const entry of await readdir(from)) await placeSigned(join(from, entry), join(to, entry))
    return
  }
  if (!await sameBytes(from, to)) throw new Error(`[start-points] ${to} differs from ${from} under one signature-named path`)
}

/** Azure Static Web Apps has one navigation fallback, the root build's. The
 *  folder's own files are routed as themselves (the first matching route
 *  wins), and every other path under the folder is a hive location there, so
 *  it is answered with the folder's page. */
const extendAzure = async (config, folder, named) => {
  const parsed = JSON.parse(await readFile(config, 'utf8'))
  const prefix = `/${folder}/`
  const cache = name => ({ 'cache-control': MUTABLE.includes(name) ? 'no-cache, no-store, must-revalidate' : 'public, max-age=0, must-revalidate' })
  const routes = [
    ...named.map(({ name, directory }) => ({ route: prefix + name + (directory ? '/*' : ''), headers: cache(name) })),
    { route: `${prefix}*`, rewrite: `${prefix}index.html`, headers: cache('index.html') },
  ]
  parsed.routes = [...routes, ...(parsed.routes ?? [])]
  // A seed host is read from other origins; every byte is public and verified.
  parsed.globalHeaders = { ...(parsed.globalHeaders ?? {}), 'access-control-allow-origin': '*' }
  await writeFile(config, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
}

const extendHeaders = async (file, folder) => {
  const prefix = `/${folder}/`
  const lines = [
    '', `# The minimal host beside this build (host/start-points.mjs).`,
    '/*', '  Access-Control-Allow-Origin: *',
    ...MUTABLE.flatMap(name => [prefix + name, '  Cache-Control: no-cache, no-store, must-revalidate']),
  ]
  await writeFile(file, `${(await readFile(file, 'utf8')).trimEnd()}\n${lines.join('\n')}\n`, 'utf8')
}

/** Cloudflare Pages serves a real file before it reads _redirects, so one
 *  rule sends every hive location under the folder to the folder's page; it
 *  goes first, ahead of the root build's catch-all. */
const extendRedirects = async (file, folder) => {
  const prefix = `/${folder}/`
  await writeFile(file, `${prefix}*    ${prefix}index.html   200\n${await readFile(file, 'utf8')}`, 'utf8')
}

/** The folder is the minimal host's <base href>: a hive location is the URL
 *  path, so the page names its folder rather than reading it off the address. */
const declareFolder = async (page, folder) => {
  const html = await readFile(page, 'utf8')
  const base = /<base\s+href="\/"\s*\/?>/i
  if (!base.test(html)) throw new Error(`[start-points] ${page} does not declare <base href="/"> to move into /${folder}/`)
  await writeFile(page, html.replace(base, `<base href="/${folder}/" />`), 'utf8')
}

export const compose = async ({ current, minimal, out, folder = 'minimal', fallback = 'current' }) => {
  if (!/^[a-z][a-z0-9-]*$/.test(folder)) throw new Error(`[start-points] --folder must be one plain name, not "${folder}"`)
  const places = { current: '/', minimal: `/${folder}/` }
  if (!(fallback in places)) throw new Error(`[start-points] --default must be one of ${Object.keys(places).join(', ')}`)
  for (const [name, dir] of [['current', current], ['minimal', minimal]]) {
    if (!await stat(join(dir, 'index.html')).catch(() => null)) throw new Error(`[start-points] --${name} ${dir} has no index.html`)
  }
  if (await stat(join(current, folder)).catch(() => null)) throw new Error(`[start-points] the current build already has /${folder}/`)
  await mkdir(out, { recursive: true })
  if ((await readdir(out)).length) throw new Error(`[start-points] ${out} is not empty`)

  await cp(current, out, { recursive: true })
  const home = join(out, folder)
  await mkdir(home)
  let signed = 0
  const named = []
  for (const entry of await readdir(minimal, { withFileTypes: true })) {
    const from = join(minimal, entry.name)
    if (SIG_NAME.test(entry.name) || entry.name === 'content') { await placeSigned(from, join(out, entry.name)); signed++ }
    else if (!ORIGIN_FILES.has(entry.name)) {
      await cp(from, join(home, entry.name), { recursive: true })
      named.push({ name: entry.name, directory: entry.isDirectory() })
    }
  }
  await declareFolder(join(home, 'index.html'), folder)
  await inject(join(out, 'index.html'), switchScript({ here: 'current', places, fallback }))
  await inject(join(home, 'index.html'), switchScript({ here: 'minimal', places, fallback }))

  const held = async name => !!await stat(join(out, name)).catch(() => null)
  if (await held('staticwebapp.config.json')) await extendAzure(join(out, 'staticwebapp.config.json'), folder, named)
  if (await held('_headers')) await extendHeaders(join(out, '_headers'), folder)
  if (await held('_redirects')) await extendRedirects(join(out, '_redirects'), folder)
  return { signed, named: named.length, places, fallback }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => {
    const at = process.argv.indexOf(`--${name}`)
    return at >= 0 ? process.argv[at + 1] : fallback
  }
  const current = arg('current'), minimal = arg('minimal'), out = arg('out')
  if (!current || !minimal || !out) {
    console.error('usage: node host/start-points.mjs --current <dir> --minimal <dir> --out <dir> [--folder minimal] [--default current|minimal]')
    process.exit(2)
  }
  compose({ current: resolve(current), minimal: resolve(minimal), out: resolve(out), folder: arg('folder', 'minimal'), fallback: arg('default', 'current') })
    .then(report => {
      console.log(`[start-points] ${out}: the current build at /, the minimal host at ${report.places.minimal}`
        + ` (${report.named} named · ${report.signed} signature-named at the root)`)
      console.log(`[start-points] a person who never chose starts at ${report.fallback}; ?start=minimal and ?start=current switch and keep the choice`)
    })
    .catch(error => { console.error(error.message ?? error); process.exit(1) })
}
