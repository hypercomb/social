// src/app/sprites/sprite-builder.token.ts
import { InjectionToken } from '@angular/core'
import { SpriteBuilder } from './sprite-builder'

export const SPRITE_BUILDERS = new InjectionToken<SpriteBuilder<any>[]>('SPRITE_BUILDERS')



