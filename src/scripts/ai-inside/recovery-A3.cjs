// Path A (canonical): set root.children to exactly the user's 7 tiles via the
// `update` op. children is a name-slot -> each name resolves to its latest
// marker (full subtree preserved). Drops ai-inside and the dup diagrams.
const WebSocket = require('ws')
const NAMES = ['dolphin','humanity-centres','hypercomb','susan','howard','loop-demo','diagrams']
const KNOWN = {
  dolphin:'469136df246bae1900cacbea657a4a9b8440734ad9b096bf781ac951c2e154a5',
  'humanity-centres':'a1e9d3467c4a3f18f3745c3e82327476dd95b67ad95eb51f9dccb1645828dbf9',
  hypercomb:'c5561c452e1ba768a2b48fd2c2fb345659d1febb23c3d2dcde3509cd45e17831',
  susan:'4b75420e168585c0f7f6346f081d6117827388fff720c64a156ba9cbd7baebf1',
  howard:'db1ac44656f5b0f9b2b1acf6cc61a778c361dafa4c5d5028cfb8da70f0d549d6',
  'loop-demo':'0ebe114cc45b028b923eb94bc0e00ea3971c50aa8c07161aae3ef779c3e03f66',
  diagrams:'d2d12ec44bd4214e8bb05970620f1d85d003993a752246ce64ed9ce87230e64d',
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
let ws, n = 0; const pend = new Map()
function rpc(req, to=20000){return new Promise(res=>{const id='a3-'+(++n);const t=setTimeout(()=>{pend.delete(id);res({ok:false,error:'timeout'})},to);pend.set(id,m=>{clearTimeout(t);res(m)});ws.send(JSON.stringify({...req,id}))})}
ws = new WebSocket('ws://localhost:2401')
ws.on('message', raw => { let m; try { m = JSON.parse(String(raw)) } catch { return } const cb = pend.get(m.id); if (cb) { pend.delete(m.id); cb(m) } })
ws.on('open', async () => {
  let r = await rpc({ op:'layer-at', segments:[] })
  const deadline = Date.now() + 20*60*1000; let w = 0
  while (!r.ok && Date.now() < deadline) { if (w%30===0) console.log('waiting for renderer (reopen localhost:4250/?claudeBridge=1)...'); await sleep(3000); w+=3; r = await rpc({ op:'layer-at', segments:[] }) }
  if (!r.ok) { console.log('TIMED OUT:', r.error); ws.close(); process.exit(1) }
  console.log('renderer live. root children before:', (r.data.children||[]).length, '(name', JSON.stringify(r.data.name) + ')')

  // canonical SET: root.children = the 7 tile NAMES (resolve to latest markers)
  const upd = await rpc({ op:'update', segments:[], layer:{ name:'/', children: NAMES } })
  console.log('update root → 7 tiles:', upd.ok ? `ok (count ${upd.data.count})` : 'FAIL ' + upd.error)
  if (!upd.ok) { ws.close(); process.exit(1) }

  // repaint: no-op remove triggers hypercomb.act() (synchronize). ai-inside now
  // unlinked, so warmup walks only the 7 tiles -> fast.
  await rpc({ op:'remove', segments:[], cells:['__repaint_noop__'] })

  // verify (light reads)
  r = await rpc({ op:'layer-at', segments:[] })
  const after = r.data.children || []
  const knownSet = new Set(Object.values(KNOWN))
  const extras = after.filter(s => !knownSet.has(s))
  console.log('\nAFTER root children:', after.length, '(expect 7)')
  console.log('all are known user tiles:', extras.length === 0 ? 'yes — ai-inside removed' : 'NO, extras: ' + extras.map(s=>s.slice(0,10)))
  for (const name of NAMES) {
    const la = await rpc({ op:'layer-at', segments:[name] }, 9000)
    console.log('  ', name.padEnd(18), la.ok ? `intact (${la.data.children?la.data.children.length:0} children)` : '['+la.error+']')
  }
  ws.close(); process.exit(0)
})
ws.on('error', e => { console.log('WS ERR', e.message); process.exit(1) })
