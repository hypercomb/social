// The blocks as plain files, to look at outside the hive: every page written
// as presentation--a--b.html beside its media, each `resource:<sig>` pointing
// at media/<sig>.<ext> and each link at the page it names. This is the form the
// preview artifact is published in; in the hive the website view does the same
// rewriting itself.
//
//   node scripts/bridge/living-presentation/blocks/preview.cjs <out-dir> [<route>]
//
// The out-dir is scratch: it belongs in the OS temp directory, never in the
// repo (AGENTS.md).

const fs = require('fs')
const path = require('path')
const { buildBlocks } = require('./build.cjs')

const EXT = { 'audio/mpeg': 'mp3', 'video/mp4': 'mp4', 'font/woff2': 'woff2', 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' }

const fileOf = (route) => `${route.join('--')}.html`

/** A link as a page writes it (`/a/b` from the root, `./c` one level down),
 *  as the file it names; anything else is left alone. */
const linkTo = (href, route, paged) => {
  let to = null
  if (href.startsWith('/')) to = href.split('/').filter(Boolean)
  else if (href.startsWith('./')) to = [...route, href.slice(2)]
  if (!to) return href
  if (!paged.has(to.join('/'))) throw new Error(`/${route.join('/')} links to /${to.join('/')}, which has no page`)
  return fileOf(to)
}

const writePreview = (out, { under = '' } = {}) => {
  const { blocks, media } = buildBlocks({ under })
  const all = under ? buildBlocks().blocks : blocks
  const paged = new Set(all.map(b => b.route.join('/')))
  fs.mkdirSync(path.join(out, 'media'), { recursive: true })
  const named = new Map(media.map(m => [m.sig, `media/${m.sig}.${EXT[m.type]}`]))
  for (const m of media) fs.copyFileSync(m.path, path.join(out, named.get(m.sig)))
  for (const b of blocks) {
    const html = b.page
      .replace(/resource:([0-9a-f]{64})/g, (whole, sig) => {
        if (!named.has(sig)) throw new Error(`/${b.route.join('/')} names ${whole}, which is not among its media`)
        return named.get(sig)
      })
      .replace(/href="([^"#][^"]*)"/g, (whole, href) => `href="${linkTo(href, b.route, paged)}"`)
    fs.writeFileSync(path.join(out, fileOf(b.route)), html, 'utf8')
  }
  return { pages: blocks.length, media: media.length }
}

module.exports = { writePreview, fileOf, linkTo }

if (require.main === module) {
  const [out, under = ''] = process.argv.slice(2)
  if (!out) { console.error('usage: preview.cjs <out-dir> [<route>]'); process.exit(2) }
  const { pages, media } = writePreview(path.resolve(out), { under })
  console.log(`${pages} pages and ${media} media in ${path.resolve(out)}`)
}
