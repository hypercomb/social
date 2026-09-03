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
import { mintKeys, verifyEd25519 } from './keys.mjs'
import {
  acceptHeadClaim,
  headClaimAuthors,
  headClaimPreimage,
  looksLikeAddressPreimage,
  planHeadClaim,
  resolveBucketHead,
} from './head-claim.mjs'

/** The molecule address of a name. sign('') is the ROOT molecule. */
export const moleculeOf = (name) => signText(canonName(name))

export const ROOT_MOLECULE = EMPTY_SIG

const HEX64 = /^[0-9a-f]{64}$/

/**
 * The hard ceiling on a fork walk. It exists so a chain that cycles or is
 * absurdly long cannot run forever — NOT as the ordinary bound, which is the
 * signed seq gap. Exhausting it yields `'unproven'`, never `'fork'`.
 */
export const FORK_WALK_CAP = 4096

/** Hops descent can require: the signed seq gap, plus slack, under the cap. */
const forkBudget = (offeredSeq, heldSeq) => {
  const gap = Number(offeredSeq ?? 0) - Number(heldSeq ?? 0)
  return Math.min(FORK_WALK_CAP, Math.max(8, Number.isFinite(gap) ? gap + 4 : 8))
}

export class MoleculeStore {
  #ticks = 0

  /**
   * `keys` is the IDENTITY, and its public key IS the bucket directory name —
   * raw lowercase 64-hex, never sign(pubkey). Hashing the bucket name would
   * sever the address from the thing that authenticates it and force the reader
   * back to a field in the bytes, which is blocker 1 restated one level down.
   *
   * Omit `keys` and a fresh identity is minted, which is what the real signer
   * does per browser profile (nostr-signer.ts:96-129). Pass the SAME `keys` to
   * two stores to model one participant on two devices; pass different keys to
   * model two participants — a distinction the old `signText(author)` address
   * could not draw, because anyone could type the string.
   */
  constructor({ root = new Root(), author = 'participant-a', keys, ledger, clock, verify = verifyEd25519 } = {}) {
    this.root = root
    this.author = author
    this.keys = keys ?? mintKeys()
    this.pubkey = this.keys.pubkey
    this.verify = verify
    this.cursors = new Map() // `${mol}:${pubkey}` -> succSig | null(empty view)
    // THE MINT LEDGER: molSig -> the last claim THIS INSTANCE actually signed.
    //
    // It is NOT content, it is NOT replicated, and it never leaves the device.
    // It models the store the SECRET lives in (`localStorage['hc:nostr:secret-
    // key']`), which is why it is a constructor option: pass the same Map to a
    // rebuilt store to model "OPFS was evicted, localStorage survived" — the
    // ordinary shape of that accident, since the two are cleared by different
    // gestures. Without it, a host that is merely BEHIND hands me a counter of
    // 0 when I had signed up to 2, and my next signature forks me off my own
    // chain with nothing anywhere reporting it (`planHeadClaim`).
    this.minted = ledger ?? new Map()
    this.clock = clock ?? (() => ++this.#ticks)
  }

  /** DEPRECATED ALIAS. My bucket address — now a public key, not sign(a string). */
  get authorSig() {
    return this.pubkey
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

  // ── head entries: a bucket holds SIGNED CLAIMS, not bare names ───────────
  //
  // An entry file is the canonical JSON of `{head, prev, seq, sig}`, named
  // sha256(its own bytes) so it is content-addressed like everything else. The
  // signature covers a preimage the READER rebuilds from the two path segments
  // it walked to — so an entry cannot be moved to another molecule, or into
  // another key's bucket, without ceasing to verify.

  /**
   * Read + AUTHENTICATE every entry in one bucket. Unverifiable entries are
   * ignored, never deleted: DATA NEVER HEALS.
   *
   * TWO GATES, and both are about the BUCKET rather than about recency:
   *
   *  (1) `verdict.keep` — the signature covers this address's preimage under
   *      this bucket's key. NOT `verdict.ok`: `ok` answers "may this become my
   *      head, given what I already hold", which is a question about a
   *      TRANSITION and has no meaning when re-reading what is already on
   *      disk. Ranking is `resolveBucketHead`'s job and nothing else's.
   *
   *  (2) ADOPTION REFUSAL. A claim binds (molecule, pubkey, head), so two keys
   *      can each mint a valid claim naming the SAME succession — and `viewOf`
   *      would then hand the byline for every row to whichever author sorts
   *      first. So when the atom is local, it must name THIS bucket as its
   *      signer. When it is absent the claim still counts: complete-or-absent,
   *      the same rule `viewOf` applies to a cold member.
   */
  #bucketClaims(molSig, bucketName, { source = this.root, listOpts } = {}) {
    if (!HEX64.test(bucketName)) return [] // 'foreign' — not a bucket, not ours
    const out = []
    for (const f of source.list(`${molSig}/${bucketName}`, listOpts)) {
      if (f.kind !== 'file') continue
      const bytes = source.read ? source.read(`${molSig}/${bucketName}/${f.name}`) : source.content(`${molSig}/${bucketName}/${f.name}`)
      const claim = this.#parseClaim(bytes)
      if (!claim) continue
      const address = { molecule: molSig, pubkey: bucketName }
      const verdict = acceptHeadClaim(address, claim, this.verify)
      if (!verdict.keep) continue
      const atom = this.getAtom(claim.head)
      if (atom && !(atom.succession === 1 && headClaimAuthors(address, atom.signer))) continue
      out.push({ entry: f.name, head: claim.head, prev: claim.prev, seq: claim.seq, sig: claim.sig })
    }
    return out
  }

  #parseClaim(bytes) {
    if (!bytes || !bytes.length) return null
    try {
      const c = JSON.parse(bytes.toString('utf8'))
      if (!c || typeof c !== 'object') return null
      return { head: c.head, prev: c.prev ?? null, seq: c.seq, sig: c.sig }
    } catch {
      return null
    }
  }

