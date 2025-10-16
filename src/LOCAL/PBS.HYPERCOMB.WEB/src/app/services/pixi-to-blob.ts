import { Sprite } from "pixi.js"

declare module 'pixi.js' {
  interface Sprite {
    toBlob(): Promise<Blob | null>
  }
}

export const addToBlobToContainer = () => {
  Sprite.prototype.toBlob = async function (): Promise<Blob | null> {
    if (!this.children.length) {
      console.warn('Container has no children to generate a Blob.')
      return null
    }


    // Create a canvas to render the container
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')

    if (!context) {
      console.error('Failed to create canvas context.')
      return null
    }

    // Calculate container bounds
    const bounds = this.getBounds()
    canvas.width = bounds.width
    canvas.height = bounds.height

    // Render each child (assuming they are Sprites or Graphics)
    for (const child of this.children) {
      const textureSource = (child as any)?.texture?.baseTexture?.resource?.source

      if (textureSource instanceof HTMLImageElement || textureSource instanceof HTMLCanvasElement) {
        context.drawImage(textureSource, child.x - bounds.x, child.y - bounds.y)
      } else {
        console.warn('Unsupported child type, skipping rendering.')
      }
    }

    // Convert the canvas content to a Blob
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob)
      }, 'image/png')
    })
  }

  console.log('Added toBlob method to Container prototype')
}


