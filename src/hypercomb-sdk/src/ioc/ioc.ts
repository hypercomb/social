import { register, get, has, list } from '@hypercomb/core'
import type { IoCContainer } from './ioc.types.js'

function detect(): IoCContainer {
  if (typeof globalThis !== 'undefined' && (globalThis as any).ioc) {
    return (globalThis as any).ioc
  }
  return { register, get, has, list }
}

let container: IoCContainer | null = null

export const ioc: IoCContainer = new Proxy({} as IoCContainer, {
  get(_, prop: string) {
    container ??= detect()
    return (container as any)[prop]
  },
})
