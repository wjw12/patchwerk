#version 300 es
precision highp float;

// Value noise over the frame. t4d moves the field through z. Mono shares one channel across rgb.

uniform float uSeed;
uniform float uPeriod;
uniform float uHarmon;
uniform float uSpread;
uniform float uGain;
uniform float uAmp;
uniform float uOffset;
uniform float uT4d;
uniform int uMono;
in vec2 vUv;
out vec4 fragColor;

float hash13(vec3 p) {
  vec3 q = fract(p * 0.1031);
  q += dot(q, q.zyx + 31.32);
  return fract((q.x + q.y) * q.z);
}

float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), u.x), mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), u.x), mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
    u.z
  );
}

float fbm(vec3 p) {
  float sum = 0.0;
  float amp = 1.0;
  float freq = 1.0;
  float norm = 0.0;
  int octaves = clamp(int(uHarmon) + 1, 1, 3);
  for (int i = 0; i < 3; i++) {
    if (i >= octaves) break;
    sum += vnoise(p * freq) * amp;
    norm += amp;
    freq *= max(uSpread, 0.001);
    amp *= uGain;
  }
  return sum / max(norm, 0.0001);
}

void main() {
  float period = max(uPeriod, 0.0001);
  vec3 p = vec3(vUv / period, uT4d) + vec3(uSeed);
  float n = fbm(p);
  vec3 rgb = vec3(n);
  if (uMono == 0) {
    rgb.g = fbm(p + vec3(19.1, 7.7, 3.3));
    rgb.b = fbm(p + vec3(4.4, 13.2, 8.8));
  }
  fragColor = vec4((rgb * 2.0 - 1.0) * uAmp + uOffset, 1.0);
}
