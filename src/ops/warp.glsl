uniform float uScale; // @range 0.4 2.8 default 1.25 label "Scale"
uniform float uSpeed; // @range 0 1.5 default 0.28 label "Speed"
uniform vec3 uTint; // @color #8fd0ff

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
  float t = iTime * uSpeed;
  vec2 p = uv * uScale;
  vec3 col = vec3(0.015, 0.01, 0.03);
  for (int i = 0; i < 6; i++) {
    p += 0.28 * vec2(sin(p.y * 1.8 + t + float(i) * 0.7), cos(p.x * 1.6 - t * 0.85));
    float d = abs(sin(p.x * 2.4) * sin(p.y * 2.4));
    col += vec3(0.18, 0.35, 1.0) * exp(-d * 7.0);
    col += uTint * exp(-abs(sin(p.x + p.y + t)) * 4.0) * 0.18;
    col += vec3(1.0, 0.32, 0.55) * exp(-d * 18.0);
  }
  float vig = smoothstep(1.25, 0.15, length(uv));
  fragColor = vec4(col * vig, 1.0);
}
