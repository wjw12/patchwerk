// @feedback
// Hydra o1: layers o4, o6, o0 inlined, then one odd-even row swap of the previous frame.
// iChannel3 is last frame, nearest. time is already speed-scaled (0.025).

vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float hydraNoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0 / 7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

const float HYDRA_SPEED = 0.025;

vec2 hydraSpin(vec2 st, float ang) {
  vec2 xy = st - vec2(0.5);
  float c = cos(ang);
  float s = sin(ang);
  // hydra mat2(cos, -sin, sin, cos), column-major
  return vec2(c * xy.x + s * xy.y, -s * xy.x + c * xy.y) + vec2(0.5);
}

vec2 hydraRotate(vec2 st, float angle, float speed) {
  return hydraSpin(st, angle + speed * iTime * HYDRA_SPEED);
}

vec2 hydraScale(vec2 st, float amount, float xMult, float yMult) {
  vec2 xy = st - vec2(0.5);
  xy *= 1.0 / vec2(amount * xMult, amount * yMult);
  return xy + vec2(0.5);
}

vec2 hydraPixelate(vec2 st, float xPixels, float yPixels) {
  vec2 xy = vec2(xPixels, yPixels);
  return (floor(st * xy) + 0.5) / xy;
}

vec2 hydraModulate(vec2 st, vec4 c, float amount) {
  return st + c.xy * amount;
}

vec2 hydraModulateRotate(vec2 st, vec4 c, float multiple) {
  return hydraSpin(st, c.x * multiple);
}

vec4 hydraOsc(vec2 st, float frequency, float sync, float offset) {
  float t = iTime * HYDRA_SPEED * sync;
  float r = sin((st.x - offset / frequency + t) * frequency) * 0.5 + 0.5;
  float g = sin((st.x + t) * frequency) * 0.5 + 0.5;
  float b = sin((st.x + offset / frequency + t) * frequency) * 0.5 + 0.5;
  return vec4(r, g, b, 1.0);
}

vec4 hydraNoiseTex(vec2 st, float scale, float offset) {
  float n = hydraNoise(vec3(st * scale, offset * iTime * HYDRA_SPEED));
  return vec4(n, n, n, 1.0);
}

vec4 layerO4(vec2 screen) {
  vec2 st = hydraPixelate(screen, 428.0, 621.0);
  st = hydraScale(st, 4.77, 1.0, 1.0);
  st = hydraModulateRotate(st, hydraNoiseTex(hydraRotate(st, 814.0, 0.841183), 12.0, 1.5), 0.5);
  st = hydraModulate(st, hydraNoiseTex(hydraPixelate(hydraRotate(st, 814.0, 1.05), 46.0, 16.0), 12.0, 0.1), 0.1);
  st = hydraRotate(st, 1.57, 2.0);
  return hydraOsc(st, 30.0, 0.1, 0.0);
}

vec4 layerO6(vec2 screen) {
  vec2 st = hydraPixelate(screen, 573.0, 5403.0);
  st = hydraScale(st, 9.1, 1.0, 1.0);
  st = hydraModulateRotate(st, hydraNoiseTex(hydraRotate(st, 815.0, 0.75), 2.8, 0.7), 1.560524);
  st = hydraModulate(st, hydraNoiseTex(hydraPixelate(hydraRotate(st, 815.0, 10.75), 46.0, 1.0), 3.6, 0.5), 0.1);
  st = hydraRotate(st, 1.57, 1.96);
  return hydraOsc(st, 56.0, 0.8, 0.0);
}

vec4 unoise(vec2 st) {
  float n = 0.5 + 0.5 * hydraNoise(vec3(st * 5.2, 0.1 * iTime * HYDRA_SPEED));
  return vec4(n, n, n, 1.0);
}

vec4 layerO0(vec2 screen) {
  vec4 c = unoise(hydraPixelate(screen, 256.0, 256.0));
  c = min(c, unoise(hydraPixelate(screen, 128.0, 128.0)));
  c = min(c, unoise(hydraPixelate(screen, 64.0, 64.0)));
  c = min(c, unoise(hydraPixelate(screen, 32.0, 32.0)));
  c = min(c, unoise(hydraPixelate(screen, 16.0, 16.0)));
  c = min(c, unoise(hydraPixelate(screen, 8.0, 8.0)));
  c = min(c, unoise(hydraPixelate(screen, 4.0, 4.0)));
  c = min(c, unoise(hydraPixelate(screen, 2.0, 2.0)));
  c *= 20.0;
  return mod(c, vec4(1.001));
}

vec4 hydraBlend(vec4 c0, vec4 c1, float amount) {
  return c0 * (1.0 - amount) + c1 * amount;
}

vec4 pysort(vec2 frag, vec2 res) {
  vec2 uv = frag / res;
  float parity = mod(float(iFrame), 2.0) * 2.0 - 1.0;
  float vp = mod(floor(frag.y), 2.0) * 2.0 - 1.0;
  vec2 dir = vec2(0.0, 1.0) * parity * vp / res;
  vec4 curr = texture(iChannel3, uv);
  if (uv.y + dir.y < 0.0 || uv.y + dir.y > 1.0) return curr;
  vec4 comp = texture(iChannel3, uv + dir);
  float gCurr = (curr.r + curr.g + curr.b) / 3.0;
  float gComp = (comp.r + comp.g + comp.b) / 3.0;
  if (dir.y < 0.0) {
    if (gCurr > 0.495 && gComp > gCurr) return comp;
    return curr;
  }
  if (gComp > 0.495 && gCurr >= gComp) return comp;
  return curr;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 screen = fragCoord / iResolution.xy;
  vec4 o4 = layerO4(screen);
  vec4 o6 = layerO6(screen);
  vec4 o0 = layerO0(screen);
  vec4 mid = hydraBlend(hydraBlend(o4, o6, 1.239), o0, -1.304);
  vec4 sorted = pysort(fragCoord, iResolution.xy);
  vec4 blended = hydraBlend(sorted, mid, 1.032);
  fragColor = vec4((blended.rgb - 0.5) * 1.237 + 0.5, blended.a);
}
