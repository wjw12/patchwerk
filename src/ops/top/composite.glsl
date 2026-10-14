#version 300 es
precision highp float;
precision highp sampler2D;

// Two-input composite. Over is premultiplied Porter-Duff. Both inputs are sampled at the same uv.

uniform sampler2D uA;
uniform sampler2D uB;
uniform int uOp;
in vec2 vUv;
out vec4 fragColor;

void main() {
  vec4 a = texture(uA, vUv);
  vec4 b = texture(uB, vUv);
  if (uOp == 1) fragColor = a + b;
  else if (uOp == 2) fragColor = a * b;
  else if (uOp == 3) fragColor = a - b;
  else if (uOp == 4) fragColor = abs(a - b);
  else if (uOp == 5) fragColor = 1.0 - (1.0 - a) * (1.0 - b);
  else if (uOp == 6) fragColor = max(a, b);
  else if (uOp == 7) fragColor = min(a, b);
  else fragColor = vec4(a.rgb + b.rgb * (1.0 - a.a), a.a + b.a * (1.0 - a.a));
}
