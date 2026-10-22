// Facts every proposal site may cite. Counts are measured from the checkout
// at build time, never typed in, so a page can't quote a number the repo no
// longer supports.

const { execSync } = require('child_process')
const path = require('path')

const SRC = path.join(__dirname, '..', '..', '..')

const run = (cmd) => execSync(cmd, { cwd: SRC, encoding: 'utf8', maxBuffer: 1 << 28 }).trim()

function measure() {
  const commits = Number(run('git rev-list --count --no-merges HEAD'))
  const first = run('git log --reverse --format=%ad --date=short --no-merges').split('\n')[0]
  const assisted = new Set()
  let current = ''
  for (const line of run('git log --no-merges --format=@@%H%n%B').split('\n')) {
    if (line.startsWith('@@')) current = line.slice(2)
    else if (/^Co-Authored-By: Claude/i.test(line)) assisted.add(current)
  }
  const files = run('git ls-files').split('\n')
  const specs = files.filter(f => /\.spec\.(ts|js)$/.test(f)).length
  let rustTests = 0
  for (const f of files.filter(f => f.endsWith('.rs'))) {
    try { rustTests += (require('fs').readFileSync(path.join(SRC, f), 'utf8').match(/#\[test\]/g) || []).length } catch {}
  }
  const docs = files.filter(f => f.startsWith('documentation/') && f.endsWith('.md')).length
  return { commits, first, assisted: assisted.size, specs, rustTests, docs, measuredAt: new Date().toISOString().slice(0, 10) }
}

const fmt = (n) => Number(n).toLocaleString('en-US')

// Shared, proposal-neutral facts. A proposal file picks what it cites.
const PROJECT = {
  name: 'Hypercomb',
  repo: 'https://github.com/hypercomb/social',
  app: 'https://hypercomb.io',
  site: 'https://hypercomb.com',
  relay: 'wss://jwize.com',
  content: 'https://pluginthematrix.com',
  licenseCode: 'AGPL-3.0-only',
  licenseDocs: 'CC BY-SA 4.0',
  maintainer: 'Jaime Weise',
  company: 'Point Blank Solutions',
  contact: 'jaime@pointblanksolutions.ca',
}

module.exports = { measure, fmt, PROJECT }
