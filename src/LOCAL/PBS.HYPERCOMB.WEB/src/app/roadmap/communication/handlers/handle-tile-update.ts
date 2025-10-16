
@Injectable({
    providedIn: 'root'
})
export class HandleTileUpdate extends MessageHandler {
    public override get method(): string { return HandleTileUpdate.name }
    constructor(injector: Injector) {
        super(injector)
    }

    protected override canHandle = async (...args: any[]): Promise<boolean> => {
        const [sender] = args
        return !await this.IsSender(sender)
    }

    protected override  onHandle = async (...args: any[]) => {

        const [sender, tiles] = args


        const getSourceId = async (currentSource, sourceUniqueId) => {
            // get the parent 
            const parent = await this.tile_queries.fetchByUniqueId(sourceUniqueId)
            const sourceId = parent?.cellId || currentSource
            return sourceId
        }

        for (const tile of tiles) {

            let existing = (await this.CellManager.findByUniqueId(tile.uniqueId))?.data
            // restore the blob
            await this.setBlob64(tile)
            const sourceUniqueId = tile.SourceUniqueId
            const currentSource = this.ContextStack.Id

            // these will be overridden by the existing or newly created
            delete tile.SourceUniqueId
            delete tile.Id
            delete tile.sourceId
            // remove image from cache 

            if (existing) {

                await this.setBlob64(tile)
                Object.assign(existing, tile)
                await this.tile_actions.updateByUnique(existing)
                Assets.cache.remove(existing.HiveId)
            }
            else {
                const sourceId = await getSourceId(currentSource, sourceUniqueId)!
                tile.sourceId = sourceId
                const newTile = await this.tile_actions.store(tile)
                Assets.cache.remove(newtile.hiveId)

            }
        }

        // update the layout 
        await this.LayoutService.refresh()

        // notify
        this.NotificationService.info(`hive was updated by ${sender}`)
    }

    private setBlob64 = async (tile) => {
        delete tile.blob
        if (!tile.blob64) {
            return
        }
        const mimeType = await this.SerializationService.getMimeTypeFromBase64(tile.blob64)
        tile.blob = await this.SerializationService.base64ToBlob(tile.blob64, mimeType)
        delete tile.blob64
        this.textureCache.removeTexture(tile.hiveId)
    }
}


