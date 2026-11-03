// Build the blocks: for every tile with content (content.cjs), its page and its
// included files, read from the repo now so a page quotes the code as it is.
//
// buildBlocks({ under }) -> [{ route: string[], page: string, files: [{ name, text }] }]
//   `under` limits it to routes at or under a route ('presentation/simple').

const fs = require('fs')
const path = require('path')
const { render } = require('./page.cjs')
const content = require('./content.cjs')

const SRC = path.join(__dirname, '..', '..', '..', '..')

/** The excerpt: `lines` lines from the first line starting with `from`. */
const excerpt = ({ path: rel, from, lines }) => {
  const all = fs.readFileSync(path.join(SRC, rel), 'utf8').split('\n')
  const at = all.findIndex(line => line.startsWith(from))
  if (at < 0) throw new Error(`${rel}: no line starts with ${JSON.stringify(from)}; the block's excerpt needs updating`)
  return { path: rel, text: all.slice(at, at + lines).join('\n') }
}

/** An attached file keeps its own name; a name already taken on the tile gets
 *  its folder in front (two files named index.ts stay two files). */
const filesOf = (rels) => {
  const taken = new Set()
  return rels.map(rel => {
    let name = path.basename(rel)
    if (taken.has(name)) name = `${path.basename(path.dirname(rel))}-${name}`
    taken.add(name)
    return { name, path: rel, text: fs.readFileSync(path.join(SRC, rel), 'utf8') }
  })
}

const buildBlocks = ({ under = '' } = {}) => {
  const prefix = String(under).replace(/^\/+|\/+$/g, '')
  return Object.entries(content)
    .filter(([route]) => !prefix || route === prefix || route.startsWith(`${prefix}/`))
    .map(([route, block]) => ({
      route: route.split('/'),
      page: render(block, { code: (block.code ?? []).map(excerpt) }),
      files: filesOf(block.files ?? []),
    }))
}

module.exports = { buildBlocks, SRC }
