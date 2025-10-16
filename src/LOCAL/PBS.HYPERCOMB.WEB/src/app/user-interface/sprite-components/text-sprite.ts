import { Injectable } from '@angular/core'
import { Container, Text, TextStyle } from 'pixi.js'
import { PixiServiceBase } from 'src/app/pixi/pixi-service-base'

@Injectable({
    providedIn: 'root'
})
export class HighDefinitionTextService extends PixiServiceBase {

    /**
     * Creates a high-definition text container.
     * 
     * @param text The text content to display.
     * @param fontSize The font size for the HD text (default is 18).
     * @param color The color of the text (default is red).
     * @param maxWidth Optional maximum width to constrain the text (default undefined).
     * @returns A Container containing the centered text.
     */
    public add(
        text: string,
        fontSize: number = 48,
        color: string = 'red',
        maxWidth?: number
    ): Container {

        text ||= 'Emtpy'
        const container = new Container()

        const style = new TextStyle({
            align: 'center',
            fill: 'white',
            fontFamily: 'Varela',
            fontSize: 24,
            dropShadow: {
                color: '#333',
                blur: 3,
                angle: Math.PI / 6,
                distance: 5,
            },
            wordWrap: true,
            wordWrapWidth: 280,
        })

        const basicText = new Text({
            style,
            text: text,
            resolution: 4
        })

        container.addChild(basicText)

        const remainingX = (this.hexagonWidth - basicText.width) / 2
        const remainingY = (this.hexagonHeight - basicText.height) / 2
        basicText.x = remainingX
        basicText.y = remainingY

        container.zIndex = 4

            ; (<any>window).txt = { basicText, container }

        return container
    }
}

