// The shaders the landing page shows as code. What is printed is what runs.

export const TUNNEL = `// Paste a ShaderToy mainImage. It runs as is.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
  float r = length(p);
  float depth = 0.35 / r + iTime * 0.6;
  float lane = atan(p.y, p.x) * 2.546;
  vec2 g = abs(fract(vec2(lane, depth * 3.0)) - 0.5);
  float line = smoothstep(0.1, 0.0, min(g.x, g.y) * (0.4 + r));
  vec3 pink = vec3(1.0, 0.13, 0.6);
  vec3 lime = vec3(0.84, 1.0, 0.24);
  vec3 col = mix(pink, lime, step(0.92, fract(depth * 0.5))) * line * r * 1.8;
  fragColor = vec4(col + pink * 0.015 / r, 1.0);
}`;

export const SPECTRUM = `// iChannel0 is the audio: row 0.25 spectrum, row 0.75 waveform.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec2 p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
  float bass = texture(iChannel0, vec2(0.01, 0.25)).x;
  float angle = abs(atan(p.x, p.y)) / 3.1416;
  float spec = texture(iChannel0, vec2(angle * 0.7, 0.25)).x;
  float ring = abs(length(p) - 0.42 - spec * 0.32 - bass * 0.08);
  float wave = texture(iChannel0, vec2(uv.x, 0.75)).x;
  float trace = abs(uv.y - wave);
  vec3 col = vec3(1.0, 0.13, 0.6) * (0.006 / ring);
  col += vec3(0.84, 1.0, 0.24) * (0.002 / trace) * 0.6;
  fragColor = vec4(col * (0.6 + bass), 1.0);
}`;

/** The agent's edit: these lines arrive typed, then the preview switches to the full shader. */
export const AGENT_ADDED = [4, 5, 6, 9, 10];

export const AGENT = `float hash(float n) { return fract(sin(n) * 43758.5453); }

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float kick = exp(-fract(iTime * 2.0) * 5.0);
  float row = floor(uv.y * 28.0) + floor(iTime * 9.0);
  uv.x += (hash(row) - 0.5) * kick * 0.35;
  float bars = step(0.5, fract(uv.x * 9.0 + iTime * 0.3));
  vec3 col = mix(vec3(0.07, 0.04, 0.1), vec3(1.0, 0.13, 0.6), bars);
  float flash = step(0.94, hash(row * 7.0)) * kick;
  col = mix(col, vec3(0.84, 1.0, 0.24), flash);
  fragColor = vec4(col, 1.0);
}`;

export const AGENT_BEFORE = AGENT.split("\n")
  .filter((_, i) => !AGENT_ADDED.includes(i))
  .join("\n");

export const CURSORS = `// iCursors[i].xy is where each person in the room points.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec2 aspect = vec2(iResolution.x / iResolution.y, 1.0);
  vec3 col = vec3(0.05, 0.03, 0.07);
  float waves = 0.0;
  for (int i = 0; i < iCursorCount; i++) {
    float d = length((uv - iCursors[i].xy) * aspect);
    waves += sin(d * 70.0 - iTime * 7.0) * exp(-d * 3.0);
  }
  col += vec3(1.0, 0.13, 0.6) * smoothstep(0.2, 0.9, waves);
  col += vec3(0.84, 1.0, 0.24) * smoothstep(0.9, 1.4, waves);
  fragColor = vec4(col, 1.0);
}`;

/** Digits as halftone: a 3×5 font, chosen and lit by a moving field. */
export const DIGITS = `const int FONT[10] = int[10](31599, 9362, 29671, 29391, 23497, 31183, 31215, 29257, 31727, 31695);

float glyph(int n, vec2 p) {
  ivec2 c = ivec2(floor(p * vec2(3.0, 5.0)));
  if (c.x < 0 || c.x > 2 || c.y < 0 || c.y > 4) return 0.0;
  int bit = 14 - ((4 - c.y) * 3 + c.x);
  return float((FONT[n] >> bit) & 1);
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 size = vec2(9.0, 14.0) * iResolution.y / 520.0;
  vec2 cell = floor(fragCoord / size);
  vec2 local = fract(fragCoord / size);
  vec2 p = (cell * size + size * 0.5 - iResolution.xy * vec2(0.5, 1.15)) / iResolution.y;
  float arc = abs(length(p * vec2(0.62, 1.0)) - 0.78);
  float wave = 0.5 + 0.5 * sin(atan(p.y, p.x) * 9.0 - iTime * 1.4 + length(p) * 6.0);
  float field = smoothstep(0.34, 0.0, arc) * (0.35 + 0.65 * wave);
  field *= 0.75 + 0.25 * hash(cell + floor(iTime * 6.0));
  int n = int(clamp(field * 9.99, 0.0, 9.0));
  float ink = glyph(n, (local - vec2(0.2, 0.18)) / vec2(0.6, 0.64)) * step(0.12, field);
  vec3 plum = vec3(0.42, 0.2, 0.5);
  vec3 col = mix(plum, vec3(1.0, 0.13, 0.6), smoothstep(0.3, 0.6, field));
  col = mix(col, vec3(0.84, 1.0, 0.24), smoothstep(0.82, 0.95, field));
  fragColor = vec4(vec3(0.071, 0.043, 0.09) + col * ink * (0.35 + field), 1.0);
}`;
