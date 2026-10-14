uniform float uCells; // @range 2 20 default 7 label "Cells"

// Animated hexagon matte, white inside, black outside, soft edges.

vec4 hexCoords(vec2 uv) {
  const vec2 r = vec2(1.0, 1.7320508);
  const vec2 h = r * 0.5;
  vec2 a = mod(uv, r) - h;
  vec2 b = mod(uv - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  return vec4(gv, uv - gv);
}

float hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
  vec4 h = hexCoords(uv * uCells);
  float phase = sin(iTime * 1.1 + length(h.zw) * 0.6 - atan(h.w, h.z + 0.001) * 2.0); // the center cell sits at (0,0): atan(0,0) is undefined
  float size = 0.22 + 0.22 * phase;
  float m = smoothstep(size + 0.03, size - 0.03, hexDist(h.xy));
  fragColor = vec4(vec3(m), 1.0);
}
