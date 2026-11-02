// Paste into the console of the tab where the tile is blank. Change NAME if needed.
(async () => {
  const NAME = 'dolphin'
  const get = k => window.ioc.get(k)
  const show = get('@diamondcoreprocessor.com/ShowCellDrone')
  const history = get('@diamondcoreprocessor.com/HistoryService')
  const lineage = get('@hypercomb.social/Lineage')
  const here = lineage.explorerSegments?.() ?? []
  const propsAt = async (parent) => {
    const sig = await history.sign({ explorerSegments: () => [...parent, NAME] })
    const layer = await history.currentLayerAt(sig)
    return { locationSig: sig.slice(0, 12), hasLayer: !!layer, properties: layer?.properties ?? null }
  }
  const cached = show.cellImageCache.has(NAME) ? (show.cellImageCache.get(NAME) ?? null) : 'absent'
  const out = {
    here,
    cached,
    rendered: show.renderedCells.get(NAME)?.imageSig ?? 'not-rendered',
    pendingProps: show.renderedCells.get(NAME)?.pendingProps ?? null,
    inAtlas: typeof cached === 'string' && cached.length === 64 ? show.imageAtlas.hasImage(cached) : null,
    failed: typeof cached === 'string' && cached.length === 64 ? show.imageAtlas.hasFailed(cached) : null,
    atRoot: await propsAt([]),
    here_layer: await propsAt(here),
    indexKeys: Object.keys(JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([k]) => /props/i.test(k)).map(([k, v]) => [k, v.length]))))),
  }
  console.log(JSON.stringify(out, null, 2))
})()
