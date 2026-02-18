// hypercomb-shared/core/initializers/server-initializer.service.ts

import { Injectable } from '@angular/core'
import { LocationParser, type LocationParseResult } from './location-parser'

@Injectable({ providedIn: 'root' })
export class ServerInitializer {

  public enabled = async (_: string): Promise<boolean> => true

  // note: this now only parses and returns the shape used by runtime-mediator
  public initialize = async (input: string): Promise<LocationParseResult> => {
    return LocationParser.parse(input)
  }
}

window.ioc.register('ServerInitializer', new ServerInitializer())
