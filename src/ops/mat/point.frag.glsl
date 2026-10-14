#version 300 es
precision highp float;

uniform float uAlpha;
uniform vec3 uColor;
out vec4 fragColor;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  if (d > 1.0) discard;
  float falloff = smoothstep(1.0, 0.15, d);
  vec3 rgb = uColor * uAlpha * falloff;
  fragColor = vec4(rgb, falloff);
}
