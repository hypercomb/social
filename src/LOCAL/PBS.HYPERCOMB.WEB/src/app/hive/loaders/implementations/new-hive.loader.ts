import { inject } from "@angular/core";
import { HiveResolutionType } from "../../hive-models";
import { HiveScout } from "../../hive-scout";
import { HiveLoaderBase } from "../hive-loader.base";
import { DatabaseService } from "src/app/database/database-service";
import { HiveTemplateService } from "src/assets/hives/hive-template.service";

export class NewHiveLoader extends HiveLoaderBase {

  private readonly template = inject(HiveTemplateService);
  private readonly db = inject(DatabaseService);

  public enabled(scout: HiveScout): boolean {
    return scout.type === HiveResolutionType.New;
  }

  public async load(scout: HiveScout) {
    const json = this.template.createInstance();

    const blob = new Blob([JSON.stringify(json)], {
      type: "application/json"
    });

    await this.db.ensureHiveDb();
    await this.db.importHive(blob);

    return undefined;
  }
}
