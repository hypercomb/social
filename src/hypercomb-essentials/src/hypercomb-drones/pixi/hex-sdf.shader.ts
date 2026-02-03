import { Shader, Texture } from 'pixi.js'

type Vec2 = [number, number]

export class HexSdfTextureShader {
  public shader: Shader

  private readonly uniforms: {
    u_quadSize: { value: Vec2; type: 'vec2<f32>' }
    u_radiusPx: { value: number; type: 'f32' }
    u_texSize: { value: Vec2; type: 'vec2<f32>' }
    u_pan: { value: Vec2; type: 'vec2<f32>' }
    u_zoom: { value: number; type: 'f32' }
  }

  public constructor(texture: Texture, quadW: number, quadH: number, radiusPx: number) {
    this.uniforms = {
      u_quadSize: { value: [quadW, quadH], type: 'vec2<f32>' },
      u_radiusPx: { value: radiusPx, type: 'f32' },
      u_texSize: { value: [Math.max(1, texture.width), Math.max(1, texture.height)], type: 'vec2<f32>' },
      u_pan: { value: [0, 0], type: 'vec2<f32>' },
      u_zoom: { value: 1, type: 'f32' },
    }

    this.shader = Shader.from({
      gl: {
        vertex: HexSdfTextureShader.vertexSource,
        fragment: HexSdfTextureShader.fragmentSource,
      },
      resources: {
        hex: this.uniforms,
        u_tex0: texture.source,
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

  public setTexture = (texture: Texture): void => {
    ;(this.shader.resources as any).u_tex0 = texture.source
    this.uniforms.u_texSize.value[0] = Math.max(1, texture.width)
    this.uniforms.u_texSize.value[1] = Math.max(1, texture.height)
  }

  // pan is in uv units (0..1). example: 0.05 moves right 5% of the image
  public setPan = (x: number, y: number): void => {
    this.uniforms.u_pan.value[0] = x
    this.uniforms.u_pan.value[1] = y
  }

  // zoom > 1 zooms in, zoom < 1 zooms out
  public setZoom = (z: number): void => {
    this.uniforms.u_zoom.value = Math.max(0.001, z)
  }

  private static vertexSource = `
    attribute vec2 aPosition;
    attribute vec2 aUV;

    uniform mat3 uProjectionMatrix;
    uniform mat3 uWorldTransformMatrix;
    uniform mat3 uTransformMatrix;

    varying vec2 vUV;

    void main() {
      mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
      gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
      vUV = aUV;
    }
  `

  private static fragmentSource = `
    precision highp float;

    varying vec2 vUV;

    uniform vec2 u_quadSize;
    uniform float u_radiusPx;
    uniform vec2 u_texSize;
    uniform vec2 u_pan;
    uniform float u_zoom;
    uniform sampler2D u_tex0;

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

      // ---------------------------------
      // reconstruct local pixel coords from uv
      // uv is 0..1 across the quad
      // local is centered at 0,0 in pixel space
      // ---------------------------------
      vec2 local = (vUV - 0.5) * u_quadSize;

      // ---------------------------------
      // hex sdf clip in pixel space
      // ---------------------------------
      vec2 p_hex = rot30(local);
      float d = sdHex(p_hex, u_radiusPx);
      if (d > 0.0) discard;

      // ---------------------------------
      // texture mapping (cover) + editor pan/zoom
      // ---------------------------------
      vec2 uv = vUV;
      vec2 c = uv - 0.5;

      float texAspect = u_texSize.x / u_texSize.y;
      float hexAspect = 0.8660254; // (sqrt(3)/2), width/height of a regular hex bbox

      // cover: crop the longer axis so the image fills the hex
      if (texAspect > hexAspect) {
        float s = hexAspect / texAspect;
        c.x *= s;
      } else {
        float s = texAspect / hexAspect;
        c.y *= s;
      }

      // zoom and pan in the same centered space
      c = c / u_zoom + u_pan;

      uv = c + 0.5;

      // ---------------------------------
      // prevent edge bleeding
      // discard if outside an inset uv rect
      // ---------------------------------
      vec2 inset = 0.5 / u_texSize;

      if (uv.x < inset.x || uv.x > 1.0 - inset.x || uv.y < inset.y || uv.y > 1.0 - inset.y) {
        discard;
      }

      gl_FragColor = texture2D(u_tex0, uv);
    }
  `
}
