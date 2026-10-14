#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D sP;
uniform int uN;
uniform int uWidth;
uniform float uSeed;
uniform float uPeriod;
uniform float uHarmon;
uniform float uSpread;
uniform float uGain;
uniform float uAmp;
uniform float uT4d;
out vec4 fragColor;

float hash14(vec4 p) {
  vec4 q = fract(p * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  q += dot(q, q.wzxy + 33.33);
  return fract((q.x + q.y) * q.z + q.w);
}

float noise4(vec4 x) {
  vec4 i = floor(x);
  vec4 f = fract(x);
  vec4 u = f * f * (3.0 - 2.0 * f);
  float a = hash14(i);
  float b = hash14(i + vec4(1.0, 0.0, 0.0, 0.0));
  float c = hash14(i + vec4(0.0, 1.0, 0.0, 0.0));
  float d = hash14(i + vec4(1.0, 1.0, 0.0, 0.0));
  float e = hash14(i + vec4(0.0, 0.0, 1.0, 0.0));
  float f1 = hash14(i + vec4(1.0, 0.0, 1.0, 0.0));
  float g = hash14(i + vec4(0.0, 1.0, 1.0, 0.0));
  float h = hash14(i + vec4(1.0, 1.0, 1.0, 0.0));
  float a2 = hash14(i + vec4(0.0, 0.0, 0.0, 1.0));
  float b2 = hash14(i + vec4(1.0, 0.0, 0.0, 1.0));
  float c2 = hash14(i + vec4(0.0, 1.0, 0.0, 1.0));
  float d2 = hash14(i + vec4(1.0, 1.0, 0.0, 1.0));
  float e2 = hash14(i + vec4(0.0, 0.0, 1.0, 1.0));
  float f2 = hash14(i + vec4(1.0, 0.0, 1.0, 1.0));
  float g2 = hash14(i + vec4(0.0, 1.0, 1.0, 1.0));
  float h2 = hash14(i + vec4(1.0, 1.0, 1.0, 1.0));
  float x1 = mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, f1, u.x), mix(g, h, u.x), u.y), u.z);
  float x2 = mix(mix(mix(a2, b2, u.x), mix(c2, d2, u.x), u.y), mix(mix(e2, f2, u.x), mix(g2, h2, u.x), u.y), u.z);
  return mix(x1, x2, u.w);
}

float fbm(vec4 p) {
  float sum = 0.0;
  float amp = 1.0;
  float freq = 1.0;
  float norm = 0.0;
  int octaves = clamp(int(uHarmon) + 1, 1, 3);
  for (int i = 0; i < 3; i++) {
    if (i >= octaves) break;
    sum += (noise4(p * freq) * 2.0 - 1.0) * amp;
    norm += amp;
    freq *= max(uSpread, 0.001);
    amp *= uGain;
  }
  return sum / max(norm, 0.0001);
}

void main() {
  ivec2 id = ivec2(gl_FragCoord.xy);
  int i = id.y * uWidth + id.x;
  if (i >= uN) discard;
  vec3 p = texelFetch(sP, id, 0).xyz;
  float period = max(uPeriod, 0.0001);
  vec4 q = vec4(p / period, uT4d) + vec4(uSeed);
  float nx = fbm(q);
  float ny = fbm(q + vec4(19.1, 7.7, 3.3, 11.0));
  float nz = fbm(q + vec4(4.4, 13.2, 8.8, 2.2));
  fragColor = vec4(vec3(nx, ny, nz) * uAmp, 0.0);
}
