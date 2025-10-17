import { Hypercomb } from "src/app/core/mixins/abstraction/hypercomb.base"

export abstract class ReceiveFileBase extends Hypercomb {

    protected readonly files: string = 'Files'
    protected readonly plain: string = 'text/plain'
    protected readonly uriList: string = 'text/uri-list'
    protected readonly html: string = 'text/html'

    protected abstract canReceive(dropEvent): Promise<boolean>
    protected abstract receiving(dropEvent): Promise<boolean>

    public receive = async (dropEvent): Promise<boolean> => {

        const canReceive = await this.canReceive(dropEvent)
        if (!canReceive) return false
        return await this.receiving(dropEvent)
    }
}

