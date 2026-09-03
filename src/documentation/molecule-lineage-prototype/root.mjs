// root.mjs — an in-memory model of the OPFS root.
//
// The root is an UNTAGGED UNION. Nothing on disk says what a name is; the
// ENTRY decides, never the directory:
//
//   <sig>                          atom  (file)   — layer / envelope / succession / resource
//   <molSig>/<authorSig>/<succSig> head  (dir/dir/zero-byte file) — a contributor bucket
//   <molSig>/<recordSig>           pool record (file) — a system pool member
//   <molSig>/000x                  legacy marker (file) — drain source only
//
// A molecule address and a pool address can be byte-identical (a tile named
// 'bees'); both live in the same directory and never collide because a bucket
// is a DIR and a pool record is a FILE.

export class Root {
  #files = new Map() // path -> Buffer

  write(path, bytes = Buffer.alloc(0)) {
    this.#files.set(path, Buffer.from(bytes))
    return path
  }

  read(path) {
    return this.#files.has(path) ? this.#files.get(path) : null
  }

  has(path) {
    return this.#files.has(path)
  }

  remove(path) {
    return this.#files.delete(path)
  }

  paths() {
    return [...this.#files.keys()]
  }

  get size() {
    return this.#files.size
  }

  /** How many times a byte-identical atom is stored (0 or 1 — content addressed). */
  copiesOf(sig) {
    return this.#files.has(sig) ? 1 : 0
  }

  /**
   * readdir. `dir` '' = the root itself. Returns [{name, kind:'file'|'dir'}].
   * Order is DELIBERATELY unspecified in the model: pass {order:'reverse'} to
   * prove that nothing in the read model depends on listing order.
   */
  list(dir = '', { order = 'natural' } = {}) {
    const prefix = dir ? `${dir}/` : ''
    const kinds = new Map()
    for (const p of this.#files.keys()) {
      if (!p.startsWith(prefix)) continue
      const rest = p.slice(prefix.length)
      if (!rest) continue
      const slash = rest.indexOf('/')
      if (slash === -1) {
        if (!kinds.has(rest)) kinds.set(rest, 'file')
      } else {
        kinds.set(rest.slice(0, slash), 'dir')
      }
    }
    const out = [...kinds].map(([name, kind]) => ({ name, kind }))
    if (order === 'reverse') out.reverse()
    if (order === 'sorted') out.sort((a, b) => (a.name < b.name ? -1 : 1))
    return out
  }
}
