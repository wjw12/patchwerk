uniform float uRelief; // @range 0 40 default 14 label "Relief"
uniform vec3 uInk; // @color #12324a
uniform vec3 uGlow; // @color #ffb35c

// Shades the reaction-diffusion state on iChannel0: B concentration as height,
// central-difference normals sized by iChannelResolution, a two-tone ramp and a rim.

float height(vec2 uv) {
  return texture(iChannel0, uv).g;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec2 px = 1.0 / iChannelResolution[0].xy;
  float h = height(uv);
  float dx = height(uv + vec2(px.x, 0.0)) - height(uv - vec2(px.x, 0.0));
  float dy = height(uv + vec2(0.0, px.y)) - height(uv - vec2(0.0, px.y));
  vec3 n = normalize(vec3(-dx * uRelief, -dy * uRelief, 1.0));
  vec3 lig = normalize(vec3(-0.4, 0.6, 0.7));
  float dif = clamp(dot(n, lig), 0.0, 1.0);
  float spe = pow(clamp(dot(reflect(-lig, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 24.0);

  float v = smoothstep(0.08, 0.38, h);
  vec3 base = mix(vec3(0.94, 0.92, 0.86), uInk, v);
  base = mix(base, uGlow, smoothstep(0.02, 0.12, h) * (1.0 - v) * 0.85);
  vec3 col = base * (0.35 + 0.75 * dif) + 0.35 * spe;
  float vig = smoothstep(1.3, 0.2, length(uv - 0.5) * 1.6);
  fragColor = vec4(col * vig, 1.0);
}
