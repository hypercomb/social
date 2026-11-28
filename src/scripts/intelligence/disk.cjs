// Intelligence groups, passivated on disk for management.
//
// A resource is content. It stays on a host. This disk does not keep the
// dump. A group remembers a problem in group.json. Each result is a member
// of the pool intelligence:<group>. The pool directory is sign of that
// meaning. The member's name is sha256 of the canonical arguments. The file
// holds the domain and the answer's own signature. Retrieval is
// GET https://<domain>/<answer>, and the body is kept only when it hashes
// to the answer signature.

const { createHash } = require('node:crypto')
const { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } = require('node:fs')
const { dirname, join } = require('node:path')

const HASH = /^[0-9a-f]{64}$/
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

const canonical = (value) => {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('arguments must be finite')
    return JSON.stringify(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object') {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  throw new Error('arguments must be canonical JSON')
}

const hashArguments = (value) => createHash('sha256').update(canonical(value), 'utf8').digest('hex')

const assertHash = (hash) => {
  if (!HASH.test(hash)) throw new Error('a hash is 64 lowercase hex characters')
}

const assertDomain = (domain) => {
  if (!DOMAIN.test(domain)) throw new Error('a domain is a hostname, with no scheme and no path')
}

const slug = (name) => {
  const out = String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!out || HASH.test(out)) throw new Error('a group needs a name')
  return out
}

const intelligenceRoot = (env = process.env) => {
  const base = env.LOCALAPPDATA
  if (!base) throw new Error('LOCALAPPDATA is not set')
  return join(base, 'hypercomb', 'intelligence')
}

const groupDir = (root, name) => join(root, slug(name))
const groupFile = (root, name) => join(groupDir(root, name), 'group.json')
const poolMeaning = (name) => `intelligence:${slug(name)}`
const poolAddress = (name) => createHash('sha256').update(poolMeaning(name), 'utf8').digest('hex')
const poolDir = (root, name) => join(root, poolAddress(name))

const addGroup = (root, name, problem) => {
  const text = String(problem ?? '').trim()
  if (!text) throw new Error('a group needs the problem it solves')
  const dir = groupDir(root, name)
  mkdirSync(dir, { recursive: true })
  const file = groupFile(root, name)
  if (!existsSync(file)) {
    writeFileSync(file, `${JSON.stringify({ kind: 'intelligence-group', name: slug(name), problem: text }, null, 2)}\n`)
  }
  return { name: slug(name), dir }
}

const listGroups = (root) => {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'group.json')))
    .map((entry) => JSON.parse(readFileSync(join(root, entry.name, 'group.json'), 'utf8')))
}

const memberText = (domain, answer) => `${domain}\n${answer}\n`

const readMember = (text, argumentHash) => {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length >= 2 && DOMAIN.test(lines[0]) && HASH.test(lines[1])) return { domain: lines[0], answer: lines[1] }
  if (lines.length === 1 && DOMAIN.test(lines[0])) return { domain: lines[0], answer: argumentHash }
  if (lines.length === 1 && HASH.test(lines[0])) return { domain: '', answer: lines[0] }
  return null
}

const remember = (root, name, domain, hash, answer = hash) => {
  assertDomain(domain)
  assertHash(hash)
  assertHash(answer)
  if (!existsSync(groupFile(root, name))) throw new Error(`no intelligence group ${slug(name)}`)
  const dir = poolDir(root, name)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, hash)
  if (existsSync(file)) {
    const stored = readMember(readFileSync(file, 'utf8'), hash)
    return stored ? { domain: stored.domain, hash, answer: stored.answer } : { domain, hash, answer }
  }
  writeFileSync(file, memberText(domain, answer))
  return { domain, hash, answer }
}

const rememberArguments = (root, name, domain, args, answer) =>
  remember(root, name, domain, hashArguments(args), answer || hashArguments(args))

const refs = (root, name) => {
  const dir = poolDir(root, name)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((entry) => HASH.test(entry))
    .sort()
    .map((hash) => {
      const stored = readMember(readFileSync(join(dir, hash), 'utf8'), hash)
      return stored ? { domain: stored.domain, hash, answer: stored.answer } : null
    })
    .filter(Boolean)
}

const resourceUrl = (domain, hash, base) => {
  assertDomain(domain)
  assertHash(hash)
  const origin = (base ?? `https://${domain}`).replace(/\/$/, '')
  return `${origin}/${hash}`
}

const homeFile = (root) => join(dirname(root), 'intelligence-home.json')

