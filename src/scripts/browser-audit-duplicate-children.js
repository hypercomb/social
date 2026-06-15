// scripts/browser-audit-duplicate-children.js
//
// GRAFT AUDIT — paste this whole file into the browser console of the
// shell whose data you want to inspect (it reads that browser's OPFS
// history; a Playwright driver would see a fresh profile, so this must
// run in the real browser). READ-ONLY: walks the reachable tree from
// root and reports every child NAME whose head presence spans more than
// one location, ranked by first appearance in each location's marker
// chain.
//
// Interpretation: the EARLIEST location is where the create actually
// happened; later locations are graft suspects — copies produced by the
// (now fixed) drain-time commit addressing race in LayerCommitter.
// Bag existence can NOT discriminate (the graft cascade mints the
// child's lineage bag at the wrong location too) — timestamps can.
//
// Cleanup: navigate to each suspect location and `/remove <name>` (or
// `/remove[a,b,c]`). History is append-only; the removal records a
// compensating commit and the head comes clean. Verify by re-running
// this audit — expected output: "no cross-location duplicates".

(async () => {
  const h = window.ioc.get('@diamondcoreprocessor.com/HistoryService')
  if (!h) { console.error('HistoryService not available — is the app booted?'); return }
  const childName = async (cs) => { try { const c = await h.getLayerBySig(cs); return c?.name ?? null } catch { return null } }

  const sightings = new Map() // name -> [{location, firstSeen}]
  const walk = async (segs, depth) => {
    if (depth > 8) return
    const locSig = await h.sign({ explorerSegments: () => segs })
    const markers = await h.listMarkerFilenames(locSig)
    if (!markers.length) return
    const firstSeen = new Map()
    let headNames = []
    for (const m of markers) {
      const mk = await h.readMarker(locSig, m)
      const names = (await Promise.all((mk?.parsed?.children ?? []).map(childName))).filter(Boolean)
      for (const n of names) if (!firstSeen.has(n)) firstSeen.set(n, mk?.at ?? 0)
      headNames = names
    }
    for (const n of headNames) {
      if (!sightings.has(n)) sightings.set(n, [])
      sightings.get(n).push({ location: '/' + segs.join('/'), firstSeen: new Date(firstSeen.get(n)).toISOString() })
    }
    for (const n of headNames) await walk([...segs, n], depth + 1)
  }
  await walk([], 0)

  const duplicates = []
  for (const [name, locs] of sightings) {
    if (locs.length > 1) duplicates.push({ name, locations: locs.sort((a, b) => a.firstSeen < b.firstSeen ? -1 : 1) })
  }
  if (!duplicates.length) { console.log('%cgraft audit: no cross-location duplicates — tree is clean', 'color:#0f0'); return }
  console.warn(`graft audit: ${duplicates.length} name(s) live at multiple locations — earliest is the likely true home`)
  for (const d of duplicates) console.table(d.locations.map(l => ({ name: d.name, ...l })))
})()
