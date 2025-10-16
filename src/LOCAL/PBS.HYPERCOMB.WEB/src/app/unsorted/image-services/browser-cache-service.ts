
@Injectable({
  providedIn: 'root'
})
export class BrowserCacheService {

  private cacheName = 'spritesheet-cache'

  // Save a blob in the Cache API with a given ID, overwriting if it exists
  public async saveBlob(id: string, blob: Blob) {
    const cache = await caches.open(this.cacheName)
    const request = new Request(`/spritesheets/${id}`)
    const response = new Response(blob, { headers: { 'Content-Type': 'image/webp' } })
    await cache.put(request, response) // This will overwrite if the entry exists
  }

  // Retrieve a blob from the Cache API by ID
  public async getBlob(id: string): Promise<Blob | null> {
    const cache = await caches.open(this.cacheName)
    const response = await cache.match(`/spritesheets/${id}`)
    return response ? await response.blob() : null
  }

  // Optional: Remove a blob from the Cache API by ID
  public async removeBlob(id: string): Promise<boolean> {
    const cache = await caches.open(this.cacheName)
    return await cache.delete(`/spritesheets/${id}`)
  }
}


