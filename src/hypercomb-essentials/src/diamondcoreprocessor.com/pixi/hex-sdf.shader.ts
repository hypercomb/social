// hypercomb-essentials/src/diamondcoreprocessor.com/pixi/hex-sdf.shader.ts
// @essentials/default/hex-sdf.shader
// @hypercomb/pixi

import { Shader, Texture } from 'pixi.js'

type Vec2 = [number, number]

export class HexSdfTextureShader {
  public shader: Shader

  private readonly uniforms: {
    u_quadSize: { value: Vec2; type: 'vec2<f32>' }
    u_radiusPx: { value: number; type: 'f32' }
    u_texSize: { value: Vec2; type: 'vec2<f32>' }
  }

  public constructor(baseTexture: Texture, labelAtlas: Texture, quadW: number, quadH: number, radiusPx: number) {
    this.uniforms = {
      u_quadSize: { value: [quadW, quadH], type: 'vec2<f32>' },
      u_radiusPx: { value: radiusPx, type: 'f32' },
      u_texSize: { value: [Math.max(1, baseTexture.width), Math.max(1, baseTexture.height)], type: 'vec2<f32>' },
    }

    // v8 shaded mesh requires uniforms nested under a group and shader inputs using in/out :contentReference[oaicite:3]{index=3}
    this.shader = Shader.from({
      gl: { vertex: HexSdfTextureShader.vertexSource, fragment: HexSdfTextureShader.fragmentSource },
      resources: {
        uniforms: this.uniforms,
        u_tex0: this.toSource(baseTexture),
        u_label: this.toSource(labelAtlas),
      },
    })
  }

  public setQuadSize = (w: number, h: number): void => {
    this.uniforms.u_quadSize.value[0] = w
    this.uniforms.u_quadSize.value[1] = h
  }

  public setRadiusPx = (r: number): void => {
    this.uniforms.u_radiusPx.value = r
  }

  public setBaseTexture = (t: Texture): void => {
    ;(this.shader.resources as any).u_tex0 = this.toSource(t)
    this.uniforms.u_texSize.value[0] = Math.max(1, t.width)
    this.uniforms.u_texSize.value[1] = Math.max(1, t.height)
  }

  public setLabelAtlas = (t: Texture): void => {
    ;(this.shader.resources as any).u_label = this.toSource(t)
  }

  private toSource = (t: Texture): any => {
    return (t as any).source ?? (t as any).baseTexture?.source ?? (t as any).texture?.source
  }

  // note: use in/out so pixi v8 can compile consistently :contentReference[oaicite:4]{index=4}
  private static vertexSource = `
    in vec2 aPosition;
    in vec2 aUV;
    in vec4 aLabelUV;

    out vec2 vUV;
    out vec4 vLabelUV;

    uniform mat3 uProjectionMatrix;
    uniform mat3 uWorldTransformMatrix;
    uniform mat3 uTransformMatrix;

    void main() {
      mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
      gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
      vUV = aUV;
      vLabelUV = aLabelUV;
    }
  `

  private static fragmentSource = `
    precision highp float;

    in vec2 vUV;
    in vec4 vLabelUV;

    uniform vec2 u_quadSize;
    uniform float u_radiusPx;
    uniform vec2 u_texSize;

    uniform sampler2D u_tex0;
    uniform sampler2D u_label;

    float sdHex(vec2 p, float r) {
      p = abs(p);
      return max(p.x * 0.8660254 + p.y * 0.5, p.y) - r;
    }

    vec2 rot30(vec2 p) {
      return vec2(
        0.8660254 * p.x - 0.5 * p.y,
        0.5 * p.x + 0.8660254 * p.y
      );
    }

    void main() {
      vec2 local = (vUV - 0.5) * u_quadSize;
      float d = sdHex(rot30(local), u_radiusPx);
      if (d > 0.0) discard;

      vec4 base = texture2D(u_tex0, vUV);

      vec2 luv = mix(vLabelUV.xy, vLabelUV.zw, vUV);
      vec4 label = texture2D(u_label, luv);

      gl_FragColor = mix(base, label, label.a);
    }
  `
}

export class HexSdfTextureShaderFactory {
  public create = (baseTexture: Texture, labelAtlas: Texture, quadW: number, quadH: number, radiusPx: number): HexSdfTextureShader => {
    return new HexSdfTextureShader(baseTexture, labelAtlas, quadW, quadH, radiusPx)
  }
}

window.ioc.register('HexSdfTextureShaderFactory', new HexSdfTextureShaderFactory())
