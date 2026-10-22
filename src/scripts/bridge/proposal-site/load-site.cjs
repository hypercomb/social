// Which site a name means: a proposal in proposals/<name>.cjs, or the portal
// that lists them. And the list itself, for the portal's directory.

const fs = require('fs')
const path = require('path')

const PROPOSALS = path.join(__dirname, 'proposals')

/** Every proposal, built, oldest file first. */
function listProposals() {
  return fs.readdirSync(PROPOSALS)
    .filter(f => f.endsWith('.cjs'))
    .sort()
    .map(f => ({ name: f.replace(/\.cjs$/, ''), site: require(path.join(PROPOSALS, f))() }))
}

function loadSite(name) {
  const own = path.join(PROPOSALS, `${name}.cjs`)
  if (fs.existsSync(own)) return require(own)()
  if (name === 'portal') return require('./portal.cjs')()
  throw new Error(`no site named ${name}: one of portal, ${listProposals().map(p => p.name).join(', ')}`)
}

module.exports = { loadSite, listProposals }
