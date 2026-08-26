// hypercomb-shared/core/initializers/server-initializer.service.ts

import { LocationParser, type LocationParseResult } from './location-parser'

export class ServerInitializer {

  public enabled = async (_: string): Promise<boolean> => true

  // This only parses and returns the location shape; install policy belongs to
  // the caller (the web boot path is ensureInstall).
  public initialize = async (input: string): Promise<LocationParseResult> => {
    return LocationParser.parse(input)
  }
}

register('@hypercomb.social/ServerInitializer', new ServerInitializer())
