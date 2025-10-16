
@Injectable({ providedIn: 'root' })
export class IndexLocatorService {

    constructor(private axialService: AxialService,
        private coordinateLocator: CoordinateLocator,
        private layout: LayoutState,
        private mouse: MouseTracker) {

    }
    public getIndex = (event: any): number => {
        const point = new Point(event.x, event.y)
        const local = this.mouse.getLocalPosition(this.container, point)
        const axials = this.axialService.items.values()
        const closest = this.coordinateLocator.findClosest(local, axials!)
        const index = closest.index
        return index
    }
}


