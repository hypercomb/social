// One-time build-time fetch: pulls woff2 subsets local so NOTHING ships
// pointing at a third-party host. Output is committed; rerun only to bump.
// Variable axes (wght@300..700) => ONE file per subset instead of one per weight.
//
//   node scripts/fetch-fonts.cjs <out-dir> <family...>
//
// See documentation/no-third-party-requests.md for the standing rule.
const fs = require('fs'), path = require('path'), crypto = require('crypto')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
// latin + latin-ext only: none of these carry CJK, so Japanese falls
// through to the system stack regardless of what we ship.
const KEEP = new Set(['latin', 'latin-ext'])

// Measured: ~4226-byte URLs still subset, ~4427 silently do not. Sit well
// under the cliff — being close to it means a single added icon name flips
// the build to the full 3.9MB font.
const URL_LIMIT = 4000

const FAMILIES = {
  inter:            'Inter:wght@300..700',
  'source-serif':   'Source+Serif+4:ital,opsz,wght@0,8..60,400..600;1,8..60,400..600',
  'jetbrains-mono': 'JetBrains+Mono:wght@400..600',
  fraunces:         'Fraunces:opsz,wght@9..144,400..600',
  // The icon font behind `.mat-sym` (~400 usages across the UI). Ships whole,
  // not subset: glyphs resolve by LIGATURE from the element's text content
  // (`<span class="mat-sym">settings</span>`), so a subset would silently
  // blank any icon name added later. Apache-2.0.
  'material-symbols': 'Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200',
}

async function get(url, bin) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return bin ? Buffer.from(await r.arrayBuffer()) : r.text()
}

