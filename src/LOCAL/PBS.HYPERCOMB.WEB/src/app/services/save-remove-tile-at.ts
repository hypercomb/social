import { Container } from "pixi.js"

export function safeRemoveChildAt<TResult>(container: Container, index: number): TResult | undefined {
  if (index >= 0 && index < container.children.length) {
    return <TResult>container.removeChildAt(index)
  }
  return undefined
}


