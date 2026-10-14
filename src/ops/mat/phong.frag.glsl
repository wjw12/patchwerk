#version 300 es
precision highp float;

// Each point is a sphere of radius uSize in world units: a ray per fragment finds the true
// surface point, its normal and its depth, so spheres overlap correctly. Lit in view space.
in vec3 vCenter;

uniform mat4 uProj;
uniform vec2 uViewport;
uniform float uSize;
uniform vec3 uDiff;
uniform vec3 uSpec;
uniform vec3 uAmb;
uniform vec3 uEmit;
uniform float uShininess;
// Sum of the ambient lights' color.
uniform vec3 uAmbient;
uniform int uLightCount;
// xyz view space: a point or cone light's position, or a distant light's direction toward it.
// w: 0 distant, 1 point, 2 cone.
uniform vec4 uLightPos[8];
// A cone's axis (view space, pointing away from the light) and the cosine of its outer edge.
uniform vec4 uLightAxis[8];
// rgb color × dimmer, and the cosine of a cone's inner edge.
uniform vec4 uLightColor[8];
out vec4 fragColor;

void main() {
  // The view ray through this pixel; the sprite only bounds where to look.
  vec2 ndc = gl_FragCoord.xy / uViewport * 2.0 - 1.0;
  vec3 dir = normalize(vec3(ndc.x / uProj[0][0], ndc.y / uProj[1][1], -1.0));
  float b = dot(dir, vCenter);
  float h = b * b - dot(vCenter, vCenter) + uSize * uSize;
  if (h < 0.0) discard;
  vec3 P = dir * (b - sqrt(h));
  vec3 N = (P - vCenter) / uSize;
  vec4 clip = uProj * vec4(P, 1.0);
  gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;

  vec3 V = -dir;
  vec3 rgb = uAmb * uAmbient + uEmit;
  for (int i = 0; i < 8; i++) {
    if (i >= uLightCount) break;
    vec4 light = uLightPos[i];
    vec3 L = light.w > 0.5 ? normalize(light.xyz - P) : normalize(light.xyz);
    float reach = 1.0;
    if (light.w > 1.5) {
      vec4 axis = uLightAxis[i];
      reach = smoothstep(axis.w, uLightColor[i].w, dot(-L, axis.xyz));
    }
    float diffuse = max(dot(N, L), 0.0);
    vec3 H = normalize(L + V);
    float spec = diffuse > 0.0 ? pow(max(dot(N, H), 0.0), uShininess) : 0.0;
    rgb += uLightColor[i].rgb * reach * (uDiff * diffuse + uSpec * spec);
  }
  fragColor = vec4(rgb, 1.0);
}
