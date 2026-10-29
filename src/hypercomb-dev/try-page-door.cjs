// The local website trial pool. One directory holds every version of a page.
// try-<name>.<zone> lines the versions up. try-<name>-vN.<zone> is that
// version alone: its own origin, its own memory, the same way each host
// loads its own instance from one pool. The lineup and every revision share
// one switcher. Marks live in the pool, so a check on one origin is still
// checked on the next. Suggest hands those marks to the hive. The page
// itself is served at /raw, inside a frame that cannot reach the switcher.
// A resource: link in that page is served from /asset on the same origin.
// The stored page keeps the resource: form. The frame's origin is opaque,
// so the page policy names that origin instead of 'self'.
// A try- name with no stored page is left to the dev server, so a module
// door still boots.
//
// The label rule is the host's (hypercomb-core sandbox-door.ts,
// SANDBOX_LABEL_RE). This file is plain JS in the dev server and keeps the
// same expression. The worker does too.

const { mkdir, readFile, readdir, rename, writeFile } = require('node:fs/promises')
const path = require('node:path')

const LABEL = /^try-[a-z0-9](?:[a-z0-9-]{0,55}[a-z0-9])?$/
const VERSION_TAIL = /-v([1-9][0-9]*)$/
const MAX_BYTES = 400_000
const ASSET_MAX = 12 * 1024 * 1024
const DEFAULT_DIR = path.join(__dirname, '.try-pages')
const ASSET_SIG = /^[a-f0-9]{64}$/
const ASSET_PATH = /^\/asset\/([a-f0-9]{64})(?:\/[A-Za-z0-9._-]+)?$/

/** 'self' is a stand-in. A sandboxed frame has an opaque origin, and 'self'
 *  matches nothing there. /raw swaps in the version origin. */
const policy = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ')

/** The switcher is the door's page. No script, and the framed page is the only frame. */
const SHELL_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "frame-src 'self'",
  "connect-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ')

const doorOf = (host) => {
  const name = String(host || '').trim().toLowerCase().replace(/:\d{1,5}$/, '')
  const dot = name.indexOf('.')
  if (dot < 0) return null
  const label = name.slice(0, dot)
  const zone = name.slice(dot + 1)
  return zone && LABEL.test(label) ? { label, zone } : null
}

/** A 1.0.0 build is try-<name>-vN. Any other vector is
 *  try-<name>-v<major>-<minor>-<patch>-<build>. try-v2 is a name. */
const VECTOR_FILE = /^([1-9][0-9]*)-([0-9]+)-([0-9]+)-([1-9][0-9]*)$/
const INTEGER_FILE = /^[1-9][0-9]*$/

const asVector = (major, minor, patch, build) => ({
  major: Number(major), minor: Number(minor), patch: Number(patch), build: Number(build),
})

const fileKey = (vector) => (
  vector.major === 1 && vector.minor === 0 && vector.patch === 0
    ? String(vector.build)
    : `${vector.major}-${vector.minor}-${vector.patch}-${vector.build}`
)

const formatVector = (vector) => `${vector.major}.${vector.minor}.${vector.patch}.${vector.build}`

const lineOf = (vector) => `${vector.major}.${vector.minor}.${vector.patch}`

const parseVectorText = (raw) => {
  const match = /^([1-9][0-9]*)\.([0-9]+)\.([0-9]+)\.([1-9][0-9]*)$/.exec(String(raw || '').trim())
  return match ? asVector(match[1], match[2], match[3], match[4]) : null
}

const parseVector = (label) => {
  const name = String(label || '').trim().toLowerCase()
  const wide = /-v([1-9][0-9]*)-([0-9]+)-([0-9]+)-([1-9][0-9]*)$/.exec(name)
  if (wide) {
    const base = name.slice(0, name.length - wide[0].length)
    if (!LABEL.test(base)) return null
    return { base, ...asVector(wide[1], wide[2], wide[3], wide[4]) }
  }
  const narrow = VERSION_TAIL.exec(name)
  if (!narrow) return null
  const base = name.slice(0, name.length - narrow[0].length)
  if (!LABEL.test(base)) return null
  return { base, ...asVector(1, 0, 0, narrow[1]) }
}

