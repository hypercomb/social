import { inject, Injectable } from "@angular/core"
import { Genome } from "./genome"
import { Strand } from "./strand"
import { OpfsManager } from "src/app/common/opfs/opfs-manager"
import { Hypercomb } from "src/app/core/mixins/abstraction/hypercomb.base"

@Injectable({ providedIn: "root" })
export class GenomeManager extends Hypercomb {

  private readonly opfs = inject(OpfsManager)
  constructor(
    public genome: Genome,
    private cellName: string
  ) {}

  // ------------------------------------
  // add (returns strand id = filename)
  // ------------------------------------
  public add = async (gene: string): Promise<string> => {
    const id = this.nextId()

    const strand: Strand = {
      gene,
      instruction: true
    }

    this.genome.strands.push(strand)
    await this.saveStrand(id, strand)

    return id
  }

  // ------------------------------------
  // remove (linear)
  // ------------------------------------
  public remove = async (gene: string): Promise<void> => {
    const id = this.nextId()

    const strand: Strand = {
      gene,
      instruction: false
    }

    this.genome.strands.push(strand)
    await this.saveStrand(id, strand)
  }

  // ------------------------------------
  // persistence
  // ------------------------------------
  private saveStrand = async (id: string, strand: Strand): Promise<void> => {
    const dir = await this.opfs.ensureDirs([
      "hives",
      this.state.hive(),
      this.cellName,
      "strands"
    ])

    await this.opfs.writeFile(
      dir,
      `${id}.json`,
      JSON.stringify(strand)
    )
  }

  private nextId = (): string => {
    return String(this.genome.strands.length).padStart(6, "0")
  }

  // ------------------------------------
  // hydration
  // ------------------------------------
  public hydrate = async (): Promise<void> => {
    const dir = await this.opfs.ensureDirs([
      "hives",
      this.hiveName,
      this.cellName,
      "strands"
    ])

    const entries = await this.opfs.listEntries(dir)

    const files = entries
      .map(e => e.name)
      .filter(n => n.endsWith(".json"))
      .sort()

    this.genome.strands.length = 0

    for (const name of files) {
      const handle = await this.opfs.getFile(dir, name)
      const file = await this.opfs.readFile(handle)
      const text = await file.text()
      const strand = JSON.parse(text) as Strand
      this.genome.strands.push(strand)
    }
  }

  // ------------------------------------
  // read
  // ------------------------------------
  public history = (): readonly Strand[] => {
    return this.genome.strands
  }
}
