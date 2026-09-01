// A whole whose page has three holes, and three parts whose own pages fill
// them. Proves the composition end to end in the renderer.
//
//   node scripts/bridge/_page-proof.cjs build
//   node scripts/bridge/_page-proof.cjs enter     navigate + website mode
//   node scripts/bridge/_page-proof.cjs clean
const WebSocket = require('ws')
const W = 'page-proof'
const P = ['part-alpha', 'part-beta', 'part-gamma']
let n = 0
const send = q => new Promise((res, rej) => {
  const ws = new WebSocket('ws://localhost:2401')
  const t = setTimeout(() => { try { ws.close() } catch {}; rej(new Error('timeout')) }, 40000)
  ws.on('open', () => ws.send(JSON.stringify({ ...q, id: `pp-${Date.now()}-${++n}` })))
  ws.on('message', r => { clearTimeout(t); let p = null; try { p = JSON.parse(String(r)) } catch {}; try { ws.close() } catch {}; res(p) })
  ws.on('error', e => { clearTimeout(t); rej(e) })
})
const ok = async (q, w) => { const r = await send(q); if (!r || r.ok === false) throw new Error(`${w}: ${r && r.error}`); return r.data }

// The container. Three holes, and text of its OWN so we can tell the whole is
// still there when the holes are empty.
const CONTAINER = `<!doctype html><html><body style="margin:0;background:#0f1218;color:#e8e8e8;font-family:system-ui,sans-serif">
<h1 style="padding:24px 24px 0">page-proof — the WHOLE's own page</h1>
<p style="padding:0 24px;color:#8b93a1">Three holes below. Each is filled by a part's own page.</p>
<div data-hc-container="row" style="display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-start;padding:24px">
  <div data-hc-slot="0" style="flex:1 1 0;min-width:0"></div>
  <div data-hc-slot="1" style="flex:1 1 0;min-width:0"></div>
  <div data-hc-slot="2" style="flex:1 1 0;min-width:0"></div>
</div>
<p style="padding:0 24px 24px;color:#8b93a1">— end of the whole's page —</p>
</body></html>`

// Each part brings its OWN styling. If isolation works, all three keep their
// own colour; if the container's CSS leaked in, they would all look the same.
const page = (name, colour) =>
  `<style>.card{background:${colour};color:#0b0d12;padding:20px;border-radius:10px;font-family:system-ui,sans-serif}
   h2{margin:0 0 6px;font-size:20px}</style>
   <div class="card"><h2>${name}</h2><p>This is ${name}'s OWN page, seated into a hole.</p></div>`

async function build() {
  await ok({ op: 'update', segments: [W], layer: { name: W, children: P } }, 'whole + children')
  const { sig: containerSig } = await ok({ op: 'put-resource', text: CONTAINER }, 'container')
  await ok({ op: 'bag-set', segments: [W], slot: 'website', cells: [containerSig] }, 'whole page')
  console.log('whole page  :', containerSig.slice(0, 12) + '…')

  const colours = ['#f4a261', '#8ecae6', '#a3b18a']
  for (let k = 0; k < P.length; k++) {
    const { sig } = await ok({ op: 'put-resource', text: page(P[k], colours[k]) }, 'part page')
    await ok({ op: 'bag-set', segments: [W, P[k]], slot: 'website', cells: [sig] }, 'part page set')
    console.log(`part ${k}      :`, P[k], sig.slice(0, 12) + '…')
  }

  await ok({
    op: 'effect-emit', cell: 'parts:distribute-visual',
    payload: { segments: [W], parts: P, flow: 'row', place: false },
  }, 'distribute')
  console.log('distribute emitted with flow:row')
  await new Promise(r => setTimeout(r, 9000))

  const L = await ok({ op: 'layer-at', segments: [W] }, 'whole layer')
  for (const s of (L.decorations || [])) {
    try {
      const d = JSON.parse((await ok({ op: 'get-resource', sig: s }, 'd')).text)
      if (d.kind === 'visual:division:plan') {
        console.log('FRAME:', JSON.stringify(d.payload),
          d.payload.flow === 'row' ? '  <-- flow landed' : '  <-- STALE BUNDLE (reload the hive)')
      }
    } catch {}
  }
  for (const p of P) {
    const pl = await ok({ op: 'layer-at', segments: [W, p] }, 'part layer')
    let order = '—'
    for (const s of (pl.decorations || [])) {
      try { const d = JSON.parse((await ok({ op: 'get-resource', sig: s }, 'd')).text); if (d.kind === 'group') order = d.payload.order } catch {}
    }
    console.log(`  ${p.padEnd(12)} order=${order} page=${(pl.website || []).length ? 'yes' : 'NO'}`)
  }
}

const enter = async () => {
  await ok({ op: 'submit', text: W }, 'navigate')
  await new Promise(r => setTimeout(r, 2500))
  await ok({ op: 'submit', text: '/website' }, 'website mode')
  await new Promise(r => setTimeout(r, 2500))
  console.log('ui:', JSON.stringify(await ok({ op: 'ui-state' }, 'ui')))
}

const clean = async () => {
  for (const p of P) await send({ op: 'remove', segments: [W], cells: [p] })
  await send({ op: 'remove', segments: [], cells: [W] })
  console.log('removed')
}

const cmd = process.argv[2] || 'build'
;({ build, enter, clean })[cmd]().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