const splitLabel = (label) => {
  const parsed = parseVector(label)
  const name = String(label || '').trim().toLowerCase()
  if (!parsed) return { base: name, version: null, vector: null, key: null }
  const { base, ...vector } = parsed
  return { base, version: fileKey(vector) === String(vector.build) ? vector.build : null, vector, key: fileKey(vector) }
}

const sameVector = (a, b) => a.major === b.major && a.minor === b.minor && a.patch === b.patch && a.build === b.build

const nextVector = (latest, bump) => {
  if (!latest) return asVector(1, 0, 0, 1)
  if (bump === 'major') return asVector(latest.major + 1, 0, 0, 1)
  if (bump === 'minor') return asVector(latest.major, latest.minor + 1, 0, 1)
  if (bump === 'patch') return asVector(latest.major, latest.minor, latest.patch + 1, 1)
  return asVector(latest.major, latest.minor, latest.patch, latest.build + 1)
}

const loopback = (request) => {
  const addr = String(request.socket?.remoteAddress || '')
  if (addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1') return true
  if (addr) return false
  const host = String(request.headers.host || '').replace(/:\d{1,5}$/, '')
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

const readBody = (request, max = MAX_BYTES) => new Promise((resolve, reject) => {
  const chunks = []
  let size = 0
  const fail = (error) => {
    request.destroy()
    reject(error)
  }
  request.on('data', (chunk) => {
    size += chunk.length
    if (size > max) {
      fail(Object.assign(new Error('too large'), { status: 413 }))
      return
    }
    chunks.push(chunk)
  })
  request.on('end', () => resolve(Buffer.concat(chunks)))
  request.on('error', reject)
})

const send = (response, status, body, type, extra) => {
  response.statusCode = status
  response.setHeader('Content-Type', type)
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'no-referrer')
  if (extra) {
    for (const [name, value] of Object.entries(extra)) response.setHeader(name, value)
  }
  response.end(body)
}

const pageFile = (dir, label) => path.join(dir, `${label}.html`)
const versionFile = (dir, base, key) => path.join(dir, `${base}-v${key}.html`)
const noteFile = (dir, base, key) => path.join(dir, `${base}-v${key}.note.json`)
const picksFile = (dir, base) => path.join(dir, `${base}.picks.json`)
const assetDir = (dir, base) => path.join(dir, `${base}.assets`)
const assetFile = (dir, base, sig) => path.join(assetDir(dir, base), sig)
const assetTypeFile = (dir, base, sig) => path.join(assetDir(dir, base), `${sig}.type`)

/** A page's resource: links become files this origin serves. The stored HTML stays as it was. */
const rewriteTrialRefs = (html) => String(html).replace(
  /resource:([a-f0-9]{64})/gi,
  (_match, sig) => `/asset/${sig.toLowerCase()}`,
)

const assetTypeOf = (header, bytes) => {
  const declared = String(header || '').split(';')[0].trim().toLowerCase()
  const allowed = {
    'text/css': 'text/css; charset=utf-8',
    'image/png': 'image/png',
    'image/jpeg': 'image/jpeg',
    'image/gif': 'image/gif',
    'image/webp': 'image/webp',
    'image/svg+xml': 'image/svg+xml',
    'font/woff': 'font/woff',
    'font/woff2': 'font/woff2',
  }
  if (allowed[declared]) return allowed[declared]
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (bytes.length >= 4 && bytes.toString('ascii', 0, 4) === 'wOFF') return 'font/woff'
  if (bytes.length >= 4 && bytes.toString('ascii', 0, 4) === 'wOF2') return 'font/woff2'
  return ''
}

/** A page stored before versions existed is v1. The set of files is the pool. */
const adoptLegacy = async (dir, base) => {
  const first = versionFile(dir, base, 1)
  try { await readFile(first); return } catch { /* v1 is not there yet */ }
  try { await readFile(pageFile(dir, base)) } catch { return }
  await rename(pageFile(dir, base), first)
}

const versionsOf = async (dir, base) => {
  await adoptLegacy(dir, base)
  let names = []
  try { names = await readdir(dir) } catch { return [] }
  const prefix = `${base}-v`
  const found = []
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith('.html')) continue
    const raw = name.slice(prefix.length, -'.html'.length)
    if (INTEGER_FILE.test(raw)) found.push(asVector(1, 0, 0, raw))
    else {
      const wide = VECTOR_FILE.exec(raw)
      if (wide) found.push(asVector(wide[1], wide[2], wide[3], wide[4]))
    }
  }
  found.sort((a, b) => a.major - b.major || a.minor - b.minor || a.patch - b.patch || a.build - b.build)
  return found
}

