// src/app/cells/hive/phenotype.ts
import { Strand } from "./strand";

export class Phenotype {
    constructor(
        public gene: string, // gene identifier for the current cell
        public strands: Strand[],
    ) { }
}
