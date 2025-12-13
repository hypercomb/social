import { Genome } from "./genome"
import { Strand } from "./strand"
import { Phenotype } from "./phenotype"

export class PhenotypeManager {

    // gene → list of strands
    private cache = new Map<string, Strand[]>()

    constructor(private genome: Genome) {}

    // return a Phenotype, not just the strands
    public get = (gene: string): Phenotype => {
        let list = this.cache.get(gene)

        if (!list) {
            list = this.genome.strands.filter(s => s.geneId === gene)
            this.cache.set(gene, list)
        }
        return new Phenotype(gene, list)
    }

    // add a strand and update genome + cache
    public add = (gene: string): Phenotype => {
        const strand: Strand = { gene: gene, instruction: true }

        // write to genome
        this.genome.strands.push(strand)

        // write to cache
        let list = this.cache.get(gene)
        if (!list) {
            list = []
            this.cache.set(gene, list)
        }
        list.push(strand)

        return new Phenotype(gene, list)
    }

    // remove operation = instruction false
    public remove = (gene: string): Phenotype => {
        const strand: Strand = { gene, instruction: false }

        this.genome.strands.push(strand)

        let list = this.cache.get(gene)
        if (!list) {
            list = []
            this.cache.set(gene, list)
        }
        list.push(strand)

        return new Phenotype(gene, list)
    }
}
