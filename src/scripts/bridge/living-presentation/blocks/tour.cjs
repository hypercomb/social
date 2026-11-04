// The tour's scenes, folded into the tiles they explain.
//
// The narrated tour (scripts/presentation, published at hypercomb.com/tour/)
// is the standard: its words, its voice, its figures and its look. A tile that
// one of its scenes explains shows that scene — the same headline, the same
// figure, the same narration, the same recorded voice — and nothing of its own
// in their place, so no idea is said twice. Every scene lands on a tile that
// is already in the tree (tree.cjs); the tree is unchanged.
//
// Nothing here is a second copy: the scenes are read from scenes/*.json, the
// figures are drawn by the tour's own visualHtml, the voice is the tour's own
// audio-cache file, the clips are its media/*.mp4, the faces are the vendored
// ones. Each medium is named by its signature (media.cjs), so a page carries a
// reference and the bytes are stored once in the hive.

const fs = require('fs')
const path = require('path')
const T = require('../../../presentation/build.cjs')
const { sentencesOf, sentenceTimes } = require('../../../presentation/timing.cjs')

const TOUR = path.dirname(require.resolve('../../../presentation/build.cjs'))

/** The tile each scene explains: one scene per tile. The tour's opening
 *  protocol scene and its close have tiles of their own in the road tree. */
const SCENES_OF = {
  'presentation': 1,
  'road/protocol': 2,
  'presentation/simple': 3,
  'presentation/accessible': 4,
  'presentation/simple/primitive/signature': 5,
  'presentation/simple/primitive': 6,
  'presentation/organized/history': 7,
  'presentation/intelligent': 8,
  'presentation/intelligent/automaton': 9,
  'presentation/simple/act': 10,
  'presentation/intelligent/sentence': 11,
  'presentation/collaborative/workbench': 12,
  'presentation/organized': 13,
  'presentation/organized/heart': 14,
  'presentation/collaborative/domain': 15,
  'presentation/collaborative/discovery': 16,
  'presentation/collaborative/publishing': 17,
  'presentation/collaborative': 18,
  'presentation/intelligent/agent': 19,
  'road/creations': 20,
  'road/coming': 21,
  'road/vision': 22,
  'road/computer': 23,
  'road/yours': 24,
  'road/first-day': 25,
}

/** The scene a route shows, or null when no scene explains it. One tile, one
 *  scene (jwize 2026-11-03): the hierarchy is the presentation. */
const sceneAt = (route) => SCENES_OF[route] ?? null

/** Every scene is placed exactly once. */
const placed = () => Object.values(SCENES_OF)

const sceneOf = (n) => {
  const s = T.scenes.find(x => x.n === n)
  if (!s) throw new Error(`no tour scene ${n}`)
  return s
}

/** One scene, ready for a page: its parts as HTML, its caption, its voice. */
const sceneParts = (n, media) => {
  const s = sceneOf(n)
  // The voice is keyed by the words: a scene whose words changed is silent
  // (it holds for its reading time) until build.cjs records them again.
  const voice = T.cachePath(s.say)
  const clip = (name) => media.ref(media.add(path.join(TOUR, 'media', T.CLIP_FILE[name])))
  return {
    n,
    name: T.plain(s.headline).replace(/[.]$/, ''),
    eyebrow: T.esc(T.smart(s.eyebrow)),
    headline: T.emph(s.headline),
    figure: T.visualHtml(s, { clipSrc: clip }),
    sub: s.sub ? T.emph(s.sub) : '',
    link: s.link ? { href: s.link.href, label: T.smart(s.link.label) } : null,
    caption: T.captionOf(s.say),
    voice: voice ? media.ref(media.add(voice)) : null,
    lines: linesOf(s.say, voice).map((l, i) => ({ ...l, lit: lightsOf(s, i) })),
  }
}

/** A scene's narration as the sentences a reader sees one at a time, each
 *  with where it sits in the voice (seconds; `to` is where the next sentence
 *  starts, so the voice plays straight through). The timing is the shared
 *  sentence clock (scripts/presentation/timing.cjs) the recorder and the
 *  drawn clips use, so all three agree on where a sentence starts. Without a
 *  voice, or when the spoken and shown sentences do not pair up, a sentence
 *  carries no times and is held for its reading time. */
const linesOf = (say, voice) => {
  const shown = sentencesOf(T.captionOf(say))
  let spans = null
  if (voice) {
    try {
      const spoken = sentencesOf(T.spokenOf(say))
      if (spoken.length === shown.length) spans = sentenceTimes(voice, spoken).spans
    } catch { spans = null }
  }
  return shown.map((text, i) => ({
    say: text,
    from: spans ? Math.max(0, i === 0 ? 0 : spans[i].start) : null,
    to: spans ? (spans[i + 1] ? spans[i + 1].start : null) : null,
  }))
}

/** The figure's parts a sentence is about (scene "lights", one entry per
 *  sentence; "*" is the whole figure), or null where the scene names none. */
const lightsOf = (s, i) => {
  if (!Array.isArray(s.lights)) return null
  const l = s.lights[i]
  return l === '*' ? ['*'] : Array.isArray(l) ? l : null
}

/** The tour's icon sprite, read from its template: one set of icons. */
const sprite = () => {
  const html = fs.readFileSync(path.join(TOUR, 'template.html'), 'utf8')
  const m = html.match(/<svg aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden"><defs>[\s\S]*?<\/defs><\/svg>/)
  if (!m) throw new Error('the tour template no longer carries its icon sprite where tour.cjs looks for it')
  return m[0]
}

/** The faces, each stored once and named by its signature. */
const fontFaces = (media) => T.FONTS.map(f => {
  const sig = media.add(path.join(T.FONT_DIRS[f.dir], f.file))
  return `@font-face{font-family:"${f.family}";font-style:normal;font-weight:${f.weight};font-display:swap;src:url(${media.ref(sig)}) format("woff2")}`
}).join('\n')

/** The voice for any line the tour's way: audio-cache/<hash>.mp3, or null
 *  while the line has not been voiced yet (blocks/narrate.cjs voices them). */
const voiceOf = (say, media) => {
  const file = T.cachePath(say)
  return file ? media.ref(media.add(file)) : null
}

module.exports = { SCENES_OF, sceneAt, placed, sceneParts, sprite, fontFaces, voiceOf, T, TOUR }
