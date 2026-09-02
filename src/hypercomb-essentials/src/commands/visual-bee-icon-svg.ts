// Material Symbols are fonts, while the tile overlay rasterises SVG markup.
// Keep the two identities aligned here so a behavior's declared toggleIcon is
// also the mark participants see and click directly on a tile.

const GLYPHS: Readonly<Record<string, string>> = {
  description:
    '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 12h6M9 16h6"/>',
  photo_library:
    '<rect x="5" y="5" width="15" height="14" rx="1"/><path d="M3 17V3h14"/><circle cx="15.5" cy="9.5" r="1.5"/><path d="m8 16 3.5-3 2.5 2 2-1.5 3 2.5"/>',
  slideshow:
    '<rect x="3" y="4" width="18" height="14" rx="1"/><path d="m10 8 5 3-5 3z"/><path d="M9 21h6M12 18v3"/>',
  hub:
    '<circle cx="12" cy="12" r="2.5"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="12" cy="20" r="2"/><path d="m10.2 10.2-3.8-3.8m7.4 3.8 3.8-3.8M12 14.5V18"/>',
  view_carousel:
    '<rect x="8" y="4" width="8" height="16" rx="1"/><path d="M5 7H3v10h2M19 7h2v10h-2"/>',
  web:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
  school:
    '<path d="m3 9 9-5 9 5-9 5z"/><path d="M7 12v5c3 2.2 7 2.2 10 0v-5M21 9v6"/>',
  account_tree:
    '<rect x="3" y="3" width="6" height="5" rx="1"/><rect x="15" y="10" width="6" height="5" rx="1"/><rect x="15" y="18" width="6" height="4" rx="1"/><path d="M6 8v8h9M12 12h3M12 20h3"/>',
  conversion_path:
    '<circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 5h4a3 3 0 0 1 3 3v8a3 3 0 0 0 3 3"/><path d="m10 13 4 3-4 3"/>',
  // The scroller — pages that turn: an open book, the right-hand page lifting
  // mid-flick. Material's own `auto_stories` is the same picture.
  auto_stories:
    '<path d="M3 6.5c2.8-1.1 6-1.1 9 0v12.5c-3-1.1-6.2-1.1-9 0z"/><path d="M21 6.5c-2.8-1.1-6-1.1-9 0v12.5c3-1.1 6.2-1.1 9 0z"/><path d="M12 6.5c1.8-3 4.4-4.2 7.5-3.8"/>',
  // The hexagons ground itself — the publish panel's opens-as strip offers it
  // beside the registered views, so the un-pinned face has an honest mark.
  hexagon:
    '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/>',
}

function hashedGlyph(seed: string): string {
  let hash = 2166136261
  for (const char of seed) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  const count = 3 + (hash >>> 0) % 3
  const nodes: Array<{ x: number; y: number }> = []
  for (let i = 0; i < count; i++) {
    const phase = ((hash >>> ((i * 5) % 24)) & 31) / 32
    const angle = phase * Math.PI * 2 + i * (Math.PI * 2 / count)
    nodes.push({
      x: Number((12 + Math.cos(angle) * 7).toFixed(2)),
      y: Number((12 + Math.sin(angle) * 7).toFixed(2)),
    })
  }
  return '<circle cx="12" cy="12" r="2.25"/>'
    + nodes.map(node =>
      `<path d="M12 12L${node.x} ${node.y}"/><circle cx="${node.x}" cy="${node.y}" r="1.6"/>`,
    ).join('')
}

/** SVG mark for a behavior. Known Material ligatures get a semantic drawing;
 * future behavior names get a stable, name-derived constellation rather than
 * collapsing back to one generic icon. */
export function visualBeeIconSvg(toggleIcon: string, view: string): string {
  const glyph = GLYPHS[toggleIcon] ?? hashedGlyph(`${toggleIcon}:${view}`)
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"'
    + ' fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
    + ` aria-hidden="true">${glyph}</svg>`
}
