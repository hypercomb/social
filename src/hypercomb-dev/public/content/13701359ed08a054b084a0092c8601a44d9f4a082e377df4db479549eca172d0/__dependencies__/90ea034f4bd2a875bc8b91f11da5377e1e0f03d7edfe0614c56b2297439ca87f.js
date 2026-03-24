// @diamondcoreprocessor.com/presentation/tiles
// src/diamondcoreprocessor.com/presentation/tiles/hex-icon-button.ts
import { Container, Sprite, Text, TextStyle, Assets } from "pixi.js";
var HexIconButton = class extends Container {
  #display = null;
  #config;
  #hovered = false;
  constructor(config) {
    super();
    this.#config = config;
  }
  async load() {
    try {
      if (this.#config.fontChar) {
        await document.fonts.ready;
        const style = new TextStyle({
          fontFamily: "hypercomb-icons",
          fontSize: this.#config.width,
          fill: this.#config.tint ?? 16777215
        });
        const text = new Text({ text: this.#config.fontChar, style, resolution: window.devicePixelRatio * 4 });
        text.anchor.set(0.5, 0.5);
        text.position.set(this.#config.width / 2, this.#config.height / 2);
        this.#display = text;
        this.addChild(text);
      } else if (this.#config.svgMarkup) {
        const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(this.#config.svgMarkup)}`;
        const loadOpts = { src: dataUri };
        if (this.#config.alias) loadOpts.alias = this.#config.alias;
        const texture = await Assets.load(loadOpts);
        const sprite = new Sprite(texture);
        sprite.width = this.#config.width;
        sprite.height = this.#config.height;
        sprite.tint = this.#config.tint ?? 16777215;
        this.#display = sprite;
        this.addChild(sprite);
      }
    } catch (e) {
      console.warn("[HexIconButton] load failed:", e);
    }
  }
  get hovered() {
    return this.#hovered;
  }
  set hovered(value) {
    if (this.#hovered === value) return;
    this.#hovered = value;
    if (!this.#display) return;
    this.#display.tint = value ? this.#config.hoverTint ?? 13162751 : this.#config.tint ?? 16777215;
  }
  containsPoint(localX, localY) {
    return localX >= 0 && localX <= this.#config.width && localY >= 0 && localY <= this.#config.height;
  }
};

// src/diamondcoreprocessor.com/presentation/tiles/hex-overlay.shader.ts
import { Geometry, Mesh, Shader, Texture } from "pixi.js";
var HexOverlayMesh = class {
  mesh;
  #ug;
  constructor(radiusPx, flat) {
    const pad = radiusPx + 6;
    const pos = new Float32Array([
      -pad,
      -pad,
      pad,
      -pad,
      pad,
      pad,
      -pad,
      pad
    ]);
    const uv = new Float32Array([
      0,
      0,
      1,
      0,
      1,
      1,
      0,
      1
    ]);
    const idx = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const geom = new Geometry();
    geom.addAttribute("aPosition", pos, 2);
    geom.addAttribute("aUV", uv, 2);
    geom.addIndex(idx);
    const uniformDefs = {
      u_quadSize: { value: [pad * 2, pad * 2], type: "vec2<f32>" },
      u_radiusPx: { value: radiusPx, type: "f32" },
      u_flat: { value: flat ? 1 : 0, type: "f32" },
      u_fillColor: { value: [0, 0.118, 0.188], type: "vec3<f32>" },
      // 0x001e30
      u_fillAlpha: { value: 0.65, type: "f32" },
      u_strokeColor: { value: [0.267, 0.533, 0.667], type: "vec3<f32>" },
      // 0x4488aa
      u_strokeAlpha: { value: 0.5, type: "f32" }
    };
    const shader = Shader.from({
      gl: { vertex: VERT, fragment: FRAG },
      resources: { uniforms: uniformDefs }
    });
    this.#ug = shader.resources.uniforms;
    this.mesh = new Mesh({
      geometry: geom,
      shader,
      texture: Texture.WHITE
    });
    this.mesh.blendMode = "pre-multiply";
  }
  update(radiusPx, flat) {
    const pad = radiusPx + 6;
    const u = this.#ug.uniforms;
    u.u_quadSize[0] = pad * 2;
    u.u_quadSize[1] = pad * 2;
    u.u_radiusPx = radiusPx;
    u.u_flat = flat ? 1 : 0;
    this.#ug.update();
    const pos = this.mesh.geometry.getBuffer("aPosition");
    if (pos) {
      const d = pos.data;
      d[0] = -pad;
      d[1] = -pad;
      d[2] = pad;
      d[3] = -pad;
      d[4] = pad;
      d[5] = pad;
      d[6] = -pad;
      d[7] = pad;
      pos.update();
    }
  }
};
var VERT = `
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
`;
var FRAG = `
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

    // manual smoothing width (avoids fwidth which requires OES_standard_derivatives)
    float fw = max(u_radiusPx * 0.04, 1.5);
    float aa = fw * 1.5;
    float hexMask = 1.0 - smoothstep(-aa, aa, d);
    if (hexMask < 0.005) discard;

    // fill
    vec3 col = u_fillColor;
    float alpha = hexMask * u_fillAlpha;

    // stroke \u2014 2 screen-pixel ring centered on the hex edge
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
`;
export {
  HexIconButton,
  HexOverlayMesh
};
