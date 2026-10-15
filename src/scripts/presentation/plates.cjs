// The eight plates, drawn in one language on the 960x400 frame.
// Tokens only (the page's :root is the one sheet); no fonts, gradients, filters or motion inside.
// The shared helpers and tokens live in plates/lib.cjs; each plate is one module in
// plates/<name>.cjs exporting a function that returns the SVG string.
//   node plates.cjs            → visuals/*.svg
//   node plates.cjs ai-door    → visuals/ai-door.svg (one plate)
const fs = require('fs'), path = require('path')
const OUT = path.join(__dirname, 'visuals')
const DIR = path.join(__dirname, 'plates')
const names = fs.readdirSync(DIR).filter(f => f.endsWith('.cjs') && f !== 'lib.cjs').map(f => f.slice(0, -4)).sort()
const wanted = process.argv.slice(2)
for (const n of wanted) if (!names.includes(n)) { console.error(`unknown plate: ${n} (${names.join(', ')})`); process.exit(1) }
const todo = wanted.length ? wanted : names
for (const name of todo) fs.writeFileSync(path.join(OUT, name + '.svg'), require(path.join(DIR, name + '.cjs'))())
console.log('plates:', todo.join(', '))
