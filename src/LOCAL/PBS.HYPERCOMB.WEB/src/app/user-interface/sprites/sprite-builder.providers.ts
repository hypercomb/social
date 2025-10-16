// src/app/sprites/sprite-builder.providers.ts
import { ImportedImageSpriteBuilder } from "../sprite-components/imported-image-sprite-builder"
import { SPRITE_BUILDERS } from "../sprite-components/sprite-builder.token"
import { TileImageSpriteBuilder } from "../sprite-components/tile-image-sprite-builder"

export const SPRITE_BUILDER_PROVIDERS = [
    { provide: SPRITE_BUILDERS, useClass: TileImageSpriteBuilder, multi: true },
    { provide: SPRITE_BUILDERS, useClass: ImportedImageSpriteBuilder, multi: true },
]
