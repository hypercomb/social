
@Injectable({
    providedIn: 'root'
})
export class PivotService extends PixiServiceBase {

    constructor() {
        super()
    }

    public pivot(container: Container) {
        if (!container) {
            console.warn('Container is not defined')
            return
        }

        // Get the global center relative to the offset (container.x, container.y)
        const globalCenter = new Point(
            this.renderer.screen.width / 2,
            this.renderer.screen.height / 2
        )

        // Convert the adjusted global center to local space
        const localCenter = container.toLocal(globalCenter)

        // Adjust position to counteract pivot change (prevent visual jump)
        const x = container.position.x + (localCenter.x - container.pivot.x)
        const y = container.position.y + (localCenter.y - container.pivot.y)

        container.position.set(x, y)

        // Set pivot
        container.pivot.set(localCenter.x, localCenter.y)

        // Rotate 90 degrees
        container.rotation += Math.PI / 2
    }

}


