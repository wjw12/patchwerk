#version 300 es
precision highp float;

// Two-stop ramp. Vertical runs bottom to top, horizontal left to right, radial from the center.

uniform int uType;
uniform float uPhase;
uniform float uPeriod;
uniform int uExtend;
uniform vec3 uColor0;
uniform vec3 uColor1;
in vec2 vUv;
out vec4 fragColor;

float tile(float t) {
  if (uExtend == 1) return fract(t);
  if (uExtend == 2) {
    float f = fract(t * 0.5) * 2.0;
    return f <= 1.0 ? f : 2.0 - f;
  }
  return clamp(t, 0.0, 1.0);
}

void main() {
  vec2 centered = (vUv - 0.5) * vec2(16.0 / 9.0, 1.0);
  float along = uType == 1 ? vUv.x : uType == 2 ? length(centered) * 2.0 : vUv.y;
  float t = tile((along + uPhase) / max(uPeriod, 0.0001));
  fragColor = vec4(mix(uColor0, uColor1, t), 1.0);
}
