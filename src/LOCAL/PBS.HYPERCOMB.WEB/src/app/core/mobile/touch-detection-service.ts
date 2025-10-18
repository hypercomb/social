import { Injectable } from "@angular/core"

@Injectable({
    providedIn: 'root'
})
export class TouchDetectionService {
    private screenSizeInchesToPixels(inches: number): number {
        // Assuming an average PPI of 96 (this is a very rough estimate)
        return inches * 96
    }

    public supportsTouch(): boolean {
        return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || ((<any>navigator).msMaxTouchPoints > 0)
    }

    public supportsEdit(): boolean {
        const minEditSizeInches = 11.6 // Minimum size in inches for a device to show edit controls
        const sizePixels = this.screenSizeInchesToPixels(minEditSizeInches)

        // Check if the device's screen size is equal to or larger than the minimum size
        return Math.max(screen.width, screen.height) >= sizePixels
    }
}


