#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D sP;
uniform mat4 uView;
uniform mat4 uViewProj;
uniform float uScale;
uniform float uFocus;
uniform int uWidth;

void main() {
  int i = gl_VertexID;
  ivec2 id = ivec2(i - (i / uWidth) * uWidth, i / uWidth);
  vec4 P = texelFetch(sP, id, 0);
  vec4 view = uView * vec4(P.xyz, 1.0);
  gl_Position = uViewProj * vec4(P.xyz, 1.0);
  float z = max(abs(view.z), 0.001);
  gl_PointSize = clamp(uScale * (1.0 + uFocus / z), 1.0, 64.0);
}
