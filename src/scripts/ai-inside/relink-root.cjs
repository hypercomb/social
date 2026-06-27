// Recover root: relink the user's tiles that got dropped from root.children
// (their subtrees are intact and resolve by name). `add` appends by name and
// resolves name -> latest marker at commit, preserving each full subtree.
const WebSocket = require('ws')
const MISSING = ['dolphin','humanity-centres','hypercomb','susan','howard','loop-demo','diagrams']
let ws, n = 0; const pend = new Map()
function rpc(req, to=15000){return new Promise(res=>{const id='rl-'+(++n);const t=setTimeout(()=>{pend.delete(id);res({ok:false,error:'timeout'})},to);pend.set(id,m=>{clearTimeout(t);res(m)});ws.send(JSON.stringify({...req,id}))})}
ws = new WebSocket('ws://localhost:2401')
ws.on('message', raw => { let m; try { m = JSON.parse(String(raw)) } catch { return } const cb = pend.get(m.id); if (cb) { pend.delete(m.id); cb(m) } })
ws.on('open', async () => {
  let r = await rpc({ op: 'layer-at', segments: [] })
  console.log('BEFORE root children:', (r.data.children||[]).length)

  // relink the missing tiles (append by name -> resolves to latest marker)
  const add = await rpc({ op: 'add', segments: [], cells: MISSING })
  console.log('relink add:', add.ok ? `ok (${add.data.count} tiles)` : 'FAIL ' + add.error)

  r = await rpc({ op: 'layer-at', segments: [] })
  const kids = r.data.children || []
  console.log('AFTER root children:', kids.length)
  for (const sig of kids) { const inf = await rpc({ op: 'inflate', cell: sig }, 4000); console.log('  ', sig.slice(0,10), '→', inf.ok ? JSON.stringify(inf.data.name) : '[large/' + inf.error + ']') }

  // diagnose the white overlay: is the website ViewMode likely active? check
  // which cells carry visual:website:page decorations (those mount as HTML).
  console.log('\n-- website:page decorations present? --')
  for (const seg of [[ 'ai-inside' ], ['ai-inside','openai'], ['dolphin']]) {
    const la = await rpc({ op: 'layer-at', segments: seg })
    const decs = la.ok && Array.isArray(la.data.decorations) ? la.data.decorations.length : 0
    console.log('  /' + seg.join('/'), '→ decorations:', decs)
  }
  ws.close(); process.exit(0)
})
ws.on('error', e => { console.log('ERR', e.message); process.exit(1) })
