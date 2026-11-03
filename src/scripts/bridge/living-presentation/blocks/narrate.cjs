// Voice every page's beats in the tour's voice, through the tour's one path
// (scripts/presentation/build.cjs ensureAudio: the same voice, the same rate,
// the same audio-cache/<hash>.mp3 names). A page picks a voiced beat up on
// its next build; a beat not voiced yet holds for its reading time instead.
//
//   node scripts/bridge/living-presentation/blocks/narrate.cjs           # voice what is missing (needs the network)
//   node scripts/bridge/living-presentation/blocks/narrate.cjs --check   # list what is missing, voice nothing

const content = require('./content.cjs')
const tour = require('./tour.cjs')

const lines = Object.entries(content)
  .filter(([route, block]) => !tour.sceneAt(route) && Array.isArray(block.beats))
  .flatMap(([route, block]) => block.beats.map((b, i) => ({ say: b.say, n: `${route} #${i + 1}`, name: b.say.slice(0, 48) })))

tour.T.ensureAudio(lines, { check: process.argv.includes('--check') })
  .then(() => { if (!process.argv.includes('--check')) console.log(`${lines.length} beats voiced.`) })
  .catch(e => { console.error('narrate failed:', e.message); process.exit(1) })
