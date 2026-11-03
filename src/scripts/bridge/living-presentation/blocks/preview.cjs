// The pages as a folder of plain files, to look at outside the hive: each
// page as <route joined by -->.html, each medium as media/<sig>.<ext>, links
// and `resource:<sig>` rewritten to those files. What the hive does when it
// mounts a page (resource:<sig> → /@resource/<sig>, a word link → the tile
// that fills it), done once, ahead of time.
//
//   node scripts/bridge/living-presentation/blocks/preview.cjs <out-dir> [<route>]

const fs = require('fs')
const path = require('path')
const { buildBlocks } = require('./build.cjs')

const EXT = { 'audio/mpeg': '.mp3', 'video/mp4': '.mp4', 'font/woff2': '.woff2', 'image/png': '.png', 'image/webp': '.webp', 'image/jpeg': '.jpg', 'image/svg+xml': '.svg' }
const fileOf = (route) => `${route.join('--')}.html`

const preview = (out, under = '') => {
  const { blocks, media } = buildBlocks({ under })
  fs.mkdirSync(path.join(out, 'media'), { recursive: true })
  const mediaPath = Object.fromEntries(media.map(m => [m.sig, `media/${m.sig.slice(0, 16)}${EXT[m.type]}`]))
  for (const m of media) fs.copyFileSync(m.path, path.join(out, mediaPath[m.sig]))
  for (const b of blocks) {
    const html = b.page
      .replace(/resource:([0-9a-f]{64})/g, (_, sig) => {
        if (!mediaPath[sig]) throw new Error(`${b.route.join('/')}: names a medium the build did not collect: ${sig}`)
        return mediaPath[sig]
      })
      .replace(/href="\.\/([^"/]+)"/g, (_, word) => `href="${fileOf([...b.route, word])}"`)
      .replace(/href="\/([^"]+)"/g, (_, at) => `href="${fileOf(at.split('/'))}"`)
    fs.writeFileSync(path.join(out, fileOf(b.route)), html)
  }
  return { pages: blocks.map(b => fileOf(b.route)), media: Object.values(mediaPath) }
}

if (require.main === module) {
  const [out, under] = process.argv.slice(2)
  if (!out) { console.error('usage: preview.cjs <out-dir> [<route>]'); process.exit(2) }
  const r = preview(path.resolve(out), under)
  console.log(`${r.pages.length} pages and ${r.media.length} media in ${path.resolve(out)}`)
}

module.exports = { preview, fileOf }
