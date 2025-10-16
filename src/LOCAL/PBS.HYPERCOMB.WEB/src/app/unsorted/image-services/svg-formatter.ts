
@Injectable({
  providedIn: 'root'
})
export class SvgFormatter {
  resizeAndCenterSVG(svgContent: string, targetWidth: number, targetHeight: number): string {
    const parser = new DOMParser()
    const serializer = new XMLSerializer()
    const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml')
    const svgElement = svgDoc.documentElement

    const viewBox = svgElement.getAttribute('viewBox')
    let [originalX, originalY, originalWidth, originalHeight] = viewBox
      ? viewBox.split(' ').map(Number)
      : [0, 0, svgElement.getAttribute('width'), svgElement.getAttribute('height')].map(Number)

    const aspectRatio = originalWidth / originalHeight
    const targetAspectRatio = targetWidth / targetHeight

    let newWidth, newHeight
    if (aspectRatio > targetAspectRatio) {
      newWidth = targetWidth
      newHeight = targetWidth / aspectRatio
    } else {
      newHeight = targetHeight
      newWidth = targetHeight * aspectRatio
    }

    const offsetX = (targetWidth - newWidth) / 2
    const offsetY = (targetHeight - newHeight) / 2

    const wrapperSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    wrapperSvg.setAttribute('width', `${targetWidth}`)
    wrapperSvg.setAttribute('height', `${targetHeight}`)
    wrapperSvg.setAttribute('viewBox', `0 0 ${targetWidth} ${targetHeight}`)
    wrapperSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    wrapperSvg.setAttribute('style', `background: none display: block`)

    const wrapperG = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    wrapperG.setAttribute('transform', `translate(${offsetX},${offsetY}) scale(${newWidth / originalWidth},${newHeight / originalHeight})`)
    while (svgElement.firstChild) {
      wrapperG.appendChild(svgElement.firstChild)
    }

    wrapperSvg.appendChild(wrapperG)
    return serializer.serializeToString(wrapperSvg)
  }
}


