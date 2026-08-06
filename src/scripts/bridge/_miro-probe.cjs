const WebSocket = require('ws')
;(async () => {
  const ws = new WebSocket('ws://localhost:2401', { maxPayload: 128*1024*1024 })
  await new Promise((r,j)=>{ws.on('open',r);ws.on('error',j)})
  let n=0; const pending=new Map()
  ws.on('message',(raw)=>{const m=JSON.parse(String(raw));const p=pending.get(m.id);if(p){pending.delete(m.id);p(m)}})
  const call=(req,ms=90000)=>new Promise((res,rej)=>{const id='r'+(++n);pending.set(id,res);ws.send(JSON.stringify({...req,id}));setTimeout(()=>{if(pending.has(id)){pending.delete(id);rej(new Error('timeout'))}},ms)})
  const count = (n) => 1 + (n.children||[]).reduce((a,c)=>a+count(c),0)
  for (const segs of [['moose-on-the-loose'],['moose-on-the-loose','people'],['moose-on-the-loose','people','mark-carney'],['moose-on-the-loose','companies'],['moose-on-the-loose','companies','stock-register']]) {
    const r = await call({op:'note-list', segments: segs})
    const items = Array.isArray(r.data)?r.data:(r.data&&r.data.notes)||[]
    const flat = items.filter(i=>!(i.children||[]).length && !i.mark).length
    const lists = items.filter(i=>i.mark||(i.children||[]).length)
    const rows = lists.reduce((a,l)=>a+count(l),0)
    console.log('/'+segs.join('/'))
    console.log(`   ${flat} flat notes · ${lists.length} lists · ${rows} list rows`)
    lists.forEach(l=>console.log('     ['+l.mark+'] '+String(l.text).split('\n')[0].slice(0,60)+`  (${count(l)-1} rows)`))
  }
  ws.close()
})()
