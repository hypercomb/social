
@Injectable({ providedIn: 'root' })
export class HiddenDragTargetService {
    constructor(
        private layout: LayoutState,
        private settings: Settings) {

    }
    hiddenDragElement?: HTMLDivElement
    handleDragStart!: any
    public createDragTarget = async (tile: Tile, handleDragStart: any) => {
        if (!tile) return
        this.handleDragStart = handleDragStart
        // remove previous
        this.removeDragTarget()

        const { width, height } = this.settings.hexagonDimensions

        const point = tile.toGlobal(new Point(-width / 2, -height / 2))
        const scale = this.layout.scale
        const element = document.createElement('div')
        this.hiddenDragElement = element
        element.setAttribute('draggable', 'true')
        element.style.width = `${width * scale}px`
        element.style.height = `${height * scale}px`
        element.style.backgroundColor = 'transparent'
        element.style.zIndex = '50'
        element.style.opacity = '.001'
        element.style.position = 'absolute'
        document.body.appendChild(element)
        element.addEventListener('dragstart', this.handleDragStart)
        this.updateHiddenElementPosition(point.x, point.y)
    }

    public removeDragTarget = () => {
        let element = this.hiddenDragElement
        if (element) {
            document.body.removeChild(element)
            this.hiddenDragElement = undefined
            element.removeEventListener('dragstart', this.handleDragStart)
        }
    }

    private updateHiddenElementPosition = (x: number, y: number) => {
        if (this.hiddenDragElement) {
            this.hiddenDragElement.style.left = `${x}px`
            this.hiddenDragElement.style.top = `${y}px`
        }
    }
}


