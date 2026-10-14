// Hydra o3. iChannel0 is o1, iChannel1 is o5. Posterize, grain, pink dither pixels.
// time is already speed-scaled (0.025).

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

vec4 oscAt(vec2 st, float frequency, float sync) {
  float t = iTime * HYDRA_SPEED * sync;
  float osc = sin((st.x + t) * frequency) * 0.5 + 0.5;
  return vec4(osc, osc, osc, 1.0);
}

vec4 noiseAt(vec2 st, float scale, float offset) {
  float n = hydraNoise(vec3(st * scale, offset * iTime * HYDRA_SPEED));
  return vec4(n, n, n, 1.0);
}

float luma(vec3 c) {
  return dot(c, vec3(0.2125, 0.7154, 0.0721));
}

vec4 thresh(vec4 c, float threshold, float tolerance) {
  return vec4(vec3(smoothstep(threshold - tolerance, threshold + tolerance, luma(c.rgb))), c.a);
}

vec4 colorize(vec4 o1) {
  vec3 black = vec3(0.8015686274509806, 0.9882352941176471, 0.2196078431372548);
  vec3 mid = vec3(0.45098039215686275);
  vec3 white = vec3(0.8627450980392157);
  vec4 lo = thresh(o1, 0.110297, 0.04);
  vec4 band = thresh(o1, 0.1, 0.04) * (vec4(1.0) - thresh(o1, 0.8, 0.04));
  vec4 hi = thresh(o1, 0.8, 0.04);
  vec4 c = vec4(black, 1.0) * (vec4(1.0) - lo);
  c += vec4(mid, 1.0) * band;
  c += vec4(white, 1.0) * hi;
  return c;
}

// lib-screen dither4, including the two cells that never pass.
// lib-screen dither4, including the two cells that never pass (12+1/32 and 3).
float bayer4(int x, int y) {
  if (x == 0 && y == 0) return 1.0 / 32.0;
  if (x == 1 && y == 0) return 12.0 + 1.0 / 32.0;
  if (x == 2 && y == 0) return 3.0;
  if (x == 3 && y == 0) return 15.0 / 16.0 + 1.0 / 32.0;
  if (x == 0 && y == 1) return 8.0 / 16.0 + 1.0 / 32.0;
  if (x == 1 && y == 1) return 4.0 / 16.0 + 1.0 / 32.0;
  if (x == 2 && y == 1) return 11.0 / 16.0 + 1.0 / 32.0;
  if (x == 3 && y == 1) return 6.0 / 16.0 + 1.0 / 32.0;
  if (x == 0 && y == 2) return 2.0 / 16.0 + 1.0 / 32.0;
  if (x == 1 && y == 2) return 14.0 / 16.0 + 1.0 / 32.0;
  if (x == 2 && y == 2) return 1.0 / 16.0 + 1.0 / 32.0;
  if (x == 3 && y == 2) return 9.0 / 16.0 + 1.0 / 32.0;
  if (x == 0 && y == 3) return 10.0 / 16.0 + 1.0 / 32.0;
  if (x == 1 && y == 3) return 6.0 / 16.0 + 1.0 / 32.0;
  if (x == 2 && y == 3) return 13.0 / 16.0 + 1.0 / 32.0;
  return 5.0 / 16.0 + 1.0 / 32.0;
}

vec4 greenPixels(vec2 screen, vec2 frag) {
  vec3 pink = vec3(1.0, 0.29019607843137263, 0.5031372549019607);
  vec4 o5 = texture(iChannel1, fract(screen));
  vec4 scrolled = texture(iChannel0, fract(screen + vec2(0.0, 4.9685)));
  vec4 delta = abs(o5 - scrolled);
  float maskLuma = luma(thresh(delta, 0.406777, 0.4).rgb);
  vec3 rgb = pink * maskLuma;
  int x = int(mod(frag.x, 4.0));
  int y = int(mod(frag.y, 4.0));
  float b = bayer4(x, y);
  rgb = vec3(step(b, rgb.r), step(b, rgb.g), step(b, rgb.b));
  return vec4(rgb, maskLuma);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 screen = fragCoord / iResolution.xy;
  vec2 st = screen - vec2(0.5);
  st *= 1.0 / vec2(1.02 * 1.02, 1.02);
  st += vec2(0.5);
  // scale, then modulate by osc. The 0.002 noise modulate only moves the src sample.
  vec2 warped = st + oscAt(st, 1.5, 0.348524).xy * 0.695;
  vec2 sampled = warped + noiseAt(warped, 926.0, 5.0).xy * 0.002;

  vec4 base = colorize(texture(iChannel0, fract(sampled)));
  base.rgb *= (oscAt(warped, 438000.0, 0.1) + vec4(0.600653, 0.6, 0.6, 1.0)).rgb;
  vec4 grain = noiseAt(warped, 524.0, 20.0);
  float grainA = smoothstep(0.4999999, 0.7000001, luma(grain.rgb));
  base.rgb += grain.rgb * grainA * 0.194975;
  base.rgb += vec3(-0.1);
  vec4 high = thresh(texture(iChannel0, fract(screen)), 0.8, 0.15);
  base.rgb *= 1.0 - high.rgb;
  vec4 poster = colorize(texture(iChannel0, fract(screen)));
  vec4 speckle = noiseAt(screen, 500.0, 20.0);
  float speckleA = smoothstep(0.4999999, 0.7000001, luma(speckle.rgb));
  base.rgb += poster.rgb + speckle.rgb * speckleA * high.rgb;
  vec4 dots = greenPixels(screen, fragCoord);
  fragColor = vec4(dots.rgb + base.rgb * (1.0 - dots.a), 1.0);
}
