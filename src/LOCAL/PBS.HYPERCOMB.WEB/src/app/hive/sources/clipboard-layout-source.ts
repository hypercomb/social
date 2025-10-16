

@Injectable({
    providedIn: 'root'
})
export class ClipboardLayoutSource extends LayoutSourceBase implements ILayoutSource {
    private clipboardService = inject(ClipboardService)

    getTiles = async (state: any): Promise<Cell[]> => {
        // get the local data.
        const key = this.clipboardService
        const data = await this.hierarchy_queries.fetchHierarchy(Constants.ClipboardHive, key)

        // remove the selected flag.
        let index = 0
        for (const item of data) {
            item.index = index++
            item.options &= ~CellOptions.Selected
        }
        return data
    }

    public canLayout = async (): Promise<boolean> => {
        return this.state.hasMode(HypercombMode.ViewingClipboard)
    }
}


