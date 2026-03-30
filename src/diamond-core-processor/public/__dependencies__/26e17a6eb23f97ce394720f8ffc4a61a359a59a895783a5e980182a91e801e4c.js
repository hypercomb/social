// @diamondcoreprocessor.com/presentation/avatars
// src/diamondcoreprocessor.com/presentation/avatars/bee-swarm.shader.ts
import { Shader } from "pixi.js";
var BeeSwarmShader = class _BeeSwarmShader {
  shader;
  #ug;
  constructor() {
    const uniformDefs = {
      u_time: { value: 0, type: "f32" },
      u_scale: { value: 1, type: "f32" }
    };
    this.shader = Shader.from({
      gl: { vertex: _BeeSwarmShader.vertexSource, fragment: _BeeSwarmShader.fragmentSource },
      resources: { uniforms: uniformDefs }
    });
    this.#ug = this.shader.resources.uniforms;
  }
  setTime = (t) => {
    this.#ug.uniforms.u_time = t;
    this.#ug.update();
  };
  setScale = (s) => {
    this.#ug.uniforms.u_scale = s;
    this.#ug.update();
  };
  // ─── vertex shader ───────────────────────────────────────────
  // Each bee is a quad (4 verts, 6 indices). Per-instance data is
  // duplicated across the 4 verts of each quad (same pattern as
  // show-honeycomb's hex quads).
  static vertexSource = `
    in vec2 aPosition;
    in vec2 aUV;
    in vec2 aBeePos;
    in vec3 aBeeColor;
    in vec3 aWingColor;
    in float aBeePhase;
    in float aBeeVariant;
    in float aBeeAlpha;
    in float aBeeFacing;

    out vec2 vUV;
    out vec3 vBodyColor;
    out vec3 vWingColor;
    out float vPhase;
    out float vVariant;
    out float vAlpha;
    out float vFacing;
    out float vTime;

    uniform mat3 uProjectionMatrix;
    uniform mat3 uWorldTransformMatrix;
    uniform mat3 uTransformMatrix;
    uniform float u_time;
    uniform float u_scale;

    void main() {
      // body bob \u2014 subtle vertical oscillation
      float bob = sin(u_time * 3.0 + aBeePhase) * 2.0;
      vec2 worldPos = aBeePos + aPosition * u_scale + vec2(0.0, bob);

      mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
      gl_Position = vec4((mvp * vec3(worldPos, 1.0)).xy, 0.0, 1.0);

      vUV = aUV;
      vBodyColor = aBeeColor;
      vWingColor = aWingColor;
      vPhase = aBeePhase;
      vVariant = aBeeVariant;
      vAlpha = aBeeAlpha;
      vFacing = aBeeFacing;
      vTime = u_time;
    }
  `;
  // ─── fragment shader ─────────────────────────────────────────
  // Draws bee shape entirely via SDF composition:
  //   - body ellipse (aspect varies by variant)
  //   - two wing ellipses with flutter animation
  //   - stripe bands on body
  //   - two dot eyes
  static fragmentSource = `
    precision highp float;

    in vec2 vUV;
    in vec3 vBodyColor;
    in vec3 vWingColor;
    in float vPhase;
    in float vVariant;
    in float vAlpha;
    in float vFacing;
    in float vTime;

    // SDF ellipse (approximate \u2014 fast)
    float sdEllipse(vec2 p, vec2 r) {
      vec2 q = p / r;
      float d = length(q) - 1.0;
      return d * min(r.x, r.y);
    }

    // SDF circle
    float sdCircle(vec2 p, float r) {
      return length(p) - r;
    }

    void main() {
      // local coordinates: center of quad is (0,0), range roughly -1..1
      vec2 uv = (vUV - 0.5) * 2.0;

      // mirror X based on facing direction (negative = facing left)
      uv.x *= vFacing >= 0.0 ? 1.0 : -1.0;

      // \u2500\u2500 variant-dependent body proportions \u2500\u2500
      // variant 0: classic bee (balanced)
      // variant 1: round bumble (wider, shorter)
      // variant 2: elongated wasp (narrow, longer)
      float v = floor(vVariant + 0.5);
      vec2 bodyR = v < 0.5 ? vec2(0.35, 0.50)     // classic
               : v < 1.5 ? vec2(0.45, 0.42)     // bumble
               :            vec2(0.28, 0.58);    // wasp

      // stripe count varies by variant
      float stripeFreq = v < 0.5 ? 6.0 : v < 1.5 ? 5.0 : 8.0;

      // \u2500\u2500 body \u2500\u2500
      float dBody = sdEllipse(uv, bodyR);

      // \u2500\u2500 wings \u2500\u2500 flutter via time + phase
      float flutter = sin(vTime * 12.0 + vPhase * 6.28) * 0.15;
      vec2 wingOffset = vec2(bodyR.x * 0.7, -bodyR.y * 0.35 + flutter);
      vec2 wingR = vec2(0.28, 0.18);

      float dWingL = sdEllipse(uv - vec2(-wingOffset.x, wingOffset.y), wingR);
      float dWingR = sdEllipse(uv - vec2( wingOffset.x, wingOffset.y), wingR);
      float dWings = min(dWingL, dWingR);

      // \u2500\u2500 eyes \u2500\u2500 two small dots near top of body
      float eyeSpacing = bodyR.x * 0.45;
      float eyeY = -bodyR.y * 0.35;
      float eyeR = 0.06;
      float dEyeL = sdCircle(uv - vec2(-eyeSpacing, eyeY), eyeR);
      float dEyeR = sdCircle(uv - vec2( eyeSpacing, eyeY), eyeR);
      float dEyes = min(dEyeL, dEyeR);

      // \u2500\u2500 composite \u2500\u2500
      float aa = 0.04; // anti-aliasing width

      // wings (behind body)
      float wingAlpha = 1.0 - smoothstep(-aa, aa, dWings);
      vec3 wingCol = vWingColor * 1.2; // slightly brighter
      float wingOpacity = 0.55; // translucent wings

      // body
      float bodyAlpha = 1.0 - smoothstep(-aa, aa, dBody);

      // stripes on body
      float stripeMask = smoothstep(-0.02, 0.02, sin(uv.y * stripeFreq * 3.14159));
      vec3 stripeColor = vBodyColor * 0.3; // dark stripes
      vec3 bodyCol = mix(vBodyColor, stripeColor, stripeMask * 0.7);

      // eyes
      float eyeAlpha = 1.0 - smoothstep(-aa, aa, dEyes);

      // layer: wings behind, body on top, eyes on top of body
      vec3 color = vec3(0.0);
      float alpha = 0.0;

      // wings layer
      color = wingCol * wingOpacity;
      alpha = wingAlpha * wingOpacity;

      // body layer (over wings)
      color = mix(color, bodyCol, bodyAlpha);
      alpha = mix(alpha, 1.0, bodyAlpha);

      // eyes layer (over body)
      color = mix(color, vec3(0.05), eyeAlpha);
      alpha = mix(alpha, 1.0, eyeAlpha);

      // overall opacity (fade in/out)
      alpha *= vAlpha;

      if (alpha < 0.005) discard;

      // premultiplied alpha
      gl_FragColor = vec4(color * alpha, alpha);
    }
  `;
};
export {
  BeeSwarmShader
};
