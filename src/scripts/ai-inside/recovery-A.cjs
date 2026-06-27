// Path A — full reset: restore root to the user's original 7 tiles and drop
// ai-inside. Subtrees are intact; we relink by name (resolves to latest marker)
// then bag-set root.children to exactly the 7 current sigs (ai-inside omitted).
const WebSocket = require('ws')
const ORDER = ['dolphin','humanity-centres','hypercomb','susan','howard','loop-demo','diagrams']
let ws, n = 0; const pend = new Map()
function rpc(req, to=15000){return new Promise(res=>{const id='rA-'+(++n);const t=setTimeout(()=>{pend.delete(id);res({ok:false,error:'timeout'})},to);pend.set(id,m=>{clearTimeout(t);res(m)});ws.send(JSON.stringify({...req,id}))})}
const nameOf = async sig => { const r = await rpc({ op:'inflate', cell:sig }, 9000); return r.ok && r.data ? r.data.name : null }

ws = new WebSocket('ws://localhost:2401')
ws.on('message', raw => { let m; try { m = JSON.parse(String(raw)) } catch { return } const cb = pend.get(m.id); if (cb) { pend.delete(m.id); cb(m) } })
const sleep = ms => new Promise(r => setTimeout(r, ms))
ws.on('open', async () => {
  // 0. wait for a renderer (broker is up; renderer = the reopened bridge tab)
  let probe = await rpc({ op:'layer-at', segments:[] })
  const deadline = Date.now() + 20*60*1000
  let waited = 0
  while (!probe.ok && Date.now() < deadline) {
    if (waited % 30 === 0) console.log('waiting for renderer (reopen localhost:4250/?claudeBridge=1)...')
    await sleep(3000); waited += 3
    probe = await rpc({ op:'layer-at', segments:[] })
  }
  if (!probe.ok) { console.log('TIMED OUT waiting for renderer —', probe.error); ws.close(); process.exit(0) }
  console.log('renderer live. root children before:', (probe.data.children||[]).length)

  // 1. relink the 7 user tiles (append by name; preserves prior + full subtrees)
  const add = await rpc({ op:'add', segments:[], cells:ORDER })
  console.log('relink 7 tiles:', add.ok ? `ok (${add.data.count})` : 'FAIL ' + add.error)

  // 2. read fresh root sigs and map sig -> name
  let root = await rpc({ op:'layer-at', segments:[] })
  const sigs = root.data.children || []
  const map = {}
  for (const s of sigs) { const nm = await nameOf(s); if (nm) map[nm] = s; console.log('   ', s.slice(0,10), '→', nm) }

  // 3. build ordered 7 (exclude ai-inside) and bag-set root to exactly those
  const seven = ORDER.map(nm => map[nm]).filter(Boolean)
  if (seven.length !== 7) { console.log('ABORT — only resolved', seven.length, 'of 7 tiles; not touching root.'); ws.close(); process.exit(1) }
  const set = await rpc({ op:'bag-set', segments:[], slot:'children', cells:seven })
  console.log('set root to 7 tiles (ai-inside dropped):', set.ok ? `ok (count ${set.data.count})` : 'FAIL ' + set.error)

  // 4. repaint (no-op remove calls hypercomb.act(); ai-inside now unlinked so warmup walks only the 7)
  await rpc({ op:'remove', segments:[], cells:['__repaint_noop__'] })

  // 5. verify
  root = await rpc({ op:'layer-at', segments:[] })
  const after = root.data.children || []
  console.log('\nAFTER root children:', after.length)
  for (const s of after) console.log('   ', s.slice(0,10), '→', await nameOf(s))
  ws.close(); process.exit(0)
})
ws.on('error', e => { console.log('WS ERR', e.message); process.exit(0) })
