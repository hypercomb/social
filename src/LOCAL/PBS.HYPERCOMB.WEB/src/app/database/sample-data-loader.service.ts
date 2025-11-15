// src/app/database/sample-data-loader.service.ts
import { Injectable, inject } from "@angular/core"
import { SettingsRepository } from "./repository/settings-repository"
import { OpfsHiveService } from "src/app/hive/storage/opfs-hive-service"
import * as sampleData from "../../assets/sample-data/index"

@Injectable({ providedIn: "root" })
export class SampleDataLoaderService {
  private readonly settings = inject(SettingsRepository)
  private readonly opfsHives = inject(OpfsHiveService)

  private readonly flagKey = "sampleDataLoaded"

  // sample hive modules (raw JSON data)
  private readonly sampleModules = [
    { data: (sampleData as any).provinces1000,   name: "provinces#1000.json" },
    { data: (sampleData as any).news1000,        name: "news#1000.json" },
    { data: (sampleData as any).crypto1000,      name: "crypto#1000.json" },
    { data: (sampleData as any).businessPlan1000, name: "business-plan#1000.json" }
  ]

  public loadSampleDataIfNeeded = async (): Promise<void> => {
    const loaded = await this.settings.get<boolean>(this.flagKey)
    if (loaded) return

    // build file list to pass to service
    const files: File[] = this.sampleModules
      .filter(m => !!m.data)
      .map(m => new File([JSON.stringify(m.data)], m.name, { type: "application/json" }))

    if (files.length > 0) {
      await this.opfsHives.import(files)
    }

    await this.settings.put(this.flagKey, true)
  }
}
