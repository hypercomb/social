import { Drone } from "../drone.base.js"

export interface Honeycomb {
    name: string
    drones: Drone[]
    children: string[]
}