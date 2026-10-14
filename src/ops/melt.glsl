uniform float uMelt; // @range 0 2 default 0.85 label "Melt"
uniform vec3 uTint; // @color #ff7a3d
// @feedback

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float pull = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= iCursorCount) break;
    pull += 0.08 / (distance(uv, iCursors[i].xy) + 0.045);
  }
  float bass = texture(iChannel1, vec2(0.04, 0.25)).r;
  vec2 drip = uv + vec2(0.0, -uMelt * (pull + bass) * 0.018);
  vec3 photo = texture(iChannel0, drip).rgb;
  vec3 prev = texture(iChannel3, drip).rgb;
  float lit = max(prev.r, max(prev.g, prev.b));
  float hold = lit < 0.03 ? 0.0 : 0.84;
  vec3 col = mix(photo * uTint, prev, hold);
  col += photo * (0.18 + bass * 0.35);
  fragColor = vec4(col, 1.0);
}
