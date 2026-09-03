// host.mjs — a host is a pile of bytes with two verbs.
//
//   GET /<sig>            → immutable atom bytes            (content)
//   GET /<dir>/           → directory listing, no-store      (the UNBUILT branch
//                           this prototype assumes: relay.js has no readdir)
//
// Nothing is computed. A miss is a real 404 (null), never a shell.

export const hostOf = (root, { order = 'natural' } = {}) => {
  const stats = { listings: 0, gets: 0, misses: 0 }
  return {
    stats,
    /** GET /<dir>/ */
    list(dir) {
      stats.listings++
      return root.list(dir, { order })
    },
    /** GET /<sig> */
    content(sig) {
      const bytes = root.read(sig)
      stats.gets++
      if (!bytes) stats.misses++
      return bytes
    },
  }
}
