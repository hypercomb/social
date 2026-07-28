// Repair pass for _linkedin-leads-build.cjs: re-apply ONLY the `children`
// slot updates, which are pure SET ops and therefore idempotent. The build's
// first run lost these 7 ops to a renderer that dropped mid-run ("no renderer
// connected"), leaving every cell minted (notes + pheromones landed) but not
// linked as a child of its parent.
//
//   node scripts/bridge/_linkedin-leads-link.cjs
//
// Safe to re-run. Waits for the renderer instead of failing on it.

const WebSocket = require('ws')

const BRIDGE = 'ws://localhost:2401'
const TIMEOUT = 60_000
const ROOT = 'linkedin-leads'

let counter = 0
function send(req) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE)
    const id = `link-${Date.now()}-${++counter}`
    const t = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, TIMEOUT)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
    ws.on('message', raw => {
      clearTimeout(t)
      try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) }
      ws.close()
    })
    ws.on('error', e => { clearTimeout(t); reject(e) })
  })
}

// the fix the build script was missing: ride out a renderer that comes and goes
async function withRenderer(req, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await send(req)
      if (r.ok || r.error !== 'no renderer connected') return r
    } catch (e) {
      if (i === attempts - 1) throw e
    }
    if (i === 0) process.stdout.write('(waiting for renderer) ')
    await new Promise(r => setTimeout(r, 3000))
  }
  return { ok: false, error: 'renderer never connected' }
}

const LINKS = [
  [[ROOT], ['paradigm-twins', 'builders', 'conveners', 'capital', 'nostr', 'philosophy', 'search-seams']],
  [[ROOT, 'paradigm-twins'], ['chad-fowler', 'anselm-eickhoff', 'peter-van-hardenberg', 'michael-taylor', 'ritesh-kadmawala']],
  [[ROOT, 'builders'], ['aurelien-franky', 'jacob-duval', 'zixuan-chen', 'harsh-sahu', 'aryan-shaw', 'sylve-chevet', 'victor-brodeur', 'robert-elves', 'jose-morales']],
  [[ROOT, 'conveners'], ['emma-tracey', 'johanna-dahlroos', 'boris-mann', 'ana-jamborcic', 'ira-nezhynska', 'akhilesh-thite']],
  [[ROOT, 'capital'], ['james-fairweather', 'diraj-goel', 'hilla-pedramparsi', 'luca-maraschi']],
  [[ROOT, 'nostr'], ['derek-ross', 'samuel-manzanera', 'vano-khuroshvili', 'emre-yilmaz', 'neil-chong-kit']],
  [[ROOT, 'philosophy'], ['benton-moss', 'javan-ward', 'benny-cheung', 'sebastien-dubois', 'jamie-watters', 'oliver-muldoon']],
]

async function main() {
  let ok = 0, fail = 0
  for (const [segments, children] of LINKS) {
    process.stdout.write(`  ${segments.join('/')} <- ${children.length} children ... `)
    // `update` takes the children INSIDE a `layer` object — a top-level
    // `children` key is silently rejected with "no layer provided".
    const r = await withRenderer({ op: 'update', segments, layer: { children } })
    if (r.ok) { ok++; console.log('ok') } else { fail++; console.log(`FAIL: ${r.error}`) }
  }
  console.log(`\n[link] ${ok} ok, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