const readHome = (root) => {
  const file = homeFile(root)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed?.kind !== 'intelligence-home' || parsed.set !== true || typeof parsed.path !== 'string') {
      return { broken: true }
    }
    return parsed
  } catch {
    return { broken: true }
  }
}

const writeHome = (root) => {
  writeFileSync(homeFile(root), `${JSON.stringify({ kind: 'intelligence-home', path: root, set: true }, null, 2)}\n`)
}

const lostRights = (error) => error?.code === 'EPERM' || error?.code === 'EACCES'

const probe = (dir) => {
  const mark = join(dir, '.write-probe')
  writeFileSync(mark, '')
  unlinkSync(mark)
}

const notice = (result) => {
  if (result.kind === 'started') return `started ${result.path}`
  if (result.reason === 'rights') {
    return `The intelligence folder was set at ${result.path} and this process cannot write it. The folder did not give up its rights; this process does not have them. Restore access, then reset the folder: intelligence reset`
  }
  return `The intelligence folder was set at ${result.path} and is disconnected. Reset the folder: intelligence reset`
}

const start = (root, hooks = {}) => {
  const check = hooks.probe ?? probe
  const recorded = readHome(root)
  if (!recorded) {
    mkdirSync(root, { recursive: true })
    check(root)
    writeHome(root)
    return { kind: 'started', path: root }
  }
  if (recorded.broken || recorded.path !== root) {
    return { kind: 'reset', path: root, reason: 'disconnected' }
  }
  try {
    check(root)
    return { kind: 'started', path: root, already: true }
  } catch (error) {
    if (lostRights(error)) return { kind: 'reset', path: root, reason: 'rights' }
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return { kind: 'reset', path: root, reason: 'disconnected' }
    }
    throw error
  }
}

const reset = (root, hooks = {}) => {
  const check = hooks.probe ?? probe
  if (existsSync(root)) {
    try {
      check(root)
    } catch (error) {
      if (!lostRights(error)) throw error
      const refused = new Error(`${notice({ kind: 'reset', path: root, reason: 'rights' })} Reset will not delete it.`)
      refused.code = 'ERIGHTS'
      throw refused
    }
  } else {
    mkdirSync(root, { recursive: true })
    check(root)
  }
  writeHome(root)
  return { kind: 'started', path: root, reset: true }
}

const lookup = (root, name, args) => {
  const hash = hashArguments(args)
  const file = join(poolDir(root, name), hash)
  if (!existsSync(file)) return null
  const stored = readMember(readFileSync(file, 'utf8'), hash)
  if (!stored?.domain || !stored.answer) return null
  return { domain: stored.domain, hash, answer: stored.answer }
}

const get = async (root, name, args, options = {}) => {
  const member = lookup(root, name, args)
  if (!member) {
    const missed = new Error(`no member in ${poolMeaning(name)} for ${hashArguments(args)}`)
    missed.code = 'EMISS'
    throw missed
  }
  return retrieve(member.domain, member.answer, options)
}

const retrieve = async (domain, hash, options = {}) => {
  const url = resourceUrl(domain, hash, options.base)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${domain} answered ${response.status} for ${hash}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const got = createHash('sha256').update(bytes).digest('hex')
  if (got !== hash) throw new Error(`${domain} returned bytes that do not hash to ${hash}`)
  return bytes
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value)

// The axial plane. The same signed q and r recompute the same s.
const cubeS = (q, r) => -q - r

// Clockwise 60°: (q, r, s) -> (-r, -s, -q), and s = -q - r, so (q, r) -> (-r, q + r).
// Six turns come back to the same cube. The shape canon is computed, never authored:
// translate so the minimum (q, then r) is the origin, try the six turns, and keep
// the lexicographically smallest coordinate list.
const turnCube = (q, r) => ({ q: -r, r: q + r })

const integer = (value) => finite(value) && Number.isInteger(value)

const canonCoords = (coords) => {
  if (!Array.isArray(coords) || coords.length === 0) throw new Error('a shape is a list of cubes')
  for (const cube of coords) {
    if (!integer(cube?.q) || !integer(cube?.r)) throw new Error('a cube has integer q and r')
  }
  let best = null
  let bestText = null
  for (let turn = 0; turn < 6; turn++) {
    const turned = coords.map((cube) => {
      let q = cube.q
      let r = cube.r
      for (let step = 0; step < turn; step++) {
        const next = turnCube(q, r)
        q = next.q
        r = next.r
      }
      return { q, r }
    })
    let origin = turned[0]
    for (const cube of turned) {
      if (cube.q < origin.q || (cube.q === origin.q && cube.r < origin.r)) origin = cube
    }
    const placed = turned
      .map((cube) => ({ q: cube.q - origin.q, r: cube.r - origin.r }))
      .sort((a, b) => a.q - b.q || a.r - b.r)
    const text = canonical(placed)
    if (bestText === null || text < bestText) {
      bestText = text
      best = placed
    }
  }
  return best
}

