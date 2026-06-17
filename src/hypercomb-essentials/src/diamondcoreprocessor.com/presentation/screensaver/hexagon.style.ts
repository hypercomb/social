// diamondcoreprocessor.com/presentation/screensaver/hexagon.style.ts
//
// Hexagon bubble — matches the hive's hex grid (orientation-aware).

import { Container, Graphics } from 'pixi.js'
import { registerBubbleStyle, hexPoints, addClippedImage, addNeonEdge, addLabel } from './bubble-style.js'

registerBubbleStyle({
  name: 'hexagon',
  description: 'Hexagons matching the grid',
  build({ tex, color, r, label, hideText, flat }) {
    const view = new Container()
    const pts = hexPoints(r, flat)
    if (tex) addClippedImage(view, tex, () => new Graphics().poly(pts).fill(0xffffff), r)
    else view.addChild(new Graphics().poly(pts).fill({ color, alpha: 0.3 }))
    addNeonEdge(view, r, (width, alpha) => new Graphics().poly(pts).stroke({ color, width, alpha }))
    addLabel(view, label, hideText, r)
    return view
  },
})
