uniform float uGain; // @range 0 2 default 1 label "Gain"

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 col = 0.5 + 0.5 * cos(iTime + uv.xyx * 6.2831 + vec3(0.0, 2.0, 4.0));
  fragColor = vec4(col * uGain, 1.0);
}
