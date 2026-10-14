// @feedback
// Ghost trails: last frame drifts (zoom, spin, rise, RGB split) and the camera fades in over it.
// iChannel0 is the camera. iChannel3 is last frame.
uniform float uFresh; // @range 0.02 1 default 0.3 label "Fresh frame"
uniform float uGlow; // @range 0 1 default 0.5 label "Light trails"
uniform float uDecay; // @range 0.8 1 default 0.94 label "Trail decay"
uniform float uZoom; // @range -0.03 0.03 default 0.006 label "Drift zoom"
uniform float uSpin; // @range -0.05 0.05 default 0 label "Drift spin"
uniform float uRise; // @range -0.01 0.01 default 0.002 label "Drift rise"
uniform float uSplit; // @range 0 0.02 default 0.004 label "RGB split"

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float aspect = iResolution.x / iResolution.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float s = sin(uSpin);
  float k = cos(uSpin);
  c = mat2(k, -s, s, k) * c * (1.0 - uZoom);
  vec2 back = c / vec2(aspect, 1.0) + 0.5 - vec2(0.0, uRise);
  vec3 prev = vec3(
    texture(iChannel3, back + vec2(uSplit, 0.0)).r,
    texture(iChannel3, back).g,
    texture(iChannel3, back - vec2(uSplit, 0.0)).b);
  vec3 cam = texture(iChannel0, uv).rgb;
  vec3 echo = mix(prev, cam, uFresh);
  vec3 glow = max(prev * uDecay, cam);
  fragColor = vec4(mix(echo, glow, uGlow), 1.0);
}
