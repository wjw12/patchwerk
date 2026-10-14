uniform float uSwirl; // @range -0.05 0.05 default 0.014 label "Swirl"
uniform float uZoom; // @range 0.98 1.02 default 0.996 label "Zoom"

// Buffer B: Buffer A this frame (iChannel0 wire), turned and pulled outward a little.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 half_ = 0.5 * iResolution.xy;
  vec2 p = fragCoord - half_;
  float r = length(p) / iResolution.y;
  float a = uSwirl * (0.4 + 2.0 * r);
  p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p * uZoom;
  fragColor = vec4(texture(iChannel0, (p + half_) / iResolution.xy).rgb, 1.0);
}