  /**
   * Every author's head in a molecule. THE ENTRY DECIDES: dirs are buckets, and
   * the bucket NAME — never a field in the bytes — is the author.
   *
   * The old rule was "a bucket with anything but exactly one file is skipped",
   * which turned any second entry into a total page blackout. Now that nobody
   * but the bucket's own key can put an entry there, a second entry means the
   * owner wrote twice — so RESOLVE it (highest seq, ties by smallest head sig)
   * instead of blanking the page.
   */
  heads(molSig, opts) {
    const out = []
    for (const entry of this.root.list(molSig, opts)) {
      if (entry.kind !== 'dir') continue // a file here is a pool record, not ours
      const claims = this.#bucketClaims(molSig, entry.name)
      const win = this.#resolve(molSig, entry.name, claims)
      if (!win) continue
      out.push({ authorSig: entry.name, sig: win.head, seq: win.seq, entry: win.entry, rivals: claims.length - 1 })
    }
    return out
  }

  /**
   * `resolveBucketHead`, plus ONE asymmetry for MY OWN bucket.
   *
   * A same-generation sibling (`rival`) is settled for everyone else by the
   * smallest head signature, which is the only deterministic answer a third
   * party can compute and is what makes every reader converge. But for my own
   * bucket I hold evidence nobody else has: the MINT LEDGER says which of those
   * siblings I actually signed. Preferring it means my own page never flips to
   * a second device's generation behind my back, while every other reader's
   * answer is unchanged — the ledger is local and is never replicated, so it
   * cannot make two readers disagree.
   */
  #resolve(molSig, bucketName, claims) {
    const win = resolveBucketHead(claims)
    if (!win || bucketName !== this.pubkey) return win
    const mine = this.minted.get(molSig)
    if (!mine || mine.seq !== win.seq) return win
    return claims.find((c) => c.head === mine.head) ?? win
  }

  headSig(molSig, authorSig = this.pubkey) {
    return this.heads(molSig).find((h) => h.authorSig === authorSig)?.sig ?? null
  }

  /** The claim currently resolved for one bucket — what acceptance compares against. */
  heldClaim(molSig, bucketName = this.pubkey) {
    return this.#resolve(molSig, bucketName, this.#bucketClaims(molSig, bucketName))
  }

  /**
   * Mint a SIGNED head entry for MY bucket at `molSig`. The preimage binds the
   * molecule and the pubkey, so this entry is inert anywhere else.
   *
   * Public so a test can model a crash mid-commit faithfully — the write half
   * of write-then-prune, with a real claim rather than a bare file name.
   */
  mintHeadEntry(molSig, { head, prev = null, seq }) {
    const preimage = headClaimPreimage(molSig, this.pubkey, head, prev, seq)
    const claim = { head, prev, seq, sig: this.keys.sign(preimage) }
    const bytes = bytesOf(claim)
    return { name: sha256(bytes), bytes, claim }
  }

  /**
   * new-before-old: the entry IS the commit. Still two steps and still not
   * atomic (blocker 6's other half) — but a half-applied write now RESOLVES
   * rather than erasing the author's whole chain.
   *
   * `prev` and `seq` come from `planHeadClaim`, not from the bucket alone: the
   * bucket is rebuilt from a host, so a host that missed my last two pushes
   * would otherwise choose the counter my next signature commits to.
   */
  #setHead(molSig, succSig, plan) {
    const held = plan.base ?? null
    const entry = this.mintHeadEntry(molSig, { head: succSig, prev: plan.prev, seq: plan.seq })

    // SIGN THEN SELF-VERIFY, BEFORE PUBLISHING. My own commit goes through the
    // same door as a stranger's: there is no "trusted local" branch for anyone
    // to widen later. The plan may legitimately be AHEAD of what the bucket
    // holds (the ledger outranking a lagging host), and that reads as a
    // multi-generation gap, so the walk is supplied — it resolves locally,
    // because every atom on my own chain is already mine.
    const verdict = acceptHeadClaim(
      { molecule: molSig, pubkey: this.pubkey },
      entry.claim,
      this.verify,
      { held, chainContains: (from, target) => this.#chainContains(from, target) },
    )
    if (!verdict.ok) throw new Error(`refused my own head claim: ${verdict.reason} (${verdict.detail})`)

    const bucket = `${molSig}/${this.pubkey}`
    this.root.write(`${bucket}/${entry.name}`, entry.bytes)
    // THE LEDGER IS WRITTEN AFTER THE BYTES, and is the only record that
    // survives losing this store. A host can never lower it.
    this.minted.set(molSig, { head: succSig, prev: plan.prev, seq: plan.seq })
    // MY OWN bucket, and only ever my own: sweep the entries that lost to the
    // one I just signed. A foreign bucket is never swept by anybody.
    for (const e of this.root.list(bucket)) {
      if (e.name !== entry.name) this.root.remove(`${bucket}/${e.name}`)
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
    // THE AUTHOR COMES FROM THE BUCKET DIRECTORY, never from the atom. The
    // succession no longer carries an `author` field to disagree with it.
    const others = this.heads(molSig)
      .filter((h) => h.authorSig !== this.pubkey)
      .sort((a, b) => (a.authorSig < b.authorSig ? -1 : 1))
      .map((h) => ({ author: h.authorSig, sig: h.sig, ...this.getAtom(h.sig) }))

    const hidden = new Set(mine?.hidden ?? [])
    const rows = []
    const byEnvelope = new Map()
    const byName = new Map()

    const absorb = (succ, isMine, author) => {
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
          author,
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

    absorb(mine, true, this.pubkey)
    for (const o of others) absorb(o, false, o.author)
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

  /**
   * What I would sign next, if I committed now — and, crucially, WHICH CLAIM
   * that plan is built on. `base` is the stronger of the bucket head and my own
   * mint ledger, and everything downstream compares against IT rather than
   * against the bucket: the self-verify in `#setHead`, and the out-of-sync
   * guard in `#commit`.
   */
  #plan(molSig) {
    const held = this.heldClaim(molSig)
    const minted = this.minted.get(molSig) ?? null
    const plan = planHeadClaim(held, minted)
    const base = plan.prev === (minted?.head ?? null) ? minted : held
    return { ...plan, base: base ?? null, held: held ?? null }
  }

  #base(molSig) {
    const viewed = this.#viewedSuccession(molSig)
    return {
      members: [...(viewed?.members ?? [])],
      hidden: [...(viewed?.hidden ?? [])],
      // prev is ALWAYS the strongest link I can prove is mine — the directory
      // head, or my own mint ledger when a host is behind it. Committing from a
      // rewound view APPENDS; history never branches and never rewrites.
      prev: this.#plan(molSig).prev,
    }
  }

  /**
   * THE SUCCESSION ATOM STILL DECLARES NO LOCATION — AND NOW NAMES ITS SIGNER.
   *
   * `name` and `author` are GONE and are not coming back. They were the two
   * fields `#absorbMolecule` turned into PATH SEGMENTS, and the fix was not to
   * check them on arrival: a field which does not exist is a check nobody can
   * forget. Placement comes from the directory walk.
   *
   * `signer` is a different animal and the authority review is what asked for
   * it. With the atom bound to nothing, any key could mint a valid head claim
   * naming SOMEONE ELSE'S succession — every field in the preimage true — and
   * take the byline for the whole page on every reader. `signer` is NEVER a
   * path segment and chooses nothing; it is compared against a bucket address
   * that is already authenticated, which is exactly why it is safe now and was
   * not before. The distinction to hold on to: a DECLARED LOCATION is a
   * capability, a DECLARED AUTHOR checked against an authenticated address is a
   * binding.
   *
   * `prev` comes from the one plan `#setHead` will sign, so the atom and the
   * claim can never disagree about the chain link.
   */
  #commit(molSig, { members, hidden }) {
    const plan = this.#plan(molSig)

    // OUT-OF-SYNC REFUSAL — fail closed rather than fork silently.
    //
    // My ledger can legitimately be AHEAD of what this store can see: an OPFS
    // eviction, a partial "clear site data", a restore from a folder backup,
    // or simply a host that missed my last two pushes. The old code took the
    // bucket's answer, restarted `seq` from it, and signed — so a legitimate
    // local write forked me off my own chain, every peer refused it (first
    // 'stale', then 'fork'), and NOTHING reported it because my own page
    // rendered perfectly.
    //
    // `planHeadClaim` stops the counter going backwards, but a `prev` I cannot
    // resolve is worse than a wrong counter: `#base` would take its MEMBERS
    // from the stale head I can see while naming a `prev` I cannot, and publish
    // a generation that silently drops everything the newer head held. So
    // refuse, loudly, and say what to do — replicating from a current host
    // resolves it.
    if (plan.base && plan.base.head !== (plan.held?.head ?? null)) {
      throw new Error(
        `out of sync at ${molSig.slice(0, 8)}: this store holds seq ${plan.held?.seq ?? -1} ` +
        `but I signed seq ${plan.base.seq}. Replicate from a current host before committing.`,
      )
    }

    const succ = {
      succession: 1,
      signer: this.pubkey,
      prev: plan.prev,
      members,
      at: this.clock(),
    }
    if (hidden.length) succ.hidden = hidden
    const sig = this.putAtom(succ)
    this.#setHead(molSig, sig, plan)
    this.cursors.delete(`${molSig}:${this.pubkey}`) // follow the head again
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

    const { sig: mol } = this.resolveRoute(route)

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

    const succession = this.#commit(mol, base)
    return { molecule: mol, vertex: vertexSig, envelope, succession, committed: true }
  }

  /** Reorder: a NEW envelope (slot changed) + a NEW succession. Undoable. */
  reorder(route, name, slot) {
    const canon = canonName(name)
    const { sig: mol } = this.resolveRoute(route)
    const base = this.#base(mol)
    const at = base.members.findIndex((s) => this.getAtom(s)?.root === canon)
    if (at < 0) throw new Error(`"${canon}" is not a member here`)
    const old = this.getAtom(base.members[at])
    const envelope = this.putAtom({ ...old, slot })
    base.members.splice(at, 1)
    base.members.splice(Math.min(slot, base.members.length), 0, envelope)
    return this.#commit(mol, base)
  }

  /** HIDE FIRST: hide any member (including another author's) in MY succession. */
  hide(route, name) {
    const canon = canonName(name)
    const { sig: mol } = this.resolveRoute(route)
    const row = this.viewOf(mol).find((r) => r.name === canon)
    if (!row) throw new Error(`"${canon}" is not visible here`)
    const base = this.#base(mol)
    const targets = [row.envelope, ...row.stack.map((s) => s.envelope)]
    base.hidden = [...new Set([...base.hidden, ...targets])]
    return this.#commit(mol, base)
  }

  /**
   * remove: drop MY envelope AND append an empty succession to the removed
   * member's OWN molecule on my chain — the replacement for the create-reset
   * guard, so re-creating the name does not resurrect my old subtree. No atom
   * is deleted (delete-second is GC, over all heads).
   */
  remove(route, name) {
    const canon = canonName(name)
    const { sig: mol } = this.resolveRoute(route)
    const base = this.#base(mol)
    const at = base.members.findIndex((s) => this.getAtom(s)?.root === canon)
    if (at < 0) throw new Error(`"${canon}" is not a member here`)
    base.members.splice(at, 1)
    const succession = this.#commit(mol, base)
    const child = signText(canon)
    if (this.headSig(child)) {
      const childBase = this.#base(child)
      this.#commit(child, { members: [], hidden: [], prev: childBase.prev })
    }
    return succession
  }

  /** Point a new envelope at an existing vertex — share, never copy. */
  revive(route, name, vertexSig) {
    const canon = canonName(name)
    const { sig: mol } = this.resolveRoute(route)
    const base = this.#base(mol)
    const envelope = this.putAtom({
      meta: 1, layer: vertexSig, root: canon, relation: 'child', slot: nextFreeSlot(base.members, this),
    })
    base.members.push(envelope)
    return this.#commit(mol, base)
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

  /**
   * Pull one atom and everything it names. Verify on arrival; 404 = absent.
   *
   * THE PREIMAGE GATE. `sha256(bytes) === sig` proves the bytes match the NAME.
   * It can never prove the name is an ATOM address rather than a DIRECTORY
   * address, because 64-hex is one alphabet for both by design — and a
   * molecule address is sha256(a tile name) while a pool address is
   * sha256(a meaning), both SHORT PUBLIC STRINGS. So a remote does not need a
   * collision to choose where my bytes land: it lists the address as a member
   * and serves the four bytes `bees`. In OPFS a file and a directory cannot
   * share a name, so one served page can permanently deny the drone pool.
   *
   * `looksLikeAddressPreimage` (core) refuses any replicated body that could be
   * a name or a meaning. It is conservative in the safe direction and loses
   * nothing: such a body is a handful of bytes. See its comment for why the
   * real cure is domain separation on the ADDRESS and why that is a forward
   * migration rather than a patch.
   */
  pullClosure(host, sig, seen = new Set()) {
    if (!SIG_RE.test(sig) || seen.has(sig)) return
    seen.add(sig)
    if (this.root.has(sig)) {
      const held = this.getAtom(sig)
      if (held) for (const next of mineSignatures(held)) this.pullClosure(host, next, seen)
      return
    }
    const bytes = host.content(sig)
    if (!bytes || !bytes.length) return
    if (sha256(bytes) !== sig) throw new Error(`atom ${sig} failed its hash`)
    if (looksLikeAddressPreimage(bytes)) return // a directory address, not an atom
    this.root.write(sig, bytes)
    const atom = this.getAtom(sig)
    if (atom) for (const next of mineSignatures(atom)) this.pullClosure(host, next, seen)
  }

  /**
   * Fetch ONE atom for a decision, WITHOUT writing anything.
   *
   * Fork refusal used to walk `prev` with `pullClosure`, so the closure of a
   * chain the reader was ABOUT TO REJECT was downloaded and committed to disk
   * first — 64 hops x a full page each, at addresses the sender chose. A
   * verdict is not a rollback of the writes it cost, so the walk must be able
   * to read without keeping.
   */
  #peekAtom(host, sig) {
    if (!host || !SIG_RE.test(String(sig ?? ''))) return null
    const bytes = host.content(sig)
    if (!bytes || !bytes.length) return null
    if (sha256(bytes) !== sig) return null
    try { return JSON.parse(bytes.toString('utf8')) } catch { return null }
  }

  /**
   * GET /<molSig>/ then GET /<molSig>/<bucket>/ — replicate every author's head
   * into my root.
   *
   * READER-DERIVED PLACEMENT. `molSig` is the address I issued the listing
   * against and `entry.name` is a directory the listing returned. Those two
   * variables are BOTH the write path AND the two authenticated fields of the
   * preimage, so a claim can only ever be filed where it was signed to live.
   * Nothing in this loop reads a location out of the bytes; there is nothing in
   * the bytes to read.
   *
   * Fork refusal is unchanged in rule: a head is accepted over one I hold only
   * if its prev chain contains what I hold. History never branches.
   */
  replicateMolecule(host, molSig, { includeMine = false } = {}) {
    const report = { accepted: [], refused: [], skipped: [], kept: [] }
    for (const entry of host.list(molSig)) {
      if (entry.kind !== 'dir') continue
      // SHAPE GATE, before the name enters any path. A non-64-hex directory is
      // 'foreign' under classifyDirectoryEntry — not a bucket, not ours, and
      // never a write target. (http-auth.js's devOpen returns the literal
      // pubkey 'dev-open'; a bucket named that would veto deletion forever.)
      if (!HEX64.test(entry.name)) {
        report.refused.push({ author: entry.name, reason: 'malformed' })
        continue
      }
      if (!includeMine && entry.name === this.pubkey) {
        report.skipped.push(entry.name)
        continue
      }
      const address = { molecule: molSig, pubkey: entry.name }
      const held = this.heldClaim(molSig, entry.name)

      // A host may serve several entries for one bucket (the owner crashed
      // mid-commit, or two of their devices published). Read them all, then
      // rank with the SAME total order every reader uses, so the outcome never
      // depends on listing order.
      const offers = []
      for (const file of host.list(`${molSig}/${entry.name}`)) {
        if (file.kind !== 'file') continue
        const bytes = host.content(`${molSig}/${entry.name}/${file.name}`)
        if (!bytes || !bytes.length) continue
        const offered = this.#parseClaim(bytes)
        if (!offered) {
          report.refused.push({ author: entry.name, reason: 'malformed' })
          continue
        }
        offers.push({ offered, bytes })
      }
      offers.sort((a, b) =>
        (b.offered.seq ?? -1) - (a.offered.seq ?? -1) ||
        (String(a.offered.head) < String(b.offered.head) ? -1 : 1))

      // ── PASS ONE: KEEP EVERY AUTHENTIC ENTRY ─────────────────────────────
      //
      // `authentic` is the KEEP bit and `ok` is the HEAD bit, and conflating
      // them is what made a temporal replay permanent. A host that serves only
      // generation 0 of a 70-generation chain forges nothing; on first sight
      // there is nothing to be stale against, so the reader adopts it — and
      // under the old code the real head then arrived, could not prove descent
      // across 69 hops, and was REFUSED AND DISCARDED as a fork. The victim
      // ended up accusing the honest author of branching, forever.
      //
      // Keeping every authentic entry makes recency a property of what the
      // READER HOLDS rather than of the order a host answered in: once
      // generation 69 is in hand it outranks generation 0 by the author's own
      // signed counter and can never be talked back down.
      //
      // NOTHING IN A FOREIGN BUCKET IS EVER DELETED. The old code accepted one
      // entry and swept its siblings — bytes it did not write, in a directory
      // it does not own — which is both the plainest data-never-heals violation
      // in the file and the reason two readers who met the same author's two
      // entries in a different order stayed on different heads forever. The
      // convergence `resolveBucketHead` documents is only true if the resolver
      // is allowed to SEE both.
      for (const { offered, bytes } of offers) {
        const verdict = acceptHeadClaim(address, offered, this.verify, {
          held,
          chainContains: (from, target) =>
            this.#chainContains(from, target, { host, budget: forkBudget(offered.seq, held?.seq) }),
        })
        if (!verdict.keep) {
          // `malformed` / `unsigned` are not the author's bytes at all;
          // `fork` is a DISPROVEN branch, and refusing it must cost nothing —
          // no entry stored, and (because the walk peeked rather than pulled)
          // not one byte of its closure fetched.
          report.refused.push({ author: entry.name, incoming: offered.head, held: held?.head ?? null, reason: verdict.reason })
          continue
        }
        const name = sha256(bytes)
        const path = `${molSig}/${entry.name}/${name}`
        if (!this.root.has(path)) this.root.write(path, bytes)
        if (!verdict.ok) {
          // Genuine history that is not my head: kept, reported, never deleted.
          report.kept.push({ author: entry.name, head: offered.head, seq: offered.seq, reason: verdict.reason })
          continue
        }
        if (verdict.unchanged) report.accepted.push({ author: entry.name, head: offered.head, unchanged: true })
      }

      // ── PASS TWO: THE WINNER'S CLOSURE, AND ONLY THE WINNER'S ────────────
      //
      // The head is now a pure function of the entries I hold. Pull the bytes
      // for THAT one — a refused claim must never have cost me a write, which
      // is why the fork walk above reads without keeping (`#peekAtom`).
      //
      // The atom must then AGREE with the claim: it is a succession, its prev
      // matches, and it NAMES THIS BUCKET as its signer. That last one is the
      // adoption refusal — a valid claim over someone else's succession — and
      // it is checked again on every read in `#bucketClaims`, so a bucket
      // cannot keep a stolen byline by racing the fetch.
      const winner = this.heldClaim(molSig, entry.name)
      if (!winner && this.root.list(`${molSig}/${entry.name}`).some((f) => f.kind === 'file')) {
        // Entries are on disk and none of them resolves: every one of them
        // names a succession that does not name THIS bucket as its signer.
        // That is the adoption refusal, and it is worth saying out loud —
        // silently rendering nothing is how a byline theft would hide.
        report.refused.push({ author: entry.name, reason: 'atom-mismatch' })
      }
      if (winner && winner.head !== held?.head) {
        this.pullClosure(host, winner.head)
        const succ = this.getAtom(winner.head)
        if (!succ || succ.succession !== 1 || (succ.prev ?? null) !== winner.prev || !headClaimAuthors(address, succ.signer)) {
          report.refused.push({ author: entry.name, incoming: winner.head, reason: 'atom-mismatch' })
        } else {
          report.accepted.push({ author: entry.name, head: winner.head, seq: winner.seq })
        }
      }
    }
    return report
  }

  /**
   * Walk `prev` from `fromSig` looking for `targetSig`. TRI-STATE.
   *
   * `prev` is a REFERENT (hypercomb-core/src/core/edge-registry.ts), never a
   * closure edge — carrying it would make every cold read the entire history of
   * the thing. So the walk is DELIBERATE and BOUNDED, and the two ways it can
   * fail mean OPPOSITE things:
   *
   *   false        I reached the chain's genesis and your head is not on it.
   *                A real branch. Permanent, and an accusation.
   *   'unproven'   I ran out of budget, or an atom did not arrive, or the
   *                chain cycles. This says NOTHING about the author.
   *
   * Reporting the second as the first is what turned 65 ordinary edits made
   * while a peer was offline into a permanent partition between two honest
   * participants on one honest host. The budget is now derived from the SIGNED
   * SEQ GAP, which is exactly the number of hops descent can require and cannot
   * be inflated beyond what the author actually signed — the doctrine already
   * said seq "bounds the fork walk"; a constant 64 was neither that quantity
   * nor large enough for an ordinary absence.
   *
   * Every hop READS WITHOUT KEEPING (`#peekAtom`): a verdict must not cost the
   * reader a write at an address the sender chose.
   */
  #chainContains(fromSig, targetSig, { host = null, budget = FORK_WALK_CAP } = {}) {
    let sig = fromSig
    const seen = new Set()
    let hops = 0
    while (sig) {
      if (sig === targetSig) return true
      if (seen.has(sig)) return 'unproven' // a cycle proves nothing
      if (hops++ >= budget) return 'unproven'
      seen.add(sig)
      const atom = this.getAtom(sig) ?? this.#peekAtom(host, sig)
      if (!atom) return 'unproven' // an absent generation is not a branch
      sig = atom.prev ?? null
    }
    return false // walked to genesis: the target is provably not an ancestor
  }

  /**
   * COLD: an EMPTY root materializes a route from host listings alone.
   *
   * `#absorbMolecule` USED TO LIVE HERE and is DELETED, not repaired. Its two
   * lines were
   *
   *     const placement = signText(succ.name)
   *     this.root.write(`${placement}/${succ.author}/${head}`)
   *
   * — both path segments taken from fields the atom declared, so bytes from a
   * host chose which directory they landed in. It has no replacement because
   * `replicateMolecule` already files at the address it ASKED FOR; the two
   * functions converge, and the cold path inherits acceptance, fork refusal and
   * the shape gate for free. The defect is closed by removing the function that
   * had it.
   *
   * `includeMine` is true here on purpose: the cold path no longer needs a
   * skip-mine guard, because nobody but my key can produce a claim that
   * verifies in my bucket. The signature is the guard now, not the skip.
   */
  materializeCold(host, route = []) {
    let molSig = ROOT_MOLECULE
    let name = ''
    const walked = []
    const reports = []
    for (let i = 0; ; i++) {
      reports.push(this.replicateMolecule(host, molSig, { includeMine: true }))
      walked.push({ name, molecule: molSig })
      if (i >= route.length) break
      const target = canonName(route[i])
      const hit = this.viewOf(molSig).find((r) => r.name === target)
      if (!hit) throw new Error(`dead route while cold: "${target}" not under "${name || '(root)'}"`)
      name = target
      molSig = signText(target)
    }
    return { walked, reports, children: this.viewOf(molSig) }
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
      if (e.kind !== 'dir' || e.name !== this.pubkey) continue
      // Sweep only entries that LOST to a verified winner in MY OWN bucket. A
      // reader holding no key owns no bucket, so its flatten is a structural
      // no-op — the cold path that used to be the attack surface can no longer
      // delete anything at all.
      const head = this.heldClaim(molSig)?.entry ?? null
      if (!head) continue
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
