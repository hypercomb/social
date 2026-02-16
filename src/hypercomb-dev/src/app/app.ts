import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { PixiHostDrone, ShowHoneycombDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi'
import { MousePanInput, MousewheelZoomInput } from '@hypercomb/essentials/diamondcoreprocessor.com/input'
import { ZoomDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/input/zoom/zoom.drone'
import { PanningDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/input/pan/panning.drone';
import { Settings } from '@hypercomb/essentials/diamondcoreprocessor.com/core/settings';
import { AxialService } from '@hypercomb/essentials/diamondcoreprocessor.com/core/axial/axial-service';

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
    const _ = [AxialService, PanningDrone,   PixiHostDrone, ShowHoneycombDrone, MousePanInput, MousewheelZoomInput, Settings, ZoomDrone]

    queueMicrotask(async () => {
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
