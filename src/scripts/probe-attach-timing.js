// Paste into the console of the slow tab, THEN drop the picture and name the tile.
// After the picture shows, run:  copy(JSON.stringify(window.__attachTrace, null, 1))
(() => {
  const bus = globalThis.__hypercombEffectBus
  const t0 = performance.now()
  window.__attachTrace = []
  const mark = (e, p) => window.__attachTrace.push(`${Math.round(performance.now() - t0)}ms ${e} ${p?.cell ?? ''} ${(p?.segments ?? []).join('/')}`)
  for (const e of ['command:arm-resource', 'cell:added', 'cell:attach-resource', 'cell:committed', 'tile:saved', 'cell:0000-changed', 'cell:attach-pending', 'render:cell-count', 'thumbnail:wanted'])
    bus.on(e, p => mark(e, p))
  const show = window.ioc.get('@diamondcoreprocessor.com/ShowCellDrone')
  const iv = setInterval(() => {
    const hit = [...show.renderedCells.values()].find(c => c.imageSig && show.imageAtlas.hasImage(c.imageSig) && !window.__seen?.has(c.label))
    window.__seen ??= new Set(show.renderedCells.keys())
    if (hit) { mark('PICTURE IN ATLAS', { cell: hit.label }); clearInterval(iv) }
  }, 50)
  console.log('tracing — drop the picture, name the tile, then copy(JSON.stringify(window.__attachTrace, null, 1))')
})()
