uniform float uSplit; // @range 0 8 default 2.5 label "Chromatic split (px)"
uniform float uGlow; // @range 0 2 default 0.8 label "Glow"
uniform float uGrain; // @range 0 0.2 default 0.05 label "Grain"

// Three-input compositor.
// iChannel0 = foreground A, iChannel1 = background B, iChannel2 = matte.
// Matte picks A over B; chromatic split and a 13-tap glow use iChannelResolution
// so offsets stay in source pixels; screen-blended glow, grain, grade.

vec3 sampleSplit(sampler2D tex, vec2 uv, vec2 px) {
  vec2 dir = (uv - 0.5) * uSplit * px;
  return vec3(texture(tex, uv + dir).r, texture(tex, uv).g, texture(tex, uv - dir).b);
}

vec3 glow(sampler2D tex, vec2 uv, vec2 px) {
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int i = -6; i <= 6; i++) {
    float w = exp(-float(i * i) / 18.0);
    vec2 o = float(i) * px * 3.0;
    sum += w * (texture(tex, uv + vec2(o.x, 0.0)).rgb + texture(tex, uv + vec2(0.0, o.y)).rgb);
    wsum += 2.0 * w;
  }
  return sum / wsum;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec2 px0 = 1.0 / iChannelResolution[0].xy;
  vec2 px1 = 1.0 / iChannelResolution[1].xy;
  vec2 px2 = 1.0 / iChannelResolution[2].xy;

  vec3 a = sampleSplit(iChannel0, uv, px0);
  vec3 b = (1.0 - exp(-1.3 * sampleSplit(iChannel1, uv, px1))) * 0.6;
  float matte = texture(iChannel2, uv).r;
  float edge = clamp(length(vec2(
    texture(iChannel2, uv + vec2(px2.x, 0.0)).r - texture(iChannel2, uv - vec2(px2.x, 0.0)).r,
    texture(iChannel2, uv + vec2(0.0, px2.y)).r - texture(iChannel2, uv - vec2(0.0, px2.y)).r)) * 2.0, 0.0, 1.0);

  vec3 col = mix(b, a, matte);
  vec3 g = glow(iChannel0, uv, px0) * matte + glow(iChannel1, uv, px1) * 0.3;
  col = 1.0 - (1.0 - col) * (1.0 - clamp(g * uGlow, 0.0, 1.0));
  col += edge * vec3(1.0, 0.85, 0.6) * 0.6;

  float grain = fract(sin(dot(fragCoord + fract(iTime) * 97.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  col += grain * uGrain;
  col = pow(max(col, 0.0), vec3(0.95, 1.0, 1.08));
  fragColor = vec4(col, 1.0);
}
