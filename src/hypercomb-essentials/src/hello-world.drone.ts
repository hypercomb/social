import { Drone, get, list} from "@hypercomb/core"
import { helloWorld } from "./hw-service.js"

const pixihost = 'ddd2317a1089b8b067a2d1f1e48c0ddcc3f8a9fe49333e1a8a868c9f69e39a31'

export class HelloWorldDrone extends Drone {

  public override description =
    'Minimal hello world action from Hypercomb essentials.'
  
  public override grammar = [
    { example: 'hello world' }
  ]

  public override effects = ['memory'] as const

  public override links = [
    {
      label: 'Essentials module',
      url: 'https://storagehypercomb.blob.core.windows.net/hypercomb-data/16dbba2ef40c566ebe0f3e8edee6fb59cda8244b328c7beef3e9e47c7b1ed36e',
      trust: 'official',
      purpose: 'Resolve and load Hypercomb essentials'
    } as const
  ]

  protected override heartbeat = async (grammar:string): Promise<void> => {
   const host =  get(pixihost) 
   const list2 = list()
   console.log(`Hello, world! from ${host}`)
    helloWorld()
  }
}
