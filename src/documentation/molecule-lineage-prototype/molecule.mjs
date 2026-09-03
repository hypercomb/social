// molecule.mjs — "lineage as molecule".
//
// THE MODEL
// ---------
// ATOM      <root>/<sig>                            content-addressed bytes.
//   vertex     { name, properties?:[sig] }          a tile. NO children slot —
//                                                   the parent→child edge is gone
//                                                   from layer bytes, so nothing
//                                                   cascades.
//   envelope   { meta:1, layer, root, relation,     an INCIDENCE. `root` is the
//                slot }                             member's canonical name so a
//                                                   route never fetches a vertex;
//                                                   `slot` is placement ON the
//                                                   incidence.
//   succession { succession:1, name, author, prev,  THE META LINEAGE. `members`
//                members:[envSig], hidden?, at }    is the ordered claim of ONE
//                                                   author at ONE moment; `prev`
//                                                   is order-in-time. The sig
//                                                   commits both.
//
// MOLECULE  <root>/<sign(canon(name))>/             a SET. No order, no markers.
//           .../<sign(author)>/<headSuccSig>        one contributor bucket per
//                                                   author holding exactly ONE
//                                                   zero-byte entry: the head.
//
// Depth is a ROUTE, never an address: /business/people means walk the root
// molecule, find the envelope named 'business', walk into sign('business'),
// find the envelope named 'people', and the page you are on is sign('people').
// Every entity is one readdir from the root.
//
// ORDER lives in exactly two places and never in the directory:
//   - the succession's `members` array — one author's ordered claim;
//   - the envelope's `slot` — placement on the incidence.
// Readers stack heads with YOU at index 0; a foreign name collides into a
// stack variant, never over your member.

import { canonName } from './canon.mjs'
import { sha256, signText, bytesOf, mineSignatures, EMPTY_SIG, SIG_RE } from './sig.mjs'
import { Root } from './root.mjs'

/** The molecule address of a name. sign('') is the ROOT molecule. */
export const moleculeOf = (name) => signText(canonName(name))

export const ROOT_MOLECULE = EMPTY_SIG

const bucketOf = (authorSig) => authorSig

export class MoleculeStore {
  #ticks = 0

  constructor({ root = new Root(), author = 'participant-a', clock } = {}) {
    this.root = root
    this.author = author
    this.authorSig = signText(author)
    this.cursors = new Map() // `${mol}:${authorSig}` -> succSig | null(empty view)
    this.clock = clock ?? (() => ++this.#ticks)
  }

  // ── atoms ────────────────────────────────────────────────────────────────

  /**
   * The empty-content sig IS the root molecule's directory name, so an empty
   * atom is absence and is never written as a file.
   */
  putBytes(bytes) {
    const sig = sha256(bytes)
    if (bytes.length) this.root.write(sig, bytes)
    return sig
  }

  putAtom(obj) {
    return this.putBytes(bytesOf(obj))
  }

  getAtom(sig) {
    if (!SIG_RE.test(String(sig ?? ''))) return null
    const bytes = this.root.read(sig)
    if (!bytes || !bytes.length) return null
    try {
      return JSON.parse(bytes.toString('utf8'))
    } catch {
      return null
    }
  }

  // ── molecule directory ───────────────────────────────────────────────────

  /** Every author's head in a molecule. THE ENTRY DECIDES: dirs are buckets. */
  heads(molSig, opts) {
    const out = []
    for (const entry of this.root.list(molSig, opts)) {
      if (entry.kind !== 'dir') continue // a file here is a pool record, not ours
      const files = this.root.list(`${molSig}/${entry.name}`).filter((e) => e.kind === 'file')
      if (files.length !== 1) continue // one writer per bucket: a fork is not a head
      out.push({ authorSig: entry.name, sig: files[0].name })
    }
    return out
  }

  headSig(molSig, authorSig = this.authorSig) {
    return this.heads(molSig).find((h) => h.authorSig === authorSig)?.sig ?? null
  }

  /** new-before-old: the entry IS the commit. */
  #setHead(molSig, succSig) {
    const bucket = `${molSig}/${bucketOf(this.authorSig)}`
    this.root.write(`${bucket}/${succSig}`)
    for (const e of this.root.list(bucket)) {
      if (e.name !== succSig) this.root.remove(`${bucket}/${e.name}`)
    }
  }

