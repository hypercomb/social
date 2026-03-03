// hypercomb-dev/src/app/router/route-sink.component.ts

import { Component } from '@angular/core'

@Component({
  standalone: true,
  template: ''
})
export class RouteSinkComponent { }

class RouteSinkComponentRef { public readonly type = RouteSinkComponent }
register('@hypercomb.social/RouteSinkComponent', new RouteSinkComponentRef())
