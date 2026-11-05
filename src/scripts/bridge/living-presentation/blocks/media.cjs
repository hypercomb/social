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
//   media.partsOf(sig)                              // -> a voice's parts as refs, or null
//   media.list()                                    // -> [{ sig, path, name, type, size, start?, end? }]
//   bytesOf(m)                                      // -> the medium's bytes (a voice part is a slice)
//
// A VOICE ARRIVES IN PARTS (jwize 2026-11-05: "stream the audio so it doesn't
// have to full load or load a chunk first so it is fast"). Every byte a page
// plays is verified against its signature before it plays, so a voice cannot
// stream as one file: the hive would hold it until the last byte arrived. It is
// broken apart too, at its frames, into a short head (about two seconds) and
// parts of about eight seconds. Each part is a medium in its own right, and the
// parts in order are the voice's bytes exactly. A page that may play a stream
// it builds (media-src blob:) starts the head the moment it is verified and
// feeds the rest in behind it; anywhere else it plays the whole voice, which
// stays a medium too.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const TYPE = {
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.woff2': 'font/woff2',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
}

const sigOf = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

/** A medium's bytes: the whole file, or the slice a voice part names. */
const bytesOf = (m) => {
  const bytes = fs.readFileSync(m.path)
  return m.start == null ? bytes : bytes.subarray(m.start, m.end)
}

// MPEG audio, layer III: kbit/s by version and index, Hz by version.
const KBPS = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] }
const HZ = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 2.5: [11025, 12000, 8000] }

/** Where each frame of an MP3 starts, with its length in seconds; null when
 *  the bytes are not plain layer III frames end to end (the voice then stays
 *  whole). An ID3v2 tag in front rides with the first frame. */
const framesOf = (bytes) => {
  let at = 0
  if (bytes.length > 10 && bytes.toString('latin1', 0, 3) === 'ID3') {
    at = 10 + ((bytes[6] & 0x7f) << 21 | (bytes[7] & 0x7f) << 14 | (bytes[8] & 0x7f) << 7 | (bytes[9] & 0x7f))
  }
  const frames = []
  while (at < bytes.length) {
    if (at + 4 > bytes.length) return null
    const h = bytes.readUInt32BE(at)
    if ((h >>> 21) !== 0x7ff) return null
    const v = [2.5, 0, 2, 1][(h >>> 19) & 3]
    if (!v || ((h >>> 17) & 3) !== 1) return null // reserved version, or not layer III
    const kbps = KBPS[v === 1 ? 1 : 2][(h >>> 12) & 15]
    const hz = HZ[v][(h >>> 10) & 3]
    if (!kbps || !hz) return null
    const pad = (h >>> 9) & 1
    const length = Math.floor((v === 1 ? 144 : 72) * kbps * 1000 / hz) + pad
    if (at + length > bytes.length) return null
    frames.push({ at, seconds: (v === 1 ? 1152 : 576) / hz })
    at += length
  }
  return frames.length ? frames : null
}

const HEAD_SECONDS = 2
const PART_SECONDS = 8

/** The byte ranges a voice breaks into: a head of about two seconds, then
 *  parts of about eight; a last part shorter than half that joins the one
 *  before it. One range when the voice is too short to gain from parts. */
const voiceParts = (bytes) => {
  const frames = framesOf(bytes)
  if (!frames) return [[0, bytes.length]]
  const cuts = [0]
  let held = 0, limit = HEAD_SECONDS
  for (let i = 1; i < frames.length; i++) {
    held += frames[i - 1].seconds
    if (held >= limit) { cuts.push(frames[i].at); held = 0; limit = PART_SECONDS }
  }
  if (cuts.length > 1 && held < PART_SECONDS / 2) cuts.pop()
  return cuts.map((start, i) => [start, i + 1 < cuts.length ? cuts[i + 1] : bytes.length])
}

const createMedia = () => {
  const bySig = new Map()
  const byPath = new Map()
  const partsBySig = new Map()
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
      if (ext === '.mp3' && !partsBySig.has(sig)) {
        const parts = voiceParts(bytes)
        partsBySig.set(sig, parts.length < 2 ? null : parts.map(([start, end], i) => {
          const slice = bytes.subarray(start, end)
          const part = sigOf(slice)
          if (!bySig.has(part)) bySig.set(part, { sig: part, path: abs, name: `${path.basename(abs, ext)}.${i}${ext}`, type: TYPE[ext], size: slice.length, start, end })
          return `resource:${part}`
        }))
      }
      return sig
    },
    ref: (sig) => `resource:${sig}`,
    /** A voice's parts in order, as refs, or null when it plays whole. */
    partsOf: (sig) => partsBySig.get(String(sig).replace(/^resource:/, '')) ?? null,
    list: () => [...bySig.values()],
  }
}

module.exports = { createMedia, sigOf, bytesOf, framesOf, voiceParts }
