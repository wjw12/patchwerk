#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D sP;
uniform int uN;
uniform int uWidth;
uniform vec3 uT;
uniform vec3 uR;
uniform vec3 uS;
out vec4 fragColor;

vec3 rotate(vec3 p, vec3 deg) {
  vec3 a = radians(deg);
  float cx = cos(a.x);
  float sx = sin(a.x);
  p = vec3(p.x, cx * p.y - sx * p.z, sx * p.y + cx * p.z);
  float cy = cos(a.y);
  float sy = sin(a.y);
  p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
  float cz = cos(a.z);
  float sz = sin(a.z);
  p = vec3(cz * p.x - sz * p.y, sz * p.x + cz * p.y, p.z);
  return p;
}

void main() {
  ivec2 id = ivec2(gl_FragCoord.xy);
  int i = id.y * uWidth + id.x;
  if (i >= uN) discard;
  vec3 p = texelFetch(sP, id, 0).xyz * uS;
  fragColor = vec4(rotate(p, uR) + uT, 1.0);
}
