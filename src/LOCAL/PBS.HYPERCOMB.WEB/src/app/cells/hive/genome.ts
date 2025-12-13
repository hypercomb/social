// src/app/cells/hive/genome.ts
import { Strand } from "./strand";

export class Genome {
  // genomes parent is the cell from the current address in hypercomb 
  // address bar and doesn't need to be stored here
  public strands: Strand[] = []; // append-only history
}