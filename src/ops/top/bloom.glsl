#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uTex;
uniform sampler2D uScene;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uFill;
uniform float uIntensity;
uniform float uPregamma;
uniform int uPass;
in vec2 vUv;
out vec4 fragColor;

vec3 pregamma(vec3 color) {
  return pow(max(color, vec3(0.0)), vec3(max(uPregamma, 0.001)));
}

void main() {
  if (uPass == 0) {
    vec3 color = pregamma(texture(uTex, vUv).rgb);
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float knee = max(uThreshold * 0.5, 0.0001);
    float soft = clamp(luma - uThreshold + knee, 0.0, 2.0 * knee);
    soft = (soft * soft) / (4.0 * knee + 0.0001);
    float weight = max(luma - uThreshold, soft) / max(luma, 0.0001);
    fragColor = vec4(color * weight, 1.0);
    return;
  }
  if (uPass == 1 || uPass == 2) {
    vec2 offset = uTexel * mix(1.0, 6.0, clamp(uFill, 0.0, 1.0));
    vec3 color = texture(uTex, vUv + vec2(-offset.x, -offset.y)).rgb
      + texture(uTex, vUv + vec2(offset.x, -offset.y)).rgb
      + texture(uTex, vUv + vec2(-offset.x, offset.y)).rgb
      + texture(uTex, vUv + vec2(offset.x, offset.y)).rgb;
    fragColor = vec4(color * 0.25, 1.0);
    return;
  }
  vec3 scene = texture(uScene, vUv).rgb;
  vec3 bloom = texture(uTex, vUv).rgb;
  fragColor = vec4(scene + bloom * uIntensity, 1.0);
}
