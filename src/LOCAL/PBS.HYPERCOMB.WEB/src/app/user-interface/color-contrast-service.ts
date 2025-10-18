
@Injectable({
  providedIn: 'root'
})
export class ColorContrastService {

  constructor() { }

  public adjustContrastColor(tile: Tile) {
    // Find the sprite with the custom property 'type' set to 'border-overlay'
    const borderOverlaySprite = tile.children.find(child =>
      child instanceof Sprite && (child as any).type === 'border-overlay'
    ) as Sprite | undefined

    if (borderOverlaySprite) {
      const currentColor = borderOverlaySprite.tint.toString(16)
      // Calculate contrast color
      const contrastColor = this.calculateContrastColor(currentColor)

      // Create a new SVG texture with the updated color
      const svgTexture = this.createSvgTextureWithColor(contrastColor, borderOverlaySprite.texture)
      borderOverlaySprite.texture = svgTexture
    }
  }

  private calculateContrastColor(currentColor: string): string {
    // Convert hex color to RGB
    const rgb = this.hexToRgb(currentColor)
    if (!rgb) {
      return currentColor // Return original color if conversion fails
    }

    // Calculate brightness
    const brightness = Math.sqrt(0.299 * rgb.r * rgb.r + 0.587 * rgb.g * rgb.g + 0.114 * rgb.b * rgb.b)

    // Determine if the color is light or dark and flip
    return brightness > 128 ? '#000000' : '#FFFFFF'
  }

  private hexToRgb(hex: string): { r: number, g: number, b: number } | null {
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i
    hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b)

    const regex = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i
    const result = regex.exec(hex)
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null
  }

  private createSvgTextureWithColor(color: string, originalTexture: Texture): Texture {
    // Ensure the resource is of the type that has the 'source' property
    const resource = originalTexture.baseTexture.resource
    if (resource && 'source' in resource) {
      const svgString = (resource as any).source
      const coloredSvgString = this.updateSvgColor(svgString, color)

      const blob = new Blob([coloredSvgString], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const newTexture = Texture.from(url)

      return newTexture
    }
    return originalTexture // Return the original texture if the source is not available
  }

  private updateSvgColor(svgString: string, color: string): string {
    // Replace the fill color in the SVG string with the new color
    return svgString.replace(/fill="[^"]*"/g, `fill="${color}"`)
  }
}


