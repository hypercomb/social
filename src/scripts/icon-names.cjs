// Extracts every Material Symbols ligature the UI actually renders, so the
// icon font can be subset to those glyphs instead of shipping all ~3000.
//
//   node scripts/icon-names.cjs          # print the sorted list, one per line
//
// Icons resolve by LIGATURE — the element's text content IS the glyph name —
// so anything that ends up as the text of a `.mat-sym` element counts, whether
// it is written literally in a template or produced by a .ts string.
const fs = require('fs'), path = require('path')

// Resolved against the repo, not the cwd, so `require`ing this from
// fetch-fonts.cjs gives the same list wherever it is invoked from.
const REPO = path.resolve(__dirname, '..')
const ROOTS = ['hypercomb-shared', 'hypercomb-web/src', 'hypercomb-dev/src', 'hypercomb-essentials/src']
  .map(r => path.join(REPO, r))
const EXT = new Set(['.html', '.ts', '.scss'])

// A ligature name is lowercase letters, digits and underscores.
const NAME = /^[a-z][a-z0-9_]*$/

// Sentinels an icon-named resolver returns that are STATES, not glyphs — rule 4
// below cannot tell them apart by shape. Keep this list tiny: an entry here is
// a claim that a name is never rendered, and a wrong claim makes a real icon
// render as its own name.
// (`opaque` is websites-group's "unknowable site" marker, not a Material glyph;
// sending it to Google would put a name in the subset request that no font has.)
const NOT_GLYPHS = new Set(['opaque'])

function walk(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out) }
    // Tests never render icons, and their fixtures ("content: 'hello'" in a
    // chat message) look exactly like the patterns below. Skip them.
    else if (EXT.has(path.extname(e.name)) && !/\.spec\.[tj]s$/.test(e.name)) out.push(p)
  }
  return out
}

const names = new Set()

// The icon picker is AUTHORITATIVE, not a heuristic: every name it offers is
// selectable at runtime and can already be sitting on a tile, so all of them
// must be in the subset whether or not any template mentions them. Miss this
// file and the picker grid renders as blank space — icon-picker.component.scss
// re-declares `.mat-sym` with NO fallback family, so a missing glyph there
// shows nothing at all. That is exactly what happened when the subset was
// first cut. Everywhere else the same miss renders the ligature NAME instead.
const PICKER = path.join(REPO, 'hypercomb-shared/ui/icon-picker/material-icon-names.ts')
if (fs.existsSync(PICKER)) {
  const src = fs.readFileSync(PICKER, 'utf8')
  const body = src.slice(src.indexOf('MATERIAL_ICON_NAMES'))
  for (const m of body.matchAll(/'([a-z][a-z0-9_]*)'|"([a-z][a-z0-9_]*)"/g)) {
    const t = m[1] ?? m[2]
    if (NAME.test(t)) names.add(t)
  }
}

// Insurance for names the rules below cannot prove are icons — see the header
// of that file for why the margin is worth its bytes.
const EXTRA = path.join(__dirname, 'icon-names.extra.txt')
if (fs.existsSync(EXTRA)) {
  for (const line of fs.readFileSync(EXTRA, 'utf8').split('\n')) {
    const t = line.trim()
    if (t && !t.startsWith('#') && NAME.test(t)) names.add(t)
  }
}

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = fs.readFileSync(file, 'utf8')

    // 1. Literal element text: <span class="mat-sym ...">settings</span>
    for (const m of src.matchAll(/class="[^"]*\bmat-sym\b[^"]*"[^>]*>([^<]*)</g)) {
      const t = m[1].trim()
      if (NAME.test(t)) names.add(t)
    }

    // 2. Interpolated text: >{{ cond ? 'play_arrow' : 'pause' }}< — both arms
    //    of the ternary are icons. Call ARGUMENTS are not: in
    //    `isOpen('tiles') ? 'expand_more' : 'chevron_right'` the icons are the
    //    arms, while 'tiles' is a section key. Drop call expressions first,
    //    then whatever literals remain are the ones that get rendered.
    for (const m of src.matchAll(/class="[^"]*\bmat-sym\b[^"]*"[^>]*>\s*\{\{([^}]*)\}\}/g)) {
      const arms = m[1].replace(/[\w$.]+\s*\([^)]*\)/g, ' ')
      for (const q of arms.matchAll(/'([^']+)'|"([^"]+)"/g)) {
        const t = (q[1] ?? q[2]).trim()
        if (NAME.test(t)) names.add(t)
      }
    }

    // 3. .ts/.scss that build the markup or name icons in data:
    //    `icon: 'folder'`, `<span class="mat-sym">${x}</span>` neighbours.
    for (const m of src.matchAll(/\bicons?\s*:\s*'([a-z][a-z0-9_]*)'/g)) names.add(m[1])
    for (const m of src.matchAll(/\bicons?\s*:\s*"([a-z][a-z0-9_]*)"/g)) names.add(m[1])
    // …and the assignment form of the same thing: `readonly icon = 'nearby'`.
    for (const m of src.matchAll(/\bicons?\s*=\s*'([a-z][a-z0-9_]*)'/g)) names.add(m[1])
    for (const m of src.matchAll(/\bicons?\s*=\s*"([a-z][a-z0-9_]*)"/g)) names.add(m[1])

    // 4. Glyph RESOLVERS: a declaration whose own name says icon, returning
    //    string literals. `case 'pools': return 'nearby'` renders a glyph just
    //    as surely as a literal in a template does.
    //
    //    Every COMPOUND name in such a switch survived without this rule only
    //    by coincidence — `push_pin`, `zoom_out`, `center_focus_strong` each
    //    happen to appear literally in some template too. The bare English
    //    words did not: `nearby` and `subject` reached the shell as the WORDS,
    //    because `.mat-sym` falls back to `system-ui` rather than blanking.
    //    Scoping to icon-named declarations is what keeps this from swallowing
    //    every string literal in the codebase and blowing the URL ceiling.
    for (const d of src.matchAll(/[\w$#]*[Ii]con[\w$]*\s*=\s*(?:\([^)]*\))?[^{]*\{/g)) {
      const from = d.index + d[0].length
      const to = src.indexOf('\n  }', from)
      const body = src.slice(from, to === -1 ? from + 4000 : to)
      // Both arms of a ternary return are glyphs; the condition is not.
      for (const r of body.matchAll(/return\s+(?:[^'"\n]*\?\s*)?'([a-z][a-z0-9_]*)'(?:\s*:\s*'([a-z][a-z0-9_]*)')?/g)) {
        if (r[1] && !NOT_GLYPHS.has(r[1])) names.add(r[1])
        if (r[2] && !NOT_GLYPHS.has(r[2])) names.add(r[2])
      }
    }
    // `content:` only counts in stylesheets, where it IS the CSS property that
    // sets a ::before ligature. In .ts it is almost always a message body.
    if (path.extname(file) === '.scss') {
      for (const m of src.matchAll(/content:\s*'([a-z][a-z0-9_]{2,})'/g)) names.add(m[1])
    }
  }
}

const sorted = [...names].sort()
if (require.main === module) console.log(sorted.join('\n'))
module.exports = sorted
