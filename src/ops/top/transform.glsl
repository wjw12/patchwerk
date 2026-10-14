#version 300 es
precision highp float;
precision highp sampler2D;

// Rotate degrees clockwise, then scale, then translate, about the center.
// The UV walks that backwards. extend zero shows bg; hold stretches the edge.

uniform sampler2D uTex;
uniform float uTx;
uniform float uTy;
uniform float uRot;
uniform float uSx;
uniform float uSy;
uniform vec3 uBg;
uniform int uExtend;
in vec2 vUv;
out vec4 fragColor;

vec2 tile(vec2 uv) {
  if (uExtend == 2) return fract(uv);
  if (uExtend == 3) {
    vec2 f = fract(uv * 0.5) * 2.0;
    return vec2(f.x <= 1.0 ? f.x : 2.0 - f.x, f.y <= 1.0 ? f.y : 2.0 - f.y);
  }
  return clamp(uv, 0.0, 1.0);
}

void main() {
  vec2 uv = vUv - 0.5 - vec2(uTx, uTy);
  uv /= max(vec2(uSx, uSy), vec2(0.0001));
  float c = cos(uRot);
  float s = sin(uRot);
  uv = mat2(c, s, -s, c) * uv;
  uv += 0.5;
  bool outside = uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0;
  if (uExtend == 1 && outside) fragColor = vec4(uBg, 1.0);
  else fragColor = texture(uTex, tile(uv));
}
