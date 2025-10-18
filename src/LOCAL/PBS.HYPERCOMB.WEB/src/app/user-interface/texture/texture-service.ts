import { Injectable } from '@angular/core'
import { Texture } from 'pixi.js'
import { Cell } from 'src/app/cells/cell'
import { ITextureProvider } from './i-texture-provider'
import { EmptyTextureProvider } from './empty-texture-provider'
import { TextureCacheProvider } from './texture-cache-provider'
import { RenderTextureProvider } from './render-texture-provider'
import { SpritesheetProvider } from './spritesheet-texture-provider'

@Injectable({ providedIn: 'root' })
export class TextureService {
  private readonly providers: readonly ITextureProvider[]

  constructor(
    emptyTextureProvider: EmptyTextureProvider,
    spritesheetProvider: SpritesheetProvider,
    textureCacheProvider: TextureCacheProvider,
    renderTextureProvider: RenderTextureProvider
  ) {
    // priority order: empty → cache → render → spritesheet (or adjust as needed)
    this.providers = [
      emptyTextureProvider,
      textureCacheProvider,
      renderTextureProvider,
      //spritesheetProvider,
    ]
  }

  /**
   * Retrieves a PIXI texture for a given cell.
   * Automatically checks available providers in priority order.
   * Each provider determines if it can serve or generate a texture.
   */
  public async getTexture(cell: Cell): Promise<Texture | undefined> {
    for (const provider of this.providers) {
      try {
        if (await provider.available(cell)) {
          const texture = await provider.getTexture(cell)
          if (texture) return texture
        }
      } catch (err) {
        // avoid halting the chain if a provider fails
        console.warn(`[TextureService] provider '${provider.constructor.name}' failed:`, err)
      }
    }
    return undefined
  }
}
