// hypercomb-shared/core/initializers/server-initializer.service.ts

import { LocationParser, type LocationParseResult } from './location-parser'

export class ServerInitializer {

  public enabled = async (_: string): Promise<boolean> => true

  // note: this now only parses and returns the shape used by runtime-mediator
  public initialize = async (input: string): Promise<LocationParseResult> => {
    return LocationParser.parse(input)
  }
}

register('@hypercomb.social/ServerInitializer', new ServerInitializer(), 'ServerInitializer')
