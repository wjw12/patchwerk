uniform float uCover; // @range 0 1 default 0.52 label "Coverage"
uniform float uWarp; // @range 0 3 default 1.4 label "Domain warp"
uniform float uWind; // @range 0 2 default 0.6 label "Wind"
uniform vec3 uSun; // @color #ffcf9e

// Volumetric clouds: a slab of domain-warped 3D value-noise fbm, 72 view steps
// with 6 light steps each, Henyey-Greenstein phase, powder term, sky and sun.
// Deliberately ALU-heavy: every density sample is 2 warp fbms + 1 detail fbm.

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i + vec3(0, 0, 0)), hash13(i + vec3(1, 0, 0)), f.x),
                 mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
                 mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

const mat3 M3 = mat3(0.00, 0.80, 0.60,
                    -0.80, 0.36, -0.48,
                    -0.60, -0.48, 0.64);

float fbm(vec3 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    sum += amp * noise(p);
    p = M3 * p * 2.02;
    amp *= 0.5;
  }
  return sum;
}

const float BASE = 1.2;
const float TOP = 3.4;

float density(vec3 p, int detail) {
  vec3 wind = vec3(iTime * uWind, 0.0, iTime * uWind * 0.35);
  vec3 q = p * 0.55 + wind * 0.25;
  vec3 warp = vec3(fbm(q * 0.5 + vec3(0.0, 1.7, 3.1), 3), fbm(q * 0.5 + vec3(5.2, 1.3, 2.8), 3), 0.0) - 0.5;
  float h = clamp((p.y - BASE) / (TOP - BASE), 0.0, 1.0);
  float profile = smoothstep(0.0, 0.12, h) * smoothstep(1.0, 0.35, h);
  float shape = fbm(q + uWarp * warp, 2);
  float base = (shape - (1.0 - uCover) * 0.85) * profile;
  if (base <= 0.0) return 0.0;
  float erode = fbm(q * 3.1 + uWarp * warp * 2.0 - wind * 0.4, detail);
  return clamp((base - erode * 0.12) * 5.0, 0.0, 1.0);
}

float hg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}

vec3 skyColor(vec3 rd, vec3 sun) {
  float s = clamp(dot(rd, sun), 0.0, 1.0);
  vec3 col = mix(vec3(0.62, 0.72, 0.86), vec3(0.18, 0.34, 0.66), pow(clamp(rd.y, 0.0, 1.0), 0.5));
  col += uSun * 0.35 * pow(s, 6.0) + uSun * 6.0 * pow(s, 900.0);
  return col;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
  float yaw = 0.15 * sin(iTime * 0.05) + (iMouse.z > 0.0 ? (iMouse.x / iResolution.x - 0.5) * 2.0 : 0.0);
  vec3 ro = vec3(0.0, 0.2, 0.0);
  vec3 ww = normalize(vec3(sin(yaw), 0.2, cos(yaw)));
  vec3 uu = normalize(cross(vec3(0.0, 1.0, 0.0), ww));
  vec3 vv = cross(ww, uu);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.6 * ww);
  vec3 sun = normalize(vec3(-0.38, 0.22, 0.9));

  vec3 sky = skyColor(rd, sun);
  vec3 col = sky;

  if (rd.y > 0.01) {
    float t0 = (BASE - ro.y) / rd.y;
    float t1 = min((TOP - ro.y) / rd.y, 60.0);
    float steps = 72.0;
    float dt = (t1 - t0) / steps;
    float jitter = fract(sin(dot(fragCoord, vec2(12.9898, 78.233))) * 43758.5453);
    float t = t0 + dt * jitter;
    float trans = 1.0;
    vec3 light = vec3(0.0);
    float phase = mix(hg(dot(rd, sun), 0.6), hg(dot(rd, sun), -0.25), 0.35);
    for (int i = 0; i < 72; i++) {
      if (t > t1 || trans < 0.01) break;
      vec3 p = ro + rd * t;
      float d = density(p, 5);
      if (d > 0.002) {
        float shadow = 0.0;
        float ls = 0.18;
        for (int j = 0; j < 6; j++) {
          shadow += density(p + sun * ls * (float(j) + 0.5), 3);
        }
        float beer = exp(-shadow * ls * 4.0);
        float powder = 1.0 - exp(-d * 8.0);
        vec3 lum = uSun * 22.0 * beer * powder * phase + mix(vec3(0.3, 0.36, 0.48), vec3(0.75, 0.82, 0.95), clamp((p.y - BASE) / (TOP - BASE), 0.0, 1.0)) * 0.6;
        float absorb = exp(-d * dt * 2.2);
        light += trans * lum * (1.0 - absorb);
        trans *= absorb;
      }
      t += dt;
    }
    float fade = exp(-0.0006 * t0 * t0);
    col = mix(sky, sky * trans + light, fade);
  } else {
    col = mix(vec3(0.24, 0.27, 0.3), sky, exp(rd.y * 12.0));
  }

  col = 1.0 - exp(-col * 1.1);
  col = pow(col, vec3(0.92));
  fragColor = vec4(col, 1.0);
}