const writeVersion = async (dir, base, vector, body, note) => {
  await mkdir(dir, { recursive: true })
  const file = versionFile(dir, base, fileKey(vector))
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, body)
  await rename(temp, file)
  if (!note) return
  const summary = String(note.summary || '').replace(/\s+/g, ' ').trim().slice(0, 600)
  const from = Array.isArray(note.from) ? note.from.map(item => formatVector(item)).filter(Boolean).slice(0, 8) : []
  if (!summary && !from.length) return
  await writeFile(noteFile(dir, base, fileKey(vector)), JSON.stringify({ summary, from }))
}

const readNote = async (dir, base, vector) => {
  try {
    const raw = JSON.parse(await readFile(noteFile(dir, base, fileKey(vector)), 'utf8'))
    return {
      summary: typeof raw.summary === 'string' ? raw.summary : '',
      from: Array.isArray(raw.from) ? raw.from.map(String) : [],
    }
  } catch { return { summary: '', from: [] } }
}

/** Marks are the pool's, not one origin's. A check on v1 is still checked on v2. */
const readPicks = async (dir, base) => {
  try {
    const raw = JSON.parse(await readFile(picksFile(dir, base), 'utf8'))
    const picks = []
    for (const item of Array.isArray(raw.picks) ? raw.picks : []) {
      const vector = parseVectorText(item)
      if (!vector) continue
      const text = formatVector(vector)
      if (!picks.includes(text)) picks.push(text)
    }
    return picks
  } catch { return [] }
}

const writePicks = async (dir, base, picks) => {
  await mkdir(dir, { recursive: true })
  await writeFile(picksFile(dir, base), JSON.stringify({ picks }))
}

const loadEntries = async (dir, base, versions, lineup) => {
  const entries = []
  for (const vector of versions) {
    const html = await readFile(versionFile(dir, base, fileKey(vector)))
    entries.push({
      vector,
      html: html.toString('utf8'),
      note: await readNote(dir, base, vector),
      origin: versionOrigin(lineup, base, vector),
    })
  }
  return entries
}

const originFor = (request, label, zone) => {
  const host = String(request.headers.host || '')
  const port = /:(\d{1,5})$/.exec(host)?.[1]
  const scheme = request.socket?.encrypted ? 'https' : 'http'
  return `${scheme}://${label}.${zone}${port ? `:${port}` : ''}`
}

/** The hive that owns this trial. A localhost zone is the hive on localhost. */
const hiveHome = (request, zone) => {
  const host = String(request.headers.host || '')
  const port = /:(\d{1,5})$/.exec(host)?.[1]
  const scheme = request.socket?.encrypted ? 'https' : 'http'
  const name = zone === 'localhost' || zone === '127.0.0.1' || zone === '::1' ? 'localhost' : zone
  return `${scheme}://${name}${port ? `:${port}` : ''}/`
}

const hiveSuggest = (request, zone, base, picks, ask) => {
  const query = new URLSearchParams()
  query.set('hc-trial', base)
  query.set('picked', picks.join(','))
  query.set('ask', ask)
  return `${hiveHome(request, zone)}?${query.toString()}`
}

const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]))

const vectorLabel = (base, vector) => `${base}-v${fileKey(vector)}`

const versionOrigin = (lineup, base, vector) =>
  lineup.replace(`://${base}.`, `://${vectorLabel(base, vector)}.`)

const headingsOf = (html) => {
  const found = []
  const pattern = /<h[1-3][^>]*>([^<]{1,80})/gi
  let match = pattern.exec(html)
  while (match && found.length < 8) {
    const text = match[1].replace(/\s+/g, ' ').trim()
    if (text) found.push(text)
    match = pattern.exec(html)
  }
  return found
}

