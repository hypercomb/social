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

const TOUR = path.dirname(require.resolve('../../../presentation/build.cjs'))

/** The tile each scene explains. A tile with more than one run of scenes
 *  plays each run on its own stage (the opening, and the close). */
const SCENES_OF = {
  'presentation': [
    { label: 'The opening', scenes: [1, 2] },
    { label: 'The road ahead', scenes: [20, 21, 22, 23, 24, 25] },
  ],
  'presentation/simple': [3],
  'presentation/simple/primitive': [6],
  'presentation/simple/primitive/signature': [5],
  'presentation/simple/act': [10],
  'presentation/organized': [13],
  'presentation/organized/heart': [14],
  'presentation/organized/history': [7],
  'presentation/collaborative': [18],
  'presentation/collaborative/workbench': [12],
  'presentation/collaborative/domain': [15],
  'presentation/collaborative/publishing': [17],
  'presentation/collaborative/discovery': [16],
  'presentation/intelligent': [8],
  'presentation/intelligent/sentence': [11],
  'presentation/intelligent/automaton': [9],
  'presentation/intelligent/agent': [19],
  'presentation/accessible': [4],
}

/** A route's stages: [{ label, scenes: [n] }], or [] when no scene explains it. */
const stagesOf = (route) => {
  const v = SCENES_OF[route]
  if (!v) return []
  return typeof v[0] === 'number' ? [{ label: '', scenes: v }] : v
}

/** Every scene is placed exactly once. */
const placed = () => Object.values(SCENES_OF).flatMap(v => typeof v[0] === 'number' ? v : v.flatMap(s => s.scenes))

const sceneOf = (n) => {
  const s = T.scenes.find(x => x.n === n)
  if (!s) throw new Error(`no tour scene ${n}`)
  return s
}

/** One scene, ready for a page: its parts as HTML, its caption, its voice.
 *  `figure`, when given, draws the scene's figure instead of the tour's own,
 *  so a clip the page does not show is never carried with it. */
const sceneParts = (n, media, figure = null) => {
  const s = sceneOf(n)
  const voice = T.cachePath(s.say)
  if (!voice) throw new Error(`scene ${n} has no recorded voice for its current words — run node scripts/presentation/build.cjs`)
  const clip = (name) => media.ref(media.add(path.join(TOUR, 'media', T.CLIP_FILE[name])))
  return {
    n,
    name: T.plain(s.headline).replace(/[.]$/, ''),
    eyebrow: T.esc(T.smart(s.eyebrow)),
    headline: T.emph(s.headline),
    figure: figure ? figure() : T.visualHtml(s, { clipSrc: clip }),
    sub: s.sub ? T.emph(s.sub) : '',
    link: s.link ? { href: s.link.href, label: T.smart(s.link.label) } : null,
    caption: T.captionOf(s.say),
    voice: media.ref(media.add(voice)),
  }
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

module.exports = { SCENES_OF, stagesOf, placed, sceneParts, sprite, fontFaces, voiceOf, T, TOUR }
