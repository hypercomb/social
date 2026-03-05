import { Bee } from "../bee.base.js"

export interface Honeycomb {
    name: string
    bees: Bee[]
    layers: string[]
}