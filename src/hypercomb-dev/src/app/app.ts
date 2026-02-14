import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { PinchZoomDrone, PixiHostDrone, ShowHoneycombDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi'
import { MousewheelZoomInput } from '@hypercomb/essentials/diamondcoreprocessor.com/input'
import { MousePanInput } from '@hypercomb/essentials/diamondcoreprocessor.com/input/mouse-pan.input'
import { ZoomDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/input/zoom.drone'
import { PanningDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/input/panning.drone';


@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('hypercomb-dev');
  constructor() {
    const { register, get, list } = window.ioc
    const types = [PanningDrone, PinchZoomDrone, PixiHostDrone, ShowHoneycombDrone, MousePanInput, MousewheelZoomInput, ZoomDrone]

    queueMicrotask(async () => {
      register('PixiHost', new PixiHostDrone())
      register('ShowHoneycomb', new ShowHoneycombDrone())
      const l = list();
      console.log('[core-adapter] ioc keys:', l)

      const hostkey = 'PixiHost'
      const host = <any>get(hostkey)!
      await host.encounter('testing')

      const showkey = 'ShowHoneycomb'
      const show = <any>get(showkey)!
      await show.encounter('testing')

      const zoomkey = 'ZoomDrone'
      const zoom = <any>get(zoomkey)!
      await zoom.encounter('testing')

      const pankey = 'PanningDrone'
      const pan = <any>get(pankey)!
      await pan.encounter('testing')
    })

  }
}
