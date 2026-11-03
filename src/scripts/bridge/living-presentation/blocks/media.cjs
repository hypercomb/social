// The pages' media, each named by the SHA-256 of its bytes: the voice, the
// clips, the faces, the captured pictures (doctrine: a reference holds the
// signature, never the content).
//
// A page names a medium as `resource:<sig>` — in an attribute, in CSS url(),
// or in its script — which is the one form the hive's website view rewrites
// to `/@resource/<sig>` and the publish closure carries to a host
// (hypercomb-essentials/src/sharing/decoration-closure.ts). The bytes are
// stored once, however many pages name them.
//
//   const media = createMedia()
//   const sig = media.add('/abs/path/clip.mp4')     // -> 64-hex
//   media.ref(sig)                                  // -> 'resource:<sig>'
//   media.list()                                    // -> [{ sig, path, name, type, size }]

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const TYPE = {
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.woff2': 'font/woff2',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
}

const sigOf = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

const createMedia = () => {
  const bySig = new Map()
  const byPath = new Map()
  return {
    /** Add a file by path; its signature names it. */
    add(file) {
      const abs = path.resolve(file)
      if (byPath.has(abs)) return byPath.get(abs)
      if (!fs.existsSync(abs)) throw new Error(`medium missing: ${abs}`)
      const bytes = fs.readFileSync(abs)
      const sig = sigOf(bytes)
      const ext = path.extname(abs).toLowerCase()
      if (!TYPE[ext]) throw new Error(`no media type for ${abs}`)
      if (!bySig.has(sig)) bySig.set(sig, { sig, path: abs, name: path.basename(abs), type: TYPE[ext], size: bytes.length })
      byPath.set(abs, sig)
      return sig
    },
    ref: (sig) => `resource:${sig}`,
    list: () => [...bySig.values()],
  }
}

module.exports = { createMedia, sigOf }
