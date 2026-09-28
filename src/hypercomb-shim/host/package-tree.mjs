// THE PACKAGE AS TILES, SOURCE AND ALL. A package revision keeps its source
// the way the hive keeps everything: on the living primitive
// (life-primitive.md), as the tiles the code belongs to. Never a side list of
// paths: a file is a child of the unit it was compiled into, that unit is a
// beehavior (or an atom) of the tile its folder is, and each tile names the
// cell layer the package runs, so the code a hive runs and the code it was
// written as are one tree, drilled from the package down to the file.
//
//   package   { name, package: <package sig>, children }
//   tile      { name, cell?: <cell layer sig>, namespace?: <barrel sig>, children }
//   behaviour { name: <class>, bee: M(bee), dependencies: [sig], children }   — the spot's own shape
//   atom      { name: <src path>, dependency: <sig>, children }
//   file      { name: <repo path>, content: M(resource) }                    — the spot's own shape
//
// M(x) is a meta envelope's signature ({ meta: 1, …, relation }). Every
// record is signature-named. A file is placed exactly once: under the unit
// named by it, else the unit that inlined it, else its folder's tile; a spec
// rides with the unit it tests. The build cache is the witness: a source
// edited after the package was built is refused, never kept as the code
// that runs.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const posix = path => path.split(sep).join('/')
const IMPORTED = /(?:\bfrom|\bimport)\s*\(?\s*"([^"]+)"/g
/** Never source: what a build or an install makes. */
const MADE = /(^|\/)(node_modules|dist|\.git)(\/|$)|(^|\/)\.build-cache\.json$/

/** The package's own files: what its checkout tracks, or — with no checkout
 *  (a generic release) — every file under it that no build made. */
const packageFiles = async packageDir => {
  try {
    const out = execFileSync('git', ['-C', packageDir, 'ls-files', '-z', '--', '.'], { stdio: ['ignore', 'pipe', 'ignore'] })
    return out.toString('utf8').split('\0').filter(Boolean).filter(p => !MADE.test(p))
  } catch {
    const files = []
    const walk = async dir => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name)
        const rel = posix(relative(packageDir, path))
        if (MADE.test(rel)) continue
        if (entry.isDirectory()) await walk(path)
        else if (entry.isFile()) files.push(rel)
      }
    }
    await walk(packageDir)
    return files
  }
}

/**
 * Build a package's tile tree into a pool. `keep(bytes)` stores bytes under
 * their signature and returns it. Returns the root, the package, the atoms
 * the package runs (its closure), and how many files the tree holds.
 */
