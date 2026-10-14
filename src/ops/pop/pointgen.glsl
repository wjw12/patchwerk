#version 300 es
precision highp float;

uniform int uN;
uniform int uWidth;
uniform int uShape;
uniform float uS;
out vec4 fragColor;

void main() {
  ivec2 id = ivec2(gl_FragCoord.xy);
  int i = id.y * uWidth + id.x;
  if (i >= uN) discard;
  if (uShape == 1) {
    float y = 1.0 - (float(i) + 0.5) / float(uN) * 2.0;
    float radius = sqrt(max(0.0, 1.0 - y * y));
    float phi = 2.399963229728653 * float(i);
    fragColor = vec4(cos(phi) * radius * uS, y * uS, sin(phi) * radius * uS, 1.0);
  } else {
    float ang = 6.283185307179586 * (float(i) + 0.5) / float(uN);
    fragColor = vec4(cos(ang) * uS, sin(ang) * uS, 0.0, 1.0);
  }
}
