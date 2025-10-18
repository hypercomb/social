
@Injectable({ providedIn: 'root' })
export class HexagonLayoutService extends PixiServiceBase {

  constructor(injector: Injector) {
    super(injector)
  }

  public centerOnSprite(container: Container, sprite: Sprite) {
    // The desired center position on the screen
    const desiredCenterX = this.app.screen.width / 2
    const desiredCenterY = this.app.screen.height / 2
    const scale = container.scale.x

    // The sprite's position, taking into account the container's position and stage scale
    const spriteScaledX = (sprite.x - container.x - sprite.width / 2) * scale
    const spriteScaledY = (sprite.y - container.y - sprite.width / 2) * scale

    // Adjust container position based on sprite's scaled position to center it
    container.x = desiredCenterX - spriteScaledX
    container.y = desiredCenterY - spriteScaledY
  }
}


