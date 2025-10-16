import { inject, Injectable } from "@angular/core"
import { HiveResolutionType } from "../hive-models"
import { Router } from "@angular/router"
import { GenusBootstrapper } from "../data-resolvers/genus-data.loader"
import { HiveScout } from "../hive-scout"
import { HiveLoaderBase } from "./hive-loader.base"

@Injectable({providedIn: 'root'})
export class Genus extends HiveLoaderBase {
  private readonly genus = inject(GenusBootstrapper)
  private readonly router = inject(Router)
  public readonly type = HiveResolutionType.Genus

    public override enabled = async (hiveName: string): Promise<boolean> => {
    this.logResolution(`Genus enabled for ${hiveName}`)
    // resolve only when there is no hiveName
    return !hiveName
  }

  public override async resolve(hiveName: string): Promise<HiveScout> {
    this.logResolution(`Genus resolving for ${hiveName}`)
    // create an "empty scout" with a default name
    const scout = HiveScout.genus("welcome")
    this.genus.load(scout)
     
    // navigate to the new hive
    await this.router.navigate([`/${scout.name}`])
    this.logResolution(`Genus resolved for ${scout.name}`)
    return scout
  
  }
}
