#version 300 es
precision highp float;
precision highp sampler2D;

// Level, the pre page then opacity. Gamma > 1 darkens midtones (pow, not 1/gamma).
// Opacity scales rgb and alpha: the viewer shows rgb, so alpha alone would not dim a render.

uniform sampler2D uTex;
uniform float uInvert;
uniform float uBlack;
uniform float uBrightness;
uniform float uGamma;
uniform float uContrast;
uniform float uOpacity;
in vec2 vUv;
out vec4 fragColor;

void main() {
  vec4 color = texture(uTex, vUv);
  vec3 rgb = color.rgb;
  if (uInvert > 0.5) rgb = 1.0 - rgb;
  float floorBlack = min(uBlack, 0.999);
  rgb = (rgb - floorBlack) / (1.0 - floorBlack);
  rgb += uBrightness;
  rgb = pow(max(rgb, vec3(0.0)), vec3(max(uGamma, 0.001)));
  rgb = (rgb - 0.5) * uContrast + 0.5;
  fragColor = vec4(rgb, color.a) * uOpacity;
}
