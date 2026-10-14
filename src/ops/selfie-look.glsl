// Row tears on the beat, pixel cells, a three-color posterize, neon edges, halftone digits.
// iChannel0 is the echo, iChannel1 the raw camera (edges), iChannel2 the audio.
uniform vec3 uShadow; // @color #1a0b24 label "Shadow"
uniform vec3 uMid; // @color #ff2199 label "Midtone"
uniform vec3 uLight; // @color #d6ff3d label "Highlight"
uniform vec3 uEdgeColor; // @color #ffffff label "Edge color"
uniform float uLevels; // @range 2 8 default 4 label "Levels"
uniform float uPalette; // @range 0 1 default 1 label "Palette mix"
uniform float uPixel; // @range 1 32 default 3 label "Pixel size"
uniform float uEdges; // @range 0 3 default 1 label "Edges"
uniform float uTear; // @range 0 0.3 default 0.05 label "Tear"
uniform float uTearRows; // @range 4 80 default 24 label "Tear rows"
uniform float uTearRate; // @range 0 30 default 8 label "Tear rate"
uniform float uBeat; // @range 0 4 default 1.5 label "Beat glitch"
uniform float uDigits; // @range 0 1 default 0 label "Digits"
uniform float uDigitSize; // @range 6 40 default 12 label "Digit size"
uniform float uScan; // @range 0 1 default 0.3 label "Scanlines"

const int FONT[10] = int[10](31599, 9362, 29671, 29391, 23497, 31183, 31215, 29257, 31727, 31695);

float glyph(int n, vec2 p) {
  ivec2 c = ivec2(floor(p * vec2(3.0, 5.0)));
  if (c.x < 0 || c.x > 2 || c.y < 0 || c.y > 4) return 0.0;
  int bit = 14 - ((4 - c.y) * 3 + c.x);
  return float((FONT[n] >> bit) & 1);
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

vec3 palette(float l) {
  float q = clamp(floor(l * uLevels) / (uLevels - 1.0), 0.0, 1.0);
  return q < 0.5 ? mix(uShadow, uMid, q * 2.0) : mix(uMid, uLight, q * 2.0 - 1.0);
}

float edgeAt(vec2 uv) {
  vec2 px = 1.5 / iResolution.xy;
  float tl = luma(texture(iChannel1, uv + px * vec2(-1, 1)).rgb);
  float t = luma(texture(iChannel1, uv + px * vec2(0, 1)).rgb);
  float tr = luma(texture(iChannel1, uv + px * vec2(1, 1)).rgb);
  float l = luma(texture(iChannel1, uv + px * vec2(-1, 0)).rgb);
  float r = luma(texture(iChannel1, uv + px * vec2(1, 0)).rgb);
  float bl = luma(texture(iChannel1, uv + px * vec2(-1, -1)).rgb);
  float b = luma(texture(iChannel1, uv + px * vec2(0, -1)).rgb);
  float br = luma(texture(iChannel1, uv + px * vec2(1, -1)).rgb);
  float gx = tr + 2.0 * r + br - tl - 2.0 * l - bl;
  float gy = tl + 2.0 * t + tr - bl - 2.0 * b - br;
  return smoothstep(0.15, 0.6, length(vec2(gx, gy)));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float bass = texture(iChannel2, vec2(0.02, 0.25)).x;
  float amount = uTear * (1.0 + bass * uBeat);
  float tick = floor(iTime * uTearRate);
  float row = floor(uv.y * uTearRows);
  float torn = step(1.0 - clamp(amount * 3.0, 0.0, 0.9), hash(vec2(row, tick)));
  float shift = (hash(vec2(row + 17.0, tick)) - 0.5) * 2.0 * amount * torn;
  uv.x = fract(uv.x + shift);

  vec2 cell = vec2(uPixel);
  vec2 at = (floor(uv * iResolution.xy / cell) + 0.5) * cell / iResolution.xy;
  vec3 cam = vec3(
    texture(iChannel0, at + vec2(shift * 0.3, 0.0)).r,
    texture(iChannel0, at).g,
    texture(iChannel0, at - vec2(shift * 0.3, 0.0)).b);
  vec3 col = mix(cam, palette(luma(cam)), uPalette);
  col = mix(col, uEdgeColor, clamp(edgeAt(uv) * uEdges, 0.0, 1.0));

  vec2 size = vec2(uDigitSize, uDigitSize * 1.5);
  vec2 dcell = floor(fragCoord / size);
  float l = luma(texture(iChannel0, (dcell + 0.5) * size / iResolution.xy).rgb);
  float ink = glyph(int(clamp(l * 9.99, 0.0, 9.0)), (fract(fragCoord / size) - vec2(0.2, 0.18)) / vec2(0.6, 0.64));
  col = mix(col, uShadow + palette(l) * ink, uDigits);

  col *= 1.0 - uScan * 0.5 * step(0.5, fract(fragCoord.y * 0.5));
  fragColor = vec4(col, 1.0);
}
