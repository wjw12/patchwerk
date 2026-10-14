#version 300 es
precision highp float;
precision highp sampler2D;

// One axis of a blur. uDir is one pixel in x or y. Size is the gaussian sigma in pixels.
// Extend is sampled in the shader: the source texture stays clamp-to-edge for everyone else.

uniform sampler2D uTex;
uniform vec2 uDir;
uniform float uSize;
uniform int uExtend;
uniform int uBox;
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

vec4 take(vec2 uv) {
  if (uExtend == 1 && (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)) return vec4(0.0);
  return texture(uTex, tile(uv));
}

void main() {
  float sigma = max(uSize, 0.001);
  // 16 taps. Past that, space them so a large size still reaches ±2 sigma (or the box radius).
  float reach = uBox == 1 ? uSize : sigma * 2.0;
  float stepPx = max(1.0, reach / 16.0);
  int radius = int(min(16.0, ceil(reach / stepPx)));
  if (radius <= 0) {
    fragColor = take(vUv);
    return;
  }
  vec4 acc = vec4(0.0);
  float sum = 0.0;
  for (int i = -16; i <= 16; i++) {
    if (abs(i) > radius) continue;
    float dist = float(i) * stepPx;
    float w = uBox == 1 ? 1.0 : exp(-0.5 * dist * dist / (sigma * sigma));
    acc += take(vUv + uDir * dist) * w;
    sum += w;
  }
  fragColor = acc / max(sum, 0.0001);
}
