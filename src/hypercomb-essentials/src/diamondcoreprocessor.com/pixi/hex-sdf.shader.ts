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

  constructor(baseTexture: Texture, externalTexture: Texture, labelAtlas: Texture, cellImageAtlas: Texture, quadW: number, quadH: number, radiusPx: number) {
    this.uniforms = {
      u_quadSize: { value: [quadW, quadH], type: 'vec2<f32>' },
      u_radiusPx: { value: radiusPx, type: 'f32' },
      u_texSize: { value: [Math.max(1, baseTexture.width), Math.max(1, baseTexture.height)], type: 'vec2<f32>' },
    }

    // v8 shaded mesh requires uniforms nested under a group and shader inputs using in/out
    this.shader = Shader.from({
      gl: { vertex: HexSdfTextureShader.vertexSource, fragment: HexSdfTextureShader.fragmentSource },
      resources: {
        uniforms: this.uniforms,
        u_tex0: this.toSource(baseTexture),
        u_tex1: this.toSource(externalTexture),
        u_label: this.toSource(labelAtlas),
        u_cellImages: this.toSource(cellImageAtlas),
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

  public setExternalTexture = (t: Texture): void => {
    ;(this.shader.resources as any).u_tex1 = this.toSource(t)
  }

  public setCellImageAtlas = (t: Texture): void => {
    ;(this.shader.resources as any).u_cellImages = this.toSource(t)
  }

  private toSource = (t: Texture): any => {
    return (t as any).source ?? (t as any).baseTexture?.source ?? (t as any).texture?.source
  }

  // note: use in/out so pixi v8 can compile consistently
  private static vertexSource = `
    in vec2 aPosition;
    in vec2 aUV;
    in vec4 aLabelUV;
    in float aTexKind;
    in vec4 aImageUV;
    in float aHasImage;
    in float aHeat;
    in vec3 aIdentityColor;
    in float aHasBranch;

    out vec2 vUV;
    out vec4 vLabelUV;
    out float vTexKind;
    out vec4 vImageUV;
    out float vHasImage;
    out float vHeat;
    out vec3 vIdentityColor;
    out float vHasBranch;

    uniform mat3 uProjectionMatrix;
    uniform mat3 uWorldTransformMatrix;
    uniform mat3 uTransformMatrix;

    void main() {
      mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
      gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
      vUV = aUV;
      vLabelUV = aLabelUV;
      vTexKind = aTexKind;
      vImageUV = aImageUV;
      vHasImage = aHasImage;
      vHeat = aHeat;
      vIdentityColor = aIdentityColor;
      vHasBranch = aHasBranch;
    }
  `

  private static fragmentSource = `
    precision highp float;

    in vec2 vUV;
    in vec4 vLabelUV;
    in float vTexKind;
    in vec4 vImageUV;
    in float vHasImage;
    in float vHeat;
    in vec3 vIdentityColor;
    in float vHasBranch;

    uniform vec2 u_quadSize;
    uniform float u_radiusPx;
    uniform vec2 u_texSize;

    uniform sampler2D u_tex0;
    uniform sampler2D u_tex1;
    uniform sampler2D u_label;
    uniform sampler2D u_cellImages;

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
      vec2 rotated = rot30(local);
      float d = sdHex(rotated, u_radiusPx);
      if (d > 0.0) discard;

      vec4 base;

      if (vHasImage > 0.5) {
        // snapshot cell: fill full hex with the snapshot image (border is baked in)
        // sdHex r = apothem. Pointy-top bounding box: width = 2r, height = 2r / (√3/2)
        float hexW = 2.0 * u_radiusPx;
        float hexH = 2.0 * u_radiusPx / 0.8660254;
        vec2 hexScale = vec2(hexW / u_quadSize.x, hexH / u_quadSize.y);
        vec2 hexUV = clamp((vUV - 0.5) / hexScale + 0.5, 0.0, 1.0);
        vec2 imgUV = mix(vImageUV.xy, vImageUV.zw, hexUV);
        base = texture2D(u_cellImages, imgUV);
      } else {
        // no snapshot: training wheels (hex prism texture)
        vec4 baseLocal = texture2D(u_tex0, vUV);
        vec4 baseExternal = texture2D(u_tex1, vUV);
        base = mix(baseLocal, baseExternal, step(0.5, vTexKind));

        // subtle identity wash on cell interior
        float borderWidth = u_radiusPx * 0.18;
        float innerD = sdHex(rotated, u_radiusPx - borderWidth);
        float innerMask = smoothstep(0.0, -1.5, innerD);
        base.rgb = mix(base.rgb, vIdentityColor, innerMask * 0.07);
      }

      vec4 color = base;

      if (vHasImage < 0.5) {
        // label only for cells without snapshot (text must not overlap border path)
        vec2 luv = mix(vLabelUV.xy, vLabelUV.zw, vUV);
        float labelAlpha = texture2D(u_label, luv).a;
        color = mix(color, vec4(1.0, 1.0, 1.0, labelAlpha), labelAlpha);

        // ambient presence — identity color at rest, shifts to warm amber with heat
        float heatRing = smoothstep(0.0, -1.5, d) - smoothstep(-4.0, -6.0, d);
        vec3 warmColor = vec3(1.0, 0.62, 0.12);
        vec3 heatTint = mix(vIdentityColor, warmColor, vHeat);
        float heatAlpha = mix(0.07, 0.68, vHeat);
        color.rgb = mix(color.rgb, heatTint, heatRing * heatAlpha);
      }

      // branch indicator: inner hex ring + subtle portal glow
      if (vHasBranch > 0.5) {
        float innerD = sdHex(rotated, u_radiusPx * 0.78);
        float ring = 1.0 - smoothstep(0.0, 1.2, abs(innerD));
        vec3 ringColor = vec3(0.45, 0.72, 1.0);
        color.rgb = mix(color.rgb, ringColor, ring * 0.7);

        float dist = length(local) / u_radiusPx;
        float glow = exp(-dist * dist * 3.0);
        color.rgb += ringColor * glow * 0.12;
      }

      gl_FragColor = color;
    }
  `
}

export class HexSdfTextureShaderFactory {
  create = (baseTexture: Texture, externalTexture: Texture, labelAtlas: Texture, cellImageAtlas: Texture, quadW: number, quadH: number, radiusPx: number): HexSdfTextureShader => {
    return new HexSdfTextureShader(baseTexture, externalTexture, labelAtlas, cellImageAtlas, quadW, quadH, radiusPx)
  }
}

window.ioc.register('@diamondcoreprocessor.com/HexSdfTextureShaderFactory', new HexSdfTextureShaderFactory())
