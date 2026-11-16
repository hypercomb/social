// Café Society, step 1 of 3 — fetch the mockup.
//
//   node scripts/bridge/_cafe-society/mine.cjs
//
// Downloads every page of the cafesociety.app mockup, its stylesheet, every
// picture the pages show and the two font families, into the ignored work
// folder (src/.tmp/cafe-society, or CAFE_WORK). Nothing here touches a hive.
//
// The three steps: mine (fetch) → build (cut into atoms, parts, frames) →
// plant (write into the hive over the bridge). Re-run all three when the
// mockup changes; only what changed gets a new signature.
const fs = require('fs'), path = require('path')

const WORK = process.env.CAFE_WORK || path.resolve(__dirname, '../../../.tmp/cafe-society')
const ORIGIN = 'https://cafesociety.app'
const AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const ROUTES = ['', 'culture', 'culture/coffee', 'culture/tea', 'culture/kava', 'culture/shisha', 'culture/cigar', 'culture/alcohol',
  'vendors', 'community', 'members', 'gatherings', 'journal', 'recipes', 'contact', 'account']
const FONTS = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300..700;1,300..700&family=Jost:wght@300..700&display=swap'

const get = async url => {
  const r = await fetch(url, { headers: { 'user-agent': AGENT } })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return Buffer.from(await r.arrayBuffer())
}
const fileOf = route => (route ? route.replace(/\//g, '_') : 'index') + '.html'

async function main() {
  for (const d of ['raw', 'img', 'fonts']) fs.mkdirSync(path.join(WORK, d), { recursive: true })

  const pictures = new Set()
  let sheet = null
  for (const route of ROUTES) {
    const html = (await get(`${ORIGIN}/${route}`)).toString('utf8')
    fs.writeFileSync(path.join(WORK, 'raw', fileOf(route)), html)
    for (const m of html.matchAll(/src="(https:\/\/images\.[a-z.]+\/[^"]+)"/g)) pictures.add(m[1])
    sheet = sheet || (html.match(/<link rel="stylesheet" href="(\/assets\/[^"]+\.css)"/) || [])[1]
  }
  console.log(`pages    ${ROUTES.length}`)
  if (!sheet) throw new Error('the mockup links no stylesheet')
  fs.writeFileSync(path.join(WORK, 'raw', 'site.css'), await get(ORIGIN + sheet))
  console.log(`sheet    ${sheet}`)

  // A picture is named by the last word of its address; two addresses with
  // the same name are the same picture on two hosts.
  const byName = new Map()
  for (const url of pictures) byName.set(url.slice(url.lastIndexOf('/') + 1), url)
  for (const [name, url] of byName) fs.writeFileSync(path.join(WORK, 'img', name), await get(url))
  console.log(`pictures ${byName.size}`)

  // The latin faces only, fetched once here so no reader ever asks a font host.
  const css = (await get(FONTS)).toString('utf8')
  const faces = [...css.matchAll(/\/\* latin \*\/\s*@font-face\s*\{([^}]*)\}/g)].map(m => m[1])
  for (const face of faces) {
    const family = (face.match(/font-family:\s*'([^']+)'/) || [])[1]
    const style = (face.match(/font-style:\s*(\w+)/) || [])[1]
    const url = (face.match(/url\((https:[^)]+\.woff2)\)/) || [])[1]
    if (!family || !url) continue
    const name = family.toLowerCase().replace(/\s+/g, '-') + (style === 'italic' ? '-italic' : '') + '.woff2'
    fs.writeFileSync(path.join(WORK, 'fonts', name), await get(url))
    console.log(`face     ${name}`)
  }
  console.log('mined into ' + WORK)
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1) })
