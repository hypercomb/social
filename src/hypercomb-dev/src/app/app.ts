import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SearchBarComponent } from '@hypercomb/shared';
import { AxialService } from '@hypercomb/essentials/diamondcoreprocessor.com/core/axial/axial-service';
import { PanningDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/input/pan/panning.drone';
import { PixiHostDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/pixi-host.drone';
import { ShowHoneycombDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/show-honeycomb.drone';
import { MousePanInput } from '@hypercomb/essentials/diamondcoreprocessor.com/input/pan/mouse-pan.input';
import { MousewheelZoomInput } from '@hypercomb/essentials/diamondcoreprocessor.com/input/zoom/mousewheel-zoom.input';
import { Settings } from '@hypercomb/essentials/diamondcoreprocessor.com/core/settings';
import { ZoomDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/input/zoom/zoom.drone';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SearchBarComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('hypercomb-dev');
  constructor() {
    const { register, get, list } = window.ioc
    const _ = [AxialService, PanningDrone, PixiHostDrone, ShowHoneycombDrone, MousePanInput, MousewheelZoomInput, Settings, ZoomDrone]

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
