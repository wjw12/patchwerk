#version 300 es
precision highp float;

// Each point is a sphere facing the camera, lit in view space (Blinn-Phong).
in vec3 vView;

uniform vec3 uDiff;
uniform vec3 uSpec;
uniform vec3 uAmb;
uniform vec3 uEmit;
uniform float uShininess;
// Sum of the ambient lights' color.
uniform vec3 uAmbient;
uniform int uLightCount;
// xyz in view space; w = 1 a point light's position, w = 0 a distant light's direction toward the light.
uniform vec4 uLightPos[4];
uniform vec3 uLightColor[4];
out vec4 fragColor;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  c.y = -c.y;
  float d = dot(c, c);
  if (d > 1.0) discard;
  vec3 N = vec3(c, sqrt(1.0 - d));
  vec3 V = normalize(-vView);
  vec3 rgb = uAmb * uAmbient + uEmit;
  for (int i = 0; i < 4; i++) {
    if (i >= uLightCount) break;
    vec4 light = uLightPos[i];
    vec3 L = light.w > 0.5 ? normalize(light.xyz - vView) : normalize(light.xyz);
    float diffuse = max(dot(N, L), 0.0);
    vec3 H = normalize(L + V);
    float spec = diffuse > 0.0 ? pow(max(dot(N, H), 0.0), uShininess) : 0.0;
    rgb += uLightColor[i] * (uDiff * diffuse + uSpec * spec);
  }
  fragColor = vec4(rgb, 1.0);
}
