// hypercomb-essentials/src/diamondcoreprocessor.com/pixi/hex-overlay.shader.ts
// Lightweight SDF shader for the hover overlay hex — smooth fill + stroke edges.

import { Geometry, Mesh, Shader, Texture } from 'pixi.js'

export class HexOverlayMesh {
  readonly mesh: Mesh

  #ug: any

  constructor(radiusPx: number, flat: boolean) {
    // quad half-extents: pad slightly beyond circumradius so AA fringe isn't clipped
    const pad = radiusPx + 6
    const pos = new Float32Array([
      -pad, -pad,  pad, -pad,  pad, pad,  -pad, pad,
    ])
    const uv = new Float32Array([
      0, 0,  1, 0,  1, 1,  0, 1,
    ])
    const idx = new Uint32Array([0, 1, 2, 0, 2, 3])

    const geom = new Geometry()
    ;(geom as any).addAttribute('aPosition', pos, 2)
    ;(geom as any).addAttribute('aUV', uv, 2)
    ;(geom as any).addIndex(idx)

    const uniformDefs = {
      u_quadSize:    { value: [pad * 2, pad * 2], type: 'vec2<f32>' },
      u_radiusPx:    { value: radiusPx,           type: 'f32' },
      u_flat:        { value: flat ? 1.0 : 0.0,   type: 'f32' },
      u_fillColor:   { value: [0.0, 0.118, 0.188], type: 'vec3<f32>' }, // 0x001e30
      u_fillAlpha:   { value: 0.65,                type: 'f32' },
      u_strokeColor: { value: [0.267, 0.533, 0.667], type: 'vec3<f32>' }, // 0x4488aa
      u_strokeAlpha: { value: 0.5,                 type: 'f32' },
    }

    const shader = Shader.from({
      gl: { vertex: VERT, fragment: FRAG },
      resources: { uniforms: uniformDefs },
    })

    this.#ug = (shader.resources as any).uniforms

    this.mesh = new Mesh({
      geometry: geom as any,
      shader: shader as any,
      texture: Texture.WHITE as any,
    } as any)
    ;(this.mesh as any).blendMode = 'pre-multiply'
  }

  update(radiusPx: number, flat: boolean): void {
    const pad = radiusPx + 6
    const u = this.#ug.uniforms
    u.u_quadSize[0] = pad * 2
    u.u_quadSize[1] = pad * 2
    u.u_radiusPx = radiusPx
    u.u_flat = flat ? 1.0 : 0.0
    this.#ug.update()

    // resize quad vertices
    const pos = (this.mesh.geometry as any).getBuffer('aPosition')
    if (pos) {
      const d = pos.data as Float32Array
      d[0] = -pad; d[1] = -pad
      d[2] =  pad; d[3] = -pad
      d[4] =  pad; d[5] =  pad
      d[6] = -pad; d[7] =  pad
      pos.update()
    }
  }
}

const VERT = `
  in vec2 aPosition;
  in vec2 aUV;
  out vec2 vUV;

  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;

  void main() {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
  }
`

const FRAG = `
  precision highp float;

  in vec2 vUV;

  uniform vec2  u_quadSize;
  uniform float u_radiusPx;
  uniform float u_flat;
  uniform vec3  u_fillColor;
  uniform float u_fillAlpha;
  uniform vec3  u_strokeColor;
  uniform float u_strokeAlpha;

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
    vec2 rotated = u_flat > 0.5 ? local : rot30(local);
    float d = sdHex(rotated, u_radiusPx);

    // fwidth gives exact screen-pixel rate of change for pixel-perfect AA
    float fw = fwidth(d);
    float aa = fw * 1.5;
    float hexMask = 1.0 - smoothstep(-aa, aa, d);
    if (hexMask < 0.005) discard;

    // fill
    vec3 col = u_fillColor;
    float alpha = hexMask * u_fillAlpha;

    // stroke — 2 screen-pixel ring centered on the hex edge
    float sw = fw * 2.0;
    float strokeMask = 1.0 - smoothstep(0.0, aa, abs(d) - sw);
    strokeMask *= hexMask;
    float strokeA = strokeMask * u_strokeAlpha;

    // composite stroke over fill
    float outA = alpha + strokeA - alpha * strokeA;
    vec3 outC = (outA > 0.001)
      ? (col * alpha * (1.0 - strokeA) + u_strokeColor * strokeA) / outA
      : col;

    // premultiplied alpha output
    gl_FragColor = vec4(outC * outA, outA);
  }
`
