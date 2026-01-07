
import { Injectable, inject } from "@angular/core"
import { Container, Point, Graphics, Text } from "pixi.js"
import { PixiServiceBase } from "../pixi/pixi-service-base"
import { simplify } from "src/app/shared/services/name-simplifier"
import { context } from "../state/interactivity/context-cell"

@Injectable({ providedIn: 'root' })
export class TooltipService extends PixiServiceBase {
    private currentTooltip: Container | null = null

    protected override onPixiReady(): void {
        void this.safeInit()
    }
    
    private async safeInit() {
        const container = context.container()!

        this.stage.addChild(container)
        container.zIndex = 1
        container.alpha = 1
        container.eventMode = 'dynamic'

        container.on('pointermove', (event) => {
            const globalPoint = new Point(event.data.global.x, event.data.global.y)
            const localPoint = container.toLocal(globalPoint)
            document.title = `Cursor Position: x=${localPoint.x.toFixed(2)}, y=${localPoint.y.toFixed(2)}`
        })

        const elements = document.querySelectorAll<HTMLElement>('span[data-tooltip]')
        elements.forEach(element => {
            element.addEventListener('mouseover', () => this.show(element))
            element.addEventListener('mouseout', () => this.hide())
        })
    }

    async show(element: HTMLElement) {
        this.hide()
        const container = context.container()!
        const rawName = element.getAttribute('data-tooltip') || 'No tooltip text'
        const saveText = simplify(rawName)

        const position = this.getHTMLElementPosition(element)
        const local = container.toLocal(position)

        if (local) {
            const tooltip = this.createTooltip(saveText, local)
            container.addChild(tooltip)
            this.currentTooltip = tooltip
        }
    }

    async hide() {
        if (this.currentTooltip) {
            const container = context.container()!
            container.removeChild(this.currentTooltip)
            this.currentTooltip.destroy()
            this.currentTooltip = null
        }
    }

    private getHTMLElementPosition(element: HTMLElement): Point {
        const rect = element.getBoundingClientRect()
        return new Point(rect.left + window.scrollX, rect.top + window.scrollY)
    }

    private createTooltip(text: string, position: Point): Container {
        const tooltip = new Container()

        const background = new Graphics()
        const paddingX = 30
        const paddingY = 10
        const bgColor = 0x11161c
        const cornerRadius = 3

        background.roundRect(0, 0, text.length * 8 + paddingX, 24 + paddingY, cornerRadius)
        background.fill(bgColor)

        const toolTipText = new Text({
            text,
            style: {
                fontSize: 14,
                fontFamily: 'verdana, sans-serif',
                fill: 0xffffff,
            }
        })

        toolTipText.x = paddingX / 2
        toolTipText.y = paddingY / 2

        tooltip.addChild(background)
        tooltip.addChild(toolTipText)

        const verticalOffset = 10
        tooltip.position.set(position.x + (tooltip.width / 2), position.y - tooltip.height - verticalOffset)

        return tooltip
    }
}


