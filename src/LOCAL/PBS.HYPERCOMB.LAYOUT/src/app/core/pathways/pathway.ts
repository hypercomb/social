// src/app/core/pathways/implementations/website.pathway.ts

import { PathwayContext } from "./pathway-context.model"
import { Pathway } from "./pathway.model"


export const WEBSITE_PATHWAY = 'path.website.open'
export const WEBSITE_EDGE = 'edge.website.open'


export class WebsitePathway implements Pathway<PathwayContext> {

  public readonly key = WEBSITE_PATHWAY

  // pathway is open when a tile is selected
  public open(ctx: PathwayContext): boolean {
    return !!ctx.selection?.seeds?.length
  }
}
