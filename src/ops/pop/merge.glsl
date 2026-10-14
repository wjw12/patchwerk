#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D s0;
uniform sampler2D s1;
uniform int uN0;
uniform int uN;
uniform int uWidth;
out vec4 fragColor;

ivec2 at(int index) {
  return ivec2(index - (index / uWidth) * uWidth, index / uWidth);
}

void main() {
  ivec2 id = ivec2(gl_FragCoord.xy);
  int i = id.y * uWidth + id.x;
  if (i >= uN) discard;
  if (i < uN0) fragColor = texelFetch(s0, at(i), 0);
  else fragColor = texelFetch(s1, at(i - uN0), 0);
}
