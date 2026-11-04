// Voice every page's beats in the tour's voice, through the tour's one path
// (scripts/presentation/build.cjs ensureAudio: the same voice, the same rate,
// the same audio-cache/<hash>.mp3 names). A page picks a voiced beat up on
// its next build; a beat not voiced yet holds for its reading time instead.
//
//   node scripts/bridge/living-presentation/blocks/narrate.cjs           # voice what is missing (needs the network)
//   node scripts/bridge/living-presentation/blocks/narrate.cjs --check   # list what is missing, voice nothing

const content = require('./content.cjs')
const tour = require('./tour.cjs')

// Every spoken line a page adds to the tour: a block's beats, and a capture's
// caption (the scene's last beat, said while the narration turns to it). The
// tour's own scenes are voiced by scripts/presentation/build.cjs.
const lines = Object.entries(content).flatMap(([route, block]) => [
  ...(!tour.sceneAt(route) && Array.isArray(block.beats) ? block.beats.map((b, i) => ({ say: b.say, n: `${route} #${i + 1}`, name: b.say.slice(0, 48) })) : []),
  ...(block.live || []).map(l => ({ say: l.caption, n: `${route} (capture ${l.shot || 'tiles'})`, name: l.caption.slice(0, 48) })),
  // a scene a page tells in its own words (a real hive in place of a demo clip)
  ...Object.entries(block.figures || {}).filter(([, f]) => f.say).map(([n, f]) => ({ say: f.say, n: `scene ${n} on ${route}`, name: f.say.slice(0, 48) })),
])

tour.T.ensureAudio(lines, { check: process.argv.includes('--check') })
  .then(() => { if (!process.argv.includes('--check')) console.log(`${lines.length} beats voiced.`) })
  .catch(e => { console.error('narrate failed:', e.message); process.exit(1) })
