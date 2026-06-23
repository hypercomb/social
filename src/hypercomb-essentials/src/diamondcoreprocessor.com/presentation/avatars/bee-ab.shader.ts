// diamondcoreprocessor.com/presentation/avatars/bee-ab.shader.ts
//
// Textured swarm shader: renders the baked AB atlas (see bee-ab-atlas.ts) as
// GPU-instanced quads, frame-cycling the flap from the atlas and mirroring on
// facing — the textured replacement for the procedural SDF in bee-swarm.shader.
// One draw call for all bees; the flap is a cheap atlas-cell pick, not per-bee
// geometry. Same uniform/setTime surface as BeeSwarmShader so the drone can
// swap it in place. Bob stays in the vertex shader; position/phase/alpha/facing
// ride the existing per-bee buffers.

import { Shader, type Texture } from 'pixi.js'

const FLAP_HZ = 1.6 // ~0.6s flap cycle — matches the loved CSS flap

export class BeeAbShader {
  public shader: Shader
  #ug: any

  constructor(atlas: Texture, frames: number) {
    const uniformDefs = {
      u_time: { value: 0, type: 'f32' },
      u_scale: { value: 1.0, type: 'f32' },
      u_frames: { value: frames, type: 'f32' },
    }

    this.shader = Shader.from({
      gl: { vertex: BeeAbShader.vertexSource, fragment: BeeAbShader.fragmentSource },
      resources: {
        uniforms: uniformDefs,
        // Bound by name → `uniform sampler2D uTexture` in the fragment shader.
        uTexture: (atlas as any).source,
      },
    } as any)

    this.#ug = (this.shader.resources as any).uniforms
  }

  public setTime = (t: number): void => {
    this.#ug.uniforms.u_time = t
    this.#ug.update()
  }

  public setScale = (s: number): void => {
    this.#ug.uniforms.u_scale = s
    this.#ug.update()
  }

  // ─── vertex ──────────────────────────────────────────────────
  // Quad per bee; world offset + subtle bob added here. Unused per-bee
  // attributes (color/variant) are simply not declared — harmless.
  private static vertexSource = `
    in vec2 aPosition;
    in vec2 aUV;
    in vec2 aBeePos;
    in float aBeePhase;
    in float aBeeAlpha;
    in float aBeeFacing;

    out vec2 vUV;
    out float vPhase;
    out float vAlpha;
    out float vFacing;
    out float vTime;

    uniform mat3 uProjectionMatrix;
    uniform mat3 uWorldTransformMatrix;
    uniform mat3 uTransformMatrix;
    uniform float u_time;
    uniform float u_scale;

    void main() {
      float bob = sin(u_time * 3.0 + aBeePhase) * 2.0;
      vec2 worldPos = aBeePos + aPosition * u_scale + vec2(0.0, bob);

      mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
      gl_Position = vec4((mvp * vec3(worldPos, 1.0)).xy, 0.0, 1.0);

      vUV = aUV;
      vPhase = aBeePhase;
      vAlpha = aBeeAlpha;
      vFacing = aBeeFacing;
      vTime = u_time;
    }
  `

  // ─── fragment ────────────────────────────────────────────────
  // Pick a flap frame from the horizontal atlas by time+phase, mirror U when
  // facing left, sample, and fade by per-bee alpha. The atlas texture is
  // uploaded premultiplied (Pixi canvas default), so scaling the sampled texel
  // by vAlpha keeps premultiplied alpha correct; mesh uses 'pre-multiply' blend.
  private static fragmentSource = `
    precision highp float;

    in vec2 vUV;
    in float vPhase;
    in float vAlpha;
    in float vFacing;
    in float vTime;

    uniform sampler2D uTexture;
    uniform float u_frames;

    void main() {
      float localU = vFacing >= 0.0 ? vUV.x : 1.0 - vUV.x;
      float fp = fract(vTime * ${FLAP_HZ.toFixed(2)} + vPhase * 0.1592);
      float frame = floor(fp * u_frames);
      vec2 uv = vec2((frame + localU) / u_frames, vUV.y);

      vec4 tex = texture(uTexture, uv);
      if (tex.a * vAlpha < 0.004) discard;

      gl_FragColor = tex * vAlpha;
    }
  `
}
