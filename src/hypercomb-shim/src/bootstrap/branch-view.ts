// hypercomb-shim/src/bootstrap/branch-view.ts
//
// The host page's look at one signature: the branch as folders, which files
// are loaded, and the edits that mint a new root. The AI module is not
// loaded with the page. A mission name loads it from that subdomain.

import { deriveMinifiedLayer, minifyModuleBody, ownedMinifyTool } from '@hypercomb/core'
import {
  broadcastFace, diffBranches, loadAi, mintBranch, missionOrigin, packFiles, publishInstanceHead, readBranch,
  type Branch, type BranchEdits, type BranchFile, type BranchRead, type LayerNode, type PublishedHead,
} from './branch-files.js'

export type BranchViewOptions = {
  rootSig: string
  /** The domain the signature was opened from. */
  source: string
  read: BranchRead
  /** The package this origin is running, when it has one. */
  installed?: string
}

const STYLE = `
.branch-view { margin: 1.5rem 0 0; padding: 1rem 0 0; border-top: 1px solid var(--md-outline-variant); }
.branch-view h2 { margin: 0 0 .35rem; font-size: 1rem; }
.branch-view .note { margin: 0 0 .8rem; color: var(--md-on-surface-var); }
.branch-view .row { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin: .4rem 0; }
.branch-view code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: .78rem; overflow-wrap: anywhere; }
.branch-view details { margin-left: .6rem; }
.branch-view summary { cursor: pointer; }
.branch-view label { display: flex; gap: .45rem; align-items: baseline; }
.branch-view label.off { opacity: .45; }
.branch-view .kind { color: var(--md-on-surface-faint); font-size: .75rem; }
.branch-view iframe.mission-ai { width: 100%; height: 24rem; margin-top: .8rem; border: 1px solid var(--md-outline-variant); border-radius: .7rem; background: var(--md-surface); }
.branch-view .beside { margin: .6rem 0; padding-left: 1rem; }
.branch-view .beside li { display: block; padding: .25rem 0; }
.branch-view .published-head { margin: 0 0 .8rem; }
.branch-view .head-lines { margin: .3rem 0; white-space: pre-wrap; }
.branch-view .mind { margin: .3rem 0; padding-left: 1rem; }
.branch-view .mind code { display: block; }
`

const short = (sig: string): string => `${sig.slice(0, 12)}…`

const editsOf = (offPaths: Set<string>, offSigs: Set<string>, traits: { path: string; word: string }[], choices: { path: string; sig: string; source: string }[]): BranchEdits => ({
  offPaths: [...offPaths],
  offSigs: [...offSigs],
  traits,
  choices,
})

type DerivedKeep = {
  pool: string
  member: string
  dialects: string
  dialect: string
  dialectBytes: Uint8Array
}

/** Write the derived bytes and name the record in this origin's pools, when
 *  the store is already open. An empty member file is the listing. The bytes
 *  live at their own signatures. */
const keepDerived = async (membership: DerivedKeep, files: ReadonlyMap<string, Uint8Array>): Promise<boolean> => {
  const store = (globalThis as { ioc?: { get?: (key: string) => {
    putResource?: (blob: Blob, options?: { emit?: boolean }) => Promise<string>
    getPool?: (meaning: string) => Promise<{ getFileHandle: (name: string, options: { create: boolean }) => Promise<unknown> } | null>
  } | undefined } }).ioc?.get?.('@hypercomb.social/Store')
  if (!store?.putResource || !store.getPool) return false
  try {
    for (const [sig, bytes] of files) {
      if (await store.putResource(new Blob([new Uint8Array(bytes)]), { emit: false }) !== sig) return false
    }
    if (await store.putResource(new Blob([new Uint8Array(membership.dialectBytes)]), { emit: false }) !== membership.dialect) return false
    for (const [meaning, member] of [[membership.pool, membership.member], [membership.dialects, membership.dialect]] as const) {
      const pool = await store.getPool(meaning)
      if (!pool) return false
      await pool.getFileHandle(member, { create: true })
    }
    return true
  } catch { return false }
}

