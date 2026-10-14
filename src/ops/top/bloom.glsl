#version 300 es
precision highp float;
precision highp sampler2D;

// Bloom as a mip chain: a 13-tap downsample per level (pass 0 adds pregamma and
// the threshold), then a 9-tap tent upsample that blends each level into the
// one above it. Every tap overlaps its neighbours, so a bright point spreads
// into a smooth falloff instead of a grid of copies.

uniform sampler2D uTex;
uniform sampler2D uScene;
uniform sampler2D uBase;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uFill;
uniform float uIntensity;
uniform float uPregamma;
uniform int uPass;
in vec2 vUv;
out vec4 fragColor;

vec3 tap(vec2 uv) {
  vec3 color = texture(uTex, uv).rgb;
  if (uPass == 0) color = pow(max(color, vec3(0.0)), vec3(max(uPregamma, 0.001)));
  return color;
}

vec3 down13(vec2 uv) {
  vec2 t = uTexel;
  vec3 a = tap(uv + t * vec2(-2.0, 2.0));
  vec3 b = tap(uv + t * vec2(0.0, 2.0));
  vec3 c = tap(uv + t * vec2(2.0, 2.0));
  vec3 d = tap(uv + t * vec2(-2.0, 0.0));
  vec3 e = tap(uv);
  vec3 f = tap(uv + t * vec2(2.0, 0.0));
  vec3 g = tap(uv + t * vec2(-2.0, -2.0));
  vec3 h = tap(uv + t * vec2(0.0, -2.0));
  vec3 i = tap(uv + t * vec2(2.0, -2.0));
  vec3 j = tap(uv + t * vec2(-1.0, 1.0));
  vec3 k = tap(uv + t * vec2(1.0, 1.0));
  vec3 l = tap(uv + t * vec2(-1.0, -1.0));
  vec3 m = tap(uv + t * vec2(1.0, -1.0));
  return e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
}

vec3 tent9(vec2 uv) {
  vec2 t = uTexel;
  vec3 sum = texture(uTex, uv).rgb * 4.0;
  sum += (texture(uTex, uv + vec2(t.x, 0.0)).rgb + texture(uTex, uv - vec2(t.x, 0.0)).rgb) * 2.0;
  sum += (texture(uTex, uv + vec2(0.0, t.y)).rgb + texture(uTex, uv - vec2(0.0, t.y)).rgb) * 2.0;
  sum += texture(uTex, uv + t).rgb + texture(uTex, uv - t).rgb;
  sum += texture(uTex, uv + vec2(t.x, -t.y)).rgb + texture(uTex, uv + vec2(-t.x, t.y)).rgb;
  return sum / 16.0;
}

void main() {
  if (uPass == 0) {
    vec3 color = down13(vUv);
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float knee = max(uThreshold * 0.5, 0.0001);
    float soft = clamp(luma - uThreshold + knee, 0.0, 2.0 * knee);
    soft = (soft * soft) / (4.0 * knee + 0.0001);
    float weight = max(luma - uThreshold, soft) / max(luma, 0.0001);
    fragColor = vec4(color * weight, 1.0);
    return;
  }
  if (uPass == 1) {
    fragColor = vec4(down13(vUv), 1.0);
    return;
  }
  if (uPass == 2) {
    // Each wider level adds on top, scaled by fill: 0 keeps only the tight halo, 1 adds every level in full.
    vec3 wide = tent9(vUv);
    vec3 base = texture(uBase, vUv).rgb;
    fragColor = vec4(base + wide * clamp(uFill, 0.0, 1.0), 1.0);
    return;
  }
  vec3 scene = texture(uScene, vUv).rgb;
  vec3 bloom = texture(uTex, vUv).rgb;
  fragColor = vec4(scene + bloom * uIntensity, 1.0);
}
