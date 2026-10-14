uniform float uCount; // @range 2 24 default 9 label "Rings"
uniform vec3 uColor; // @color #3de0c4

// Concentric neon rings drifting outward from three moving centers.

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 c = 0.45 * vec2(sin(iTime * 0.31 + fi * 2.1), cos(iTime * 0.23 + fi * 1.7));
    float r = length(uv - c);
    float wave = abs(fract(r * uCount * 0.5 - iTime * 0.35) - 0.5);
    col += uColor.zxy * (fi == 0.0 ? 1.0 : 0.0) * smoothstep(0.14, 0.0, wave) * 1.6 / (1.0 + 2.5 * r);
    col += uColor * (fi == 1.0 ? 1.0 : 0.0) * smoothstep(0.14, 0.0, wave) * 1.6 / (1.0 + 2.5 * r);
    col += uColor.yzx * (fi == 2.0 ? 1.0 : 0.0) * smoothstep(0.14, 0.0, wave) * 1.6 / (1.0 + 2.5 * r);
  }
  fragColor = vec4(col, 1.0);
}
