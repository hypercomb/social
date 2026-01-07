
@Injectable({
    providedIn: 'root'
})
export class NotifyTileUpdate extends SignalMessage {

    protected override get message(): string { return 'NotifyTileUpdate' }

    constructor(injector: Injector) {
        super(injector)
    }

    public override onCleanup = async (...args: any[]) => {
        const items = args[0]
        for (const item of items) {
            delete item.blob64
        }
    }


    protected override setup = async (...args: any[]) => {
        const items = args[0]
        for (const item of items) {

            if (!item.blob) continue

            // serialize for transfer
            item.blob64 = await this.SerializationService.blobToBase64(item.blob)
        }
    }
}


