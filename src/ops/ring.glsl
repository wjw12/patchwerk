uniform float uRadius; // @range 0.05 0.5 default 0.2 label "Radius"
uniform float uHeight; // @range 0 0.6 default 0.22 label "Bar height"
uniform float uBars; // @range 16 128 default 72 label "Bars"
uniform float uFeed; // @range 0 0.99 default 0.88 label "Feedback"
uniform float uSpin; // @range -0.1 0.1 default 0.012 label "Spin"
// @feedback

// iChannel0: the audio TOP. Row 0 (v 0.25) is the spectrum, row 1 (v 0.75) the waveform.
vec3 hue(float h) {
  return 0.5 + 0.5 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67)));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
  float r = length(uv);
  float u = abs(atan(uv.y, uv.x)) / 3.14159265;
  float bass = texture(iChannel0, vec2(0.02, 0.25)).r;

  float bar = floor(u * uBars);
  float bu = (bar + 0.5) / uBars;
  float spec = texture(iChannel0, vec2(pow(bu, 1.6) * 0.7, 0.25)).r;
  float inBar = step(abs(fract(u * uBars) - 0.5), 0.34);
  float r0 = uRadius * (1.0 + bass * 0.3);
  float top = r0 + 0.01 + spec * uHeight;
  float barMask = inBar * smoothstep(r0 - 0.003, r0 + 0.003, r) * smoothstep(top + 0.003, top - 0.003, r);
  vec3 col = hue(bu * 0.55 + iTime * 0.04) * barMask * (0.25 + spec * 0.6);

  float wave = texture(iChannel0, vec2(u, 0.75)).r - 0.5;
  float wr = r0 * 0.78 + wave * 0.06;
  col += vec3(0.85, 0.92, 1.0) * 0.0012 / (abs(r - wr) + 0.004);
  col += hue(iTime * 0.04 + 0.5) * bass * 0.12 * smoothstep(r0 * 0.7, 0.0, r);

  float s = 0.985 - bass * 0.02;
  float a = uSpin;
  vec2 p = mat2(cos(a), -sin(a), sin(a), cos(a)) * uv * s;
  vec2 back = p * vec2(iResolution.y / iResolution.x, 1.0) + 0.5;
  vec3 prev = texture(iChannel3, back).rgb;
  prev = mix(prev, prev.gbr, 0.06);
  col = max(col, prev * uFeed);
  fragColor = vec4(col, 1.0);
}