/** The branch of one signature, as folders you can prune, mark, and mint. */
export const branchView = (options: BranchViewOptions): HTMLElement => {
  const view = document.createElement('section')
  view.className = 'branch-view'
  const style = document.createElement('style')
  style.textContent = STYLE
  const heading = document.createElement('h2')
  heading.textContent = 'Files'
  const note = document.createElement('p')
  note.className = 'note'
  note.textContent = options.installed === options.rootSig
    ? 'These are the files loaded here. The hive chat organizes tiles. A mission runs on its own subdomain, and what it saves stays in that origin\'s store.'
    : 'The hive chat organizes tiles. A mission runs on its own subdomain, and what it saves stays in that origin\'s store.'
  const status = document.createElement('p')
  status.className = 'status'
  status.setAttribute('role', 'status')
  status.textContent = 'Reading the branch…'
  const tree = document.createElement('div')
  tree.className = 'branch-tree'
  const beside = document.createElement('div')
  const minted = document.createElement('div')
  minted.className = 'minted'
  const publishedHead = document.createElement('div')
  publishedHead.className = 'published-head'
  publishedHead.hidden = true
  view.append(style, heading, note, publishedHead, status, tree, beside, minted)

  const offPaths = new Set<string>()
  const offSigs = new Set<string>()
  const traits: { path: string; word: string }[] = []
  const choices: { path: string; sig: string; source: string }[] = []
  const held = new Map<string, Uint8Array>()
  const derived = new Map<string, ReadonlyMap<string, Uint8Array>>()
  const read: BranchRead = async sig => held.get(sig) ?? options.read(sig)
  let selected = ''
  let current: Branch | null = null
  let aiRelease = (): void => {}
  let headUrl = ''
  let working: { package: string; derivation: string | null; face: readonly string[] } = {
    package: options.rootSig,
    derivation: null,
    face: [],
  }

  const faceOf = (files: readonly { sig: string }[]): string[] =>
    [...new Set(files.map(file => file.sig.toLowerCase()).filter(sig => /^[a-f0-9]{64}$/.test(sig)))].sort()

  const renderPublished = (published: PublishedHead): void => {
    if (headUrl) URL.revokeObjectURL(headUrl)
    publishedHead.hidden = false
    publishedHead.replaceChildren()
    const line = document.createElement('p')
    const pkg = document.createElement('code')
    pkg.className = 'package'
    pkg.textContent = published.package
    line.append(
      document.createTextNode('Published to the head. Further builds leave these signatures in place. Package '),
      pkg,
    )
    const lines = document.createElement('pre')
    lines.className = 'head-lines'
    lines.textContent = published.head
    const count = document.createElement('p')
    count.textContent = `${published.face.length} signatures to mind.`
    const list = document.createElement('ul')
    list.className = 'mind'
    for (const sig of published.face) {
      const item = document.createElement('li')
      const code = document.createElement('code')
      code.textContent = sig
      item.append(code)
      list.append(item)
    }
    const file = document.createElement('a')
    headUrl = URL.createObjectURL(new Blob([published.head], { type: 'text/plain' }))
    file.href = headUrl
    file.download = 'head'
    file.textContent = 'Save the head file'
    publishedHead.append(line, lines, count, list, file)
    if (published.derivation) {
      const derived = document.createElement('p')
      const code = document.createElement('code')
      code.className = 'derivation'
      code.textContent = published.derivation
      derived.append(document.createTextNode('Derivation '), code)
      line.after(derived)
    }
    if (published.served) {
      const here = document.createElement('p')
      here.textContent = 'This browser answers GET /head with this build.'
      file.before(here)
    }
  }

  /** Minify one layer into `derived:<that layer>`. A failure stays on the page
   *  and leaves the registration that asked for it as it is. */
  const landMinified = async (node: { path: string; sig: string }, where = node.path || 'the root'): Promise<void> => {
    const tool = await ownedMinifyTool()
    let tree: Awaited<ReturnType<typeof deriveMinifiedLayer>>
    try {
      tree = await deriveMinifiedLayer(node.sig, read, async body => minifyModuleBody(body), tool)
    } catch (err) {
      const fail = document.createElement('p')
      fail.textContent = err instanceof Error ? err.message : 'This folder could not be minified.'
      minted.append(fail)
      return
    }
    for (const [sig, bytes] of tree.files) held.set(sig, bytes)
    derived.set(tree.root, tree.files)
    if (node.path === '') {
      const named = new Set<string>([tree.root, tree.derivation.sig])
      for (const sig of tree.files.keys()) named.add(sig)
      for (const sig of tree.readable.bees) if (!tree.modules.has(sig)) named.add(sig)
      for (const sig of tree.readable.dependencies) if (!tree.modules.has(sig)) named.add(sig)
      working = { package: tree.root, derivation: tree.derivation.sig, face: [...named].sort() }
    }
    if (node.path) {
      const at = choices.findIndex(choice => choice.path === node.path)
      const choice = { path: node.path, sig: tree.root, source: 'minify' }
      if (at >= 0) choices[at] = choice
      else choices.push(choice)
    }
    const kept = await keepDerived(tree.membership, tree.files)
    const line = document.createElement('p')
    const code = document.createElement('code')
    code.textContent = tree.root
    const follow = node.path
      ? 'Choosing it rewrites the layers above it.'
      : 'This signature is the minified package.'
    line.append(
      document.createTextNode(`Minified ${where}. `),
      code,
      document.createTextNode(
        ` Its record is a member of ${tree.membership.pool}. ${kept ? 'This origin holds the bytes.' : `Pack the layer to keep the bytes. ${follow}`}`,
      ),
    )
    const packLayer = document.createElement('button')
    packLayer.type = 'button'
    packLayer.textContent = 'Pack minified layer'
    packLayer.addEventListener('click', () => {
      void packFiles(tree.files).then(bytes => {
        const blob = new Blob([bytes], { type: 'application/gzip' })
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = `${tree.root.slice(0, 12)}.pack.gz`
        link.textContent = 'Download the minified layer'
        minted.append(link)
      })
    })
    minted.append(line, packLayer)
  }

  const fileRow = (file: BranchFile): HTMLElement => {
    const label = document.createElement('label')
    const on = !offSigs.has(file.sig)
    if (!on) label.classList.add('off')
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = on
    box.setAttribute('aria-label', `${on ? 'Loaded' : 'Off'} ${file.kind} ${short(file.sig)}`)
    box.addEventListener('change', () => {
      if (box.checked) offSigs.delete(file.sig)
      else offSigs.add(file.sig)
      paint()
    })
    const name = document.createElement('code')
    name.textContent = short(file.sig)
    name.title = file.sig
    const kind = document.createElement('span')
    kind.className = 'kind'
    kind.textContent = file.kind
    label.append(box, name, kind)
    return label
  }

  const folder = (node: LayerNode, byPath: Map<string, LayerNode>): HTMLElement => {
    const details = document.createElement('details')
    details.open = node.path.split('/').filter(Boolean).length < 2
    const summary = document.createElement('summary')
    if (node.path) {
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = !offPaths.has(node.path)
      box.setAttribute('aria-label', `${box.checked ? 'Loaded' : 'Off'} ${node.path}`)
      box.addEventListener('click', event => event.stopPropagation())
      box.addEventListener('change', () => {
        if (box.checked) offPaths.delete(node.path)
        else offPaths.add(node.path)
        paint()
      })
      summary.append(box)
    }
    const title = document.createElement('span')
    title.textContent = node.path ? node.path : (node.name || 'root')
    title.addEventListener('click', event => {
      event.preventDefault()
      selected = node.path
      paint()
    })
    summary.append(title)
    details.append(summary)
    if (selected === node.path) {
      const here = document.createElement('p')
      here.className = 'kind'
      here.textContent = 'Traits land on this folder.'
      details.append(here)
    }
    const files = document.createElement('div')
    for (const sig of node.bees) files.append(fileRow({ path: node.path, name: sig, kind: 'bee', sig }))
    for (const sig of node.dependencies) files.append(fileRow({ path: node.path, name: sig, kind: 'dependency', sig }))
    details.append(files)
    for (const childPath of node.children) {
      const child = byPath.get(childPath)
      if (child) details.append(folder(child, byPath))
    }
    return details
  }

  const paint = (): void => {
    tree.replaceChildren()
    if (!current) return
    const byPath = new Map(current.nodes.map(node => [node.path, node]))
    const root = byPath.get('')
    if (root) tree.append(folder(root, byPath))
    const loaded = current.files.length - [...offSigs].length
    status.textContent = current.complete
      ? `${current.files.length} files. ${offPaths.size + offSigs.size} turned off.`
      : `Some of this branch did not answer. ${loaded} files are listed, and it cannot become a new root until the rest arrive.`
  }

  const controls = document.createElement('div')
  const traitRow = document.createElement('div')
  traitRow.className = 'row'
  const traitWord = document.createElement('input')
  traitWord.placeholder = 'A trait, one word'
  traitWord.setAttribute('aria-label', 'Trait')
  traitWord.spellcheck = false
  const addTrait = document.createElement('button')
  addTrait.type = 'button'
  addTrait.textContent = 'Add trait'
  addTrait.addEventListener('click', () => {
    const word = traitWord.value.trim()
    if (!word) return
    traits.push({ path: selected, word })
    traitWord.value = ''
    const line = document.createElement('p')
    line.textContent = `Trait “${word}” is an open requirement on ${selected || 'the root'}.`
    minted.append(line)
  })
  traitRow.append(traitWord, addTrait)

  const compareRow = document.createElement('div')
  compareRow.className = 'row'
  const otherSig = document.createElement('input')
  otherSig.placeholder = 'Another signature to lay beside this one'
  otherSig.setAttribute('aria-label', 'Signature to compare')
  otherSig.spellcheck = false
  const lay = document.createElement('button')
  lay.type = 'button'
  lay.textContent = 'Lay beside'
  lay.addEventListener('click', () => {
    const sig = otherSig.value.trim().toLowerCase()
    void (async () => {
      const other = await readBranch(sig, read)
      beside.replaceChildren()
      if (!current || !other.nodes.length) {
        const miss = document.createElement('p')
        miss.textContent = 'That signature did not open.'
        beside.append(miss)
        return
      }
      const diffs = diffBranches(current, other)
      const list = document.createElement('ul')
      list.className = 'beside'
      if (!diffs.length) {
        const same = document.createElement('li')
        same.textContent = 'The folders that both name are the same signatures.'
        list.append(same)
      }
      for (const diff of diffs) {
        const item = document.createElement('li')
        const text = document.createElement('span')
        text.textContent = `${diff.path} · here ${short(diff.left)} · other ${short(diff.right)}`
        const use = document.createElement('button')
        use.type = 'button'
        use.textContent = 'Use the other'
        use.addEventListener('click', () => {
          if (diff.path === 'root') return
          const at = choices.findIndex(choice => choice.path === diff.path)
          const choice = { path: diff.path, sig: diff.right, source: 'beside' }
          if (at >= 0) choices[at] = choice
          else choices.push(choice)
          use.textContent = 'Chosen'
        })
        item.append(text, use)
        list.append(item)
      }
      beside.append(list)
    })()
  })
  compareRow.append(otherSig, lay)

  const actRow = document.createElement('div')
  actRow.className = 'row'
  const mint = document.createElement('button')
  mint.type = 'button'
  mint.textContent = 'Mint root'
  mint.addEventListener('click', () => {
    if (!current) return
    void (async () => {
      const result = await mintBranch(current, editsOf(offPaths, offSigs, traits, choices))
      minted.replaceChildren()
      if (!result.ok) {
        const fail = document.createElement('p')
        fail.textContent = result.reason
        minted.append(fail)
        return
      }
      const line = document.createElement('p')
      const code = document.createElement('code')
      code.textContent = result.rootSig
      line.append(document.createTextNode(
        result.rootSig === options.rootSig
          ? 'Nothing changed, so the root stays '
          : `New root, ${result.moved.size} layer${result.moved.size === 1 ? '' : 's'} rewritten. `,
      ), code)
      const face = document.createElement('p')
      face.textContent = `${result.face.length} files in the public face.`
      const pack = document.createElement('button')
      pack.type = 'button'
      pack.textContent = 'Pack local build'
      pack.addEventListener('click', () => {
        const packed = new Map(result.layers)
        for (const choice of choices) {
          const files = derived.get(choice.sig)
          if (!files) continue
          for (const [sig, bytes] of files) packed.set(sig, bytes)
        }
        void packFiles(packed).then(bytes => {
          const blob = new Blob([bytes], { type: 'application/gzip' })
          const link = document.createElement('a')
          link.href = URL.createObjectURL(blob)
          link.download = `${result.rootSig.slice(0, 12)}.pack.gz`
          link.textContent = 'Download the local build'
          minted.append(link)
        })
      })
      const cast = document.createElement('button')
      cast.type = 'button'
      cast.textContent = 'Broadcast face'
      cast.addEventListener('click', () => {
        const sent = broadcastFace(result.face)
        const told = document.createElement('p')
        told.textContent = sent
          ? 'The public face was broadcast on this device.'
          : 'This browser cannot broadcast.'
        minted.append(told)
      })
      minted.append(line, face, pack, cast)
      working = { package: result.rootSig, derivation: null, face: result.face }
      if (result.rootSig !== options.rootSig) {
        for (const [sig, bytes] of result.layers) held.set(sig, bytes)
        await landMinified({ path: '', sig: result.rootSig }, 'the new registration')
      }
    })()
  })

  const mission = document.createElement('input')
  mission.placeholder = 'Mission name'
  mission.setAttribute('aria-label', 'Mission name')
  mission.spellcheck = false
  const load = document.createElement('button')
  load.type = 'button'
  load.textContent = 'Load AI'
  load.addEventListener('click', () => {
    const origin = missionOrigin(options.source, mission.value)
    aiRelease()
    view.querySelector('.mission-ai')?.remove()
    if (!origin) {
      const dormant = document.createElement('p')
      dormant.textContent = 'AI stays dormant until the mission name can be a subdomain.'
      minted.append(dormant)
      return
    }
    const mount = loadAi(origin, view)
    aiRelease = mount.release
    const told = document.createElement('p')
    told.textContent = mount.loaded
      ? `AI is loading at ${origin}. What it saves stays in that origin's store.`
      : 'AI stays dormant.'
    minted.append(told)
  })
  const minify = document.createElement('button')
  minify.type = 'button'
  minify.textContent = 'Minify this folder'
  minify.addEventListener('click', () => {
    if (!current) return
    const node = current.nodes.find(item => item.path === selected)
    if (!node) return
    void landMinified(node)
  })
  const publish = document.createElement('button')
  publish.type = 'button'
  publish.textContent = 'Publish to head'
  publish.addEventListener('click', () => {
    const snapshot = { package: working.package, derivation: working.derivation, face: [...working.face] }
    void publishInstanceHead(snapshot).then(published => {
      if (published) { renderPublished(published); return }
      publishedHead.hidden = false
      publishedHead.replaceChildren()
      const fail = document.createElement('p')
      fail.textContent = 'The working build has no package signature to publish.'
      publishedHead.append(fail)
    })
  })
  actRow.append(mint, minify, publish, mission, load)
  controls.append(traitRow, compareRow, actRow)
  view.append(controls)

  void readBranch(options.rootSig, read).then(branch => {
    current = branch
    if (!branch.nodes.length) {
      status.textContent = 'That signature did not open as a branch.'
      return
    }
    if (working.package === options.rootSig && working.derivation === null) {
      working = { package: branch.root, derivation: null, face: faceOf(branch.files) }
    }
    paint()
  })

  return view
}
