// src/app/core/interpreter/website/website.bootstrap.ts

import { WebsitePathway } from '../pathways/pathway'
import { PathwayRegistry } from '../pathways/pathway-registry.service'

export const registerWebsite = (registry: PathwayRegistry): void => {
  registry.register(new WebsitePathway())
}
