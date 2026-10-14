uniform float uExposure; // @range 0 4 default 1.2 label "Exposure"
uniform float uVignette; // @range 0 2 default 0.8 label "Vignette"
uniform float uGrain; // @range 0 0.2 default 0.03 label "Grain"
uniform vec3 uShadow; // @color #1a0a3a
uniform vec3 uMid; // @color #ff3d9a
uniform vec3 uHigh; // @color #fff1c9

// iChannel0 luminance mapped through a three-stop gradient, then tonemapped.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 src = texture(iChannel0, uv).rgb * uExposure;
  float l = dot(src, vec3(0.299, 0.587, 0.114));
  vec3 ramp = mix(uShadow, uMid, smoothstep(0.0, 0.5, l));
  ramp = mix(ramp, uHigh, smoothstep(0.45, 1.6, l));
  vec3 col = ramp * (1.0 - exp(-l * 2.5)) + src * 0.15;
  col = col / (1.0 + col * 0.35);
  vec2 v = uv - 0.5;
  col *= 1.0 - uVignette * dot(v, v) * 1.6;
  float n = fract(sin(dot(fragCoord + fract(iTime) * 97.0, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) * uGrain;
  fragColor = vec4(max(col, 0.0), 1.0);
}
