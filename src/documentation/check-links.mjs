// Link audit — scans repo markdown for broken relative links and anchors.
// Run with: npm run docs:links   (exits 1 if any link is broken)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve, sep } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.angular', 'out-tsc', 'coverage', 'public', '.claude', 'hypercomb-legacy'])

function* mdFiles(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* mdFiles(full)
    } else if (name.endsWith('.md')) {
      yield full
    }
  }
}

// strip code fences so links inside ``` blocks are ignored
function stripCode(text) {
  return text.replace(/```[\s\S]*?```/g, m => m.replace(/[^\n]/g, ' '))
             .replace(/`[^`\n]*`/g, m => ' '.repeat(m.length))
}

function slugify(heading) {
  return heading.toLowerCase().trim()
    .replace(/[`*_~]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\wÀ-￿\- ]/g, '')
    .replace(/ /g, '-')
}

const headingCache = new Map()
function anchorsOf(file) {
  if (!headingCache.has(file)) {
    const text = stripCode(readFileSync(file, 'utf8'))
    const set = new Set()
    for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
      let slug = slugify(m[1]); let s = slug; let i = 1
      while (set.has(s)) s = `${slug}-${i++}`
      set.add(s)
    }
    headingCache.set(file, set)
  }
  return headingCache.get(file)
}

const broken = []
for (const file of mdFiles(ROOT)) {
  const text = stripCode(readFileSync(file, 'utf8'))
  const links = [
    ...text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g),  // inline links
    ...text.matchAll(/^\[[^\]]+\]:\s*(\S+)/gm),                    // reference defs
  ]
  for (const m of links) {
    let target = m[1]
    if (/^(https?|mailto|wss?|ftp):/.test(target)) continue
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1)
    const [pathPart, anchor] = target.split('#')
    const resolved = pathPart === '' ? file : resolve(dirname(file), decodeURIComponent(pathPart))
    if (pathPart !== '' && !existsSync(resolved)) {
      broken.push({ file, target, reason: 'missing file' })
      continue
    }
    if (anchor && resolved.endsWith('.md') && existsSync(resolved)) {
      if (!anchorsOf(resolved).has(anchor.toLowerCase())) {
        broken.push({ file, target, reason: 'missing anchor' })
      }
    }
  }
}

for (const b of broken) {
  console.log(`${b.file.slice(ROOT.length + 1)} -> ${b.target}  [${b.reason}]`)
}
console.log(`\n${broken.length} broken link(s) found`)
process.exitCode = broken.length ? 1 : 0
