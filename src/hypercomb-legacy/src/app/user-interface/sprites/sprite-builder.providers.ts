// src/app/sprites/sprite-builder.providers.ts
import { ImportedImageSpriteBuilder } from "../sprite-components/imported-image-sprite-builder"
import { SPRITE_BUILDERS } from "../sprite-components/sprite-builder.token"

export const SPRITE_BUILDER_PROVIDERS = [
    { provide: SPRITE_BUILDERS, useClass: ImportedImageSpriteBuilder, multi: true },
]
