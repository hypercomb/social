// Fill `resource:{<file>}` in meetups-home.src.html with each file's sha256
// (the hive resolves resource:<sig>), and write a preview that points at the
// files beside it (only with --preview; it is never committed). The files themselves ride into the hive with the sentence:
//   say.cjs "website page {meetups-home.html}" --file meetups-home.html --file hero.webp ...
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const here = __dirname
const src = fs.readFileSync(path.join(here, 'meetups-home.src.html'), 'utf8')
const files = new Set([...src.matchAll(/resource:\{([^}]+)\}/g)].map(m => m[1]))
const sigOf = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(here, f))).digest('hex')
let hive = src, preview = src
for (const f of files) {
  hive = hive.split(`resource:{${f}}`).join(`resource:${sigOf(f)}`)
  preview = preview.split(`resource:{${f}}`).join(f)
}
fs.writeFileSync(path.join(here, 'meetups-home.html'), hive)
if (process.argv.includes('--preview')) fs.writeFileSync(path.join(here, 'preview.html'), preview)
console.log([...files].join(' '))
