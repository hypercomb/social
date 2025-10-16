
@Injectable({
  providedIn: 'root'
})
export class HighlightSvgPath {

  notify(id: string) {
    const clipboardButtonGroup = document.getElementById(id)
    if (clipboardButtonGroup) {
      const backgroundPath = <any>clipboardButtonGroup.querySelector('.background')
      const iconPath = <any>clipboardButtonGroup.querySelector('.icon-path')

      clipboardButtonGroup.classList.add('shake')
      iconPath.style.fill = '#ffb300'
      backgroundPath.style.opacity = 1 // Change the color to white

      setTimeout(() => {
        backgroundPath.style.opacity = 0 // Revert the color after 1 second
        iconPath.style.fill = 'white'
        clipboardButtonGroup.classList.remove('shake')
      }, 1000)
    }
  }
}



