import { Injectable } from '@angular/core'
import { Assets, Sprite, Texture } from 'pixi.js'
import { SpriteBuilder } from './sprite-builder'
import { Cell } from 'src/app/cells/cell'

@Injectable({
  providedIn: 'root'
})
export class BorderColorSprite extends SpriteBuilder<Cell> {

  public override build = async (cell: Cell): Promise<Sprite> => {
    const { width, height } = this.settings.hexagonDimensions
    const padding = 20
    const border = cell.borderColor

    // Generate the SVG string
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height + padding}">
          <polygon points="
              ${width / 2},${padding / 2} 
              0,${(height * 0.25) + (padding / 2)} 
              0,${(height * 0.75) + (padding / 2)} 
              ${width / 2},${height + (padding / 2)} 
              ${width},${(height * 0.75) + (padding / 2)} 
              ${width},${(height * 0.25) + (padding / 2)} 
              ${width / 2},${padding / 2} 
          " fill="none" stroke="${border}" stroke-width="18" />
      </svg>`

    // Create a canvas and render the SVG onto it
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height + padding

    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Canvas 2D context is not supported in this environment.')
    }

    // Render the SVG onto the canvas
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)

    await new Promise<void>((resolve, reject) => {
      const image = new Image()
      image.onload = () => {
        context.drawImage(image, 0, 0)
        URL.revokeObjectURL(url)
        resolve()
      }
      image.onerror = (error) => {
        console.error('Failed to load SVG image:', error)
        reject(error)
      }
      image.src = url
    })

    // Generate a PIXI texture from the canvas
    const texture = Texture.from(canvas)

    // Cache the texture if not already cached
    if (!Assets.cache.has(border)) {
      Assets.cache.set(border, texture)
    }

    // Create a sprite from the texture
    const sprite = new Sprite(texture)
    sprite.alpha = 0.85
    sprite.zIndex = 5
    sprite.label = BorderColorSprite.name

    return sprite
  }
}


