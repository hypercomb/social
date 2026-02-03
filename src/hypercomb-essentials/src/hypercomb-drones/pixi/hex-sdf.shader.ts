// src/hypercomb-drones/pixi/hex-sdf.shader.ts

import { Shader } from 'pixi.js'

type Vec4 = [number, number, number, number]

export class HexSdfShader {
  public shader: Shader

  private readonly uniforms: {
    uInRadius: { value: number; type: 'f32' }
    uFillColor: { value: Vec4; type: 'vec4<f32>' }
  }

  private circumRadiusPx: number
  private borderWidthPx: number

  public constructor(circumRadiusPx: number, fillColorHex: number, borderWidthPx = 0) {
    this.circumRadiusPx = circumRadiusPx
    this.borderWidthPx = borderWidthPx

    this.uniforms = {
      uInRadius: { value: HexSdfShader.computeInRadius(circumRadiusPx, borderWidthPx), type: 'f32' },
      uFillColor: { value: HexSdfShader.hexToVec4(fillColorHex), type: 'vec4<f32>' },
    }

    this.shader = Shader.from({
      gl: {
        vertex: HexSdfShader.vertexSource,
        fragment: HexSdfShader.fragmentSource,
      },
      resources: { honeycomb: this.uniforms },
    })
  }

  public setFillColor = (fillColorHex: number): void => {
    const v = HexSdfShader.hexToVec4(fillColorHex)
    this.uniforms.uFillColor.value[0] = v[0]
    this.uniforms.uFillColor.value[1] = v[1]
    this.uniforms.uFillColor.value[2] = v[2]
    this.uniforms.uFillColor.value[3] = v[3]
  }

  public setBorderWidth = (borderWidthPx: number): void => {
    this.borderWidthPx = borderWidthPx
    this.uniforms.uInRadius.value = HexSdfShader.computeInRadius(this.circumRadiusPx, this.borderWidthPx)
  }

  public setCircumRadius = (circumRadiusPx: number): void => {
    this.circumRadiusPx = circumRadiusPx
    this.uniforms.uInRadius.value = HexSdfShader.computeInRadius(this.circumRadiusPx, this.borderWidthPx)
  }

  private static computeInRadius = (circumRadiusPx: number, borderWidthPx: number): number => {
    // sdhex is inradius-based
    const raw = circumRadiusPx * 0.8660254037844386

    // inset half the border so the line can sit between cells without covering the interior
    // the extra 0.25 helps prevent aa bleed at high resolution
    const inset = borderWidthPx * 0.5 + 0.25

    return Math.max(0, raw - inset)
  }

  private static fragmentSource = `
    precision highp float;

    varying vec2 vLocal;
    uniform float uInRadius;
    uniform vec4 uFillColor;

    vec2 rot30(vec2 p) {
      float c = 0.8660254037844386;
      float s = 0.5;
      return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    }

    float sdHexFlat(vec2 p, float r) {
      p = abs(p);
      return max(dot(p, vec2(0.8660254, 0.5)), p.y) - r;
    }

    void main() {
      vec2 p = rot30(vLocal);
      float d = sdHexFlat(p, uInRadius);

      // hard reject outside so one cell cannot tint another cell's interior
      if (d > 0.0) discard;

      // inside-only aa: the feather happens inward, never outward
      float aa = 1.0;
      float mask = smoothstep(0.0, aa, -d);

      vec4 col = uFillColor;
      col.a *= mask;
      gl_FragColor = col;
    }
  `;
  

  private static hexToVec4 = (color: number, a = 1): Vec4 => {
    const r = ((color >> 16) & 0xff) / 255;
    const g = ((color >> 8) & 0xff) / 255;
    const b = (color & 0xff) / 255;
    return [r, g, b, a];
  };

  private static vertexSource = `
    attribute vec2 aPosition;
    attribute vec2 aUV;

    uniform mat3 uProjectionMatrix;
    uniform mat3 uWorldTransformMatrix;
    uniform mat3 uTransformMatrix;

    varying vec2 vLocal;

    void main() {
      mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
      gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);

      // we store local pixel coords in the uv buffer
      vLocal = aUV;
    }
  `;

}