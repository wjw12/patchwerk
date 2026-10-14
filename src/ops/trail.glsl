uniform float uDecay; // @range 0.5 0.995 default 0.92 label "Decay"
uniform float uZoom; // @range -0.04 0.04 default 0.006 label "Zoom"
uniform float uTwist; // @range -0.05 0.05 default 0.003 label "Twist"
uniform float uKick; // @range 0 0.1 default 0.02 label "Bass kick"
// @feedback

// iChannel0: the image to smear. iChannel1 (optional): the audio TOP; its bass pushes the zoom.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float bass = texture(iChannel1, vec2(0.03, 0.25)).r;
  vec2 c = (uv - 0.5) * vec2(iResolution.x / iResolution.y, 1.0);
  float a = uTwist * (1.0 + bass * 2.0);
  c = mat2(cos(a), -sin(a), sin(a), cos(a)) * c;
  c /= 1.0 + uZoom + bass * uKick;
  vec2 back = c / vec2(iResolution.x / iResolution.y, 1.0) + 0.5;
  vec3 prev = texture(iChannel3, back).rgb;
  vec3 now = texture(iChannel0, uv).rgb;
  fragColor = vec4(max(now, prev * uDecay), 1.0);
}
