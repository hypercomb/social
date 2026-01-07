// imports all needed Pixi primitives
import { Application, Container, Sprite } from 'pixi.js'

/**
 * opens a standalone visual viewer for any sprite or container
 */
export class SpriteViewer {
  private static app?: Application
  private static overlay?: HTMLDivElement

  /**
   * display any pixi sprite or container in a popup overlay
   * @param target the sprite or container to inspect visually
   * @param options optional settings (width, height, scale)
   */
  public static async show(
    target: Container | Sprite,
    options: { width?: number; height?: number; scale?: number } = {}
  ): Promise<void> {
    const { width = 400, height = 400, scale = 1 } = options

    // destroy any previous viewer before creating a new one
    SpriteViewer.destroy()

    // create overlay element
    const overlay = document.createElement('div')
    overlay.style.position = 'fixed'
    overlay.style.top = '50%'
    overlay.style.left = '50%'
    overlay.style.transform = 'translate(-50%, -50%)'
    overlay.style.border = '1px solid #888'
    overlay.style.zIndex = '99999'
    overlay.style.background = '#1e1e1e'
    overlay.style.boxShadow = '0 0 10px rgba(0,0,0,0.5)'
    overlay.style.padding = '4px'
    overlay.style.borderRadius = '8px'
    document.body.appendChild(overlay)

    // add a close button
    const closeBtn = document.createElement('button')
    closeBtn.textContent = '×'
    closeBtn.style.position = 'absolute'
    closeBtn.style.top = '4px'
    closeBtn.style.right = '6px'
    closeBtn.style.background = 'none'
    closeBtn.style.border = 'none'
    closeBtn.style.color = '#ccc'
    closeBtn.style.cursor = 'pointer'
    closeBtn.style.fontSize = '18px'
    closeBtn.onclick = () => SpriteViewer.destroy()
    overlay.appendChild(closeBtn)

    // init a small Pixi app
    const app = new Application()
    await app.init({
      width,
      height,
      backgroundColor: 0x222222,
      antialias: true,
      autoDensity: true,
    })

    // append canvas
    overlay.appendChild(app.canvas)

    // create an isolated container
    const container = new Container()
    container.scale.set(scale)
    container.x = width / 2
    container.y = height / 2
    container.addChild(target)
    app.stage.addChild(container)
    app.render()

    SpriteViewer.app = app
    SpriteViewer.overlay = overlay
  }

  /**
   * closes and cleans up viewer
   */
  public static destroy(): void {
    if (SpriteViewer.app) {
      SpriteViewer.app.destroy(true)
      SpriteViewer.app = undefined
    }
    if (SpriteViewer.overlay) {
      SpriteViewer.overlay.remove()
      SpriteViewer.overlay = undefined
    }
  }
}
