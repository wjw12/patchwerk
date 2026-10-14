uniform float uOrbit; // @range 0 1 default 0.15 label "Orbit speed"
uniform float uShadow; // @range 2 32 default 12 label "Shadow hardness"
uniform vec3 uKey; // @color #ffd9a8

// Raymarched SDF still life: soft shadows, five-tap AO, orbit camera.
// Drag on the viewer to orbit (iMouse.xy while the button is down).

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdTorus(vec3 p, vec2 t) {
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

// x = distance, y = material id
vec2 map(vec3 p) {
  vec2 res = vec2(p.y + 1.0, 0.0);
  vec3 q = p - vec3(0.0, 0.05, 0.0);
  q.xz *= rot(iTime * 0.4);
  float blob = length(q - vec3(0.0, 0.25 + 0.15 * sin(iTime * 1.3), 0.0)) - 0.55;
  float box = sdBox(q, vec3(0.45)) - 0.06;
  float core = smin(blob, box, 0.25);
  if (core < res.x) res = vec2(core, 1.0);
  vec3 tp = p - vec3(1.6, -0.55, 0.4);
  tp.xy *= rot(0.5);
  float torus = sdTorus(tp, vec2(0.45, 0.14));
  if (torus < res.x) res = vec2(torus, 2.0);
  for (int i = 0; i < 4; i++) {
    float a = float(i) * 1.5708 + 0.6;
    vec3 c = vec3(2.3 * cos(a), -0.55, 2.3 * sin(a));
    float pillar = sdBox(p - c, vec3(0.18, 0.45, 0.18)) - 0.03;
    if (pillar < res.x) res = vec2(pillar, 3.0);
  }
  return res;
}

vec3 normalAt(vec3 p) {
  const vec2 e = vec2(0.0008, -0.0008);
  return normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x + e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}

float softShadow(vec3 ro, vec3 rd, float k) {
  float res = 1.0;
  float t = 0.02;
  for (int i = 0; i < 64; i++) {
    float h = map(ro + rd * t).x;
    res = min(res, k * h / t);
    t += clamp(h, 0.01, 0.25);
    if (res < 0.002 || t > 12.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

float ambientOcclusion(vec3 p, vec3 n) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = 0.01 + 0.12 * float(i) / 4.0;
    float d = map(p + h * n).x;
    occ += (h - d) * sca;
    sca *= 0.95;
  }
  return clamp(1.0 - 3.0 * occ, 0.0, 1.0);
}

vec3 albedo(float id, vec3 p) {
  if (id < 0.5) {
    float checker = mod(floor(p.x * 1.5) + floor(p.z * 1.5), 2.0);
    return mix(vec3(0.16), vec3(0.32), checker);
  }
  if (id < 1.5) return vec3(0.85, 0.22, 0.12);
  if (id < 2.5) return vec3(0.15, 0.45, 0.85);
  return vec3(0.8, 0.75, 0.65);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
  vec2 m = iMouse.xy / iResolution.xy;
  float yaw = iTime * uOrbit + (iMouse.x > 0.0 ? (m.x - 0.5) * 6.2832 : 0.6);
  float pitch = iMouse.y > 0.0 ? mix(0.05, 1.2, m.y) : 0.42;
  vec3 ro = 5.2 * vec3(cos(pitch) * sin(yaw), sin(pitch), cos(pitch) * cos(yaw));
  vec3 ta = vec3(0.0, -0.2, 0.0);
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.8 * ww);

  vec3 sky = mix(vec3(0.55, 0.65, 0.8), vec3(0.12, 0.16, 0.26), clamp(rd.y * 1.5 + 0.3, 0.0, 1.0));
  vec3 col = sky;
  float t = 0.0;
  vec2 hit = vec2(-1.0);
  for (int i = 0; i < 160; i++) {
    vec2 h = map(ro + rd * t);
    if (h.x < 0.0005 * t) {
      hit = vec2(t, h.y);
      break;
    }
    t += h.x;
    if (t > 30.0) break;
  }

  if (hit.x > 0.0) {
    vec3 p = ro + rd * hit.x;
    vec3 n = normalAt(p);
    vec3 lig = normalize(vec3(-0.5, 0.75, -0.45));
    vec3 hal = normalize(lig - rd);
    float dif = clamp(dot(n, lig), 0.0, 1.0) * softShadow(p + n * 0.002, lig, uShadow);
    float occ = ambientOcclusion(p, n);
    float skyLight = clamp(0.5 + 0.5 * n.y, 0.0, 1.0);
    float bounce = clamp(dot(n, -lig * vec3(1.0, 0.0, 1.0)), 0.0, 1.0) * clamp(1.0 - p.y, 0.0, 1.0);
    float spe = pow(clamp(dot(n, hal), 0.0, 1.0), 48.0) * dif * (0.04 + 0.96 * pow(1.0 - clamp(dot(hal, lig), 0.0, 1.0), 5.0));
    vec3 a = albedo(hit.y, p);
    vec3 light = 2.2 * dif * uKey;
    light += 0.55 * skyLight * vec3(0.45, 0.6, 1.0) * occ;
    light += 0.3 * bounce * vec3(0.5, 0.3, 0.2) * occ;
    col = a * light + 3.0 * spe * uKey;
    col = mix(col, sky, 1.0 - exp(-0.00035 * hit.x * hit.x * hit.x));
  }

  col = pow(col / (1.0 + col), vec3(0.4545));
  col *= 0.6 + 0.4 * pow(16.0 * (fragCoord.x / iResolution.x) * (fragCoord.y / iResolution.y) * (1.0 - fragCoord.x / iResolution.x) * (1.0 - fragCoord.y / iResolution.y), 0.15);
  fragColor = vec4(col, 1.0);
}