const lineDiff = (before, after) => {
  const left = String(before).split(/\r?\n/)
  const right = String(after).split(/\r?\n/)
  const out = []
  const rows = Math.max(left.length, right.length)
  for (let i = 0; i < rows && out.length < 80; i++) {
    if (left[i] === right[i]) continue
    if (left[i] !== undefined) out.push(`- ${left[i]}`)
    if (right[i] !== undefined && out.length < 80) out.push(`+ ${right[i]}`)
  }
  return out.join('\n')
}

const SWITCH_CSS = `
  .switcher { display: flex; flex-wrap: wrap; gap: .4rem .7rem; align-items: center; margin: 0; padding: .45rem .8rem; background: #f4efe6; color: #2f2a26; font: 15px Georgia, serif; }
  .switcher a { color: #b5753d; }
  .switcher a[aria-current="page"] { font-weight: 700; }
  .switcher label { display: inline-flex; gap: .28rem; align-items: center; }
  .switcher input[name="ask"] { width: 16rem; max-width: 42vw; font: inherit; }
  .switcher button { font: inherit; }
`

/** One switcher on the lineup and on every revision. The checks are the pool's. */
const switcherHtml = (entries, picks, current, lineup) => {
  const marked = new Set(picks)
  const boxes = entries.map(entry => {
    const vector = formatVector(entry.vector)
    const checked = marked.has(vector) ? ' checked' : ''
    const here = current && sameVector(current, entry.vector) ? ' aria-current="page"' : ''
    return `<label><input type="checkbox" name="pick" value="${esc(vector)}"${checked}><a href="${esc(entry.origin)}/"${here}>${esc(vector)}</a></label>`
  }).join('')
  return `<form class="switcher" method="post" action="/" autocomplete="off"><a href="${esc(lineup)}/">All</a>${boxes}<label>Ask <input name="ask" maxlength="400" autocomplete="off"></label><button type="submit" name="act" value="mark">Keep marks</button><button type="submit" name="act" value="suggest">Suggest from these</button></form>`
}

