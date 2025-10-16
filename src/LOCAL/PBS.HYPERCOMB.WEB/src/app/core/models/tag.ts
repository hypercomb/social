// creates a stable slug for tags/categories/etc.
export const slugify = (s: string): string => {
    return s
        .normalize('NFKD')               // split accents
        .replace(/[\u0300-\u036f]/g, '') // remove diacritics
        .toLowerCase()
        .trim()
        .replace(/['"]/g, '')            // drop quotes
        .replace(/[^a-z0-9]+/g, '-')     // non-alnum â†’ hyphen
        .replace(/^-+|-+$/g, '')         // trim hyphens
        .slice(0, 64)                   // optional cap
}


export class Tag {
    public id: number = 0
    public slug: string = ''
    public name: string = ''
}


