import { Injectable } from "@angular/core";

@Injectable({ providedIn: "root" })
export class HiveTemplateService {

  public getTemplate(): any {
    const now = new Date().toISOString();

    return {
      formatName: "dexie",
      formatVersion: 1,

      data: {
        databaseName: "Database",
        databaseVersion: 108,

        tables: [
          {
            name: "cells",
            schema:
              "++cellId,kind,uniqueId,dateCreated,sourceId," +
              "smallImageId,largeImageId," +
              "isDeleted,isActive,isBranch,isHidden," +
              "isFocusedMode,isLocked,isHive,isPathway,isRecenter",
            rowCount: 1
          },
          {
            name: "tags",
            schema: "++id,&slug,name",
            rowCount: 0
          }
        ],

        data: [
          {
            tableName: "cells",
            inbound: true,
            rows: [
              {
                cellId: 1,
                kind: "Hive",

                // required fields
                uniqueId: crypto.randomUUID(),
                dateCreated: now,
                sourceId: -1,

                // image slots: unused
                smallImageId: null,
                largeImageId: null,

                // flags
                isDeleted: false,
                isActive: true,
                isBranch: false,
                isHidden: false,
                isFocusedMode: false,
                isLocked: false,
                isHive: true,
                isPathway: false,
                isRecenter: false
              }
            ]
          },
          {
            tableName: "tags",
            inbound: true,
            rows: []
          }
        ]
      }
    };
  }

  /** always return a fresh deep clone */
  public createInstance(): any {
    return structuredClone(this.getTemplate());
  }
}
