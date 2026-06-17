// diamondcoreprocessor.com/presentation/screensaver/circle.style.ts
//
// Circle bubble — classic round neon bubbles.

import { Container, Graphics } from 'pixi.js'
import { registerBubbleStyle, addClippedImage, addNeonEdge, addLabel } from './bubble-style.js'

registerBubbleStyle({
  name: 'circle',
  description: 'Round neon bubbles',
  build({ tex, color, r, label, hideText }) {
    const view = new Container()
    if (tex) addClippedImage(view, tex, () => new Graphics().circle(0, 0, r).fill(0xffffff), r)
    else view.addChild(new Graphics().circle(0, 0, r).fill({ color, alpha: 0.3 }))
    addNeonEdge(view, r, (width, alpha) => new Graphics().circle(0, 0, r).stroke({ color, width, alpha }))
    addLabel(view, label, hideText, r)
    return view
  },
})
