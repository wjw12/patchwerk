#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D sA;
uniform sampler2D sB;
uniform sampler2D sC;
uniform vec4 uA;
uniform vec4 uB;
uniform vec4 uC;
uniform int uUseA;
uniform int uUseB;
uniform int uUseC;
uniform int uOper;
uniform int uN;
uniform int uWidth;
out vec4 fragColor;

void main() {
  ivec2 id = ivec2(gl_FragCoord.xy);
  int i = id.y * uWidth + id.x;
  if (i >= uN) discard;
  vec4 A = uUseA == 1 ? texelFetch(sA, id, 0) : uA;
  vec4 B = uUseB == 1 ? texelFetch(sB, id, 0) : uB;
  vec4 C = uUseC == 1 ? texelFetch(sC, id, 0) : uC;
  vec4 result;
  if (uOper == 1) result = A - B;
  else if (uOper == 2) result = mix(A, B, clamp(C.x, 0.0, 1.0));
  else result = A + B * C;
  result.w = 1.0;
  fragColor = result;
}
