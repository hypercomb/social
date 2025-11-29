// all-upgrades.ts
// central barrel for all database upgrades

import { IDatabaseUpgrade } from "./i-database-upgrade"
import { DropIdFieldUpgrade } from "./drop-id-field.upgrade"
import { DropBlobUpgrade } from "./drop-blob.upgrade"
import { NormalizeDatesUpgrade } from './normalize-dates-upgrade'
import { NamingUpgradeNewSchema } from "./renaming-upgrade-v74"


export const allUpgrades: IDatabaseUpgrade[] = [
    new DropIdFieldUpgrade(),
    new NormalizeDatesUpgrade(),
    //new MoveImagesToNewDatabaseUpgrade()
]
// note: inject real TilePropertyMapper in Angular