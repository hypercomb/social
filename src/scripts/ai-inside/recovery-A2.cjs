// Path A (robust): set root.children to exactly the user's 7 tiles by their
// KNOWN current sigs — no inflate (renderer is slow), no add. Drops ai-inside
// and the duplicate diagrams. Safety: only proceeds if all 7 known sigs are
// present in the live root.children (proves they're current, not stale).
const WebSocket = require('ws')
const SEVEN = [
  ['dolphin',          '469136df246bae1900cacbea657a4a9b8440734ad9b096bf781ac951c2e154a5'],
  ['humanity-centres', 'a1e9d3467c4a3f18f3745c3e82327476dd95b67ad95eb51f9dccb1645828dbf9'],
  ['hypercomb',        'c5561c452e1ba768a2b48fd2c2fb345659d1febb23c3d2dcde3509cd45e17831'],
  ['susan',            '4b75420e168585c0f7f6346f081d6117827388fff720c64a156ba9cbd7baebf1'],
  ['howard',           'db1ac44656f5b0f9b2b1acf6cc61a778c361dafa4c5d5028cfb8da70f0d549d6'],
  ['loop-demo',        '0ebe114cc45b028b923eb94bc0e00ea3971c50aa8c07161aae3ef779c3e03f66'],
  ['diagrams',         'd2d12ec44bd4214e8bb05970620f1d85d003993a752246ce64ed9ce87230e64d'],
]
const sleep = ms => new Promise(r => setTimeout(r, ms))
let ws, n = 0; const pend = new Map()
function rpc(req, to=15000){return new Promise(res=>{const id='a2-'+(++n);const t=setTimeout(()=>{pend.delete(id);res({ok:false,error:'timeout'})},to);pend.set(id,m=>{clearTimeout(t);res(m)});ws.send(JSON.stringify({...req,id}))})}
ws = new WebSocket('ws://localhost:2401')
ws.on('message', raw => { let m; try { m = JSON.parse(String(raw)) } catch { return } const cb = pend.get(m.id); if (cb) { pend.delete(m.id); cb(m) } })
ws.on('open', async () => {
  // wait for renderer
  let r = await rpc({ op:'layer-at', segments:[] })
  const deadline = Date.now() + 20*60*1000; let w = 0
  while (!r.ok && Date.now() < deadline) { if (w%30===0) console.log('waiting for renderer...'); await sleep(3000); w+=3; r = await rpc({ op:'layer-at', segments:[] }) }
  if (!r.ok) { console.log('TIMED OUT:', r.error); ws.close(); process.exit(1) }

  const current = r.data.children || []
  console.log('live root children:', current.length, '| unique:', [...new Set(current)].length)
  const want = SEVEN.map(([,s]) => s)
  const present = want.filter(s => current.includes(s))
  console.log('known user-tile sigs present in live root:', present.length, '/ 7')
  if (present.length !== 7) { console.log('ABORT — some known sigs not in live root (stale). Names/sigs to recheck.'); console.log('current:', current.map(s=>s.slice(0,10))); ws.close(); process.exit(1) }

  // set root to exactly the 7 (drops ai-inside + dup diagrams)
  const set = await rpc({ op:'bag-set', segments:[], slot:'children', cells: want })
  console.log('bag-set root → 7 tiles:', set.ok ? `ok (count ${set.data.count})` : 'FAIL ' + set.error)
  if (!set.ok) { ws.close(); process.exit(1) }

  // repaint
  await rpc({ op:'remove', segments:[], cells:['__repaint_noop__'] })

  // verify — light reads only (layer-at by name, not inflate)
  r = await rpc({ op:'layer-at', segments:[] })
  const after = r.data.children || []
  console.log('\nAFTER root children:', after.length, '(expect 7)')
  for (const [name] of SEVEN) {
    const la = await rpc({ op:'layer-at', segments:[name] }, 8000)
    console.log('  ', name.padEnd(18), la.ok ? `intact (${la.data.children?la.data.children.length:0} children)` : '['+la.error+']')
  }
  // confirm ai-inside is no longer linked at root
  console.log('\nai-inside still in root.children?', after.some(s => !want.includes(s)) ? 'an extra sig remains' : 'no — removed cleanly')
  ws.close(); process.exit(0)
})
ws.on('error', e => { console.log('WS ERR', e.message); process.exit(1) })
