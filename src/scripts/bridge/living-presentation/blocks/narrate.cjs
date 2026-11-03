// Voice the pages' own beats the way the tour voices its scenes: the same
// voice, the same rate, the same cache (scripts/presentation/audio-cache,
// named by the hash of voice, rate and words). A page picks a beat's voice up
// by itself once the file exists (tour.cjs voiceOf); a beat with no voice yet
// holds for its reading time instead.
//
//   node scripts/bridge/living-presentation/blocks/narrate.cjs           # voice what is missing
//   node scripts/bridge/living-presentation/blocks/narrate.cjs --check   # list it, no network
//
// Voicing needs the network and the tour's own dependency (msedge-tts, in
// scripts/presentation: npm install there once).

const content = require('./content.cjs')
const tour = require('./tour.cjs')

const lines = Object.entries(content)
  .filter(([route]) => !tour.stagesOf(route).length)
  .flatMap(([route, block]) => (block.beats || []).map((beat, i) => ({ say: beat.say, n: `${route.split('/').pop()} ${i + 1}`, name: route })))

const unique = [...new Map(lines.map(l => [tour.T.hashOf(l.say), l])).values()]

tour.T.ensureAudio(unique).then(() => {
  const missing = unique.filter(l => !tour.T.cachePath(l.say))
  if (!process.argv.includes('--check')) console.log(missing.length ? `${missing.length} beat(s) still have no voice` : `every beat has its voice (${unique.length} lines)`)
}).catch(error => { console.error(error.message); process.exit(1) })
