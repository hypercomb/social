// tile-transformer.ts

export function hiveTransformer(table: string, value: any): any {
    // make a shallow copy so we donâ€™t mutate the original
    const copy = { ...value }
    // ensure DateCreated exists
    if (!copy.DateCreated) {
        copy.DateCreated = new Date().toISOString()
    }

    // ensure flags stored consistently (if you add HiveFlag later)
    if (copy.IsDeleted == null) copy.IsDeleted = 0
    if (copy.isPinned == null) copy.isPinned = 0
    if (copy.IsActive == null) copy.IsActive = 1

    return copy
}