const ATTRIBUTE_KEYS = new Set(['kind', 'op', 'pose', 'param', 'delta', 'on', 'out'])
const FORBIDDEN_ATTRIBUTE = ['author', 'path', 'clock', 'at', 'time', 'who', 'pubkey']

const poseOf = (pose) => {
  if (!pose || typeof pose !== 'object' || Array.isArray(pose)) return null
  const keys = Object.keys(pose)
  if (keys.length !== 1) return null
  if (keys[0] === 'n' && integer(pose.n) && pose.n >= 0 && pose.n <= 5) return { n: pose.n }
  if (keys[0] === 'rot' && integer(pose.rot) && pose.rot >= 0 && pose.rot <= 5) return { rot: pose.rot }
  if (keys[0] === 'step' && pose.step && integer(pose.step.q) && integer(pose.step.r) && Object.keys(pose.step).length === 2) {
    return { step: { q: pose.step.q, r: pose.step.r } }
  }
  return null
}

// A public lesson. A record that is not a use attribute is not an edge.
// A use attribute that names a person, a path, or a clock is refused.
const attributeEdge = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.kind !== 'use') return null
  for (const key of FORBIDDEN_ATTRIBUTE) {
    if (Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`an attribute carries no ${key}`)
  }
  for (const key of Object.keys(value)) {
    if (!ATTRIBUTE_KEYS.has(key)) throw new Error(`an attribute carries no ${key}`)
  }
  const pose = poseOf(value.pose)
  if (typeof value.op !== 'string' || value.op.trim() === '' || !pose || typeof value.param !== 'string' || value.param.trim() === '') {
    throw new Error('an attribute names the act')
  }
  if (!finite(value.delta) || !HASH.test(value.on)) throw new Error('an attribute names the act')
  if (value.out !== undefined && !HASH.test(value.out)) throw new Error('an attribute names the act')
  const edge = { on: value.on, op: value.op, pose, param: value.param, delta: value.delta }
  if (value.out !== undefined) edge.out = value.out
  return edge
}

const graph = async (root, name, options = {}) => {
  const edges = []
  for (const member of refs(root, name)) {
    if (!member.domain || !member.answer) continue
    const text = (await retrieve(member.domain, member.answer, options)).toString('utf8')
    let value
    try {
      value = JSON.parse(text)
    } catch {
      continue
    }
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.kind !== 'use') continue
    if (canonical(value) !== text) throw new Error('an attribute is the canonical bytes')
    const edge = attributeEdge(value)
    if (edge) edges.push(edge)
  }
  return edges
}

const check = async (root, name, args, options = {}) => {
  const member = lookup(root, name, args)
  if (!member) {
    const missed = new Error(`no member in ${poolMeaning(name)} for ${hashArguments(args)}`)
    missed.code = 'EMISS'
    throw missed
  }
  return checkCube(member.domain, member.answer, options)
}

const checkCube = async (domain, hash, options = {}) => {
  const bytes = await retrieve(domain, hash, options)
  const text = bytes.toString('utf8')
  let value
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('a cube record is canonical JSON')
  }
  if (canonical(value) !== text) throw new Error('a cube record is the canonical arguments')
  if (!value || typeof value !== 'object' || !finite(value.q) || !finite(value.r) || !finite(value.s)) {
    throw new Error('a cube record has finite q, r, and s')
  }
  const s = cubeS(value.q, value.r)
  if (value.s !== s) throw new Error(`the difference does not recompute: s is ${value.s}, and -q - r is ${s}`)
  return { q: value.q, r: value.r, s }
}

module.exports = {
  addGroup,
  assertDomain,
  assertHash,
  attributeEdge,
  canonical,
  canonCoords,
  check,
  checkCube,
  cubeS,
  graph,
  groupDir,
  get,
  hashArguments,
  intelligenceRoot,
  lookup,
  poolAddress,
  poolMeaning,
  listGroups,
  remember,
  rememberArguments,
  refs,
  homeFile,
  notice,
  reset,
  resourceUrl,
  retrieve,
  slug,
  start,
}
