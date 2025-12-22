import { Component, inject, signal, effect } from '@angular/core'
import { IStrand } from '../../core/hive/i-dna.token'
import { StrandManager } from '../../core/hive/strand.writer'
import { HypercombState } from '../../core/hypercomb-state'



@Component({
    standalone: true,
    selector: 'hc-strand-debug',
    templateUrl: './strand-debug.component.html',
    styleUrls: ['./strand-debug.component.scss'],
    imports: []
})
export class StrandDebugComponent {

    private readonly strands = inject(StrandManager)
    public readonly state = inject(HypercombState)

    protected readonly items = signal<IStrand[]>([])

    constructor() {
        effect(() => {
            const lineage = this.state.lineage()
            void this.load(lineage)
        })
    }

    private load = async (lineage: string): Promise<void> => {
        const list = await this.strands.list(lineage)
        this.items.set(list)
    }
}
