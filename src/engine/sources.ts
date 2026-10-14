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