const shellHtml = (base, entries, picks, current, lineup) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(formatVector(current))} ${esc(base)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { display: flex; flex-direction: column; background: #f4efe6; }
  iframe { flex: 1; width: 100%; border: 0; background: #fff; }
  ${SWITCH_CSS}
</style>
</head>
<body>
${switcherHtml(entries, picks, current, lineup)}
<iframe sandbox="allow-scripts" src="/raw" title="${esc(formatVector(current))}"></iframe>
</body>
</html>`

const lineupHtml = (base, entries, lineup, picks) => {
  const groups = []
  for (const entry of entries) {
    const name = lineOf(entry.vector)
    let group = groups.find(item => item.name === name)
    if (!group) {
      group = { name, id: name.replace(/\./g, '-'), entries: [] }
      groups.push(group)
    }
    group.entries.push(entry)
  }
  const side = groups.map(group => `<a href="#line-${group.id}">${esc(group.name)}</a>`).join('')
  const lines = groups.map(group => {
    const builds = group.entries.map(entry => {
      const page = `${entry.origin}/`
      const raw = `${entry.origin}/raw`
      const vector = formatVector(entry.vector)
      const comment = entry.note.summary ? `<p class="note">${esc(entry.note.summary)}</p>` : ''
      const from = entry.note.from.length ? `<p class="from">from ${esc(entry.note.from.join(', '))}</p>` : ''
      return `<article id="build-${esc(vector).replace(/\./g, '-')}"><a href="${esc(page)}">${esc(vector)}</a>${comment}${from}<iframe sandbox="allow-scripts allow-same-origin" src="${esc(raw)}" title="${esc(vector)}"></iframe></article>`
    }).join('')
    return `<section class="line" id="line-${group.id}"><h2>${esc(group.name)}</h2><div class="builds">${builds}</div></section>`
  }).join('')
  const latest = entries[entries.length - 1]
  const previous = entries.length > 1 ? entries[entries.length - 2] : null
  const changes = previous ? lineDiff(previous.html, latest.html) : ''
  const values = latest ? headingsOf(latest.html) : []
  const walk = latest ? `<section class="walk">
<h2>Walk</h2>
<p>latest ${esc(formatVector(latest.vector))}</p>
<p>build ${latest.vector.build}</p>
<h3>Changes</h3>
<pre>${esc(changes || 'The first build. Nothing earlier to walk.')}</pre>
<h3>Values</h3>
<ul>${values.length ? values.map(value => `<li>${esc(value)}</li>`).join('') : '<li>No headings in the latest build.</li>'}</ul>
<h3>Comments</h3>
<p>${esc(latest.note.summary || 'No comment on this build.')}</p>
<h3>Comparison</h3>
<p>${previous ? `${esc(formatVector(previous.vector))} beside ${esc(formatVector(latest.vector))}, each its own origin.` : 'One build so far. The next build sits beside it.'}</p>
${latest.note.summary ? `<h3>Improved</h3><p>${esc(latest.note.summary)}</p>` : ''}
</section>` : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(base)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { display: flex; background: #f4efe6; color: #2f2a26; font: 15px Georgia, serif; }
  .side { width: 8.5rem; flex: none; overflow: auto; border-right: 1px solid #e5dccf; padding: .7rem .8rem; }
  .side a { display: block; padding: .35rem 0; color: #b5753d; text-decoration: none; }
  .rest { flex: 1; min-width: 0; overflow: auto; }
  header { border-bottom: 1px solid #e5dccf; }
  header .name { padding: .6rem 1rem; font-weight: 600; }
  ${SWITCH_CSS}
  .line { border-bottom: 1px solid #e5dccf; }
  .line h2 { margin: 0; padding: .45rem .8rem; font-size: .85rem; letter-spacing: .04em; }
  .builds { display: flex; overflow-x: auto; }
  article { flex: 1 0 22rem; display: flex; flex-direction: column; min-height: 18rem; border-left: 1px solid #e5dccf; }
  article a { padding: .35rem .8rem; color: #b5753d; }
  .note, .from { margin: 0; padding: 0 .8rem .35rem; font-size: .8rem; color: #7a6f63; }
  iframe { flex: 1; width: 100%; min-height: 16rem; border: 0; background: #fff; }
  .walk { padding: .8rem 1rem 2rem; }
  .walk h2, .walk h3 { font-size: .8rem; letter-spacing: .08em; text-transform: uppercase; color: #b5753d; }
  .walk pre { white-space: pre-wrap; font: 12px ui-monospace, monospace; background: #fff; padding: .6rem; border: 1px solid #e5dccf; }
</style>
</head>
<body>
<nav class="side">${side}</nav>
<div class="rest">
<header><div class="name">${esc(base)}</div>${switcherHtml(entries, picks, null, lineup)}</header>
<div class="board">${lines}</div>
${walk}
</div>
</body>
</html>`
}

const serveDocument = (request, response, html, csp) => {
  response.statusCode = 200
  response.removeHeader('Content-Security-Policy')
  response.setHeader('Content-Security-Policy', csp)
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.setHeader('Content-Length', Buffer.byteLength(html))
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.end(request.method === 'HEAD' ? undefined : html)
}

const accept = (response, base, vector) => {
  response.statusCode = 204
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('x-hc-trial-version', String(vector.build))
  response.setHeader('x-hc-trial-vector', formatVector(vector))
  response.setHeader('x-hc-trial-label', vectorLabel(base, vector))
  response.end()
}

const noteFrom = (request) => {
  const summary = request.headers['x-hc-trial-summary']
  const from = String(request.headers['x-hc-trial-from'] || '')
    .split(/[\s,]+/)
    .map(parseVectorText)
    .filter(Boolean)
  if (!summary && !from.length) return null
  return { summary, from }
}

/** A switcher post. Only a form body is accepted. Anything else is left to the caller. */
const handleSwitch = async (request, response, dir, base, zone, versions) => {
  const type = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  if (type !== 'application/x-www-form-urlencoded') return false
  let body
  try { body = await readBody(request) } catch (error) {
    const status = error && error.status === 413 ? 413 : 400
    send(response, status, status === 413 ? 'the page is too large' : 'the marks could not be read', 'text/plain; charset=utf-8')
    return true
  }
  const params = new URLSearchParams(body.toString('utf8'))
  const known = new Set(versions.map(formatVector))
  const picks = []
  for (const value of params.getAll('pick')) {
    const vector = parseVectorText(value)
    if (!vector) continue
    const text = formatVector(vector)
    if (!known.has(text) || picks.includes(text)) continue
    picks.push(text)
  }
  const ask = String(params.get('ask') || '').replace(/\s+/g, ' ').trim().slice(0, 400)
  const act = String(params.get('act') || '')
  await writePicks(dir, base, picks)
  const location = act === 'suggest' ? hiveSuggest(request, zone, base, picks, ask) : '/'
  send(response, 303, '', 'text/plain; charset=utf-8', { Location: location })
  return true
}

/**
 * Serve or store a website trial. Returns true when this request was the
 * trial's and the response is finished. Returns false when the dev server
 * should keep going (the hive, or a module door with no page stored).
 */
const handleTrial = async (request, response, options = {}) => {
  const dir = options.dir || DEFAULT_DIR
  const asked = String(request.headers['x-hc-trial-list'] || request.headers['x-hc-trial'] || '')
  if (request.method === 'GET' && LABEL.test(String(request.headers['x-hc-trial-list'] || ''))) {
    if (!loopback(request)) {
      send(response, 403, 'a trial pool is read from this machine', 'text/plain; charset=utf-8')
      return true
    }
    const { base } = splitLabel(String(request.headers['x-hc-trial-list']))
    const versions = LABEL.test(base) ? await versionsOf(dir, base) : []
    const plain = versions.filter(vector => vector.major === 1 && vector.minor === 0 && vector.patch === 0).map(vector => vector.build)
    const latest = versions[versions.length - 1] || null
    send(response, 200, JSON.stringify({
      base,
      versions: plain,
      latest: plain[plain.length - 1] ?? null,
      vectors: versions.map(formatVector),
      latestVector: latest ? formatVector(latest) : null,
    }), 'application/json; charset=utf-8')
    return true
  }
  if (request.method === 'POST' && LABEL.test(asked) && !request.headers['x-hc-trial-list']) {
    if (!loopback(request)) {
      send(response, 403, 'a trial page is posted from this machine', 'text/plain; charset=utf-8')
      return true
    }
    const asset = String(request.headers['x-hc-trial-asset'] || '').trim().toLowerCase()
    if (asset) {
      const { base } = splitLabel(asked)
      if (!LABEL.test(base) || !ASSET_SIG.test(asset)) {
        send(response, 400, 'the trial file is not a signature', 'text/plain; charset=utf-8')
        return true
      }
      let bytes
      try { bytes = await readBody(request, ASSET_MAX) } catch (error) {
        const status = error && error.status === 413 ? 413 : 400
        send(response, status, status === 413 ? 'the file is too large' : 'the file could not be read', 'text/plain; charset=utf-8')
        return true
      }
      const type = assetTypeOf(request.headers['content-type'], bytes)
      if (!bytes.length || !type) {
        send(response, 415, 'the file is not a picture, a stylesheet, or a font', 'text/plain; charset=utf-8')
        return true
      }
      await mkdir(assetDir(dir, base), { recursive: true })
      await writeFile(assetFile(dir, base, asset), bytes)
      await writeFile(assetTypeFile(dir, base, asset), type)
      send(response, 204, '', 'text/plain; charset=utf-8')
      return true
    }
    let body
    try { body = await readBody(request) } catch (error) {
      const status = error && error.status === 413 ? 413 : 400
      send(response, status, status === 413 ? 'the page is too large' : 'the page could not be read', 'text/plain; charset=utf-8')
      return true
    }
    if (!body.length) {
      send(response, 400, 'the page would be empty', 'text/plain; charset=utf-8')
      return true
    }
    const askedSplit = splitLabel(asked)
    const { base } = askedSplit
    if (!LABEL.test(base)) {
      send(response, 400, 'the trial name is not a label', 'text/plain; charset=utf-8')
      return true
    }
    const note = noteFrom(request)
    const explicit = askedSplit.key ? askedSplit.vector : parseVectorText(request.headers['x-hc-trial-vector'])
    if (explicit) {
      await writeVersion(dir, base, explicit, body, note)
      accept(response, base, explicit)
      return true
    }
    const versions = await versionsOf(dir, base)
    const latest = versions[versions.length - 1] || null
    const bump = ['major', 'minor', 'patch', 'build'].includes(String(request.headers['x-hc-trial-bump']))
      ? String(request.headers['x-hc-trial-bump'])
      : 'build'
    if (latest && bump === 'build' && !note) {
      try {
        const prev = await readFile(versionFile(dir, base, fileKey(latest)))
        if (Buffer.compare(prev, body) === 0) {
          accept(response, base, latest)
          return true
        }
      } catch { /* the latest file went missing; store the next one */ }
    }
    const next = nextVector(latest, bump)
    await writeVersion(dir, base, next, body, note)
    accept(response, base, next)
    return true
  }

  const door = doorOf(request.headers.host)
  if (!door) return false
  const split = splitLabel(door.label)
  const { base, key } = split
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  const lineup = originFor(request, base, door.zone)
  const pagePath = url.pathname === '/' || url.pathname === '/index.html'
  const refuse = (status) => {
    send(response, status, 'nothing here', 'text/plain; charset=utf-8', { 'Content-Security-Policy': policy })
    return true
  }

  if (key) {
    try { await readFile(versionFile(dir, base, key)) } catch {
      return refuse(404)
    }
    const versions = await versionsOf(dir, base)
    if (request.method === 'POST' && pagePath) {
      if (await handleSwitch(request, response, dir, base, door.zone, versions)) return true
      return refuse(405)
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return refuse(405)
    const assetMatch = ASSET_PATH.exec(url.pathname)
    if (assetMatch && (request.method === 'GET' || request.method === 'HEAD')) {
      const sig = assetMatch[1]
      let bytes
      let type
      try {
        bytes = await readFile(assetFile(dir, base, sig))
        type = String(await readFile(assetTypeFile(dir, base, sig), 'utf8')).trim()
      } catch {
        return refuse(404)
      }
      response.statusCode = 200
      response.setHeader('Content-Type', type || 'application/octet-stream')
      response.setHeader('Content-Length', bytes.length)
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('X-Content-Type-Options', 'nosniff')
      response.setHeader('Referrer-Policy', 'no-referrer')
      response.setHeader('Content-Security-Policy', "default-src 'none'")
      response.end(request.method === 'HEAD' ? undefined : bytes)
      return true
    }
    if (url.pathname === '/raw') {
      const html = rewriteTrialRefs(await readFile(versionFile(dir, base, key), 'utf8'))
      const own = versionOrigin(lineup, base, split.vector)
      const framed = policy
        .split(" 'self'").join(` ${own}`)
        .replace("frame-ancestors 'none'", `frame-ancestors ${lineup} ${own}`)
      serveDocument(request, response, html, framed)
      return true
    }
    if (!pagePath) return refuse(404)
    const entries = await loadEntries(dir, base, versions, lineup)
    const picks = await readPicks(dir, base)
    serveDocument(request, response, shellHtml(base, entries, picks, split.vector, lineup), SHELL_POLICY)
    return true
  }

  const versions = await versionsOf(dir, base)
  // No stored page: this name is a module door. The hive boots.
  if (!versions.length) return false
  if (request.method === 'POST' && pagePath) {
    if (await handleSwitch(request, response, dir, base, door.zone, versions)) return true
    return refuse(405)
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return refuse(405)
  if (!pagePath) return refuse(404)
  const entries = await loadEntries(dir, base, versions, lineup)
  const origins = entries.map(entry => entry.origin)
  const picks = await readPicks(dir, base)
  const html = lineupHtml(base, entries, lineup, picks)
  const framed = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `frame-src ${origins.join(' ')}`,
    "connect-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; ')
  serveDocument(request, response, html, framed)
  return true
}

module.exports = { DEFAULT_DIR, LABEL, MAX_BYTES, handleTrial, policy }
