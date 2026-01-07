import { Container } from "pixi.js"

export interface ISpriteComponent<T> {
    canBuild(data: T): Promise<boolean>
    build(data: T, blobURL?: string): Promise<Container>
}


