// @prev iChannel0 bufB
uniform float uDecay; // @range 0.9 1 default 0.985 label "Decay"

// Buffer A: Buffer B's last frame, softened and faded, plus three orbiting emitters.
// B reads A this frame by wire; A reads B last frame by @prev. That loop is the trail.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec2 px = 1.0 / iResolution.xy;
  vec3 col = texture(iChannel0, uv).rgb * 0.5;
  col += texture(iChannel0, uv + vec2(px.x, 0.0)).rgb * 0.125;
  col += texture(iChannel0, uv - vec2(px.x, 0.0)).rgb * 0.125;
  col += texture(iChannel0, uv + vec2(0.0, px.y)).rgb * 0.125;
  col += texture(iChannel0, uv - vec2(0.0, px.y)).rgb * 0.125;
  col *= uDecay;
  vec2 p = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float angle = iTime * (1.1 + fi * 0.37) + fi * 2.094;
    vec2 e = vec2(cos(angle), sin(angle)) * (0.22 + 0.08 * sin(iTime * 0.7 + fi));
    vec3 tint = 0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + fi * 2.0);
    col += tint * smoothstep(0.035, 0.0, length(p - e)) * 0.9;
  }
  fragColor = vec4(col, 1.0);
}
