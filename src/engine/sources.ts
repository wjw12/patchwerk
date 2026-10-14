import melt from "../ops/melt.glsl?raw";
import passthrough from "../ops/out.glsl?raw";
import template from "../ops/template.glsl?raw";
import warp from "../ops/warp.glsl?raw";

export const COPY_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUv;
out vec4 fragColor;
void main() {
  fragColor = texture(uTex, vUv);
}
`;

export const PASSTHROUGH = passthrough;
export const WARP = warp;
export const MELT = melt;
export const TEMPLATE = template;

/** The webcam TOP: this tab's camera cropped to fill the cook size, or a moving test picture of a person. */
export const WEBCAM_FS = `#version 300 es
precision highp float;
uniform sampler2D uVideo;
uniform float uLive;
uniform float uMirror;
uniform vec2 uVideoSize;
uniform vec2 uSize;
uniform float uTime;
in vec2 vUv;
out vec4 fragColor;

float ellipse(vec2 p, vec2 c, vec2 r) { return length((p - c) / r); }
float box(vec2 p, vec2 c, vec2 r) { return max(abs(p.x - c.x) - r.x, abs(p.y - c.y) - r.y); }
float segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

vec3 testPicture(vec2 uv) {
  vec2 p = (uv - 0.5) * vec2(uSize.x / uSize.y, 1.0);
  float t = uTime;
  vec3 col = mix(vec3(0.13, 0.11, 0.15), vec3(0.44, 0.39, 0.37), uv.y);
  col = mix(col, vec3(0.95, 0.9, 0.78), smoothstep(0.01, 0.0, box(p, vec2(0.55, 0.2), vec2(0.2, 0.22))));
  col *= 0.8 + 0.2 * step(0.5, fract(p.x * 7.0 + 0.3)) * step(p.y, -0.2) + 0.2 * step(-0.2, p.y);

  vec2 light = normalize(vec2(0.8, 0.4));
  float sway = 0.07 * sin(t * 0.8);
  vec2 head = vec2(-0.1 + sway, 0.08 + 0.025 * sin(t * 1.3));
  vec2 shoulder = vec2(-0.1 + sway * 0.5, -0.6);
  vec3 skin = vec3(0.86, 0.62, 0.5);
  vec3 shirt = vec3(0.1, 0.3, 0.56);

  float bodyD = ellipse(p, shoulder, vec2(0.42, 0.36));
  col = mix(col, shirt * (0.6 + 0.4 * dot(normalize(p - shoulder), light)), step(bodyD, 1.0));
  float raise = smoothstep(-0.2, 0.4, sin(t * 0.55));
  vec2 hand = mix(vec2(0.32, -0.55), vec2(0.36 + 0.07 * sin(t * 5.0), 0.02 + 0.03 * cos(t * 5.0)), raise);
  col = mix(col, shirt * 0.9, step(segment(p, shoulder + vec2(0.3, 0.12), hand), 0.065));
  col = mix(col, skin * 0.8, step(box(p, vec2(head.x * 0.9 - 0.01, head.y - 0.26), vec2(0.06, 0.12)), 0.0));

  vec2 hr = vec2(0.16, 0.21);
  float headD = ellipse(p, head, hr);
  vec2 n = (p - head) / hr;
  col = mix(col, skin * (0.55 + 0.45 * clamp(dot(n, light) + 0.4, 0.0, 1.0)), step(headD, 1.0));
  float hair = step(headD, 1.04) * step(head.y + 0.06 + 0.03 * sin(p.x * 40.0), p.y);
  col = mix(col, vec3(0.12, 0.07, 0.06), hair);
  float blink = step(0.06, fract(t * 0.31));
  for (int side = -1; side <= 1; side += 2) {
    float eye = ellipse(p, head + vec2(0.06 * float(side), 0.02), vec2(0.022, 0.016 * blink + 0.002));
    col = mix(col, vec3(0.08, 0.05, 0.05), step(eye, 1.0));
  }
  float mouth = abs(ellipse(p, head + vec2(0.0, -0.06), vec2(0.06, 0.035)) - 1.0);
  col = mix(col, vec3(0.45, 0.15, 0.15), step(mouth, 0.18) * step(p.y, head.y - 0.07));
  col = mix(col, skin * (0.7 + 0.3 * dot(normalize(p - hand + 0.001), light)), step(ellipse(p, hand, vec2(0.065, 0.08)), 1.0));

  float grain = fract(sin(dot(floor(uv * uSize) + fract(t * 7.0) * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
  return col + (grain - 0.5) * 0.04;
}

void main() {
  if (uLive < 0.5) {
    fragColor = vec4(testPicture(vUv), 1.0);
    return;
  }
  float fill = max(uSize.x / uVideoSize.x, uSize.y / uVideoSize.y);
  vec2 uv = (vUv - 0.5) * uSize / (uVideoSize * fill) + 0.5;
  if (uMirror > 0.5) uv.x = 1.0 - uv.x;
  fragColor = vec4(texture(uVideo, uv).rgb, 1.0);
}
`;