export const packageTree = async ({ packageDir, repoRoot, keep }) => {
  const dist = resolve(packageDir, 'dist')
  const manifest = JSON.parse(await readFile(resolve(dist, 'manifest.json'), 'utf8').catch(() => 'null'))
  const cache = JSON.parse(await readFile(resolve(packageDir, '.build-cache.json'), 'utf8').catch(() => 'null'))
  const packageSig = Object.keys(manifest?.packages ?? {})[0]
  if (!packageSig || !cache) throw new Error(`${packageDir} is not built — npm run build:module`)
  const bare = ref => ref.replace(/\.js$/, '')
  const read = sig => readFile(resolve(dist, bare(sig)))
  const record = async value => keep(Buffer.from(JSON.stringify(value)))
  const meta = payload => record({ meta: 1, ...payload })

  // THE PACKAGE AS IT RUNS: its cells (folders) with their bees, and every
  // dependency by the specifier its first line names.
  const top = JSON.parse(await read(packageSig))
  const atoms = new Set([packageSig])
  const cellOf = new Map(), classOf = new Map()
  const walkCells = async (sig, path) => {
    atoms.add(bare(sig))
    const layer = JSON.parse(await read(sig))
    if (path !== null) cellOf.set(path, bare(sig))
    for (const bee of layer.bees ?? []) atoms.add(bare(bee))
    for (const [ref, doc] of Object.entries(layer.docs?.bees ?? {})) if (doc?.className) classOf.set(bare(ref), doc.className)
    for (const child of layer.cells ?? []) {
      const name = JSON.parse(await read(child)).name
      await walkCells(child, path === null ? name : `${path}/${name}`)
    }
  }
  await walkCells(packageSig, null)
  const bySpecifier = new Map()
  for (const ref of top.dependencies ?? []) {
    atoms.add(bare(ref))
    const specifier = /^\/\/\s+(\S+)/.exec((await read(ref)).subarray(0, 512).toString('utf8').split('\n', 1)[0])?.[1]
    if (specifier) bySpecifier.set(specifier, bare(ref))
  }
  for (const resource of top.resources ?? []) if (resource?.sig) atoms.add(resource.sig)

  // THE UNITS, from the build cache: which source each bee and atom was
  // compiled from, and the hash each file had when it was.
  // The cache names files absolutely, from whichever checkout built it.
  const marker = `/${basename(packageDir)}/`
  const srcRel = file => { const p = posix(file); const at = p.lastIndexOf(marker); return at >= 0 ? p.slice(at + marker.length) : p }
  const inPackage = file => posix(relative(packageDir, resolve(packageDir, 'src', file)))
  const unitOf = new Map() // package-relative path → unit
  const units = []
  const recorded = new Map()
  for (const [kind, table] of [['bee', cache.bees], ['atom', cache.atoms]]) {
    for (const [key, unit] of Object.entries(table ?? {})) {
      const u = { kind, key: inPackage(key), sig: unit.outputSig, files: [] }
      units.push(u)
      unitOf.set(u.key, u)
      for (const [file, entry] of Object.entries(unit.files ?? {})) recorded.set(srcRel(file), entry.sig)
    }
  }
  // A file inlined by a unit that is not its own belongs to the first such unit.
  for (const u of units.sort((a, b) => a.key < b.key ? -1 : 1)) {
    const table = u.kind === 'bee' ? cache.bees : cache.atoms
    const entry = Object.entries(table).find(([k]) => inPackage(k) === u.key)?.[1]
    for (const file of Object.keys(entry?.files ?? {})) {
      const path = srcRel(file)
      if (path !== u.key && !unitOf.has(path)) unitOf.set(path, u)
    }
  }
  const namespaceOf = new Map(Object.entries(cache.namespaces ?? {}).map(([k, u]) => [k, u.outputSig]))

  // Place every file once.
  const files = [...new Set([...await packageFiles(packageDir), ...recorded.keys()])].sort()
  const bytesOf = new Map()
  for (const path of files) {
    const bytes = await readFile(resolve(packageDir, path))
    if (recorded.has(path) && recorded.get(path) !== sha(bytes)) {
      throw new Error(`${posix(relative(repoRoot, resolve(packageDir, path)))} changed since the package was built: rebuild it (npm run build:module)`)
    }
    bytesOf.set(path, bytes)
  }
  const specOwner = path => {
    const m = /^(.*)\.spec\.(tsx?)$/.exec(path)
    return m ? unitOf.get(`${m[1]}.${m[2]}`) ?? null : null
  }
  const under = new Map() // unit → [paths]
  const loose = [] // paths that belong to their folder's tile
  for (const path of files) {
    const owner = unitOf.get(path) ?? specOwner(path)
    if (owner) { if (!under.has(owner)) under.set(owner, []); under.get(owner).push(path) }
    else loose.push(path)
  }

  const fileNode = async path => {
    const content = await meta({ resource: await keep(bytesOf.get(path)), relation: 'content' })
    return record({ name: posix(relative(repoRoot, resolve(packageDir, path))), content })
  }
  const childOf = async (layer, relation = 'children') => meta({ layer, relation })
  const fileChildren = async paths => {
    const out = []
    for (const path of [...paths].sort()) out.push(await childOf(await fileNode(path)))
    return out
  }
  const closureOf = beeSig => {
    const seen = new Set(), queue = [beeSig]
    return (async () => {
      while (queue.length) {
        for (const [, specifier] of (await read(queue.shift())).toString('utf8').matchAll(IMPORTED)) {
          const dep = bySpecifier.get(specifier)
          if (!dep || seen.has(dep)) continue
          seen.add(dep); queue.push(dep)
        }
      }
      return [...seen].sort()
    })()
  }

  // Each folder's members, then the folders bottom-up into tiles.
  const members = new Map() // folder → [{ order, sig }]
  const add = (folder, order, sig) => { if (!members.has(folder)) members.set(folder, []); members.get(folder).push({ order, sig }) }
  for (const u of units) {
    const paths = under.get(u) ?? []
    const folder = dirname(u.key) === '.' ? '' : dirname(u.key)
    if (u.kind === 'bee') {
      const behaviour = await record({
        name: classOf.get(u.sig) ?? basename(u.key).replace(/\.tsx?$/, ''),
        bee: await meta({ bee: u.sig, relation: 'bee' }),
        dependencies: await closureOf(u.sig),
        children: await fileChildren(paths),
      })
      add(folder, `1 ${u.key}`, await childOf(behaviour, 'beehavior'))
    } else {
      const atom = await record({ name: posix(relative(repoRoot, resolve(packageDir, u.key))), dependency: u.sig, children: await fileChildren(paths) })
      add(folder, `2 ${u.key}`, await childOf(atom, 'dependency'))
    }
  }
  for (const path of loose) add(dirname(path) === '.' ? '' : dirname(path), `3 ${path}`, await childOf(await fileNode(path)))

  const folders = new Set([''])
  for (const folder of members.keys()) for (let f = folder; f && f !== '.'; f = dirname(f) === '.' ? '' : dirname(f)) folders.add(f)
  const depth = f => f ? f.split('/').length : 0
  for (const folder of [...folders].sort((a, b) => depth(b) - depth(a) || (a < b ? -1 : 1))) {
    if (!folder) continue
    const inSrc = folder.startsWith('src/') ? folder.slice(4) : null
    const tile = await record({
      name: basename(folder),
      ...(inSrc && cellOf.has(inSrc) ? { cell: cellOf.get(inSrc) } : {}),
      ...(inSrc && namespaceOf.has(inSrc) ? { namespace: namespaceOf.get(inSrc) } : {}),
      children: (members.get(folder) ?? []).sort((a, b) => a.order < b.order ? -1 : 1).map(m => m.sig),
    })
    const parent = dirname(folder) === '.' ? '' : dirname(folder)
    add(parent, `0 ${folder}`, await childOf(tile))
  }
  const root = await record({
    name: basename(packageDir),
    package: packageSig,
    children: (members.get('') ?? []).sort((a, b) => a.order < b.order ? -1 : 1).map(m => m.sig),
  })
  return { root, packageSig, atoms: [...atoms].sort(), files: files.length }
}

/** Every file a tree holds, by repo path → resource signature, and every
 *  signature it reaches (records, envelopes, resources, the package's atoms). */
export const walkTree = async (rootSig, readRecord) => {
  const files = new Map(), reach = new Set()
  const visit = async (sig, name) => {
    if (reach.has(sig)) return
    reach.add(sig)
    const node = await readRecord(sig)
    if (!node || typeof node !== 'object') return
    if (node.meta === 1) {
      // An envelope: its target is a record to walk, or a leaf (a resource, a bee).
      if (node.resource) { reach.add(node.resource); if (name) files.set(name, node.resource) }
      if (node.bee) reach.add(node.bee)
      if (node.layer) await visit(node.layer)
      return
    }
    for (const key of ['dependency', 'cell', 'namespace', 'package']) if (typeof node[key] === 'string') reach.add(node[key])
    for (const dep of node.dependencies ?? []) reach.add(dep)
    if (node.content) await visit(node.content, node.name)
    if (node.bee) await visit(node.bee)
    for (const child of node.children ?? []) await visit(child)
  }
  await visit(rootSig)
  return { files, reach }
}