  /** My chain, oldest first. `prev` is the only order-in-time. */
  chain(molSig, authorSig = this.authorSig) {
    const out = []
    let sig = this.headSig(molSig, authorSig)
    const seen = new Set()
    while (sig && !seen.has(sig)) {
      seen.add(sig)
      const s = this.getAtom(sig)
      if (!s) break
      out.unshift({ sig, ...s })
      sig = s.prev ?? null
    }
    return out
  }

  // ── routes ───────────────────────────────────────────────────────────────

  /** Walk names. Returns { sig, name }. Throws on a dead route. */
  resolveRoute(route = []) {
    let sig = ROOT_MOLECULE
    let name = ''
    for (const seg of route) {
      const target = canonName(seg)
      const hit = this.viewOf(sig).find((r) => r.name === target)
      if (!hit) throw new Error(`dead route: no member named "${target}" under "${name || '(root)'}"`)
      name = target
      sig = signText(target)
    }
    return { sig, name }
  }

  moleculeFor(route = []) {
    return this.resolveRoute(route).sig
  }

  // ── read model ───────────────────────────────────────────────────────────

  #viewedSuccession(molSig) {
    const key = `${molSig}:${this.authorSig}`
    if (this.cursors.has(key)) {
      const sig = this.cursors.get(key)
      return sig ? { sig, ...this.getAtom(sig) } : null
    }
    const head = this.headSig(molSig)
    return head ? { sig: head, ...this.getAtom(head) } : null
  }

  /**
   * The rendered membership of a molecule: mine (at my cursor) first, then
   * every other author's CURRENT head, sorted by author sig. Dedup by envelope
   * sig; a repeated NAME becomes a stack variant behind yours.
   */
  viewOf(molSig, { succession } = {}) {
    const mine = succession === undefined ? this.#viewedSuccession(molSig) : succession
    const others = this.heads(molSig)
      .filter((h) => h.authorSig !== this.authorSig)
      .sort((a, b) => (a.authorSig < b.authorSig ? -1 : 1))
      .map((h) => ({ sig: h.sig, ...this.getAtom(h.sig) }))

    const hidden = new Set(mine?.hidden ?? [])
    const rows = []
    const byEnvelope = new Map()
    const byName = new Map()

    const absorb = (succ, isMine) => {
      if (!succ || !Array.isArray(succ.members)) return
      succ.members.forEach((envSig, arrayIndex) => {
        if (hidden.has(envSig)) return
        const env = this.getAtom(envSig)
        if (!env) return // complete-or-absent: a cold member is simply absent
        const existingEnv = byEnvelope.get(envSig)
        if (existingEnv) return // byte-identical incidence: one row, stored once
        const row = {
          envelope: envSig,
          vertex: env.layer,
          name: env.root,
          relation: env.relation ?? 'child',
          slot: typeof env.slot === 'number' ? env.slot : null,
          mine: isMine,
          author: succ.author,
          arrayIndex,
          stack: [],
        }
        byEnvelope.set(envSig, row)
        const holder = byName.get(env.root)
        if (holder) {
          holder.stack.push(row) // YOU are index 0; theirs stacks behind
          return
        }
        byName.set(env.root, row)
        rows.push(row)
      })
    }

    absorb(mine, true)
    for (const o of others) absorb(o, false)
    return placePinned(rows)
  }

  /** children(route) — the rendered members of the page at `route`. */
  children(route = []) {
    return this.viewOf(this.moleculeFor(route))
  }

  childNames(route = []) {
    return this.children(route).map((r) => r.name)
  }

  /** The frozen projection: `children` as an ordered sig array of vertices. */
  childrenSigs(route = []) {
    return this.children(route).map((r) => r.vertex)
  }

  /** Time travel: the membership as of position `index` on MY chain (-1 = empty). */
  childrenAt(route, index) {
    const mol = this.moleculeFor(route)
    const chain = this.chain(mol)
    const succession = index < 0 ? null : (chain[index] ?? null)
    if (index >= 0 && !succession) throw new Error(`no succession at position ${index}`)
    return this.viewOf(mol, { succession })
  }

  // ── commits ──────────────────────────────────────────────────────────────

  #base(molSig) {
    const viewed = this.#viewedSuccession(molSig)
    return {
      members: [...(viewed?.members ?? [])],
      hidden: [...(viewed?.hidden ?? [])],
      // prev is ALWAYS the directory head — committing from a rewound view
      // APPENDS (promoteToHead); history never branches and never rewrites.
      prev: this.headSig(molSig),
    }
  }

  #commit(molSig, name, { members, hidden, prev }) {
    const succ = {
      succession: 1,
      name,
      author: this.authorSig,
      prev: prev ?? null,
      members,
      at: this.clock(),
    }
    if (hidden.length) succ.hidden = hidden
    const sig = this.putAtom(succ)
    this.#setHead(molSig, sig)
    this.cursors.delete(`${molSig}:${this.authorSig}`) // follow the head again
    return sig
  }

  /**
   * save(route, name, body) — enroll/edit a member of the page at `route`.
   * Writes: 1 vertex (often already shared), 1 envelope, 1 succession, 1 entry.
   * Touches NO ancestor molecule.
   */
  save(route, name, body = null) {
    const display = String(name ?? '')
    const canon = canonName(display)
    if (!canon) throw new Error('a tile must have a name (the empty name is the ROOT molecule)')
    if (display.includes('/')) throw new Error('a name is not a path')

    const { sig: mol, name: molName } = this.resolveRoute(route)

    const vertex = { name: display }
    if (body !== null) vertex.properties = [this.putAtom(body)]
    const vertexSig = this.putAtom(vertex)

    const base = this.#base(mol)
    const at = base.members.findIndex((s) => this.getAtom(s)?.root === canon)

    let envelope
    if (at >= 0) {
      const old = this.getAtom(base.members[at])
      if (old.layer === vertexSig) {
        return { molecule: mol, vertex: vertexSig, envelope: base.members[at], succession: null, committed: false }
      }
      envelope = this.putAtom({ meta: 1, layer: vertexSig, root: canon, relation: 'child', slot: old.slot })
      base.members[at] = envelope
    } else {
      envelope = this.putAtom({
        meta: 1, layer: vertexSig, root: canon, relation: 'child', slot: nextFreeSlot(base.members, this),
      })
      base.members.push(envelope)
    }

    const succession = this.#commit(mol, molName, base)
    return { molecule: mol, vertex: vertexSig, envelope, succession, committed: true }
  }

  /** Reorder: a NEW envelope (slot changed) + a NEW succession. Undoable. */
  reorder(route, name, slot) {
    const canon = canonName(name)
    const { sig: mol, name: molName } = this.resolveRoute(route)
    const base = this.#base(mol)
    const at = base.members.findIndex((s) => this.getAtom(s)?.root === canon)
    if (at < 0) throw new Error(`"${canon}" is not a member here`)
    const old = this.getAtom(base.members[at])
    const envelope = this.putAtom({ ...old, slot })
    base.members.splice(at, 1)
    base.members.splice(Math.min(slot, base.members.length), 0, envelope)
    return this.#commit(mol, molName, base)
  }

  /** HIDE FIRST: hide any member (including another author's) in MY succession. */
  hide(route, name) {
    const canon = canonName(name)
    const { sig: mol, name: molName } = this.resolveRoute(route)
    const row = this.viewOf(mol).find((r) => r.name === canon)
    if (!row) throw new Error(`"${canon}" is not visible here`)
    const base = this.#base(mol)
    const targets = [row.envelope, ...row.stack.map((s) => s.envelope)]
    base.hidden = [...new Set([...base.hidden, ...targets])]
    return this.#commit(mol, molName, base)
  }

  /**
   * remove: drop MY envelope AND append an empty succession to the removed
   * member's OWN molecule on my chain — the replacement for the create-reset
   * guard, so re-creating the name does not resurrect my old subtree. No atom
   * is deleted (delete-second is GC, over all heads).
   */
  remove(route, name) {
    const canon = canonName(name)
    const { sig: mol, name: molName } = this.resolveRoute(route)
    const base = this.#base(mol)
    const at = base.members.findIndex((s) => this.getAtom(s)?.root === canon)
    if (at < 0) throw new Error(`"${canon}" is not a member here`)
    base.members.splice(at, 1)
    const succession = this.#commit(mol, molName, base)
    const child = signText(canon)
    if (this.headSig(child)) {
      const childBase = this.#base(child)
      this.#commit(child, canon, { members: [], hidden: [], prev: childBase.prev })
    }
    return succession
  }

  /** Point a new envelope at an existing vertex — share, never copy. */
  revive(route, name, vertexSig) {
    const canon = canonName(name)
    const { sig: mol, name: molName } = this.resolveRoute(route)
    const base = this.#base(mol)
    const envelope = this.putAtom({
      meta: 1, layer: vertexSig, root: canon, relation: 'child', slot: nextFreeSlot(base.members, this),
    })
    base.members.push(envelope)
    return this.#commit(mol, molName, base)
  }

  // ── cursor (undo is a VIEW; the directory head never moves) ───────────────

  #cursorSig(molSig) {
    const key = `${molSig}:${this.authorSig}`
    return this.cursors.has(key) ? this.cursors.get(key) : this.headSig(molSig)
  }

  undo(route) {
    const mol = this.moleculeFor(route)
    const cur = this.#cursorSig(mol)
    if (!cur) return false
    const succ = this.getAtom(cur)
    this.cursors.set(`${mol}:${this.authorSig}`, succ?.prev ?? null)
    return true
  }

  redo(route) {
    const mol = this.moleculeFor(route)
    const key = `${mol}:${this.authorSig}`
    if (!this.cursors.has(key)) return false // already at the head
    const chain = this.chain(mol)
    const cur = this.cursors.get(key)
    const next = cur === null ? chain[0] : chain[chain.findIndex((s) => s.sig === cur) + 1]
    if (!next) return false
    if (next.sig === this.headSig(mol)) this.cursors.delete(key)
    else this.cursors.set(key, next.sig)
    return true
  }

  cursorPosition(route) {
    const mol = this.moleculeFor(route)
    const chain = this.chain(mol)
    const cur = this.#cursorSig(mol)
    return { position: cur === null ? -1 : chain.findIndex((s) => s.sig === cur), total: chain.length }
  }

  // ── replication ──────────────────────────────────────────────────────────

  /** Pull one atom and everything it names. Verify on arrival; 404 = absent. */
  pullClosure(host, sig, seen = new Set()) {
    if (!SIG_RE.test(sig) || seen.has(sig)) return
    seen.add(sig)
    if (this.root.has(sig)) {
      const held = this.getAtom(sig)
      if (held) for (const next of mineSignatures(held)) this.pullClosure(host, next, seen)
      return
    }
    const bytes = host.content(sig)
    if (!bytes) return
    if (sha256(bytes) !== sig) throw new Error(`atom ${sig} failed its hash`)
    this.root.write(sig, bytes)
    const atom = this.getAtom(sig)
    if (atom) for (const next of mineSignatures(atom)) this.pullClosure(host, next, seen)
  }

  /**
   * GET /<molSig>/ then GET /<molSig>/<bucket>/ — replicate every author's head
   * into my root. A foreign head is accepted only if its prev-chain contains
   * the head I already hold for that author: anything else is that author
   * BRANCHING, and history never branches.
   */
  replicateMolecule(host, molSig, { includeMine = false } = {}) {
    const report = { accepted: [], refused: [], skipped: [] }
    for (const entry of host.list(molSig)) {
      if (entry.kind !== 'dir') continue
      if (!includeMine && entry.name === this.authorSig) {
        report.skipped.push(entry.name)
        continue
      }
      const files = host.list(`${molSig}/${entry.name}`).filter((e) => e.kind === 'file')
      if (files.length !== 1) continue
      const incoming = files[0].name
      this.pullClosure(host, incoming)
      const held = this.root
        .list(`${molSig}/${entry.name}`)
        .filter((e) => e.kind === 'file')
        .map((e) => e.name)[0]
      if (held && held !== incoming && !this.#chainContains(incoming, held)) {
        report.refused.push({ author: entry.name, incoming, held })
        continue
      }
      this.root.write(`${molSig}/${entry.name}/${incoming}`)
      for (const e of this.root.list(`${molSig}/${entry.name}`)) {
        if (e.name !== incoming) this.root.remove(`${molSig}/${entry.name}/${e.name}`)
      }
      report.accepted.push({ author: entry.name, head: incoming })
    }
    return report
  }

  #chainContains(fromSig, targetSig) {
    let sig = fromSig
    const seen = new Set()
    while (sig && !seen.has(sig)) {
      if (sig === targetSig) return true
      seen.add(sig)
      sig = this.getAtom(sig)?.prev ?? null
    }
    return false
  }

  /**
   * COLD: an EMPTY root materializes a route from host listings alone. Every
   * succession self-places by its own `name` field — the receiver never needs
   * to know the route the bytes arrived by.
   */
  materializeCold(host, route = []) {
    let molSig = ROOT_MOLECULE
    let name = ''
    const walked = []
    for (let i = 0; ; i++) {
      this.#absorbMolecule(host, molSig)
      walked.push({ name, molecule: molSig })
      if (i >= route.length) break
      const target = canonName(route[i])
      const hit = this.viewOf(molSig).find((r) => r.name === target)
      if (!hit) throw new Error(`dead route while cold: "${target}" not under "${name || '(root)'}"`)
      name = target
      molSig = signText(target)
    }
    return { walked, children: this.viewOf(molSig) }
  }

  #absorbMolecule(host, molSig) {
    for (const entry of host.list(molSig)) {
      if (entry.kind !== 'dir') continue
      const files = host.list(`${molSig}/${entry.name}`).filter((e) => e.kind === 'file')
      if (files.length !== 1) continue
      const head = files[0].name
      this.pullClosure(host, head)
      const succ = this.getAtom(head)
      if (!succ || succ.succession !== 1) continue
      // SELF-PLACING: the atom carries its own molecule name.
      const placement = signText(succ.name)
      this.root.write(`${placement}/${succ.author}/${head}`)
    }
  }

  // ── destructive walkers ──────────────────────────────────────────────────

  /**
   * The SHIPPED bug, reproduced: a per-DIRECTORY walker that treats every file
   * in a bag as a marker and deletes anything else. Hard-deletes a pool.
   */
  legacyFlatten(molSig) {
    const removed = []
    for (const e of this.root.list(molSig)) {
      if (e.kind === 'file' && !/^\d{8}$/.test(e.name)) {
        this.root.remove(`${molSig}/${e.name}`)
        removed.push(e.name)
      }
    }
    return removed
  }

  /**
   * The design's answer: the ENTRY decides and the AUTHOR owns it. Only MY
   * bucket is ever touched; files (pool records) and other authors' buckets are
   * structurally untouchable.
   */
  flatten(molSig) {
    const removed = []
    for (const e of this.root.list(molSig)) {
      if (e.kind !== 'dir' || e.name !== this.authorSig) continue
      const head = this.headSig(molSig)
      for (const f of this.root.list(`${molSig}/${e.name}`)) {
        if (f.name !== head) {
          this.root.remove(`${molSig}/${e.name}/${f.name}`)
          removed.push(f.name)
        }
      }
    }
    return removed
  }
}

// ── placement ──────────────────────────────────────────────────────────────

const nextFreeSlot = (memberSigs, store) => {
  let max = -1
  for (const s of memberSigs) {
    const env = store.getAtom(s)
    if (env && typeof env.slot === 'number') max = Math.max(max, env.slot)
  }
  return max + 1
}

/**
 * Pinned placement. Mine keep their slots (array order breaks ties); foreign
 * members are demoted to the next free slot — two tenants' slot numbers never
 * need to agree because the set never carries the order.
 */
const placePinned = (rows) => {
  const taken = new Set()
  const placed = []
  const put = (r) => {
    let p = r.slot ?? 0
    while (taken.has(p)) p++
    taken.add(p)
    placed.push({ ...r, position: p })
  }
  const bySlot = (a, b) => (a.slot ?? 1e9) - (b.slot ?? 1e9) || a.arrayIndex - b.arrayIndex
  rows.filter((r) => r.mine).sort(bySlot).forEach(put)
  rows.filter((r) => !r.mine).sort((a, b) => (a.author < b.author ? -1 : a.author > b.author ? 1 : bySlot(a, b))).forEach(put)
  return placed.sort((a, b) => a.position - b.position)
}
