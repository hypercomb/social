// diamondcoreprocessor.com/hello-world/hello-world.worker.ts
import { Worker } from "@hypercomb/core"

export class HelloWorldWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'

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

  protected override deps = { hw: '@diamondcoreprocessor.com/hello-world' }

  protected override act = async (_grammar: string): Promise<void> => {
    this.resolve('hw')
    console.log('[hypercomb essentials] hello world')
  }
}
