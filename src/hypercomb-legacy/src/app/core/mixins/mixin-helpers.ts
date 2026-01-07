export type AbstractCtor<T = object> = abstract new (...args: any[]) => T
export type Ctor<T = {}> = new (...args: any[]) => T

