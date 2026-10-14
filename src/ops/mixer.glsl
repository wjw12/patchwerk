uniform float uA; // @range 0 2 default 1 label "A gain"
uniform float uB; // @range 0 2 default 0.5 label "B gain"
uniform float uMode; // @range 0 2 default 1 label "Mode: add, screen, multiply"

// Composites iChannel0 (A) over iChannel1 (B).
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 a = texture(iChannel0, uv).rgb * uA;
  vec3 b = texture(iChannel1, uv).rgb * uB;
  vec3 add = a + b;
  vec3 screen = 1.0 - (1.0 - clamp(a, 0.0, 1.0)) * (1.0 - clamp(b, 0.0, 1.0)) + max(a - 1.0, 0.0);
  vec3 mult = a * b;
  vec3 col = uMode < 0.5 ? add : uMode < 1.5 ? screen : mult;
  fragColor = vec4(col, 1.0);
}
