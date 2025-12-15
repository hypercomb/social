export const provinces1000 = {
  "formatName": "dexie",
  "formatVersion": 1,
  "data": {
    "databaseName": "Database",
    "databaseVersion": 102,
    "tables": [
      {
        "name": "data",
        "schema": "++gene,kind,[hive+isActive+isDeleted],sourceId,uniqueId,options,name,type,dateCreated,isActive,isBranch,isDeleted,isHidden,isLocked,isHive,isNewHive,isRecenter,[hiveId+isDeleted],[hive+sourceId],[isSelected+isLocked],*tagIds",
        "rowCount": 745
      },
      {
        "name": "tags",
        "schema": "++id,&slug,name",
        "rowCount": 0
      }
    ],
    "data": [{
      "tableName": "data",
      "inbound": true,
      "rows": [
        {
          "kind": "Hive",
          "gene": 500,
          "hive": "provinces#1000",
          "name": "provinces",
          "options": 513,
          "type": 0,
          "dateCreated": "2025-03-07T21:47:00.553Z",
          "updatedAt": "2025-09-28T04:04:46.544Z",
          "borderColor": "#222",
          "backgroundColor": "white",
          "link": "",
          "index": 0,
          "scale": 0.7350918906249995,
          "x": -972.6897717580389,
          "y": -388.0735124999996,
          "sourceId": -1,
          "tagIds": [],
          "uniqueId": "523976d2-8e45-450d-8e18-18d78ab3728c",
          "etag": 0,
          "isActive": true,
          "isBranch": false,
          "isDeleted": false,
          "isHidden": false,
          "dateDeleted": "1970-01-01T00:00:00.000Z",

          "recenter": false,
          "isIgnoreBackground": false,
          "isSelected": false,
          "isFocusedMode": false,
          "isNoImage": false,
          "isInitialTile": true,
          "isRecenter": false,
          "$types": {
            "tagIds": "arrayNonindexKeys",
            "blob": "blob2"
          }
        },
      ]
    },{
      "tableName": "tags",
      "inbound": true,
      "rows": []
    }]
  }
}