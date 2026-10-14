// @feedback
// Hydra o5: invert last frame, one odd-even column swap, blend this frame's o1, contrast.
// iChannel0 is o1 (same cook). iChannel3 is last o5, nearest.
uniform float uMix; // @range 0 0.6 default 0.081 label "o1 mix"
uniform float uSort; // @range 0 1 default 0.01 label "Sort threshold"
uniform float uContrast; // @range 0.8 1.3 default 1.041 label "Contrast"

// pxsort's body samples the pass input (tex0), so the .invert() in front of it never reaches the compare.
vec4 pxsort(vec2 frag, vec2 res) {
  vec2 uv = frag / res;
  float parity = mod(float(iFrame), 2.0) * 2.0 - 1.0;
  float vp = mod(floor(frag.x), 2.0) * 2.0 - 1.0;
  vec2 dir = vec2(1.0, 0.0) * parity * vp / res;
  vec4 curr = texture(iChannel3, uv);
  if (uv.x + dir.x < 0.0 || uv.x + dir.x > 1.0) return curr;
  vec4 comp = texture(iChannel3, uv + dir);
  float gCurr = (curr.r + curr.g + curr.b) / 3.0;
  float gComp = (comp.r + comp.g + comp.b) / 3.0;
  if (dir.x < 0.0) {
    if (gCurr > uSort && gComp > gCurr) return comp;
    return curr;
  }
  if (gComp > uSort && gCurr >= gComp) return comp;
  return curr;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec4 sorted = pxsort(fragCoord, iResolution.xy);
  vec4 o1 = texture(iChannel0, fragCoord / iResolution.xy);
  vec4 blended = sorted * (1.0 - uMix) + o1 * uMix;
  fragColor = vec4((blended.rgb - 0.5) * uContrast + 0.5, blended.a);
}
