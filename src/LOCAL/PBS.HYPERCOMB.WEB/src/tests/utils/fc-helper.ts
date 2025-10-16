import fc, { Arbitrary } from 'fast-check'

export function fcOptional<T>(arb: Arbitrary<T>): Arbitrary<T | undefined> {
    return fc.option(arb, { nil: undefined })
}