;(async () => {
  const [outDir, ...want] = process.argv.slice(2)
  if (!outDir || !want.length) {
    console.error('usage: fetch-fonts.cjs <out-dir> <family...>')
    console.error('families: ' + Object.keys(FAMILIES).join(', '))
    process.exit(2)
  }
  fs.mkdirSync(outDir, { recursive: true })

  // Everything is fetched into memory FIRST and only written once every family
  // has succeeded. Deleting stale files up front meant a failed run (a tripped
  // subset guard, a dropped connection) left the directory empty and the shell
  // with no fonts at all.
  const pending = []

  let css = '/* Self-hosted fonts — no third-party requests.\n'
          + '   Regenerate: node scripts/fetch-fonts.cjs <dir> <family...>\n'
          + '   See documentation/no-third-party-requests.md */\n'

  for (const slug of want) {
    const spec = FAMILIES[slug]
    if (!spec) throw new Error(`unknown family: ${slug}`)
    // Icon glyphs must not fall back to the ligature text — `block` hides them
    // until the font lands, `swap` would flash the literal word "settings".
    const display = slug === 'material-symbols' ? 'block' : 'swap'
    // …and the icon font ships SUBSET to the ligatures the UI actually renders
    // (151 of ~3000: 158K instead of 3.9MB). The list is derived from source,
    // so adding an icon means rerunning this; icons.spec.ts fails if you don't.
    let extra = ''
    let icons = null
    if (slug === 'material-symbols') {
      icons = require('./icon-names.cjs')
      pending.push({ name: 'icons.txt', bytes: Buffer.from(icons.join('\n') + '\n') })
      extra = `&icon_names=${icons.join(',')}`
      console.log(`  (subset to ${icons.length} icons)`)
    }
    const url = `https://fonts.googleapis.com/css2?family=${spec}${extra}&display=${display}`
    // Google silently IGNORES icon_names past a URL length around 4.3KB and
    // serves the whole 3.9MB font instead — a 10x regression that no render
    // check can catch, because the full font resolves everything. Refuse to
    // ship that: fail here and make someone trim the list.
    if (icons && url.length > URL_LIMIT) {
      throw new Error(
        `[fetch-fonts] icon_names URL is ${url.length} bytes (limit ${URL_LIMIT}) for ${icons.length} icons.\n`
        + `  Google would ignore the subset and serve the full 3.9MB font.\n`
        + `  Trim scripts/icon-names.extra.txt — the picker list and extracted\n`
        + `  names are load-bearing, the margin is not.`)
    }
    const src = await get(url, false)
    // Belt and braces: a genuinely subsetted icon response carries no
    // /* subset */ label at all, while the unsubsetted whole font comes back
    // labelled /* fallback */. If we asked for a subset and got that, the
    // request was ignored for some reason the length check did not predict.
    if (icons && /\/\*\s*fallback\s*\*\//.test(src)) {
      throw new Error(
        `[fetch-fonts] asked for ${icons.length} icons but Google returned the FULL font `
        + `(3.9MB).\n  The icon_names request was ignored — shorten the list.`)
    }
    // Text families come back as /* latin */-style labelled blocks; the icon
    // font comes back as a single /* fallback */ block that is not a subset at
    // all — it is the whole font, so take every block for that one.
    const wholeFont = slug === 'material-symbols'
    const blocks = /\/\*\s*[a-z-]+\s*\*\//i.test(src)
      ? src.split(/\/\*\s*([a-z-]+)\s*\*\//i).slice(1)
      : ['all', src]
    const seen = new Map()
    for (let i = 0; i < blocks.length; i += 2) {
      const subset = blocks[i]
      // Google appends a utility class after the icon @font-face; keep only
      // the face so we do not inherit its 24px font-size into the app.
      const body = (blocks[i + 1].match(/@font-face\s*\{[^}]*\}/) ?? [blocks[i + 1]])[0]
      if (!wholeFont && subset !== 'all' && !KEEP.has(subset)) continue
      // Static subsets end in .woff2; the icon font's dynamic subset is served
      // from /l/font?kit=… with no extension at all.
      const m = body.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/)
      if (!m) continue
      // Italic and roman land in the same subset — suffix to keep them apart.
      const n = (seen.get(subset) ?? 0) + 1
      seen.set(subset, n)
      const file = `${slug}-${subset}${n > 1 ? `-${n}` : ''}.woff2`
      const bytes = await get(m[1], true)
      pending.push({ name: file, bytes })
      // VERSIONED BY CONTENT. The file keeps its name (the directory listing
      // stays readable) but its URL carries a hash of the bytes, so a client
      // holding the previous subset fetches the new one the moment the CSS
      // says so. Without this, a tab that loaded the icon font when the
      // subset was smaller kept that copy for ever — every name added since
      // rendered as its own WORD, and only a hard reload fixed it
      // (memory: project_icon_font_subset_stale_cache; recurred 2026-09-02).
      const v = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 10)
      css += body.replace(m[0], `url(./${file}?v=${v})`).replace(/^\s*\n/gm, '').trim() + '\n'
      console.log(`  ${file}  ${(bytes.length / 1024).toFixed(0)}K`)
    }
  }
  // Every family fetched cleanly — now it is safe to replace what is on disk.
  for (const f of fs.readdirSync(outDir)) {
    if (f.endsWith('.woff2')) fs.unlinkSync(path.join(outDir, f))
  }
  for (const { name, bytes } of pending) fs.writeFileSync(path.join(outDir, name), bytes)
  fs.writeFileSync(path.join(outDir, 'fonts.css'), css)

  // The stylesheet itself is fetched by an unversioned URL from the shell's
  // index.html, so a cached fonts.css would hide the new woff2 URLs just as
  // surely. Stamp the link with a hash of the CSS wherever the shell keeps
  // its index.html (web/dev: ../../src/index.html; the shim: ../../index.html).
  const cssV = crypto.createHash('sha256').update(css).digest('hex').slice(0, 10)
  for (const rel of ['../../src/index.html', '../../index.html']) {
    const html = path.resolve(outDir, rel)
    if (!fs.existsSync(html)) continue
    const before = fs.readFileSync(html, 'utf8')
    const after = before.replace(/fonts\/fonts\.css(?:\?v=[0-9a-f]+)?/g, `fonts/fonts.css?v=${cssV}`)
    if (after !== before) { fs.writeFileSync(html, after); console.log(`  stamped ${path.relative(process.cwd(), html)} (fonts.css?v=${cssV})`) }
  }
})().catch(e => { console.error(e); process.exit(1) })
