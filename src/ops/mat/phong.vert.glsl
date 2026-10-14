#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D sP;
uniform mat4 uView;
uniform mat4 uProj;
uniform float uSize;
uniform vec2 uViewport;
uniform float uMaxPoint;
uniform int uWidth;

out vec3 vCenter;

void main() {
  int i = gl_VertexID;
  ivec2 id = ivec2(i - (i / uWidth) * uWidth, i / uWidth);
  vec4 P = texelFetch(sP, id, 0);
  vec4 view = uView * vec4(P.xyz, 1.0);
  vCenter = view.xyz;
  gl_Position = uProj * view;
  // Off axis a sphere projects wider than 2r/z; the near side (z - r) gives a sprite that covers it.
  // Past the GPU's largest point the sphere is cut to the sprite; the ray below still shades it truly.
  float z = max(-view.z - uSize, 0.01);
  gl_PointSize = clamp(uSize * uProj[1][1] * uViewport.y / z, 1.0, uMaxPoint);
  // Behind the camera, or the camera inside the sphere: nothing to draw.
  if (-view.z <= uSize) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
