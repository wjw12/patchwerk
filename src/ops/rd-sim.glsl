uniform float uFeed; // @range 0.01 0.08 default 0.0545 label "Feed"
uniform float uKill; // @range 0.04 0.07 default 0.062 label "Kill"
// @feedback

// Gray-Scott reaction-diffusion. State lives in the feedback buffer:
// r = chemical A, g = chemical B, b = 1 once seeded (a cleared buffer reads 0).
// One explicit Euler step per frame, wrap-around edges via texelFetch.
// Drag on the viewer or hover a cursor to drop more B.

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec4 cell(ivec2 p, ivec2 size) {
  return texelFetch(iChannel3, (p + size) % size, 0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  ivec2 size = ivec2(iChannelResolution[3].xy);
  ivec2 p = ivec2(fragCoord);
  vec4 c = cell(p, size);

  if (c.b < 0.5) {
    vec2 g = floor(fragCoord / 24.0);
    float spot = step(0.86, hash12(g)) * step(length(fract(fragCoord / 24.0) - 0.5), 0.3);
    fragColor = vec4(1.0, spot, 1.0, 1.0);
    return;
  }

  vec2 lap = -c.rg;
  lap += 0.2 * (cell(p + ivec2(1, 0), size).rg + cell(p - ivec2(1, 0), size).rg + cell(p + ivec2(0, 1), size).rg + cell(p - ivec2(0, 1), size).rg);
  lap += 0.05 * (cell(p + ivec2(1, 1), size).rg + cell(p - ivec2(1, 1), size).rg + cell(p + ivec2(1, -1), size).rg + cell(p - ivec2(1, -1), size).rg);

  float a = c.r;
  float b = c.g;
  float abb = a * b * b;
  float na = a + (1.0 * lap.x - abb + uFeed * (1.0 - a));
  float nb = b + (0.5 * lap.y + abb - (uKill + uFeed) * b);

  for (int i = 0; i < 8; i++) {
    if (i >= iCursorCount) break;
    if (distance(fragCoord, iCursors[i].xy * iResolution.xy) < 10.0) nb = 0.9;
  }
  if (iMouse.z > 0.0 && distance(fragCoord, iMouse.xy) < 10.0) nb = 0.9;

  fragColor = vec4(clamp(na, 0.0, 1.0), clamp(nb, 0.0, 1.0), 1.0, 1.0);
}
