import { Drone } from "@hypercomb/core"
// import { helloWorld } from "./hw-service"

export class HelloWorldDrone extends Drone {

  public description =
    'Minimal hello world action from Hypercomb essentials.'
  
  public grammar = [
    { example: 'hello world' }
  ]

  public effects = ['memory'] as const

  public links = [
    {
      label: 'Essentials module',
      url: 'https://storagehypercomb.blob.core.windows.net/hypercomb-data/16dbba2ef40c566ebe0f3e8edee6fb59cda8244b328c7beef3e9e47c7b1ed36e',
      trust: 'official',
      purpose: 'Resolve and load Hypercomb essentials'
    } as const
  ]

  protected override heartbeat = async (grammar:string): Promise<void> => {
    // helloWorld()
  }
}
