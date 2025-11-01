import { Injectable, inject } from "@angular/core";
import { SettingsRepository } from "./repository/settings-repository";
import { DatabaseImportService } from "src/app/actions/propagation/import-service";
import * as sampleData from "../../assets/sample-data/index";

@Injectable({ providedIn: "root" })
export class SampleDataLoaderService {
  private readonly settings = inject(SettingsRepository);
  private readonly importer = inject(DatabaseImportService);

  private readonly flagKey = "sampleDataLoaded";

  // List of sample data exports and filenames
  private readonly sampleModules = [
    { data: (sampleData as any).provinces1000, name: "provinces#1000.json" },
    { data: (sampleData as any).news1000, name: "news#1000.json" },
    { data: (sampleData as any).crypto1000, name: "crypto#1000.json" },
    { data: (sampleData as any).businessPlan1000, name: "business-plan#1000.json" },
  ];

  public loadSampleDataIfNeeded = async (): Promise<void> => {
    const loaded = await this.settings.get<boolean>(this.flagKey);
    if (loaded) return;

    const files: File[] = [];
    for (const { data, name } of this.sampleModules) {
      if (!data) continue;
      files.push(new File([JSON.stringify(data)], name, { type: "application/json" }));
    }

    if (files.length > 0) {
      await this.importer.importGroupToOpfs(files as any);
    }
    await this.settings.put(this.flagKey, true);
  };
}
